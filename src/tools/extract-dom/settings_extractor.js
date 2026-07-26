const fs = require("fs");
const path = require("path");
const diff = require("diff");

const CMP_SELECTORS_MAP = require("../../utils/cmp_selectors_map");
const CMP_SELECTORS = Object.keys(CMP_SELECTORS_MAP);

const { frameWordCounter, calculateFrameScore } = require("./element_scorer");
const extractFromFrame = require("./frame_extractor");

/**
 * Captures the current interactive state of a frame for DOM-diff comparison.
 * Called before and after clicking a settings button in clickAndExtractSettings().
 * 
 * Returns counts of visible inputs and buttons (used to detect if the settings
 * page loaded) and the full HTML (used for character-level diff via Diff.diffChars()).
 * 
 * Note: querySelectorAllDeep, getDeepInnerHTML and isVisible are redefined here
 * because frame.evaluate() runs in browser context and cannot access Node.js scope.
 * 
 * @param {Frame} frame - Puppeteer frame to capture state from
 * @returns {{ inputs: number, buttons: number, html: string }}
 */
async function getFrameState(frame) {
    return await frame.evaluate(() => {

        /**
         * Recursively queries the DOM including all Shadow DOM trees.
         * 
         * Standard querySelectorAll() cannot pierce Shadow DOM boundaries – elements
         * inside Shadow Roots are completely invisible to it. This function solves this
         * by first querying the current root (document or ShadowRoot), then finding all
         * elements that host a Shadow Root and recursing into each one.
         * 
         * Why this works: querySelectorAll() CAN search inside a ShadowRoot if called
         * directly ON the ShadowRoot object. So instead of trying to pierce the boundary,
         * we step through the door: find the host via el.shadowRoot, then call
         * querySelectorAll on the ShadowRoot itself.
         * 
         * Limitation: only works for open Shadow DOMs (mode: "open").
         * Closed Shadow DOMs (mode: "closed") are inaccessible via JavaScript by design.
         * In practice, CMPs use open Shadow DOMs (verified: Usercentrics).
         * 
         * Performance note: uses root.querySelectorAll("*") without Array.from() to avoid
         * unnecessary array allocation on large DOMs.
         * 
         * @param {string} selector - Functional CSS selector pattern to discover (e.g. "button", "[role='switch']")
         * @param {Document|ShadowRoot|HTMLElement} root - Boundary evaluation root (defaults to document)
         * @returns {Array<HTMLElement>} - All matching elements across light DOM and all Shadow DOMs
         */
        function querySelectorAllDeep(selector, root = document) {
            let nodes = Array.from(root.querySelectorAll(selector));

            const elements = root.querySelectorAll("*");
            for (let el of elements) {
                if (el.shadowRoot) {
                    nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
                }
            }
            return nodes;
        }

        /**
         * Recursively collects the full HTML of a node including all Shadow DOM content.
         * 
         * Standard innerHTML and outerHTML cannot see inside Shadow Roots.They silently
         * ignore all Shadow DOM content. This function rebuilds the HTML tree by walking
         * childNodes level by level (not querySelectorAll which also cannot pierce Shadow DOM)
         * and recursing into Shadow Roots whenever encountered.
         * 
         * Key design decision: uses childNodes (direct children only) instead of
         * querySelectorAll("*") (all descendants). This preserves the HTML hierarchy –
         * without it, results would look like "<aside></aside><button>Accept</button>"
         * instead of "<aside><button>Accept</button></aside>".
         * 
         * The trick: cloneNode(false) clones only the element shell without children,
         * then clone.innerHTML is set to the recursively collected deep content.
         * This ensures Shadow DOM content appears correctly nested in the output.
         * 
         * Entry point logic:
         *   const root = node.shadowRoot || node;
         *   --> If node is a Shadow Host: start from its Shadow Root
         *   --> If node is already a ShadowRoot or regular element: use it directly
         * 
         * Tested on: Usercentrics (deeply nested Shadow DOM)
         * 
         * @param {HTMLElement|ShadowRoot} node - Element or ShadowRoot to extract HTML from
         * @returns {string} - Full HTML string including all Shadow DOM content
         */
        function getDeepInnerHTML(node) {
            //Light DOM:
                // <aside id="usercentrics-cmp-ui">  Shadow Host --> aside.shadowRoot is truthy but "aside instanceof ShadowRoot" is falsy (checks not if element has shadow DOm but if its Shadow Root)
                //     #shadow-root (open)            Shadow Root
                //         <dialog>                   Shadow DOM content
                //             <button>Accept</button>
                //         </dialog>
            let htmlResult = "";

			//Redirect evaluation context if the targeted node functions as an active encapsulation host
            const root = node.shadowRoot || node;

            for (const child of root.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    //first clone the shell of the element (e.g: <div class=""...)
                    let clone = child.cloneNode(false);

					//Standard child.outerHTML would fail to capture downstream shadow layers if the child is a host.
                    //Instead, we recursively inject the deep structural layout mapping.
                    clone.innerHTML = getDeepInnerHTML(child);
                    htmlResult += clone.outerHTML;

                } else if (child.nodeType === Node.TEXT_NODE) {
                    htmlResult += child.textContent;
                }
            }
            return htmlResult;
        }

        /**
         * Determines whether an element is visible to the user.
         * 
         * Uses offsetParent === null as primary check: this is true when the element
         * or any ancestor has display:none, making it more reliable than checking
         * style.display directly.
         * 
         * Special case for INPUT elements: checkboxes are often visually hidden via CSS
         * (width:0, height:0) but replaced by styled labels. They are considered visible
         * as long as they are in the render tree and not visibility:hidden.
         * 
         * Note: opacity threshold 0.05 is pragmatic: may need empirical tuning.
         * Note: fixed-position elements are excluded from the offsetParent check
         *       because fixed elements always have offsetParent === null.
         * Note: does not use a strict viewport-check because i also want to find buttons
         * that are only seen if the user scrolls
         * 
         * @param {HTMLElement} element - element to check
         * @returns {boolean}
         */
        function isVisible(element) {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            //detecting input elements is a bit tricky
            //there are often hidden for more customization (no width, height etc)
            //if the parent is visible, i take it
            if (element.tagName === "INPUT") {
                const parentStyle = element.parentElement ? window.getComputedStyle(element.parentElement) : null;

                if (parentStyle && (parentStyle.display === "none" || parentStyle.visibility === "hidden")) {
                    return false;
                }

				if (style.display === "none" || style.visibility === "hidden") {
					return false;
				}
                return true;
            }

			//If the element or the container has display:none, "element.offsetParent === null" is true.
            //Fixed positioning context is a verified W3C edge case returning null natively!
            if (element.offsetParent === null && style.position !== "fixed") {
                return false;
            }

			const hasFunctionalDimensions = rect.width > 0 && rect.height > 0;
            const hasActiveAlphaChannel = parseFloat(style.opacity) > 0.05;

            return hasFunctionalDimensions && 
				style.visibility !== "hidden" && 
				hasActiveAlphaChannel;
        }

        return {
            inputs: querySelectorAllDeep("input[type='checkbox'], [role='switch'], .toggle, .switch, [class*='toggle']").filter(isVisible).length, //same limitation regarding false postives as mentioned above
            buttons: querySelectorAllDeep("button, a, [role='button']").filter(isVisible).length,
            html: getDeepInnerHTML(document.body)
        };
    });
}

