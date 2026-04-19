const puppeteer = require("puppeteer");
const CMP_SELECTORS = require("../utils/cmp_selectors");
const SETTINGS_PATTERN = require("../utils/settingsButtons_terms");

/**
 * Minimizes HTML noise to optimize context for the LLM.
 * Removes non-structural data like scripts, inline styles, and event handlers
 * to reduce token count and focus on relevant DOM elements.
 */
function cleanHtml(html) {
    return html
        //removes all <script> tags and their internal logic
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        //strip inline CSS styles (style="...") as layout info is irrelevant for rule generation
        .replace(/\s*style="[^"]*"/gi, "")
        //removes inline JS event handlers (e.g., onclick, onload)
        .replace(/\s*on\w+="[^"]*"/gi, "")
        //collapses multiple whitespaces, tabs, and newlines into a singel one
        .replace(/\s+/g, " ")   
        .trim();
}
//clean HTML tested using heise.de banner
//version used: 
// function cleanHtml(html) {
//     return html
//     .replace(/\s*style="[^"]*"/gi, '') //no inline-style
//     .replace(/\s*on\w+="[^"]*"/gi, '')  //no event handler
//     .replace(/\s+/g, ' ')               //
//     .trim();
// }
//before: settings-subpage "21483",first banner page "15760"
//after:  settings-subpage "9845",first banner page "7937"
//--> reduction of around 50%

//using:
// function cleanHtml(html) {
//     return html
//         .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
//         .replace(/\s*style="[^"]*"/gi, '') //no inline-style
//         .replace(/\s*on\w+="[^"]*"/gi, '')  //no event handler
//         .replace(/\s+/g, ' ')               //
//         .trim();
// }
//changes nothing :)

