const puppeteer = require("puppeteer");
const Diff = require('diff');
const CMP_SELECTORS_MAP = require("../utils/cmp_selectors_map");
const CMP_SELECTORS = Object.keys(CMP_SELECTORS_MAP);
const SETTINGS_PATTERN = require("../utils/settingsButtons_terms");
//aus DarkDialogs-pdf, Appendix A.2
const TABLE_6_CUSTOM_SELECTORS = [
    'div[class*="gdpr"]', 'div[class*="Cookie"]', 'div[class*="cookie"]',
    'div[class*="Privacy"]', 'div[class*="privacy"]', 'div[class*="Policy"]',
    'div[class*="policy"]', 'div[class*="Consent"]', 'div[class*="consent"]',
    'div[class*="Notice"]', 'div[class*="notice"]', 'div[class*="Dialog"]',
    'div[class*="dialog"]', 'div[id*="gdpr"]', 'div[id*="Cookie"]',
    'div[id*="cookie"]', 'div[id*="Privacy"]', 'div[id*="privacy"]',
    'div[id*="Policy"]', 'div[id*="policy"]', 'div[id*="Consent"]',
    'div[id*="consent"]', 'div[id*="Notice"]', 'div[id*="notice"]',
    'div[id*="Dialog"]', 'div[id*="dialog"]', 'div[data-project*="cmp"]',
    'div[id*="cmp"]'
];
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
        //NOTE: inline styles are stripped to reduce token count.
        //This means the LLM cannot use CoM's styleFilter based on the filteredHtml.
        //TODO: check if style-filtering is often used in CoM and ask Clemens etc.
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


/**
 * LLM-based fallback for settings button detection.
 * Called when SETTINGS_PATTERN regex fails to identify a settings button.
 * Sends filteredHtml to Ollama and expects a single CSS selector in return.
 * 
 * @param {string} html - filteredHtml from extractFromFrame()
 * @returns {string|null} - CSS selector or null
 */
async function findSettingsButtonViaLLM(html) {
    const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
    const OLLAMA_TOKEN = process.env.OLLAMA_TOKEN || "";
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OLLAMA_TOKEN}`
            },
            body: JSON.stringify({
                model: "gemma4",
                prompt: `You are analysing a cookie banner HTML.
                        Find the button or link that opens the settings or preferences page.
                        Return ONLY a valid CSS selector string, nothing else.
                        No explanation, no JSON, no markdown: just the raw selector.

                        Examples of valid responses:
                        [aria-label="Settings"]
                        .settings-button
                        #cookie-preferences-btn

                        HTML:
                        ${html.slice(0, 20000)}`,
                stream: false
            })
        });

        if (!response.ok) {
            console.error(`LLM call failed: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const selector = String(data.response?.trim());
        
        if (!selector) {
            return null;
        }
        
        console.log(`LLM suggested settings selector: "${selector}"`);
        return selector;

    } catch (error) {
        console.error("findSettingsButtonViaLLM failed:", error.message);
        return null;
    }
}