/**
 * Clicks a settings/preferences button and extracts the resulting DOM.
 * Extracted as a separate function to avoid code duplication between the
 * regex-based and LLM-based settings button detection paths.
 * 
 *  Click strategy (three-tier):
 * 1. Shadow-DOM-aware JS injection: Performs deep traversal including piercing 
 * Shadow DOM boundaries via '>>>' syntax. Matches buttons by text label 
 * (case-insensitive) if provided to handle ambiguous/duplicate selectors.
 * 2. Event Dispatching: Triggers native mousedown, mouseup, and click sequences.
 * 3. Puppeteer Fallback: Uses standard frame.click() if the JS injection fails.
 * 
 * After clicking, three scenarios are handled:
 * 1. New iframe(s) appear: scored via calculateFrameScore(), best frame extracted.
 * 2. Existing frame DOM changes significantly (chars/inputs/buttons added):
 *    extracted from same frame if functional elements (checkboxes/toggles) are found.
 * 3. No significant change detected: returns null (click had no effect).
 * 
 * @param {Frame} frame - Puppeteer frame containing the settings button
 * @param {string} settingsButton - button object found by Regex or the LLM (supports >>> for Shadow DOM)
 * @param {Page} page - Puppeteer page instance (needed to detect new frames)
 * @param {string|null} cmpType - detected CMP name, propagated to extraction result
 * @returns {Object|null} - extracted settings DOM object, or null if click had no effect
 */