async function extractFromFrame(frame, selectors) {
    const result = await frame.evaluate((selectors) => {

        //with this function i try to find every relevant element even if it is in the shadow DOM
        /**
         * Recursively queries the DOM including Shadow DOM trees.
         * 
         * Standard querySelectorAll() cannot pierce Shadow DOM boundaries, which means
         * elements inside Shadow DOMs (common in some CMPs) would be silently ignored. --> have to find a source for that statement!
         * 
         * This function works in two steps:
         * 1. Query the current root (document or shadowRoot) for the selector
         * 2. Find all child elements and check if any have a shadowRoot attached.
         *    If so, recurse into that shadow tree and append the results.
         * 
         * @param {string} selector - CSS selector to search for (e.g. "button")
         * @param {Document|ShadowRoot} root - Starting point for the search (default: document)
         * @returns {Array} - All matching elements across the entire DOM including Shadow DOMs
         */
        function querySelectorAllDeep(selector, root = document) {
            let nodes = Array.from(root.querySelectorAll(selector));
            const elements = Array.from(root.querySelectorAll("*"));
            for (let el of elements) {
                if (el.shadowRoot) {
                    nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
                }
            }
            return nodes;
        }

        /**
         * Extracts all HTML attributes of a given element as a key-value object.
         * Provides the LLM with the full attribute context (id, class, aria-label, 
         * data-* etc.) needed to generate precise CSS selectors for CoM rulesets.
         * 
         * @param {HTMLElement} el - HTML element to extract attributes from
         * @returns {Object} - key-value pairs of all attributes (e.g. { id: "btn-accept", class: "cmp-button" })
         */
        function extractAllAttributes(el) {
            const attributes = {};
            for(const attr of el.attributes) {
                attributes[attr.name] = attr.value;
            }
            return attributes;
        }

        /**
         * Finds the human-readable label text associated with a checkbox or toggle input.
         * Labels are critical for the LLM to map UI elements to consent categories (A-F).
         * 
         * Uses two strategies:
         * 1. Explicit association via <label for="inputId"> 
         * 2. Implicit association via closest wrapping <label> element
         * 
         * @param {HTMLInputElement} input - checkbox or toggle input element
         * @returns {string} - label text, or empty string if no label found
         */
        function findLabelForInput(input) {
            if (input.id) {
                const label = document.querySelector(`label[for="${input.id}"]`);
                if (label) {
                    return label.innerText.trim();
                }
            }
            const closestLabel = input.closest("label");
            return closestLabel ? closestLabel.innerText.trim() : "";
        }

        /**
         * Extracts basic structural information about the parent element of a given HTML element.
         * This helps the LLM understand the DOM hierarchy and use CoM's parent-target selector pattern.
         * 
         * Note: Only retrieves one level up. For deeply nested structures, the filteredHtml
         * provides additional context for the LLM to infer the full hierarchy.
         * 
         * @param {HTMLElement} el - HTML element found by querySelectorAllDeep()
         * @returns {Object} - tag, id, and className of the direct parent element, or null if no parent exists
         */
        function extractParentInfo(el) {
            return {
                tag: el.parentElement ? el.parentElement.tagName : null,
                id: el.parentElement ? el.parentElement.id : null,
                className: el.parentElement ? el.parentElement.className : null
            };
        }

        /**
         * Determines whether a clickable element (button, link) is visible to the user.
         * Filters out hidden elements that exist in the DOM but are not rendered,
         * to avoid passing irrelevant selectors to the LLM.
         * 
         * Checks: physical dimensions, CSS display/visibility/opacity.
         * Note: The opacity threshold (0.05) is a pragmatic choice and may need tuning.
         * Note: innerText.length > 0 filters out icon-only buttons without text –
         *       this may cause false negatives for some CMPs.
         * 
         * @param {HTMLElement} el - element to check
         * @returns {boolean}
         */
        function isVisible(el) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                el.innerText.length > 0 && 
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                parseFloat(style.opacity) > 0.05
            );
        }

        /**
         * Visibility check for input elements (checkboxes, toggles).
         * Identical to isVisible() but without the innerText check,
         * since inputs have no text content by nature.
         * 
         * TODO: Consider merging isVisible and isVisibleInput into one function
         * with an optional parameter to avoid code duplication.
         * 
         * @param {HTMLElement} el - input element to check
         * @returns {boolean}
         */
        function isVisibleInput(el) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                parseFloat(style.opacity) > 0.05
            );
        }

        //Step 1: Check if a known CMP is present using CSS selectors from Nouwens et al. (2025), Appendix C.
        //If a known CMP container is found, return it directly (this is the most reliable extraction path)
        //The CMP name can later be derived from the matched selector (important for Pseudo-RAG example selection).
        //TODO: derive cmpType from matched selector and return it (e.g. "OneTrust", "Cookiebot")
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                // const cmpKey = Object.keys(CMP_SELECTOR_MAP).find(key => selector.includes(key));
                // const cmpType = cmpKey ? CMP_SELECTOR_MAP[cmpKey] : null;
                return {
                    buttons: [], //empty but consistent
                    checkboxes: [],
                    toggles: [],
                    cmpFound: true,
                    cmpType: null, //TODO: derive from selector
                    cmpSelector: selector,
                    url: window.location.href,
                    html: el.outerHTML.slice(0, 1500), //outerHTML = full HTML of element including children
                };
            }
        }
        
        //Step 2: No known CMP detected → extract structured DOM via negative filtering.
        //Strategy: clone the body, remove elements that are definitely NOT the banner
        // (nav, header, footer etc.), then extract all interactive elements.

        //as everything in this code: this is incomplete :)
        const NEGATIVE_SELECTORS = ["nav", "header", "footer", 
            "script", "style", "img", "svg", "noscript"];

        const body = document.body.cloneNode(true); //clone with subtrees (but at this point ignoring the shadow DOM)
        //copy is important because i dont want to manipulate the actual live DOM of the website

        NEGATIVE_SELECTORS.forEach(sel => {
            body.querySelectorAll(sel).forEach(el => el.remove());
        });

        const buttons = querySelectorAllDeep("button, a, [role='button']")
            .filter(isVisible)
            .map(el => ({
                type: "button or anker",
                text: el.innerText.trim(),
                tag: el.tagName,
                attributes: extractAllAttributes(el),
                parentInfo: extractParentInfo(el),
                //Selector priority: id (unique) > aria-label (often unique) > first class (fallback) > tag (last resort)
                //TODO: improve selector uniqueness – first class alone may match multiple elements
                //i could try to extract the sibling context, but maybe the LLM gets enough info with the filteredHTML of the body
                selector: el.id ? `#${el.id}`
                    : el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute('aria-label')}"]`
                        : el.className ? `.${el.className.trim().split(' ')[0]}`
                            : el.tagName.toLowerCase(),
                role: el.getAttribute("role") || null,
                isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                outerHTML: el.outerHTML
                //is this enough?
            }));

        //TODO: Toggle detection via class names (.toggle, .switch) may produce false positives.
        //Consider adding a text-based filter using cookie-related keywords to reduce noise.
        //aria-checked is the key attribute: "true" = consent given, "false" = consent denied.
        //Note: Modern CMPs often use div/span elements styled as toggles instead of 
        //native <input type="checkbox"> – hence the role="switch" selector.
        const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']")
            .filter(isVisibleInput)
            .map(el => ({
                type: "toggle",
                text: el.innerText.trim(),
                tag: el.tagName,
                attributes: extractAllAttributes(el),
                parentInfo: extractParentInfo(el),
                ariaChecked: el.getAttribute("aria-checked"),
                isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                outerHTML: el.outerHTML
            }));

        //Extracts native HTML checkboxes via input[type='checkbox'].
        //Native checkboxes are more reliably detected than custom styled elements
        //because they always use the standard HTML input element regardless of CMP styling.
        //isChecked reflects the current state of the checkbox (true = checked, false = unchecked).
        //the semantic meaning (consent given/denied) depends on the CMP's implementation
        //and must be interpreted by the LLM using labelText and surrounding context.
        //labelText is critical here since input elements have no innerText of their own.
        const checkboxes = querySelectorAllDeep("input[type='checkbox']")
            .filter(isVisibleInput)
            .map(el => ({
                type: "checkbox",
                labelText: findLabelForInput(el),
                tag: el.tagName,
                attributes: extractAllAttributes(el),
                parentInfo: extractParentInfo(el),
                isChecked: el.checked,
                isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                outerHTML: el.outerHTML
            }));

        return {
            buttons,
            checkboxes,
            toggles,
            cmpFound: false,
            cmpType: null,
            url: window.location.href,
            html: body.innerHTML,
            // htmlLength: body.innerHTML.length,
            //TODO: cmpType detection not yet implemented – currently always null.
            //Should be derived from matched CMP selector in Step 1 (e.g. "[id*='onetrust']" → "OneTrust")
            //Important for Pseudo-RAG: cmpType determines which few-shot examples are loaded.
        };
    }, selectors);

    const cleaned = cleanHtml(result.html);
    // console.error(cleaned.length);
    result.filteredHtml = cleaned.slice(0, 15000);
    // result.htmlLength = result.rawHtml.length;
    delete result.html;
    
    return result;
}

