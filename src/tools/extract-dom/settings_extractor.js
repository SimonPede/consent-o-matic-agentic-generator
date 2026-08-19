const fs = require("fs");
const path = require("path");
const diff = require("diff");

const CMP_SELECTORS_MAP = require("../../utils/cmp_selectors_map");
const CMP_SELECTORS = Object.keys(CMP_SELECTORS_MAP);

const { frameWordCounter, calculateFrameScore } = require("./element_scorer");
const extractFromFrame = require("./frame_extractor");

/**
 * Captures the interactive frame state for pre/post-click DOM comparison.
 * Called before and after clicking a settings button in clickAndExtractSettings().
 * 
 * Returns counts of visible inputs and buttons (used to detect whether a settings
 * view appeared) and full HTML (used for character-level diff via Diff.diffChars()).
 * 
 * Note: querySelectorAllDeep, getDeepInnerHTML, and isVisible are redefined here
 * because frame.evaluate() runs in browser context and cannot access Node.js scope.
 * 
 * @param {Frame} frame - Puppeteer frame to capture state from
 * @param {string|null} rootSelector - Optional CSS selector to limit the snapshot scope
 * @returns {{ inputs: number, buttons: number, html: string }}
 */
async function getFrameState(frame, rootSelector = null) {
    return await frame.evaluate((rootSelector) => {

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
         * In practice, CMPs seen so far use open Shadow DOMs (e.g., Usercentrics).
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
            //If `node` is a shadow host, traversal starts at `node.shadowRoot`.
            //Otherwise, traversal starts at `node` directly.
            let htmlResult = "";

			//Redirect evaluation to ShadowRoot when the node is a host element.
            const root = node.shadowRoot || node;

            for (const child of root.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    //Clone only the element shell first (no descendants).
                    let clone = child.cloneNode(false);

					//Inject recursively collected deep content, including nested shadow layers.
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

            //INPUT controls are often visually hidden and rendered through wrappers.
            //Treat them as visible when neither the input nor its parent is hidden.
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

			//`offsetParent === null` usually indicates `display:none` on self or ancestor.
            //Exclude fixed-position elements because they also return null natively.
            if (element.offsetParent === null && style.position !== "fixed") {
                return false;
            }

			const hasFunctionalDimensions = rect.width > 0 && rect.height > 0;
            const hasActiveAlphaChannel = parseFloat(style.opacity) > 0.05;

            return hasFunctionalDimensions && 
				style.visibility !== "hidden" && 
				hasActiveAlphaChannel;
        }

        const scopedRoot = rootSelector ? document.querySelector(rootSelector) : null;
        const rootNode = scopedRoot || document.body;

        return {
            inputs: querySelectorAllDeep("input[type='checkbox'], [role='switch'], .toggle, .switch, [class*='toggle']", rootNode).filter(isVisible).length, //Same false-positive risk as class-based toggle detection.
            buttons: querySelectorAllDeep("button, a, [role='button'], [class*='__btn'], .btn", rootNode).filter(isVisible).length,
            html: getDeepInnerHTML(rootNode)
        };
    }, rootSelector);
}

/**
 * Clicks a settings/preferences button and extracts the resulting DOM.
 * Separated to avoid duplication between regex-based and LLM-based
 * settings button detection paths.
 * 
 * Click strategy (three tiers):
 * 1. Shadow-DOM-aware JS traversal with `>>>` support.
 * 2. Explicit mouse event dispatch (`mousedown`, `mouseup`, `click`).
 * 3. Puppeteer fallback via `frame.click()` if JS traversal fails.
 * 
 * After clicking, three outcomes are handled:
 * 1. New iframe(s) appear: scored via calculateFrameScore(); best candidate is extracted.
 * 2. Same frame changes significantly: extract from current frame if functional controls exist.
 * 3. No meaningful change: return null.
 * 
 * @param {Frame} frame - Puppeteer frame containing the settings button
 * @param {{ selector: string, text?: string }} settingsButton - Button descriptor from regex or LLM (`>>>` supported)
 * @param {Page} page - Puppeteer page instance (needed to detect new frames)
 * @param {string|null} cmpType - detected CMP name, propagated to extraction result
 * @returns {Object|null} - extracted settings DOM object, or null if click had no effect
 */