async function clickAndExtractSettings(frame, settingsButton, page, cmpType) {
    //the problem: i dont know what the click causes. Sometimes the DOM is updated in the same frame, sometimes a new iFrame pops up
    //two options: extract from all frames again
    //or compare the DOM of the frame before and after the click --> is it different? then extract from this frame
    //otherwise look for new iframes that got loaded
    //DOM change detection uses Diff.diffChars() for character-level comparison,
    //supplemented by visible input/button count changes as additional signals.
    //TODO: evaluate optimal thresholds empirically (currently: >500 chars, >0 inputs, >=2 buttons)
    const framesBefore = page.frames().map(f => f.url()); //which frames are there before the click?
    const oldState = await getFrameState(frame);

    const selector = settingsButton.selector ? settingsButton.selector : "";
    const textToMatch = settingsButton.text ? settingsButton.text : "";

    if (selector === "") {
        console.error(`clickAndExtractSettings did not get a selector for the settings button!`)
    } else if (textToMatch === "") {
        console.error(`clickAndExtractSettings did not get a text for the settings button!`)
    }

    console.error(`settings click target - selector: ${selector}, textMatch: ${textToMatch}`);

    const clickSuccess = await frame.evaluate((sel, btnText) => {
        const parts = sel.split(" >>> ");
        let currentRoot = document;
        let candidates = [];

        for (let i = 0; i < parts.length; i++) {
            if (i === parts.length - 1) {
                candidates = Array.from(currentRoot.querySelectorAll(parts[i]));
            } else {
                let host = currentRoot.querySelector(parts[i]);
                if (!host || !host.shadowRoot) return false;
                currentRoot = host.shadowRoot;
            }
        }
        
        if (candidates.length === 0) return false;

        let target = candidates[0];

        if (btnText) {
            const found = candidates.find(el => {
                const elText = (el.innerText || el.getAttribute("aria-label") || el.title || "").trim().toLowerCase();
                return elText.includes(btnText.toLowerCase()) || btnText.toLowerCase().includes(elText);
            });
            if (found) {
                target = found;
            }
        }

        if (target) {
            //mousedown + mouseup instead of target.click(): more reliable for CMPs
            //that listen to individual mouse events rather than the synthetic click event.
            //Recommended by supervisor Thomas Franklin Cory.
            target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return true;
        }
        return false;
    }, selector, textToMatch);

    if (!clickSuccess) {
        console.error("JS Click failed. Trying Puppeteer fallback...");
        try {
            await frame.click(selector);
        } catch (err) {
            console.error("Puppeteer click also failed:", err.message);
            return null;
        }
    }

    //honestly have to test this function, found it and hope it helps, did not write it myself
    const waitForDOMStable = (frame, stableTime = 500, timeout = 5000) => {
        return frame.evaluate((stableTime, timeout) => {
            return new Promise((resolve) => {
                let stableTimer;
                const observer = new MutationObserver(() => {
                    clearTimeout(stableTimer);
                    stableTimer = setTimeout(() => {
                        observer.disconnect();
                        resolve();
                    }, stableTime);
                });
                observer.observe(document.body, { 
                    childList: true, subtree: true, 
                    characterData: true, attributes: true 
                });
                stableTimer = setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, stableTime);
                setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, timeout);
            });
        }, stableTime, timeout);
    };

    await new Promise(resolve => setTimeout(resolve, 3000));
    const newFrames = page.frames().filter(f => !framesBefore.includes(f.url()));

    const stablePromises = new Map();
    for (const f of newFrames) {
        stablePromises.set(f, waitForDOMStable(f, 800, 6000));
    }

    try {
        await page.screenshot({ path: "after_click.png" });
    } catch (err) {
        console.error(`Debug settings screenshot skipped after timeout/error: ${err.message}`);
    }

    let bestNewFrame = null;
    let highestScore = 0;
    
    if (newFrames.length > 0) {
        console.error(`${newFrames.length} new frames after the click. Starting scoring...`);
        
        const currentFrames = page.frames();
        
        const avgWordCount = await frameWordCounter(currentFrames); 

        for (const newFrame of newFrames) {
            const score = await calculateFrameScore(newFrame, avgWordCount, CMP_SELECTORS_MAP);
            console.error(`Frame Score: ${score} for URL: ${newFrame.url()}`);
            
            if (score > highestScore) {
                highestScore = score;
                bestNewFrame = newFrame;
            }
        }
    }

    if (bestNewFrame) {
        await stablePromises.get(bestNewFrame);
        const settings = await extractFromFrame(bestNewFrame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
        settings.isIframe = bestNewFrame !== page.mainFrame();
        await Promise.allSettled([...stablePromises.values()]);

        return settings;
    } else {
        const newState = await getFrameState(frame);

        const changes = diff.diffChars(oldState.html, newState.html);
        const addedChars = changes
            .filter(c => c.added) //filteres for everything that is actually new
            .reduce((sum, c) => sum + c.count, 0);
        
        const removedChars = changes
            .filter(c => c.removed)
            .reduce((sum, c) => sum + c.count, 0);

        const totalChange = addedChars + removedChars;
        
        const addedInputs = newState.inputs - oldState.inputs;
        const addedButtons = newState.buttons - oldState.buttons;

        console.error(`DOM diff: ${addedChars} chars added, ${addedInputs} inputs added.`);
        console.error(`Old state: ${oldState.buttons} buttons, ${oldState.inputs} inputs.`);
        console.error(`New state: ${newState.buttons} buttons, ${newState.inputs} inputs.`);

        //TODO: evaluate if these are good indicators. Maybe include sth like: newly rendered elements in general?
        if (totalChange > 500 || addedInputs > 0 || addedButtons >= 2) {
            console.error(`Settings detected: ${addedChars} chars, ${addedInputs} inputs, ${addedButtons} buttons added.`);
            await waitForDOMStable(frame);
            const settings = await extractFromFrame(frame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);

            if (settings.checkboxes.length > 0 || settings.toggles.length > 0 || settings.buttons.length > 2) {
                console.error(`Settings UI seems to be there! ${settings.checkboxes.length + settings.toggles.length} functional elements got found.`);
                settings.isIframe = frame !== page.mainFrame();
                await Promise.allSettled([...stablePromises.values()]);

                return settings;
            } else {
                console.error("Settings-page seems to have no input elements! A False Positive after the click?!");
                await Promise.allSettled([...stablePromises.values()]);
                
                return null;
            }
        } else {
            console.error("Settings click seems to have had no effect");
            await Promise.allSettled([...stablePromises.values()]);

            return null;
        }
    }
}

module.exports = clickAndExtractSettings;