/**
 * Attempts to identify the iFrame that hosts the CMP cookie banner.
 * 
 * Many CMPs load their banner in a dedicated iFrame with a CMP-related URL
 * (e.g. "cmp.heise.de"). If such a frame is found,
 * only that frame is extracted (avoiding unnecessary extraction from all frames)
 * 
 * If no CMP frame is identified via URL regex, null is returned as a signal to
 * extractStructuredDOM() to fall back to iterating over all available frames.
 * 
 * Note: The regex patterns are educated guesses based on known CMP naming conventions,
 * not derived from systematic data. May produce false positives or miss unknown CMPs.
 * 
 * TODO: The DOMAINS array could be populated with known CMP iframe domains
 * as an additional detection layer.
 * 
 * @param {Page} page - Puppeteer page instance of the loaded website
 * @returns {Frame|null} - CMP iframe if found, null if no CMP frame detected
 */
function findCorrectFrame(page) {
    const cmpRegex = /cmp|consent|cookie|onetrust|usercentrics|cookiebot|didomi|iubenda|trustarc|quantcast|osano|cookieyes|osano|complianz|termsfeed|cookienotice|cookiinformation|cookiescript|moove|consentmanager|consent/i;
    //TODO: The DOMAINS array could be populated with known CMP iframe domains as an additional detection layer
    const DOMAINS = [];
    const frames = page.frames();
    console.error(`I found ${frames.length} frames.`);

    if (frames.length) {
        frames.forEach((frame, index) => {
            console.error(`Frame ${index} has the URL: ${frame.url()}`);
        });
    }

    let cmpFrame = frames.find(frame => cmpRegex.test(frame.url()));

    if (cmpFrame) {
        return cmpFrame;
    }
    return null;
}