async function extractFromFrame(frame, selectors, selectorsMap, cmpType = null) {
    const result = await frame.evaluate((selectors, selectorsMap) => {

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
         * Limititation: only works for shadow DOM with "mode: open", not "mode: closed" (not accessible via JS)
         * 
         * @param {string} selector - CSS selector to search for (e.g. "button")
         * @param {Document|ShadowRoot} root - Starting point for the search (default: document)
         * @returns {Array} - All matching elements across the entire DOM including Shadow DOMs
         */

        //TO DO: i need to test it
        function querySelectorAllDeep(selector, root = document) {
            let nodes = Array.from(root.querySelectorAll(selector));
            // const elements = Array.from(root.querySelectorAll("*"));
            //should be much faster:
            const elements = root.querySelectorAll("*");
            for (let el of elements) {
                if (el.shadowRoot) {
                    nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
                }
            }
            //to get a feeling how well this works and how necessary it is:
            // console.error(`querySelectorAllDeep found ${nodes.length} nodes for ${selector}`);
            // let nodesStandard = Array.from(root.querySelectorAll(selector));
            // console.error(`querySelectorAll (standard) found ${nodesStandard.length} nodes for ${selector}`);
            return nodes;
        }

        function querySelectorDeep(selector, root = document) {
            let found = root.querySelector(selector);
            if (found) return found;

            const all = root.querySelectorAll("*");
            for (const el of all) {
                if (el.shadowRoot) {
                    found = querySelectorDeep(selector, el.shadowRoot);
                    if (found) return found;
                }
            }
            return null;
        }

        function getDeepInnerHTML(node) {
            let html = node.innerHTML || "";
            if (node.shadowRoot) {
                html += node.shadowRoot.innerHTML;
            }

            const children = node.querySelectorAll("*");
            for (const child of children) {
                if (child.shadowRoot) {
                    html += getDeepInnerHTML(child.shadowRoot);
                }
            }
            return html;
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

        //Problem: document.querySelector never finds a label which is inside the Shadow DOM!
        //because of that i use: input.getRootNode() --> finds either document or ShadowRoot
        //have to verify that these ideas really work
        function findLabelForInput(input) {
            const root = input.getRootNode();

            if (input.id && root.querySelector) {
                const label = root.querySelector(`label[for="${input.id}"]`);
                if (label) {
                    return label.innerText.trim();
                }
            }
            const closestLabel = input.closest("label");
            if (closestLabel) {
                return closestLabel.innerText.trim();
            }

            const labelledBy = input.getAttribute("aria-labelledby");
            if (labelledBy && root.querySelector) {
                const labelEl = root.querySelector(`#${labelledBy}`);
                if (labelEl) {
                    return labelEl.innerText.trim();
                }
            }
            return "";
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

        //Problem: if el is top child in shadow DOM parentElement just returns null
        function extractParentInfo(el) {
            const parent = el.parentElement;
            const root = el.getRootNode();

            if (!parent && root instanceof ShadowRoot) {
                return {
                    tag: "SHADOW-HOST", 
                    id: root.host ? root.host.id : null,
                    className: root.host ? root.host.className : "shadow-root-boundary"
                };
            }

            return {
                tag: parent ? parent.tagName : null,
                id: parent ? parent.id : null,
                className: parent ? parent.className : null
            };
        }

        function generateDeepSelector(el, searchRoot = document, depth = 0) {
            //Selector priority: id (unique) > aria-label (often unique) > first class found (fallback) > tag (last resort)
            //TODO: improve selector uniqueness
            //my solution:
            // Selector generation strategy (priority order):
            //1. id --> globally unique, most reliable
            //2. aria-label --> often unique, accessibility-friendly
            //3. first CSS class, if unique in document (classCount === 1) --> medium confidence
            //4. first CSS class, if rare (classCount <= 5) --> low confidence, may need textFilter in CoM
            //5. tag name only --> last resort, very low confidence
            //
            //selectorConfidence signals to the LLM how reliable the selector is.
            //For low/very_low confidence: consider using CoM's textFilter or parentInfo
            //to make the selector more specific in the generated ruleset.
            //
            //TODO: evaluate optimal classCount threshold empirically (currently: ≤5)

            if (depth > 5) return { selector: el.tagName.toLowerCase(), selectorConfidence: "very low" };

            const firstClass = el.className && typeof el.className === "string" 
                ? el.className.trim().split(" ")[0] : null;
            const classCount = firstClass ? searchRoot.querySelectorAll(`.${firstClass}`).length : 0;

            const selector =  el.id ? `#${el.id}`
                : el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute('aria-label')}"]`
                    : firstClass && classCount === 1 ? `.${firstClass}` //unique
                        : firstClass && classCount <= 5 ? `.${firstClass}` //acceptable
                            : el.tagName.toLowerCase();

            const selectorConfidence =  el.id ? "very high"
                : el.getAttribute("aria-label") ? "high"
                    : firstClass && classCount === 1 ? "medium"
                        : firstClass ? "low" : "very low";
            
            const root = el.getRootNode();
    
            if (root instanceof ShadowRoot) { //am i currently in a shadow DOM?
                const host = root.host; //to generate the click, puppeteer needs to know what the host in the light DOM is

                const parentResult = generateDeepSelector(host, host.getRootNode(), depth + 1); //we do that until we get to document as the root node
                
                return {
                    //using special puppeteer syntax: https://pptr.dev/guides/page-interactions#querying-elements-in-shadow-dom
                    //The LLM must be aware that >>> selectors are for test_ruleset clicks only,
                    //not for the final CoM JSON. --> i pointed out in the system prompt
                    selector: `${parentResult.selector} >>> ${selector}`,
                    selectorConfidence: parentResult.selectorConfidence === "very high" ? selectorConfidence : "medium" 
                };
            }

            return { selector, selectorConfidence};
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
         * @param {boolean} checkText - Set to true for buttons/links, false for inputs.
         * @returns {boolean}
         */
        function isVisible(el, checkText = true) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            
            const hasSize = rect.width > 0 && rect.height > 0;
            const isCssVisible = style.display !== "none" && 
                                style.visibility !== "hidden" &&
                                parseFloat(style.opacity) > 0.05;
            
            const hasText = checkText ? el.innerText.trim().length > 0 : true;

            return hasSize && isCssVisible && hasText;
        }

        //following part very similiar logic to: no cmpContainer found. Because of this i deletet my comments to save some space for now
        //i will add them later!

        // Step 1: Check if a known CMP banner container is directly accessible in this frame.
        // Uses querySelectorDeep() to find the container including Shadow DOM hosts.
        // cmpType is already determined in findCorrectFrame() via main frame scan.
        // cmpFound: true signals high-confidence extraction (direct selector match).
        // cmpFound: false (Step 2) signals generic extraction.
        //
        // Shadow DOM handling:
        // If the matched element hosts a Shadow Root (e.g. Usercentrics uses
        // <aside id="usercentrics-cmp-ui"> with a Shadow Root), we use the
        // Shadow Root as the search root for element extraction.
        // getDeepInnerHTML() recursively collects HTML from both light and shadow DOM.
        //
        // Known Limitation: Deeply nested Shadow DOM CMPs (e.g. Usercentrics) may not
        // be fully supported. The CMP type is detected correctly via main frame scan,
        // but waitForSelector() cannot pierce Shadow DOM boundaries, meaning the banner
        // container may not yet be present when extraction runs.
        // Affected CMPs: unknown!! TODO.
        for (const selector of selectors) {

            const host = querySelectorDeep(selector);

            if (!host || ["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) continue;
        
                const searchRoot = host.shadowRoot || host;
                const deepHtml = getDeepInnerHTML(host);
                
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = deepHtml;

                ["nav", "header", "footer", "script", "style", "img", "svg", "noscript"].forEach(t => {
                    tempDiv.querySelectorAll(t).forEach(n => n.remove());
                });

                const buttons = querySelectorAllDeep("button, a, [role='button']", searchRoot)
                    .filter(el => isVisible(el, true))
                    .map(el => {
                        const deepData = generateDeepSelector(el, searchRoot);
                        return {
                            type: "button or anker",
                            text: el.innerText.trim(),
                            tag: el.tagName,
                            attributes: extractAllAttributes(el),
                            parentInfo: extractParentInfo(el),
                            selector: deepData.selector,
                            selectorConfidence: deepData.selectorConfidence,
                            role: el.getAttribute("role") || null,
                            isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                            isShadow: el.getRootNode() instanceof ShadowRoot //for my understanding, LLM doesnt need that i think
                            //is this enough?
                        }
                    });

                const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']", searchRoot)
                    .filter(el => isVisible(el, false))
                    .map(el => {
                        const deepData = generateDeepSelector(el, searchRoot);
                        return {
                            type: "toggle",
                            text: el.innerText.trim(),
                            tag: el.tagName,
                            attributes: extractAllAttributes(el),
                            parentInfo: extractParentInfo(el),
                            selector: deepData.selector,
                            selectorConfidence: deepData.selectorConfidence,
                            ariaChecked: el.getAttribute("aria-checked"),
                            isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                        }
                    });

                const checkboxes = querySelectorAllDeep("input[type='checkbox']", searchRoot)
                    .filter(el => isVisible(el, false))
                    .map(el => {
                        const deepData = generateDeepSelector(el, searchRoot);
                        return {
                            type: "checkbox",
                            labelText: findLabelForInput(el),
                            tag: el.tagName,
                            attributes: extractAllAttributes(el),
                            parentInfo: extractParentInfo(el),
                            selector: deepData.selector,
                            selectorConfidence: deepData.selectorConfidence,
                            isChecked: el.checked,
                            isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                        }
                    });

                    //IMPORTANT LIMITATION:
                    //querySelectorAllDeep searches the whole live DOM, although the LLM only gets the filtered HTML (without header etc.)

                return {
                    buttons,
                    checkboxes,
                    toggles,
                    cmpFound: true,
                    cmpSelector: selector,
                    cmpContainerFound: true,
                    url: window.location.href,
                    html: tempDiv.innerHTML.slice(0, 20000) //HTML of the detected CMP container including its own tag and all children
                };
        };
        
        //Step 2: No known CMP detected --> extract structured DOM via negative filtering.
        //Strategy: clone the body, remove elements that are definitely NOT the banner
        // (nav, header, footer etc.), then extract all interactive elements.

        //as everything in this code: this is incomplete :)
        const NEGATIVE_SELECTORS = ["nav", "header", "footer", 
            "script", "style", "img", "svg", "noscript"];

        // const body = document.body.cloneNode(true); //clone with subtrees (but at this point ignoring the shadow DOM)
        // //copy is important because i dont want to manipulate the actual live DOM of the website

        const deepBodyHtml = getDeepInnerHTML(document.body);
        const filterBody = document.createElement("div");
        filterBody.innerHTML = deepBodyHtml;

        NEGATIVE_SELECTORS.forEach(sel => {
            filterBody.querySelectorAll(sel).forEach(el => el.remove());
        });

        const buttons = querySelectorAllDeep("button, a, [role='button']")
            .filter(el => isVisible(el, true))
            .map(el => {
                const deepData = generateDeepSelector(el);
                return {
                    type: "button or anker",
                    text: el.innerText.trim(),
                    tag: el.tagName,
                    attributes: extractAllAttributes(el),
                    parentInfo: extractParentInfo(el),
                    selector: deepData.selector,
                    selectorConfidence: deepData.selectorConfidence,
                    role: el.getAttribute("role") || null,
                    isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                    //is this enough?
                }
            });

        //TODO: Toggle detection via class names (.toggle, .switch) may produce false positives.
        //Consider adding a text-based filter using cookie-related keywords to reduce noise.
        //aria-checked is the key attribute: "true" = consent given, "false" = consent denied.
        //Note: Modern CMPs often use div/span elements styled as toggles instead of 
        //native <input type="checkbox"> – hence the role="switch" selector.
        const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']")
            .filter(el => isVisible(el, false))
            .map(el => {
                const deepData = generateDeepSelector(el);
                return {
                    type: "toggle",
                    text: el.innerText.trim(),
                    tag: el.tagName,
                    attributes: extractAllAttributes(el),
                    parentInfo: extractParentInfo(el),
                    selector: deepData.selector,
                    selectorConfidence: deepData.selectorConfidence,
                    ariaChecked: el.getAttribute("aria-checked"),
                    isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                }
            });

        //Extracts native HTML checkboxes via input[type='checkbox'].
        //Native checkboxes are more reliably detected than custom styled elements
        //because they always use the standard HTML input element regardless of CMP styling.
        //isChecked reflects the current state of the checkbox (true = checked, false = unchecked).
        //the semantic meaning (consent given/denied) depends on the CMP's implementation
        //and must be interpreted by the LLM using labelText and surrounding context.
        //labelText is critical here since input elements have no innerText of their own.
        const checkboxes = querySelectorAllDeep("input[type='checkbox']")
            .filter(el => isVisible(el, false))
            .map(el => {
                const deepData = generateDeepSelector(el);
                return {
                    type: "checkbox",
                    labelText: findLabelForInput(el),
                    tag: el.tagName,
                    attributes: extractAllAttributes(el),
                    parentInfo: extractParentInfo(el),
                    selector: deepData.selector,
                    selectorConfidence: deepData.selectorConfidence,
                    isChecked: el.checked,
                    isDisabled: el.disabled || el.getAttribute("aria-disabled") === "true",
                }
            });

        return {
            buttons,
            checkboxes,
            toggles,
            cmpFound: false,
            cmpType: null,
            cmpSelector: null,
            cmpContainerFound: false,
            url: window.location.href,
            html: filterBody.innerHTML,
        };
    }, selectors, selectorsMap);

    if (result.html) {
        const cleaned = cleanHtml(result.html);
        result.filteredHtml = cleaned.slice(0, 15000);
        delete result.html;
    }

    result.cmpType = cmpType;
    if (!result.cmpFound) {
        result.cmpFound = cmpType !== null;
    }
    
    return result;
}

/**
 * Calculates the average word count across all frames on the page.
 * Used as a baseline by calculateFrameScore() to detect frames that are
 * exceptionally long compared to other frames (word count > average + 100).
 * 
 * Frames that cannot be evaluated (e.g. cross-origin iframes) are silently
 * skipped via try/catch to avoid crashing the scoring pipeline.
 * 
 * @param {Frame[]} frames - array of all Puppeteer frames on the page
 * @returns {number} - average word count, or 0 if no frames could be evaluated
 */
async function frameWordCounter(frames, avgWordCount) {
    const wordCounts = [];

    for (const frame of frames) {
        try {
            const count =  await frame.evaluate(() => {
                const text = document.body ? document.body.innerText.trim() : "";
                return text.split(/\s+/).filter(w => w.length > 0).length;
            });
            wordCounts.push(count);
        } catch (err) {
            continue;
        }
    }

    if (!wordCounts.length) {
        return 0;
    }

    const sum = wordCounts.reduce((acc, curr) => acc + curr, 0);
    return sum / wordCounts.length;
}

/**
 * Scores a frame based on how likely it is to contain a cookie consent banner.
 * Inspired by and partially adapted from the scoring system in:
 * "DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs"
 * 
 * Scoring factors (see paper Appendix A.3 for original weights):
 * 
 * Positive:
 *   +2  General CSS selector match (TABLE_6_CUSTOM_SELECTORS)
 *   +10 CMP-specific selector match (CMP_SELECTORS_MAP, Nouwens et al. 2025)
 *   +n  N-gram match (weight = n-gram length: unigram +1, bigram +2, ..., 5-gram +5)
 * 
 * Negative:
 *   -20  Word count < 5 (likely a clickable element, not a dialog)
 *   -20  Word count > average + 100 (likely contains non-banner content)
 *   -100 No text content (very unlikely to be a cookie dialog)
 *   -100 Element not visible (display:none, visibility:hidden, or zero dimensions)
 *        Inspired by paper's screenshot-based visibility check (p.18), adapted for Puppeteer
 * 
 * Deviations from paper:
 *   - No screenshot-based visibility check (Selenium-specific, not available in Puppeteer)
 *     --> replaced with CSS computed style + bounding box check
 *   - No sub-string / duplicate candidate comparison (out of scope for this prototype)
 *   - N-grams extended with German phrases; full multilingual support is a TODO
 * 
 * @param {Frame} frame - Puppeteer frame to score
 * @param {number} avgWordCount - average word count across all frames (from frameWordCounter())
 * @param {Object} selectorMap - CMP_SELECTORS_MAP for domain-specific selector matching
 * @returns {number} - score (higher = more likely to be a cookie banner frame)
 */
async function calculateFrameScore(frame, avgWordCount, selectorMap) {
    //copied from DarkDialogs_Automated detection of 10 dark patterns on cookie dialogs A.3 Appendix
    //TODO: add other languages!
    const N_GRAM_DATA = {
        5: [
            "access information on a device", "and or access information on",
            "store and or access information", "use cookies and similar technologies",
            "ad and content measurement audience", "and content measurement audience insights",
            "audience insights and product development", "content measurement audience insights and",
            "improve your experience on our", "informationen auf einem gerät speichern",
            "measurement audience insights and product",
            "verwendung von cookies und ähnlichen", "basierend auf browsereinstellungen und gerätekennungen"
        ],
        4: [
            "we use cookies to", "use cookies and similar", "cookies and similar technologies", "information on a device",
            "at any time by", "and or access information", "access information on a", "you can change your",
            "you can change your", "wir verwenden cookies um", "or access information on", "store and or access",
            "cookies und ähnliche technologien", "sie können ihre einstellungen"
        ],
        3: [
            "we use cookies", "at any time", "our cookie policy", "use cookies and", "use cookies to", "cookies and similar",
            "use of cookies", "learn more about", "and our partners", "and similar technologies", "our cookie policy",
            "wir verwenden cookies", "jederzeit wieder ändern", "unsere cookie richtlinie"
        ],
        2: [
            "use cookies", "cookies and", "cookies to", "we use", "accept all", "any time", "at any", "you agree",
            "learn more", "manage preferences",
            "alle akzeptieren", "mehr erfahren", "einstellungen verwalten"
        ],
        1: [
            "cookies", "cookie", "track", "tracking", "einwilligung", "datenschutz"
        ]
    };
    try {
        return await frame.evaluate((customS, avg, selectorMap, nGrams) => {
            const el = document.body;
            if (!el) {
                return -100;
            }

            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = rect.width > 0 && 
                            rect.height > 0 && 
                            style.display !== "none" &&
                            style.visibility !== "hidden";

            if (!isVisible) {
                return -100;
            }

            let score = 0;
            const text = document.body ? document.body.innerText.trim() : "";
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const wordsCounter = words.length;

            if (wordsCounter === 0) {
                return -100;
            } else if (wordsCounter < 5) {
                score -= 20;
            } else if (wordsCounter > (avg + 100)) {
                score -= 20;
            }

            for (const selector of customS) {
                if (document.querySelector(selector)) {
                    score += 2;
                    break;
                }
            }

            for (const selector of Object.keys(selectorMap)) {
                if (document.querySelector(selector)) {
                    score += 10;
                    break;
                }
            }

            //N-Gram Analyse used by paper would need translation into english
            //far to slow and costly for my agent system. i try to use a similar but simplified version
            for (const [n, phrases] of Object.entries(nGrams).reverse()) {
                const weight = parseInt(n);
                for (const phrase of phrases) {
                    const regex = new RegExp(phrase, "i");
                    if (regex.test(text)) {
                        score += weight;
                    }
                }
            }

            return score;
        }, TABLE_6_CUSTOM_SELECTORS, avgWordCount, selectorMap, N_GRAM_DATA);
    } catch (err) {
        console.error("frame could not be scored!");
        return -100;
    }
}

/**
 * Identifies the CMP type and the most likely frame hosting the cookie banner.
 * Uses a three-tier detection strategy of increasing generality:
 * 
 * Tier 1: CMP Type Detection (main frame scan):
 *   Scans the main frame for known CMP container elements using CMP_SELECTORS_MAP
 *   (Nouwens et al. 2025, Appendix C). Returns the CMP name if found (e.g. "Sourcepoint").
 *   Runs on main frame only – CMP providers always place a bootstrap container there
 *   even when the banner itself loads in an iframe.
 * 
 * Tier 2: Deterministic Frame Detection:
 *   2a. Known CMP domains (DOMAINS array): matches iframe URLs against a list of
 *       known CMP CDN domains (e.g. "cdn.cookielaw.org" for OneTrust).
 *   2b. URL/name regex: matches frame URL or frame name against multilingual
 *       CMP-related keywords (e.g. "consent", "datenschutz", "nastavení").
 *   If either matches, that frame is returned immediately.
 * 
 * Tier 3: Score-based Fallback (inspired by DarkDialogs paper):
 *   If no frame is found deterministically, all frames are scored using:
 *   - N-gram analysis (cookie dialog phrases, weighted by length)
 *   - CSS selector matching (general selectors +2, CMP-specific selectors +10)
 *   - Word count penalties (too short: -20, too long: -20, empty: -100)
 *   The highest-scoring frame is returned if its score exceeds 0.
 *   Adapted from: DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs
 * 
 * @param {Page} page - Puppeteer page instance
 * @param {Object} selectorMap - CSS selector → CMP name map (CMP_SELECTORS_MAP)
 * @returns {{ frame: Frame|null, cmpType: string|null }}
 */
async function findCorrectFrame(page, selectorMap) {
    const cmpRegex = new RegExp(
        [
            //central terms and some providers
            "cmp|consent|cookie|gdpr|onetrust|usercentrics|cookiebot|didomi|iubenda|trustarc|quantcast|osano|cookieyes|complianz|termsfeed|cookienotice|cookiescript|moove|consentmanager",
            //"Privacy" & "Center" variation
            "privacy[\\s\\-_]*center", "privacy[\\s\\-_]*manager", "privac", "privatsp", "preferenc",
            //international
            "protection", "protec", "données", "dati", "datos", "adat", "privacidad", "polityka", "confiden",
            //German & eastern europe
            "verarbeitung", "Datenschutz", "personvern", "integritet", "nastavení", "asetukset", "настройки"
        ].join("|"), "i"
    );
    //TODO: The DOMAINS array could be populated with known CMP iframe domains as an additional detection layer
    //based so far on "DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs".pdf, Appendix B
    const DOMAINS = [
        "quantcast.mgr.consensu.org",
        "cdn.cookielaw.org", // OneTrust
        "consent.trustarc.com",
        "consentcdn.cookiebot.com",
        "gdpr.privacymanager.io", //LiveRamp
        "c.evidon.com" //Crownpeak
    ];
    const frames = page.frames();

    //just for debugging:
    console.error(`I found ${frames.length} frames.`);

    // if (frames.length) {
    //     frames.forEach((frame, index) => {
    //         console.error(`Frame ${index} has the URL: ${frame.url()}`);
    //     });
    // }
    /////////


    //CMP type detection runs on the main frame only.
    //Although the banner itself loads in a CMP iframe, the CMP provider seems t
    //place a container element (e.g. div#sp_message_container) in the main frame
    //to bootstrap the iframe. This container carries the CMP-specific selector
    //and is therefore the reliable detection point.
    //TODO: test it
    // const mainFrame = page.mainFrame();
    // const cmpType = await mainFrame.evaluate((selectorMap) => {
    //     for (const [selector, cmpName] of Object.entries(selectorMap)) {
    //         if (document.querySelector(selector)) {
    //             return cmpName;
    //         }
    //     }
    //     return null;
    // }, selectorMap);

    //new version also with shadowDOM. TODO: is this necessary?! Same question applies to waitForCmpUI
    //i really reuse this function to often!
    function querySelectorAllDeep(selector, root = document) {
        let nodes = Array.from(root.querySelectorAll(selector));
        // const elements = Array.from(root.querySelectorAll("*"));
        //should be much faster:
        const elements = root.querySelectorAll("*");
        for (let el of elements) {
            if (el.shadowRoot) {
                nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
            }
        }
        //to get a feeling how well this works and how necessary it is:
        // console.error(`querySelectorAllDeep found ${nodes.length} nodes for ${selector}`);
        // let nodesStandard = Array.from(root.querySelectorAll(selector));
        // console.error(`querySelectorAll (standard) found ${nodesStandard.length} nodes for ${selector}`);
        return nodes;
    }

    const cmpType = await mainFrame.evaluate((selectorMap) => {
        for (const [selector, cmpName] of Object.entries(selectorMap)) {
            if (querySelectorAllDeep(selector)) {
                return cmpName;
            }
        }
        return null;
    }, selectorMap);


    console.error(`CMP Type detected: ${cmpType}`);

    for (const frame of frames) {
        const url = frame.url();
        const name = frame.name();

        if (DOMAINS.some(domain => url.includes(domain))) {
            console.error(`CMP Frame detected via URL Array: ${url}`);
            return { frame, cmpType };
        }
        if (cmpRegex.test(url) || cmpRegex.test(name)) {
            console.error(`CMP Frame detected via URL/Name: ${url || name}`);
            return { frame, cmpType };
        }
    }

    const avgWordCount = await frameWordCounter(frames);
    let bestFrame = null;
    let maxScore = -101;

    for (const frame of frames) {
        const score = await calculateFrameScore(frame, avgWordCount, selectorMap);

        if (score > maxScore) {
            maxScore = score;
            bestFrame = frame;
        }
    }

    if (bestFrame && maxScore > 0) {
        console.error(`a frame was picked by score: ${bestFrame.url()} with Score: ${maxScore}`);
        return { frame: bestFrame, cmpType};
    }
    //TODO: maybe return a list of frames with at least score > -50 as fallback instead of nothing?

    return { frame: null, cmpType };
}

//small helper function for clickAndExtractSettings()
async function getFrameState(frame) {
    return await frame.evaluate(() => {
        function querySelectorAllDeep(selector, root = document) {
            let nodes = Array.from(root.querySelectorAll(selector));
            // const elements = Array.from(root.querySelectorAll("*"));
            //should be much faster:
            const elements = root.querySelectorAll("*");
            for (let el of elements) {
                if (el.shadowRoot) {
                    nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
                }
            }
            //to get a feeling how well this works and how necessary it is:
            // console.error(`querySelectorAllDeep found ${nodes.length} nodes for ${selector}`);
            // let nodesStandard = Array.from(root.querySelectorAll(selector));
            // console.error(`querySelectorAll (standard) found ${nodesStandard.length} nodes for ${selector}`);
            return nodes;
        }

        return {
            inputs: querySelectorAllDeep("input[type='checkbox'], [role='switch'], .toggle, .switch, [class*='toggle']").length, //same limitation regarding false postives as mentioned above
            buttons: querySelectorAllDeep("button, a, [role='button']").length,
            html: document.body.innerHTML //does not look in the shadowDOM! TODO
        };
    });
}


/**
 * Handles the click on a settings/preferences button and extracts the resulting DOM.
 * Extracted as a separate function to avoid code duplication between the regex-based
 * and LLM-based settings button detection paths.
 * 
 * After clicking, two scenarios are handled:
 * 1. A new iframe appears --> extract from the new frame
 * 2. The existing frame DOM changes significantly --> extract from the same frame
 * 
 * @param {Frame} frame - Puppeteer frame containing the settings button
 * @param {string} selector - CSS selector of the settings button to click
 * @param {Page} page - Puppeteer page instance (needed to detect new frames)
 * @param {string|null} cmpType - detected CMP name, propagated to extraction result
 * @returns {Object|null} - extracted settings DOM object, or null if click had no effect
 */
async function clickAndExtractSettings(frame, selector, page, cmpType) {
    //the problem: i dont know what the click causes. Sometimes the DOM is updated in the same frame, sometimes a new iFrame pops up
    //two options: extract from all frames again
    //or compare the DOM of the frame before and after the click --> is it different? then extract from this frame
    //otherwise look for new iframes that got loaded
    //TODO: currently using character count difference as a proxy for DOM change.
    //More robust alternative: use "diff" library (npm install diff) with Diff.diffChars()
    //to count actually added/removed characters rather than total length delta.
    //Even better: dom-compare library for structural DOM diffing.
    const framesBefore = page.frames().map(f => f.url()); //which frames are there before the click?

    const oldState = await getFrameState(frame);

    try {
        await frame.click(selector, { scrollIntoView: true, timeout: 3000 });
    } catch (err) {
        // console.error("Click failed:", err.message);
        // return null;
        console.error("Puppeteer click failed, trying JS click:", err.message);
        // Fallback: direct JavaScript click via frame.evaluate()
        // Puppeteer's click() requires the element to be visible, in the viewport,
        // and not obscured by other elements. This fails for elements that are
        // technically present in the DOM but not fully rendered or positioned
        // outside the visible area (e.g. banners that animate in, or elements
        // with unusual z-index stacking).
        // el.click() bypasses these checks and fires the click event directly –
        // less reliable for real user simulation but sufficient for banner interaction.
        try {
            await frame.evaluate((sel) => {
                const parts = sel.split(" >>> "); //if selector is "normal" (without >>>) this just gives back an array with one entry
                let currentRoot = document;
                let target = null;

                for (let i = 0; i < parts.length; i++) {
                    target = currentRoot.querySelector(parts[i]); ////if selector is "normal" (wothout >>>) this just gives searches in the body and then goes to click that element
                    if (!target) {
                        break;
                    }
                    currentRoot = target.shadowRoot; //gives access to shadow DOM of this element if it is the host
                    if (!currentRoot) {
                        break;
                    }
                }

                if (target) {
                    target.click();
                    return true;
                }
                return false;
            }, selector);
        } catch (err2) {
            console.error("JS deep click also failed:", err2.message);
            return null;
        }
    }
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
        const settings = await extractFromFrame(newFrame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
        settings.isIframe = newFrame !== page.mainFrame(); //isIframe signals to the LLM whether to set iframeFilter: true in the CoM ruleset
        return settings;
        // console.error(JSON.stringify(result.settings.buttons, null, 2));
    } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const newState = await getFrameState(frame);

        const changes = Diff.diffChars(oldState.html, newState.html);
        const addedChars = changes
            .filter(c => c.added) //filteres for evrything that is actually new
            .reduce((sum, c) => sum + c.count, 0);
        
        const addedInputs = newState.inputs - oldState.inputs;

        //TODO: evaluate of these are good indicators
        if (addedChars > 500 || addedInputs >= 2) {
            console.error(`Settings detected: ${addedChars} chars added, ${addedInputs} inputs added.`);
            const settings = await extractFromFrame(frame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
            settings.isIframe = frame !== page.mainFrame();
            return settings;
            // console.error(JSON.stringify(result.settings.buttons, null, 2));
        } else {
            console.error("Settings click seems to have had no effect");
            return null;
        }
    }
}

/**
 * Waits not only for the presence of the CMP host element but ensures 
 * that the element (or its Shadow Root) actually contains rendered buttons.
 */
async function waitForCmpUI(page, selectors, timeout = 15000) {
    console.error("waitForCmpUI started...");
    const start = Date.now();

    while (Date.now() - start < timeout) {
        for (const frame of page.frames()) {
            try {
                const foundSelector = await frame.evaluate((sels) => {
                    //i really reuse this function to often!
                    function querySelectorAllDeep(selector, root = document) {
                        let nodes = Array.from(root.querySelectorAll(selector));
                        // const elements = Array.from(root.querySelectorAll("*"));
                        //should be much faster:
                        const elements = root.querySelectorAll("*");
                        for (let el of elements) {
                            if (el.shadowRoot) {
                                nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
                            }
                        }
                        //to get a feeling how well this works and how necessary it is:
                        // console.error(`querySelectorAllDeep found ${nodes.length} nodes for ${selector}`);
                        // let nodesStandard = Array.from(root.querySelectorAll(selector));
                        // console.error(`querySelectorAll (standard) found ${nodesStandard.length} nodes for ${selector}`);
                        return nodes;
                    }

                    for (const sel of sels) {
                        const host = querySelectorAllDeep(sel);
                        if (host && !["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) {
                            
                            const searchRoot = host.shadowRoot || host;
                            const buttons = searchRoot.querySelectorAll("button, a, [role='button']");
                            
                            if (buttons.length > 0) {
                                return sel;
                            }
                        }
                    }
                    return null;
                }, selectors);

                if (foundSelector) {
                    console.error(`CMP UI seems to be rendered via: "${foundSelector}"`);
                    return { frame, selector: foundSelector };
                }
            } catch (e) {
            }
        }
        //Wait 500ms before the next polling attempt
        await new Promise(r => setTimeout(r, 500));
    }

    console.error("Timeout: CMP UI was not fully rendered in time!");
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
 * 2. Detect CMP type and find the correct frame via findCorrectFrame()
 * 3. Extract initial banner DOM via extractFromFrame()
 * 4. Search for a settings button using a multilingual regex (SETTINGS_PATTERN)
 * 5a. If regex succeeds: click and extract settings DOM via clickAndExtractSettings()
 * 5b. If regex fails: LLM fallback via findSettingsButtonViaLLM(), then same click logic
 * 
 * waitUntil "networkidle2" waits until at most 2 network requests are active.
 * An additional 2s buffer handles dynamically injected banners that load after
 * the initial page load – a pragmatic choice that may need tuning per website.
 * 
 * @param {string} url - URL of the website to extract the cookie banner DOM from
 * @returns {Array|null} - Array of result objects, each containing:
 *   - frameUrl: URL of the extracted frame
 *   - isMainFrame: whether the frame is the main page frame
 *   - isCookieFrame: whether a Cookie-Banner iframe was detected or not
 *   - cmpType: detected CMP name (e.g. "Sourcepoint", "OneTrust") or null
 *   - data: initial banner extraction (buttons, checkboxes, toggles, filteredHtml)
 *   - settings: settings page extraction, or null if no settings button found/clicked
 */
async function extractStructuredDom(url) {
    try {
        console.error("puppeteer-browser is getting started...");
        const browser = await puppeteer.launch({
        headless: true, //users the mor modern headless mode (instead of "shell") --Y harder to detect as a bot
            args: [
                "--no-sandbox", //important for WSL/Linux
                "--disable-setuid-sandbox", //important for WSL/Linux
                "--disable-blink-features=AutomationControlled", //when chrome is not controlled by an actual user it sets navigator.webdriver = true.
                //CMPs can detect that and block the banner or nerver render it
                "--window-size=1920,1080" //unsure if really necessary, but ensures that puppeteer launches desktop version
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

        //for debugging:
        page.on('console', msg => console.error("BROWSER:", msg.text()));

        console.error("Navigating to the page...");
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 4000)); //increased it to 4s instead of 2s

        console.error("page is loaded!");

        const waitResult = await waitForCmpUI(page, Object.keys(CMP_SELECTORS_MAP));

        if (waitResult) {
            console.error("found in frame:", waitResult.frame.url());
            //wait shortly in case of more CSS animation
            await new Promise(resolve => setTimeout(resolve, 1500)); 
        }

        //for debugging: interesting: for https://usercentrics.com/de/ the banner is not visible
        await page.screenshot({ path: "debug.png", fullPage: true });

        const { frame: cookieBannerFrame, cmpType } = await findCorrectFrame(page, CMP_SELECTORS_MAP);

        let results = [];
        if (cookieBannerFrame) {
            const data = await extractFromFrame(cookieBannerFrame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
            results.push({frame: cookieBannerFrame, frameUrl: cookieBannerFrame.url(), isMainFrame: cookieBannerFrame  === page.mainFrame(), isCookieBannerFrame: true, cmpType, data})
        } else {
            for (const frame of page.frames()) {
                console.error("No banner frame detected with high confidence. Falling back to all-frame scan.");
                if (!frame.url() || frame.url() === "about:blank") continue;
                const data = await extractFromFrame(frame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
                results.push({ frame, frameUrl: frame.url(), isMainFrame: frame === page.mainFrame(), isCookieBannerFrame: false, cmpType: null, data });
            }   
        }

        if (results.length === 0) {
            return null;
        }

        for (const result of results) {
            //i prioritize buttons, only search for anker-elements if no matching button was found
            const settingsButton = result.data.buttons.find(btn => SETTINGS_PATTERN.test(btn.text) && btn.tag === "BUTTON") ||
                result.data.buttons.find(btn => SETTINGS_PATTERN.test(btn.text) && btn.tag === "A");
            
            if (settingsButton) {
                result.settings = await clickAndExtractSettings(result.frame, settingsButton.selector, page, cmpType);
            } else {
                console.log("Regex failed: trying LLM fallback...");
                const llmSelector = await findSettingsButtonViaLLM(result.data.filteredHtml);
                if (llmSelector) {
                    result.settings = await clickAndExtractSettings(result.frame, llmSelector, page, cmpType);
                } else {
                    result.settings = null;
                }
            }
            
            delete result.frame; //frame object needs to be deleted (too big, only necessary for clicking the settings-button)
        }

        console.error(results);
        console.error("\n========== EXTRACTION RESULTS ==========");
        for (const result of results) {
            console.error(`\nFrame: ${result.frameUrl}`);
            console.error(`   isMainFrame: ${result.isMainFrame} | isCookieFrame: ${result.isCookieBannerFrame}`);
            
            if (result.data.cmpFound) {
                console.error(`  Known CMP detected: ${result.data.cmpType || "unknown"} via selector "${result.data.cmpSelector}"`);
            } else {
                console.error(`  No known CMP – generic extraction`);
            }

            console.error(`\n  Buttons found (${result.data.buttons.length}):`);
            for (const btn of result.data.buttons) {
                console.error(`      [${btn.tag}] "${btn.text}" --> selector: ${btn.selector}`);
            }

            console.error(`\n   Checkboxes found (${result.data.checkboxes.length}):`);
            for (const cb of result.data.checkboxes) {
                console.error(`      "${cb.labelText}" | checked: ${cb.isChecked} | disabled: ${cb.isDisabled}`);
            }

            console.error(`\n  Toggles found (${result.data.toggles.length}):`);
            for (const tgl of result.data.toggles) {
                console.error(`      "${tgl.text}" | aria-checked: ${tgl.ariaChecked}`);
            }

            if (result.settings) {
                console.error(`\n   Settings page extracted (isIframe: ${result.settings.isIframe}):`);
                console.error(`      Buttons: ${result.settings.buttons.length} | Checkboxes: ${result.settings.checkboxes.length} | Toggles: ${result.settings.toggles.length}`);
                for (const btn of result.settings.buttons) {
                    console.error(`      [${btn.tag}] "${btn.text}" --> selector: ${btn.selector}`);
                }
            } else {
                console.error(`\n   No settings page found`);
            }
        }
        console.error("========================================\n");

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
// (async () => {
//     const url = process.argv[2];
    
//     if (!url) {
//         console.error("Error: No URL provided. Usage: node extract_dom.js <url>");
//         process.exit(1);
//     }
    
//     const foundData = await extractStructuredDom(url);

//     if (foundData) {
//         console.error("foundData was filled with a value");
//     }
// })();


//for seperate testing:
(async () => {
    const foundData = await extractStructuredDom("https://zalando.de");
    if (foundData) {
        console.log("foundData was filled with a value");
    }
})();

//https://usercentrics.com/de/
//https://zalando.de --> does not work!
//https://heise.de
//https://spiegel.de