async function clickAndExtractSettings(frame, settingsButton, page, cmpType) {
    //CMP clicks may either mutate the current frame or spawn a new iframe.
    //Handle both paths and use DOM-diff heuristics as an additional signal.
    //TODO:Evaluate thresholds empirically (current defaults: >500 chars, >0 inputs, >=2 buttons).
    const selector = settingsButton.selector ? settingsButton.selector : "";
    const textToMatch = settingsButton.text ? settingsButton.text : "";
    const stateScopeSelector = selector.includes(" >>> ") ? selector.split(" >>> ")[0].trim() : null;

    console.error(`State snapshot scope selector: ${stateScopeSelector || "<document.body>"}`);

    const framesBefore = page.frames().map(f => f.url()); //Frame URL snapshot before click.
    const oldState = await getFrameState(frame, stateScopeSelector);

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
            //Dispatch full mouse sequence for CMPs that ignore `element.click()`.
            target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return true;
        }
        return false;
    }, selector, textToMatch);

    console.error(`settings click target result - clickSuccess: ${clickSuccess}`);

    if (!clickSuccess) {
        console.error("JS Click failed. Trying Puppeteer fallback...");
        try {
            await frame.click(selector);
            console.error("Puppeteer fallback click succeeded.");
        } catch (err) {
            console.error("Puppeteer click also failed:", err.message);
            return null;
        }
    }

    //Wait until DOM mutations settle, or return after timeout.
    //Reduces extraction from intermediate render states.
    //Step-by-step behavior:
    //1) Start observing DOM mutations inside the target frame.
    //2) Every mutation resets a short "stability timer".
    //3) If no mutation arrives during stableTime, consider the DOM settled.
    //4) If mutations never settle, force-resolve after timeout to avoid hanging.
    const waitForDOMStable = (frame, stableTime = 500, timeout = 5000) => {
        return frame.evaluate((stableTime, timeout) => {
            return new Promise((resolve) => {
                //`stableTimer` represents "quiet period completed".
                let stableTimer;

                //Observe changes to subtree structure, text nodes, and attributes.
                //If any change happens, restart the quiet-period timer.
                const observer = new MutationObserver(() => {
                    clearTimeout(stableTimer);
                    stableTimer = setTimeout(() => {
                        //No changes for `stableTime` ms -> DOM considered stable.
                        observer.disconnect();
                        resolve();
                    }, stableTime);
                });

                //Start observing from <body> for broad coverage of modal/settings UIs.
                observer.observe(document.body, { 
                    childList: true, subtree: true, 
                    characterData: true, attributes: true 
                });

                //Initial fallback: if no mutation is emitted at all, still resolve
                //after one stability window.
                stableTimer = setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, stableTime);

                //Hard timeout guard: if the page keeps mutating (animations, trackers,
                //live counters), stop waiting and continue pipeline execution.
                setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, timeout);
            });
        }, stableTime, timeout);
    };

    console.error("Waiting 3000ms after settings click before frame/diff inspection...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.error("Post-click wait finished. Collecting new frames...");
    const newFrames = page.frames().filter(f => !framesBefore.includes(f.url()));
    console.error(`New frame candidates detected: ${newFrames.length}`);

    const stablePromises = new Map();
    for (const f of newFrames) {
        console.error(`Scheduling DOM stability wait for frame: ${f.url()}`);
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
        console.error(`Best new frame selected for settings extraction: ${bestNewFrame.url()}`);
        console.error("Awaiting DOM stability for best new frame...");
        await stablePromises.get(bestNewFrame);
        console.error("DOM stability wait for best new frame finished. Extracting settings...");
        const settings = await extractFromFrame(bestNewFrame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
        settings.isIframe = bestNewFrame !== page.mainFrame();
        await Promise.allSettled([...stablePromises.values()]);

        return settings;
    } else {
        console.error("No qualifying new frame selected. Falling back to same-frame DOM diff analysis...");
        const newState = await getFrameState(frame, stateScopeSelector);

        const changes = diff.diffChars(oldState.html, newState.html);
        const addedChars = changes
            .filter(c => c.added) //Count only newly added characters.
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

        //TODO:Revisit heuristic quality; consider adding generic newly-rendered element counts.
        if (totalChange > 500 || addedInputs > 0 || addedButtons >= 2) {
            console.error(`Settings detected: ${addedChars} chars, ${addedInputs} inputs, ${addedButtons} buttons added.`);
            console.error("Awaiting same-frame DOM stability before extraction...");
            await waitForDOMStable(frame);
            console.error("Same-frame DOM stability wait finished. Extracting settings...");
            const settings = await extractFromFrame(frame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);

            if (settings.checkboxes.length > 0 || settings.toggles.length > 0 || settings.buttons.length > 2) {
                console.error(`Settings UI seems to be there! ${settings.checkboxes.length + settings.toggles.length} functional elements got found.`);
                settings.isIframe = frame !== page.mainFrame();
                await Promise.allSettled([...stablePromises.values()]);

                return settings;
            } else {
                console.error("Settings-page seems to have nearly no input elements! A false Ppositive after the click?!");
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