/**
 * Two-Pass DOM Extraction Strategy
 * 
 * Cookie banners often consist of two layers:
 * 1. The initial banner (accept/reject/settings buttons)
 * 2. A settings/preferences page (granular toggles and checkboxes per category)
 * 
 * A single DOM extraction pass is insufficient to generate a complete CoM ruleset,
 * because the selectors for granular consent options are only present in the DOM
 * AFTER the user clicks the settings button.
 * 
 * Solution: After the initial extraction, we search the extracted buttons for a
 * settings button using a multilingual regex pattern (based on Nouwens et al. 2025,
 * Appendix B). If found, Puppeteer clicks it, waits for the settings page to load,
 * and extractFromFrame() runs a second time on the now-visible settings DOM.
 * 
 * Both extraction results are returned together:
 * { initial: {...}, settings: {...} | null }
 * 
 * This gives the LLM all selectors it needs to generate a complete ruleset in one pass,
 * without requiring a second agent loop iteration or relying solely on analyse_screenshot.
 * 
 * i have to consider this new idea:
 * TODO: Store browserWSEndpoint in LangGraph agent state to allow test_ruleset
 * and subsequent extract_dom calls to reconnect via puppeteer.connect() instead
 * of launching a new browser instance. This enables multi-pass extraction across
 * tool calls without losing the browser session.
 */

/**
 * Main orchestration function for DOM extraction.
 * Launches Puppeteer, navigates to the given URL, and extracts all information
 * the LLM needs to generate a CoM ruleset.
 * 
 * Workflow:
 * 1. Launch browser and navigate to URL
 * 2. Find the correct frame (CMP iframe or all frames as fallback)
 * 3. Extract initial banner DOM via extractFromFrame()
 * 4. Search for a settings button using a multilingual regex (SETTINGS_PATTERN)
 * 5. If found: click it, detect the resulting frame change, extract settings DOM
 * 
 * waitUntil "networkidle2" waits until at most 2 network requests are active.
 * An additional 2s buffer handles dynamically injected banners that load after
 * the initial page load – a pragmatic choice that may need tuning per website.
 * 
 * @param {string} url - URL of the website to extract the cookie banner DOM from
 * @returns {Array|null} - Array of result objects, each containing:
 *   - frameUrl: URL of the extracted frame
 *   - isMainFrame: whether the frame is the main page frame
 *   - isCmpFrame: whether a CMP iframe was detected via URL regex
 *   - data: initial banner extraction (buttons, checkboxes, toggles, filteredHtml)
 *   - settings: settings page extraction, or null if no settings button found
 */
async function extractStructuredDom(url) {
    try {
        console.error("puppeteer-browser is getting started...");
        const browser = await puppeteer.launch({
            headless: "shell", //true should also work
            args: ["--no-sandbox", "--disable-setuid-sandbox"] //these flags are important for Linux/WSL
        });

        const page = await browser.newPage();

        console.error("Navigating to the page...");
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        console.error("page is loaded!");

        const cmpFrame = await findCorrectFrame(page);

        let results = [];
        if (cmpFrame) {
            const data = await extractFromFrame(cmpFrame, CMP_SELECTORS);
            results.push({frame: cmpFrame, frameUrl: cmpFrame.url(), isMainFrame: cmpFrame === page.mainFrame(), isCmpFrame: true, data})
        } else {
            for (const frame of page.frames()) {
                if (!frame.url() || frame.url() === "about:blank") continue;
                const data = await extractFromFrame(frame, CMP_SELECTORS);
                results.push({ frame, frameUrl: frame.url(), isMainFrame: frame === page.mainFrame(), isCmpFrame: false, data });
            }   
        }

        for (const result of results) {
            //i prioritize buttons, only search for anker-elements if no matching button was found
            const settingsButton = result.data.buttons.find(btn => SETTINGS_PATTERN.test(btn.text) && btn.tag === "BUTTON") ||
                result.data.buttons.find(btn => SETTINGS_PATTERN.test(btn.text) && btn.tag === "A");
            
            if (settingsButton) {
                console.error(`Settings button found: "${settingsButton.text}"`);
                //the problem: i dont know what the click causes. Sometimes the DOM is updated in the same frame, sometimes a new iFrame pops up
                //two options: extract from all frames again
                //or compare the DOM of the frame before and after the click --> is it different? then extract from this frame
                //otherwise look for new iframes that got loaded
                const framesBefore = page.frames().map(f => f.url()); //which frames are there before the click?
                const htmlBefore = await result.frame.evaluate(() => document.body.innerHTML.length);

                await result.frame.click(settingsButton.selector);
                // await new Promise(resolve => setTimeout(resolve, 5000));

                // const newFrame = page.frames().find(f => !framesBefore.includes(f.url())); //which frame is new?
                const newFramePromise = new Promise(resolve => {
                    const check = setInterval(() => {
                        const newFrame = page.frames().find(f => !framesBefore.includes(f.url()));
                        if (newFrame) {
                            clearInterval(check);
                            resolve(newFrame);
                        }
                    }, 200);
                    setTimeout(() => { clearInterval(check); resolve(null) }, 5000); //max 5s
                });

                const newFrame = await newFramePromise;
                
                //debugging
                // const framesAfterClick = page.frames();
                // console.error("Frames nach Klick:");
                // framesAfterClick.forEach((f, i) => console.error(`Frame ${i}: ${f.url()}`));
                // await page.screenshot({ path: 'after_click.png' });
                ///////////

                if (newFrame) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    result.settings = await extractFromFrame(newFrame, CMP_SELECTORS);
                    result.settings.isIframe = newFrame !== page.mainFrame(); //isIframe signals to the LLM whether to set iframeFilter: true in the CoM ruleset
                    console.error(JSON.stringify(result.settings.buttons, null, 2));
                } else {
                    const htmlAfter = await result.frame.evaluate(() => document.body.innerHTML.length);
                    //contentChanged threshold: 200 chars is intentionally sensitive to catch subtle DOM updates.
                    //Risk: may produce false positives on pages with dynamic content unrelated to the banner.
                    //TODO: evaluate optimal threshold empirically across test dataset.
                    const contentChanged = Math.abs(htmlAfter - htmlBefore) > 200;

                    if (contentChanged) {
                        result.settings = await extractFromFrame(result.frame, CMP_SELECTORS);
                        result.settings.isIframe = result.frame !== page.mainFrame();
                        console.error(JSON.stringify(result.settings.buttons, null, 2));
                    } else {
                        result.settings = null;
                        console.error("Settings click seems to have had no effect");
                    }
                }

            } else {
                result.settings = null;
            }
            
            delete result.frame; //frame object needs to be deleted (too big, only necessary for clicking the settings-button)
        }

        //TODO: remove before production
        console.error(results);
        console.log(JSON.stringify(results));

        await browser.close();
        console.error("browser closed!");
        return results;
    } catch (error) {
        console.error("extractStructuredDom failed:", error.message);
        return null;
    } finally {
        console.error("extractStructuredDom finished");
    }
    
};

//i now only use console.error() instead of .log for debugging etc, because this would otherwise get implemented in the input for the langgraph script
(async () => {
    const url = process.argv[2];
    
    if (!url) {
        console.error("Error: No URL provided. Usage: node extract_dom.js <url>");
        process.exit(1);
    }
    
    const foundData = await extractStructuredDom(url);

    if (foundData) {
        console.error("foundData was filled with a value");
    }
})();

// Note on Heise.de & Complex Layouts:
// Sites like Heise.de present a specific challenge where multiple buttons (e.g., "Accept", "Settings", "Reject") are laid out in a single row or grid.
// The LLM must understand which descriptions or labels correspond to which specific buttons.

// Solution Strategy:
// To solve this, we must provide sufficient parent and sibling information. If the structured JSON is too abstract, we should augment it
// by providing a "cleaned" version of the parent container's DOM. This allows the LLM to "see" the spatial proximity of elements,
// ensuring it identifies which toggle belongs to which privacy setting.

//Goals and Advancements
// Shadow-DOM Support: Implement recursive traversal to access elements encapsulated within Shadow Roots, as many modern CMPs use Shadow DOM for style isolation.
// Optimized Frame Filtering: Refine the frame selection logic. While the system currently scans multiple frames, we should prioritize identifying and traversing the single most relevant CMP frame to minimize noise and processing time.
//      - for every type i collect essential element information such as: type, text, attributes, tags, id, class, checked, disabled, labelText, ariaChecked, parent-Struktur und immer outer-HTML!
//      - Only process elements that are physically rendered and visible to the user (e.g., check for offsetParent !== null or computed visibility/display styles)
//      - Heuristic Action Mapping: Implement a classification layer to assign a likely_action based on element text or labels.
            //Example: A button containing "Accept all" or "Alle akzeptieren" is mapped to likely_action: ACCEPT_ALL.
//      - The FrameData Object: Consolidate all extracted elements into a single structured object per frame.
        // results.push({
        //     frameUrl: frame.url(),
        //     isMainFrame: frame === page.mainFrame(),
        //     isCMPFrame: true, // Based on heuristic detection
        //     data: frameData    // Contains the structured element lists
        // });
// HTML Sanitization: Strictly strip non-relevant code from the collected outerHTML snippets, including <script>, <img>, <iframe>, and all inline CSS (style="...").
// Noise Reduction: Minimize the DOM depth provided to the LLM to focus strictly on the interactive "branches" of the tree.