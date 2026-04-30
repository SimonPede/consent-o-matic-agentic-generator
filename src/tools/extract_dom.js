const puppeteer = require("puppeteer");
const diff = require("diff");
const fs = require("fs");
//utils imports
const CMP_SELECTORS_MAP = require("../utils/cmp_selectors_map");
const CMP_SELECTORS = Object.keys(CMP_SELECTORS_MAP);
const SETTINGS_PATTERN = require("../utils/settingsButtons_terms");
const DARKDIALOGS_SELECTORS = require("../utils/darkdialogs_selectors");
const N_GRAM_DATA = require("../utils/ngram_data");
const CMP_REGEX = require("../utils/cmp_regex");
const CMP_DOMAINS = require("../utils/cmp_domains");


/**
 * Cleans raw HTML for LLM consumption by removing irrelevant content.
 * Reduces token count while preserving the structural information needed
 * for CSS selector generation and banner analysis.
 *
 * Removes:
 * - <script> tags and their content (irrelevant for DOM structure analysis)
 * - Inline event handlers (onclick, onload etc.): not needed for CoM rulesets
 * - Inline styles (style="..."): reduces tokens; CoM's styleFilter is rarely
 *   used in practice and styles are still preserved in the structured
 *   attributes field of each extracted element
 *
 * Note: styleFilter cannot be derived from filteredHtml after this cleaning.
 * If styleFilter becomes necessary, use the attributes field of buttons/checkboxes/toggles.
 *
 * @param {string} html - Raw HTML string to clean
 * @returns {string} - Cleaned HTML string
 */
function cleanHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
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
                        ${html}`,
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
        
        console.error(`LLM suggested settings selector: "${selector}"`);
        return selector;

    } catch (error) {
        console.error("findSettingsButtonViaLLM failed:", error.message);
        return null;
    }
}

async function extractFromFrame(frame, selectors, selectorsMap, cmpType = null) {
    const result = await frame.evaluate((selectors, selectorsMap) => {

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
         * Example for Usercentrics:
         *   document.querySelectorAll("button")        --> finds 0 buttons (Shadow DOM invisible)
         *   querySelectorAllDeep("button")             --> finds all buttons inside Shadow Root
         * 
         * Limitation: only works for open Shadow DOMs (mode: "open").
         * Closed Shadow DOMs (mode: "closed") are inaccessible via JavaScript by design.
         * In practice, CMPs use open Shadow DOMs (verified: Usercentrics).
         * 
         * Performance note: uses root.querySelectorAll("*") without Array.from() to avoid
         * unnecessary array allocation on large DOMs.
         * 
         * @param {string} selector - CSS selector to search for (e.g. "button", "[role='switch']")
         * @param {Document|ShadowRoot|HTMLElement} root - Search root (default: document)
         * @returns {Array<HTMLElement>} - All matching elements across light DOM and all Shadow DOMs
         */
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

        //first better version but fails to keep the hierarchical structure
        //and if node (e.g. body) includes a shadow host which has also elements with shadow DOMs, this code will never find these elements
        //because node.querySelectorAll("*") only searches in Light DOM of the given node
        // function getDeepInnerHTML(node) {
        //     //Light DOM:
        //         // <aside id="usercentrics-cmp-ui">  Shadow Host --> aside.shadowRoot is truthy but "aside instanceof ShadowRoot" is falsy (checks not if element has shadow DOm but if its Shadow Root)
        //         //     #shadow-root (open)            Shadow Root
        //         //         <dialog>                   Shadow DOM content
        //         //             <button>Accept</button>
        //         //         </dialog>
        //     let html = node.innerHTML || "";
        //     if (node.shadowRoot) { //is node a host?
        //         html += getDeepInnerHTML(node.shadowRoot);
        //     }

        //     const children = node.querySelectorAll ? node.querySelectorAll("*") : [];
        //     for (const child of children) {
        //         if (child.shadowRoot) {
        //             html += getDeepInnerHTML(child.shadowRoot);
        //         }
        //     }
        //     return html;
        // }
        //i noticed that i regularly forgot why i it does not work as intended, here some German Gemini explanation for my future self, will be deleted later!
        //but really problematic is the loss of the structure! results would look like "<aside id="cmp-host"></aside><button>Accept</button>", although the button is inside the aside-element
        //Du rufst node.querySelectorAll("*") auf (also document.body.querySelectorAll("*")).

        // Die Methode findet das <my-banner>-Element.
        // Deine for-Schleife läuft:
        // Prüft <my-banner>. Es hat einen shadowRoot.
        // Du rufst rekursiv getDeepInnerHTML für <my-banner>.shadowRoot auf.
        // Jetzt passiert der Fehler: In diesem rekursiven Aufruf ist node nun <my-banner>.shadowRoot.
        // node.innerHTML holt den Inhalt: <div class="settings"></div>.
        // node.shadowRoot ist undefined (ein Shadow Root selbst hat keinen weiteren Shadow Root, nur seine Kinder können welche haben).
        // Du rufst node.querySelectorAll("*") auf dem Shadow Root auf.
        // Es findet <div class="settings">.
        // ABER: <div class="settings"> hat zwar Kinder in seinem eigenen Shadow DOM, aber da dein Code nur flach mit querySelectorAll sucht, sieht er diese nicht.
        // Er prüft nur, ob <div class="settings"> selbst einen shadowRoot hat. Da das div in diesem Beispiel der Host ist, hat es einen.
        // Die Rekursion ruft getDeepInnerHTML auf dem Shadow Root des divs auf.
        // Was aber, wenn das <div class="settings"> keinen Shadow Root hat, sondern ein Kind darin (z.B. <my-toggle>)?
        // querySelectorAll auf <my-banner>.shadowRoot würde <my-toggle> finden (wenn es im Light DOM des Banners liegt).
        // Wenn <my-toggle> aber im Shadow DOM von <div class="settings"> liegt, findet querySelectorAll auf <my-banner>.shadowRoot das <my-toggle> niemals.
        // Das Kernproblem: querySelectorAll durchdringt keine Schattengrenzen. Wenn ein Shadow Host tief im Baum eines anderen Shadow DOMs verschachtelt ist,
        //übersieht dein Code ihn, weil er sich immer nur den "obersten" sichtbaren Layer (das Light DOM des aktuellen Knotens) ansieht.

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
            let html = "";
            //if node is shadow host, we want/have to work in the shadow Root
            //if not, just use the node as root
            const root = node.shadowRoot || node;

            //iterate over all direct children to keep the hierarchical structure in the extracted DOM
            for (const child of root.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    //first clone the shell of the element (e.g: <div class=""...)
                    let clone = child.cloneNode(false);
                    //why now not just "child.outerHTML"?
                    //because if child is itself a shadow host this would find nothing from the shadow dom
                    clone.innerHTML = getDeepInnerHTML(child);

                    html += clone.outerHTML;

                } else if (child.nodeType === Node.TEXT_NODE) {
                    html += child.textContent;
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
            for (const attr of el.attributes) {
                attributes[attr.name] = attr.value;
            }
            return attributes;
        }


        // function findLabelForInput(input) {
        //     const root = input.getRootNode();

        //     if (input.id && root.querySelector) {
        //         const label = root.querySelector(`label[for="${input.id}"]`);
        //         if (label) {
        //             return label.innerText.trim();
        //         }
        //     }
        //     const closestLabel = input.closest("label");
        //     if (closestLabel) {
        //         return closestLabel.innerText.trim();
        //     }

        //     const labelledBy = input.getAttribute("aria-labelledby");
        //     if (labelledBy && root.querySelector) {
        //         const labelEl = root.querySelector(`#${labelledBy}`);
        //         if (labelEl) {
        //             return labelEl.innerText.trim();
        //         }
        //     }
        //     return "";
        // }
        //new version checks aria-labelledby first, rather than as a last resort.
        //In modern, complex web applications (especially CMPs built with React or Shadow DOM), developers often use custom <div> structures
        //instead of native <label> tags. In these cases, ARIA attributes act as the definitive

        /**
         * Finds the human-readable label text associated with a checkbox or toggle input.
         * Labels are critical for the LLM to map UI elements to consent categories (A-F).
         * 
         * Shadow DOM aware: standard document.querySelector() cannot find labels that live
         * inside a Shadow Root. The fix: input.getRootNode() returns either document (normal DOM)
         * or the ShadowRoot the input lives in. Calling querySelector() on that root searches
         * within the correct DOM context.
         * 
         * Four strategies in priority order:
         * 1. ARIA association: aria-labelledby (supports multiple space-separated IDs)
         * 2. Direct ARIA label: aria-label attribute on the input itself
         * 3. Explicit association: <label for="inputId"> linked via input.id
         * 4. Implicit association: input is wrapped inside a <label> element
         * 5. Title attribute: last resort fallback
         * 
         * @param {HTMLInputElement} input - checkbox or toggle input element
         * @returns {string} - label text, or empty string if no label found
         */
        function findLabelForInput(input) {
            const root = input.getRootNode();

            //Step 1: Check for aria-labelledby attribute
            //aria-labelledby is the strongest ARIA labelling mechanism:
            //it explicitly points to one or more elements that serve as the label for this input.
            const labelledBy = input.getAttribute("aria-labelledby");
            if (labelledBy && root.querySelector) {
                //aria-labelledby can reference MULTIPLE elements via space-separated IDs.
                //Example: aria-labelledby="title-id description-id"
                const ids = labelledBy.split(/\s+/);
                //Old Version: Passed the entire string into querySelector("#" + labelledBy)
                //If the string contained a space, it created an invalid CSS selector and failed completely
                let combinedText = [];
                for (const id of ids) {
                    //prefer getElementById() when available (faster than querySelector)
                    //because getElementById searches by ID directly without CSS parsing.
                    //However, ShadowRoot does not have getElementById()
                    //fall back to querySelector("#id") for Shadow DOM contexts.
                    const labelEl = root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
                    if (labelEl && labelEl.innerText.trim()) {
                        combinedText.push(labelEl.innerText.trim());
                    }
                }

                if (combinedText.length > 0) {
                    return combinedText.join(" ");
                }
            }

            const ariaLabel = input.getAttribute("aria-label");
            if (ariaLabel && ariaLabel.trim()) {
                return ariaLabel.trim();
            }

            if (input.id && root.querySelector) {
                const label = root.querySelector(`label[for="${input.id}"]`);
                if (label && label.innerText.trim()) {
                    return label.innerText.trim();
                }
            }

            const closestLabel = input.closest("label");
            if (closestLabel && closestLabel.innerText.trim()) {
                return closestLabel.innerText.trim();
            }

            const title = input.getAttribute("title");
            if (title && title.trim()) {
                return title.trim();
            }

            return "";
        }

        /**
         * Extracts structural information about the direct parent of a given element.
         * Helps the LLM understand DOM hierarchy and use CoM's parent+target selector pattern,
         * 
         * Shadow DOM edge case: if el is the top-level child of a Shadow Root, parentElement
         * returns null because the Shadow Root boundary acts as a wall – there is no parent
         * in the traditional sense. In this case, the logical parent is the Shadow Host element
         * in the Light DOM (e.g. aside#usercentrics-cmp-ui).
         * 
         * Detection: !parent && root instanceof ShadowRoot
         *   --> parent is null (hit the Shadow boundary)
         *   --> root is a ShadowRoot (confirmed: el lives inside Shadow DOM)
         *   --> root.host is the Shadow Host element in the Light DOM
         * 
         * Note: only retrieves one level up. For deeper hierarchy context,
         * the LLM should use filteredHtml.
         * 
         * @param {HTMLElement} el - element found by querySelectorAllDeep()
         * @returns {Object} - tag, id, className of parent, or SHADOW-HOST info if at Shadow boundary
         */
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

        /**
         * Generates a CSS selector for an element, including full Shadow DOM path if needed.
         * 
         * For elements in the normal Light DOM, generates a standard CSS selector using
         * the priority: id > aria-label > unique class > rare class > tag name.
         * 
         * For elements inside a Shadow DOM, uses an "inside-out" approach:
         * 1. Detect that el lives in a Shadow DOM: el.getRootNode() instanceof ShadowRoot
         * 2. Find the Shadow Host in the Light DOM: root.host
         * 3. Recursively generate the selector for the host (which may itself be in a Shadow DOM)
         * 4. Combine: "hostSelector >>> elementSelector" (Puppeteer Shadow-piercing syntax)
         * 
         * Example output for a button inside Usercentrics Shadow DOM:
         *   "aside#usercentrics-cmp-ui >>> [aria-label='Ablehnen']"
         * 
         * IMPORTANT: The >>> syntax is Puppeteer-specific for clicking elements in Shadow DOM.
         * It must NOT be used in the CoM JSON ruleset: the system prompt instructs the LLM
         * to use parent+target pattern instead.
         * 
         * selectorConfidence signals reliability to the LLM:
         * - very high / high: use selector directly
         * - medium: likely unique, verify against filteredHtml
         * - low / very low: use textFilter or parentInfo in CoM ruleset
         * 
         * @param {HTMLElement} el - element to generate selector for
         * @param {Document|ShadowRoot|HTMLElement} searchRoot - root for class uniqueness check
         * @param {number} depth - recursion depth guard (max 5, prevents infinite loops in
         *                         pathological cases of deeply nested Shadow DOM hosts)
         * @returns {{ selector: string, selectorConfidence: string }}
         */
        function generateDeepSelector(el, searchRoot = document, depth = 0) {
            //TODO: evaluate optimal classCount threshold empirically (currently: ≤5)

            if (depth > 5) {
                return { selector: el.tagName.toLowerCase(), selectorConfidence: "very low" };
            }
            const firstClass = el.className && typeof el.className === "string" 
                ? el.className.trim().split(" ")[0] : null;
            const classCount = firstClass ? searchRoot.querySelectorAll(`.${firstClass}`).length : 0;

            const selector = el.id ? `#${el.id}`
                : el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute('aria-label')}"]`
                    : firstClass && classCount === 1 ? `.${firstClass}` //unique
                        : firstClass && classCount <= 5 ? `.${firstClass}` //acceptable
                            : el.tagName.toLowerCase();

            const selectorConfidence = el.id ? "very high"
                : el.getAttribute("aria-label") ? "high"
                    : firstClass && classCount === 1 ? "medium"
                        : firstClass ? "low" : "very low";
            

            /**
             * Perspective: Inside-Out. 
             * Checks if the element is encapsulated within a Shadow DOM.
             * If the root node is a ShadowRoot, we use root.host to "exit" the shadow
             * and find the owning element (Host) in the Light DOM to build a recursive path.
             */
            const root = el.getRootNode();
    
            if (root instanceof ShadowRoot) { //am i currently in a shadow DOM?
                const host = root.host; //to generate the click, puppeteer needs to know what the host in the light DOM is

                const parentResult = generateDeepSelector(host, host.getRootNode(), depth + 1);
                
                return {
                    //using special puppeteer syntax: https://pptr.dev/guides/page-interactions#querying-elements-in-shadow-dom
                    selector: `${parentResult.selector} >>> ${selector}`,
                    selectorConfidence: parentResult.selectorConfidence === "very high" ? selectorConfidence : "medium" 
                };
            }
            return { selector, selectorConfidence};
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
         * 
         * @param {HTMLElement} el - element to check
         * @returns {boolean}
         */
        function isVisible(el) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            //if the element or the container has display:none, "el.offsetParent === null" is true
            //fixed seems to be a weird edge case. TODO: check if true!
            if (el.offsetParent === null && style.position !== "fixed") {
                return false;
            }

            //detecting input elements is a bit tricky
            //there are often hidden for more customization (no width, height etc)
            //so as long as it is in the render tree (first check) and not hidden, i take it
            if (el.tagName === "INPUT") {
                return style.visibility !== "hidden";
            }

            return rect.width > 0 && 
                rect.height > 0 && 
                style.visibility !== "hidden" &&
                parseFloat(style.opacity) > 0.05;
        }

        //Step 1: Check if a known CMP banner container is directly accessible in this frame.
        //Uses querySelectorDeep() to find the container including Shadow DOM hosts.
        //cmpType is already determined in findCorrectFrame() via main frame scan.
        //cmpFound: true signals high-confidence extraction (direct selector match).
        //cmpFound: false (Step 2) signals generic extraction.
        //
        //Shadow DOM handling:
        //If the matched element hosts a Shadow Root (e.g. Usercentrics uses
        //<aside id="usercentrics-cmp-ui"> with a Shadow Root), we use the
        //Shadow Root as the search root for element extraction.
        //getDeepInnerHTML() recursively collects HTML from both light and shadow DOM.
        //
        //Known Limitation: Deeply nested Shadow DOM CMPs (e.g. Usercentrics) may not
        //be fully supported. The CMP type is detected correctly via main frame scan,
        //but waitForSelector() cannot pierce Shadow DOM boundaries, meaning the banner
        //container may not yet be present when extraction runs.
        //Affected CMPs: unknown!! TODO.

        //NOTE: bestResult logic instead of first-match:
        //When testing on flightaware.com, the settings page loaded inside a div
        //that already existed but was hidden. Without bestResult logic, the code
        //would pick the first matching container (the banner) even after the settings
        //page became visible. By selecting the container with the most interactive
        //elements, we ensure the settings page is correctly extracted after clicking.
        let bestResult = null;
        let maxInteractiveElements = -1;

        for (const selector of selectors) {
            
            const host = querySelectorDeep(selector);

            if (!host || ["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) continue;
        
                const searchRoot = host.shadowRoot || host;

                const buttons = querySelectorAllDeep("button, a, [role='button']", searchRoot)
                    .filter(el => isVisible(el))
                    .map(el => {
                        const deepData = generateDeepSelector(el, searchRoot);
                        return {
                            type: "button or anker",
                            text: el.innerText.trim() || el.getAttribute("aria-label") || el.title || "",
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
                    
                //TODO: Toggle detection via class names (.toggle, .switch) may produce false positives.
                //Consider adding a text-based filter using cookie-related keywords to reduce noise.
                //aria-checked is the key attribute: "true" = consent given, "false" = consent denied.
                //Note: Modern CMPs often use div/span elements styled as toggles instead of 
                //native <input type="checkbox"> – hence the role="switch" selector.
                const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle'] [class*='switch']", searchRoot)
                    .filter(el => isVisible(el))
                    .map(el => {
                        const deepData = generateDeepSelector(el, searchRoot);
                        return {
                            type: "toggle",
                            text: el.innerText.trim() || el.getAttribute("aria-label") || findLabelForInput(el) || "",
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
                const checkboxes = querySelectorAllDeep("input[type='checkbox']", searchRoot)
                    .filter(el => isVisible(el))
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

                const interactiveCount = buttons.length + checkboxes.length + toggles.length;
                if (interactiveCount > maxInteractiveElements && interactiveCount > 0) {
                    maxInteractiveElements = interactiveCount;
                    
                    const hostClone = host.cloneNode(false);
                    hostClone.innerHTML = getDeepInnerHTML(host);
                    const tempDiv = document.createElement("div");
                    tempDiv.appendChild(hostClone);

                    ["nav", "script", "style", "img", "svg", "noscript"].forEach(t => {
                        tempDiv.querySelectorAll(t).forEach(n => n.remove());
                    });

                    bestResult = {
                        buttons,
                        checkboxes,
                        toggles,
                        cmpFound: true,
                        cmpSelector: selector,
                        cmpContainerFound: true,
                        url: window.location.href,
                        html: tempDiv.innerHTML
                    };
                }
            }; //end of for loop

            if (bestResult) {
                return bestResult;
            }
        
        //Step 2: No known CMP detected --> extract structured DOM of whole DOM

        //as everything in this code: this is incomplete :)
        // const NEGATIVE_SELECTORS = ["nav", "header", "footer", 
        //     "script", "style", "img", "svg", "noscript"];
        //the UserCentrics Banner has most of its content inside the header and footer
        //i will try:
        const NEGATIVE_SELECTORS = ["nav", "script", "style", "img", "svg", "noscript"];

        const hostClone = document.body.cloneNode(false);
        hostClone.innerHTML = getDeepInnerHTML(document.body);

        const filterBody = document.createElement("div");
        filterBody.appendChild(hostClone);

        NEGATIVE_SELECTORS.forEach(sel => {
            filterBody.querySelectorAll(sel).forEach(el => el.remove());
        });

        const buttons = querySelectorAllDeep("button, a, [role='button']")
            .filter(el => isVisible(el))
            .map(el => {
                const deepData = generateDeepSelector(el);
                return {
                    type: "button or anker",
                    text: el.innerText.trim() || el.getAttribute("aria-label") || el.title || "",
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

        const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']")
            .filter(el => isVisible(el))
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

        const checkboxes = querySelectorAllDeep("input[type='checkbox']")
            .filter(el => isVisible(el))
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
        result.filteredHtml = cleaned.slice(0, 200000);
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
 * Shadow DOM traversal not needed here: document.body.innerText returns
 * rendered text which includes Shadow DOM content automatically.
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
 *        Inspired by paper's screenshot-based visibility check (S.18), adapted for Puppeteer
 * 
 * Deviations from paper:
 *   - No screenshot-based visibility check (Selenium-specific, not available in Puppeteer)
 *     --> replaced with CSS computed style + bounding box check
 *   - No sub-string/duplicate candidate comparison (out of scope for this prototype)
 *   - N-grams extended with German phrases; full multilingual support is a TODO
 *   - Evaluation of the URL and the iframe name (my own idea)
 *   - TODO: implemented concept from Nouwens et al. (2025) - A Cross-Country Analysis of GDPR Cookie Banners:
 *         they also evaluated if elements had a z-index > 10 and if position: fixed
 * 
 * @param {Frame} frame - Puppeteer frame to score
 * @param {number} avgWordCount - average word count across all frames (from frameWordCounter())
 * @param {Object} selectorMap - CMP_SELECTORS_MAP for domain-specific selector matching
 * @returns {number} - score (higher = more likely to be a cookie banner frame)
 */
async function calculateFrameScore(frame, avgWordCount, selectorMap) {
    try {
        const url = frame.url();
        const name = frame.name();
        let frameScoreBonus = 0;

        if (CMP_DOMAINS.some(domain => url.includes(domain))) {
            frameScoreBonus += 50; //TODO: evaluate!
        }

        if (CMP_REGEX.test(url) || CMP_REGEX.test(name)) {
            frameScoreBonus += 20; //TODO: evaluate!
        }

        const score = await frame.evaluate((customS, avg, selectorMap, nGrams) => {
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

            function querySelectorAllDeep(selector, root = document) {
                let nodes = Array.from(root.querySelectorAll(selector));
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

            //functionality really similiar to getDeeperInnerHTML()
            function getDeepText(node) {
                let text = "";
                const root = node.shadowRoot || node;

                for (const child of root.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        text += " " + child.textContent;
                    } else if(child.nodeType === Node.ELEMENT_NODE) {
                        text += " " + getDeepText(child);
                    }
                }
                return text.trim();
            }

            let localScore = 0;
            const text = getDeepText(document.body).replace(/\s+/g, " ").trim();
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const wordsCounter = words.length;

            if (wordsCounter === 0) {
                return -100;
            } else if (wordsCounter < 5) {
                localScore -= 20;
            } else if (wordsCounter > (avg + 100)) {
                localScore -= 20;
            }

            for (const selector of customS) {
                const relults = querySelectorAllDeep(selector);
                if (relults.length > 0) {
                    localScore += 2;
                    break;
                }
            }

            for (const selector of Object.keys(selectorMap)) {
                const relults = querySelectorAllDeep(selector);
                if (relults.length > 0) {
                    localScore += 10;
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
                        localScore += weight;
                    }
                }
            }

            return localScore;
        }, DARKDIALOGS_SELECTORS, avgWordCount, selectorMap, N_GRAM_DATA);

        if (score < -100) {
            return score;
        }

        return score + frameScoreBonus;
    } catch (err) {
        console.error("frame could not be scored!");
        return -100;
    }
}

/**
 * Identifies the CMP type and the most likely frame hosting the cookie banner.
 * Uses a two-step approach:
 * 
 * Step 1: CMP Type Detection (main frame scan):
 *   Scans the main frame for known CMP container elements using CMP_SELECTORS_MAP
 *   (Nouwens et al. 2025, Appendix C). Returns the CMP name if found (e.g. "Sourcepoint").
 *   Runs on main frame only: CMP providers always place a bootstrap container there
 *   even when the banner itself loads in an iframe.
 *   Verified on: heise.de (Sourcepoint), spiegel.de, usercentrics.com
 * 
 * Step 2: Score-based Frame Selection (calculateFrameScore):
 *   All frames are scored. The score incorporates:
 *   - Domain matching against known CMP CDN domains (+50 bonus)
 *   - URL/name regex matching against CMP-related keywords (+20 bonus)
 *   - N-gram analysis of visible text content
 *   - CSS selector matching (general: +2, CMP-specific: +10)
 *   - Word count penalties
 *   The highest-scoring frame is returned if score > 0.
 *   Inspired by: DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs
 * 
 * @param {Page} page - Puppeteer page instance
 * @param {Object} selectorMap - CSS selector → CMP name map (CMP_SELECTORS_MAP)
 * @returns {{ frame: Frame|null, cmpType: string|null }}
 */
async function findCorrectFrame(page, selectorMap) {
    const frames = page.frames();

    //just for debugging:
    console.error(`I found ${frames.length} frames.`);

    //TODO: test if main frame is enough!!
    const cmpType = await page.mainFrame().evaluate((selectorMap) => {
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

        for (const [selector, cmpName] of Object.entries(selectorMap)) {
            const foundNodes = querySelectorAllDeep(selector);
            if (foundNodes.length > 0) {
                return cmpName;
            }
        }
        return null;
    }, selectorMap);


    console.error(`CMP Type detected: ${cmpType}`);

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
        function querySelectorAllDeep(selector, root = document) {
            let nodes = Array.from(root.querySelectorAll(selector));

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

        function getDeepInnerHTML(node) {
            let html = "";
            const root = node.shadowRoot || node;

            for (const child of root.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) {

                    let clone = child.cloneNode(false);
                    clone.innerHTML = getDeepInnerHTML(child);

                    html += clone.outerHTML;

                } else if (child.nodeType === Node.TEXT_NODE) {
                    html += child.textContent;
                }
            }
            return html;
        }

        function isVisible(el) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();

            //if the element or the container has display:none, "el.offsetParent === null" is true
            //fixed seems to be a weird edge case. TODO: check if true!
            if (el.offsetParent === null && style.position !== "fixed") {
                return false;
            }

            //detecting input elements is a bit tricky
            //there are often hidden for more customization (no width, height etc)
            //so as long as it is in the render tree (first check) and not hidden, i take it
            if (el.tagName === "INPUT") {
                return style.visibility !== "hidden";
            }

            return rect.width > 0 && 
                rect.height > 0 && 
                style.visibility !== "hidden" &&
                parseFloat(style.opacity) > 0.05;
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
 * Click strategy (two attempts):
 * 1. JS click via frame.evaluate(): dispatches mousedown + mouseup + click events.
 *    More reliable for CMPs that listen to individual mouse events.
 *    Also handles Shadow DOM selectors via >>> syntax.
 * 2. Puppeteer frame.click() as fallback if JS click returns false.
 * 
 * After clicking, three scenarios are handled:
 * 1. New iframe(s) appear: scored via calculateFrameScore(), best frame extracted.
 * 2. Existing frame DOM changes significantly (chars/inputs/buttons added):
 *    extracted from same frame if functional elements (checkboxes/toggles) are found.
 * 3. No significant change detected: returns null (click had no effect).
 * 
 * @param {Frame} frame - Puppeteer frame containing the settings button
 * @param {string} selector - CSS selector of the button (supports >>> for Shadow DOM)
 * @param {Page} page - Puppeteer page instance (needed to detect new frames)
 * @param {string|null} cmpType - detected CMP name, propagated to extraction result
 * @returns {Object|null} - extracted settings DOM object, or null if click had no effect
 */
async function clickAndExtractSettings(frame, selector, page, cmpType) {
    //the problem: i dont know what the click causes. Sometimes the DOM is updated in the same frame, sometimes a new iFrame pops up
    //two options: extract from all frames again
    //or compare the DOM of the frame before and after the click --> is it different? then extract from this frame
    //otherwise look for new iframes that got loaded
    //DOM change detection uses Diff.diffChars() for character-level comparison,
    //supplemented by visible input/button count changes as additional signals.
    //TODO: evaluate optimal thresholds empirically (currently: >500 chars, >0 inputs, >=2 buttons)
    const framesBefore = page.frames().map(f => f.url()); //which frames are there before the click?
    console.error(`settings selector: ${selector}`);
    const oldState = await getFrameState(frame);

    const clickSuccess = await frame.evaluate((sel) => {
        const parts = sel.split(" >>> ");
        let currentRoot = document;
        let target = null;

        for (let i = 0; i < parts.length; i++) {
            target = currentRoot.querySelector(parts[i]);
            if (!target) {
                return false;
            }
            
            if (i < parts.length - 1) {
                currentRoot = target.shadowRoot;
                if (!currentRoot) {
                    return false
                };
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
    }, selector);

    if (!clickSuccess) {
        console.error("JS Click failed. Trying Puppeteer fallback...");
        try {
            await frame.click(selector);
        } catch (err) {
            console.error("Puppeteer click also failed:", err.message);
            return null;
        }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    //debugging
    // const framesAfterClick = page.frames();
    // console.error("Frames nach Klick:");
    // framesAfterClick.forEach((f, i) => console.error(`Frame ${i}: ${f.url()}`));
    await page.screenshot({ path: 'after_click.png' });
    ///////////

    await new Promise(resolve => setTimeout(resolve, 3000));
    const newFrames = page.frames().filter(f => !framesBefore.includes(f.url()));

    let bestNewFrame = null;
    let highestScore = 0;
    
    if (newFrames.length > 0) {
        console.error(`${newFrames.length} new frames after the click. Starting scoing...`);
        
        const fallbackAvgWordCount = 100; 

        for (const newFrame of newFrames) {
            const score = await calculateFrameScore(newFrame, fallbackAvgWordCount, CMP_SELECTORS_MAP);
            console.error(`Frame Score: ${score} for URL: ${newFrame.url()}`);
            
            if (score > highestScore) {
                highestScore = score;
                bestNewFrame = newFrame;
            }
        }
    }

    if (bestNewFrame) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const settings = await extractFromFrame(bestNewFrame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
        settings.isIframe = bestNewFrame !== page.mainFrame(); //isIframe signals to the LLM whether to set iframeFilter: true in the CoM ruleset
        return settings;
        // console.error(JSON.stringify(result.settings.buttons, null, 2));
    } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const newState = await getFrameState(frame);

        const changes = diff.diffChars(oldState.html, newState.html);
        const addedChars = changes
            .filter(c => c.added) //filteres for evrything that is actually new
            .reduce((sum, c) => sum + c.count, 0);
        
        const addedInputs = newState.inputs - oldState.inputs;
        const addedButtons = newState.buttons - oldState.buttons;

        console.error(`DOM diff: ${addedChars} chars added, ${addedInputs} inputs added.`);
        console.error(`Old state: ${oldState.buttons} buttons, ${oldState.inputs} inputs.`);
        console.error(`New state: ${newState.buttons} buttons, ${newState.inputs} inputs.`);

        //TODO: evaluate if these are good indicators. Maybe include sth like: newly rendered elements in general?
        if (addedChars > 500 || addedInputs > 0 || addedButtons >= 2) {
            console.error(`Settings detected: ${addedChars} chars, ${addedInputs} inputs, ${addedButtons} buttons added.`);
            const settings = await extractFromFrame(frame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);

            if (settings.checkboxes.length > 0 || settings.toggles.length > 0) {
                console.error(`Settings UI seems to be there! ${settings.checkboxes.length + settings.toggles.length} functional elements got found.`);
                settings.isIframe = frame !== page.mainFrame();
                return settings;
            } else {
                console.error(" A False Positive after the click?!");
                return null;
            }
            // console.error(JSON.stringify(result.settings.buttons, null, 2));
        } else {
            console.error("Settings click seems to have had no effect");
            return null;
        }
    }
}

/**
 * Polls all frames until a known CMP container with rendered buttons is found.
 * Used before findCorrectFrame() to ensure the banner is fully loaded.
 * 
 * Checks both Light DOM and Shadow DOM (via querySelectorAllDeep) because
 * some CMPs like Usercentrics render their banner inside a Shadow Root.
 * 
 * @param {Page} page - Puppeteer page instance
 * @param {string[]} selectors - CMP container selectors to watch for
 * @param {number} timeout - max wait time in ms (default: 10000)
 * @returns {{ frame: Frame, selector: string }|null}
 */
async function waitForCmpUI(page, selectors, timeout = 10000) {
    console.error("waitForCmpUI started...");
    const start = Date.now();

    while (Date.now() - start < timeout) {
        for (const frame of page.frames()) {
            try {
                const foundSelector = await frame.evaluate((sels) => {
                    //i really reuse this function to often!
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

                    for (const sel of sels) {
                        const host = querySelectorAllDeep(sel)[0];
                        if (host && !["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) {
                            
                            const searchRoot = host.shadowRoot || host;
                            const buttons = querySelectorAllDeep("button, a, [role='button']", searchRoot);
                            
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
        // page.on('console', msg => console.error("BROWSER:", msg.text()));

        console.error("Navigating to the page...");
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        console.error("page is loaded!");

        const waitResult = await waitForCmpUI(page, Object.keys(CMP_SELECTORS_MAP));

        if (waitResult) {
            console.error(`waitForCmpUI found ${waitResult.selector} in frame ${waitResult.frame.url()}`);
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
                console.error(`Regex failed in frame ${result.frame.url()}, trying LLM fallback...`);
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
                console.error(`\n  Buttons found (${result.settings.buttons.length}):`);
                for (const btn of result.settings.buttons) {
                    console.error(`      [${btn.tag}] "${btn.text}" --> selector: ${btn.selector}`);
                }

                console.error(`\n   Checkboxes found (${result.settings.checkboxes.length}):`);
                for (const cb of result.settings.checkboxes) {
                    console.error(`      "${cb.labelText}" | checked: ${cb.isChecked} | disabled: ${cb.isDisabled}`);
                }

                console.error(`\n  Toggles found (${result.settings.toggles.length}):`);
                for (const tgl of result.settings.toggles) {
                    console.error(`      "${tgl.text}" | aria-checked: ${tgl.ariaChecked}`);
                }
            } else {
                console.error(`\n   No settings page found`);
            }
        }
        console.error("========================================\n");
        fs.writeFileSync('extraction_debug.json', JSON.stringify(results, null, 2));
        console.error("Gesamter Output wurde in extraction_debug.json gespeichert.");
        await browser.close();
        console.error("browser closed!");

        console.log(JSON.stringify(results)) //for sending it to the pyhton code
        return results;
    } catch (error) {
        console.error("extractStructuredDom failed:", error.message);
        return null;
    } finally {
        console.error("extractStructuredDom finished");
    }
    
};

// i now only use console.error() instead of .log for debugging etc, because this would otherwise get implemented in the input for the langgraph script
(async () => {
    //in graph.py called like this: 
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


//for seperate testing:
// (async () => {
//     const foundData = await extractStructuredDom("https://www.cookiebot.com/");
//     if (foundData) {
//         console.log("foundData was filled with a value");
//     }
// })();

//https://usercentrics.com/de/
//https://zalando.de
//https://heise.de
//https://spiegel.de

//URLS for few shot examples:
//1: https://www.flightaware.com/ --> not up to da
//2: https://www.affinity.com/ --> not up to da
//3: https://cookieinformation.com/ --> not up to da
//4: https://www.cookiebot.com/ --> minor tweaks necessary because of "inline" at the ids
//5: https://www.swedbank.com/ --> fits almost perfectly. Current uses not the seemingly random generated ids like id-890693537-1
//--> system prompt: "**Dynamic IDs:** If a checkbox or toggle has an ID that appears dynamically 
// generated (e.g., contains long numeric strings like `#id-890693537-1`), 
// do not use the ID as selector. Instead use the `name` attribute:
// `input[name='functi']` or combine with a stable parent class:
// `.cookie-form input[name='functi']`
// The `name` attribute and class names from `parentInfo` are stable alternatives."

// https://www.transavia.com/ --> settings btton führt zum falschen iframe
// https://ameliconnect.ameli.fr/ --> weird strcuture, where my script fails to extract the settings page




//sehr spannedner outpt:
//CMP Type detected: null
// a frame was picked by score: https://www.skyscanner.de/sttc/px/captcha-v2/index.html?url=Lw==&uuid=47bb3710-424e-11f1-be4c-f97fa79ab85f with Score: 2
// Regex failed in frame https://www.skyscanner.de/sttc/px/captcha-v2/index.html?url=Lw==&uuid=47bb3710-424e-11f1-be4c-f97fa79ab85f, trying LLM fallback...
// findSettingsButtonViaLLM failed: fetch failed
// [
//   {
//     frameUrl: 'https://www.skyscanner.de/sttc/px/captcha-v2/index.html?url=Lw==&uuid=47bb3710-424e-11f1-be4c-f97fa79ab85f',
//     isMainFrame: true,
//     isCookieBannerFrame: true,
//     cmpType: null,
//     data: {
//       buttons: [],
//       checkboxes: [],
//       toggles: [],
//       cmpFound: false,
//       cmpType: null,
//       cmpSelector: null,
//       cmpContainerFound: false,
//       url: 'https://www.skyscanner.de/sttc/px/captcha-v2/index.html?url=Lw==&uuid=47bb3710-424e-11f1-be4c-f97fa79ab85f',
//       filteredHtml: '<body><div id="root"><div id="app_main" class="App_App__YzZiO"><section class="App_App__logo__NTM3Y"></section><section class="App_App__image__MzI5Z"><div class="UNKNOWN" data-backpack-ds-comp><div class="BpkImage_bpk-image__NDc4O BpkImage_bpk-image--no-background__MTIzO"></div></div></section><h1 class="App_App__headline__OGFkN">Bist du ein Mensch oder ein Roboter?</h1><section class="App_App__message__YzI1N">Nimm das bitte nicht persönlich – einige Skripts und Bots sind heutzutage bemerkenswert lebensecht!</section><section class="App_App__captcha__NTllM"><div id="px-captcha"></div></section><section class="App_App__resolve__NTJjZ">Du kannst immer noch nicht auf die Seite zugreifen? Bitte überprüfe, ob du JavaScript und Cookies eingeschaltet hast und stelle sicher, dass dein Browser den Ladevorgang nicht unterdrückt.</section><section class="App_App__identifier__M2ZkO">47bb3710-424e-11f1-be4c-f97fa79ab85f</section></div></div><iframe src="https://js.px-cloud.net/?t=d-zgelyj4qu-1777303942797&amp;v=478ee737-424e-11f1-824c-a750f9e5535d" dataframetoken="d-zgelyj4qu-1777303942797" referrerpolicy="strict-origin-when-cross-origin" aria-hidden="true" tabindex="-1" role="presentation" title=""></iframe></body>'
//     },
//     settings: null
//   }
// ]




























// 2. Greedy Extraction Logic ("Best-Fit" Strategy)
// The Change: Shifted from "First-Fit" (returning the first element that matches a CMP selector) to "Best-Fit" (iterating through all matches and selecting the one with the highest interactiveCount).

// Reasoning: CMPs like OneTrust often inject multiple elements matching the same CSS patterns (e.g., empty backdrops or hidden containers). Selecting the first match often results in "empty" extractions.

// Academic Justification: To ensure heuristic robustness, the agent implements a density-based selection algorithm. By quantifying interactive potential (buttons, toggles, checkboxes), the system prioritizes the active UI layer over decorative or structural background elements.

// 3. Render-Tree Aware State Diffing
// The Change: Integrated an isVisible check into the getFrameState function used for click-success verification.

// Reasoning: Many CMPs "preload" the settings menu in a hidden state (display: none). A standard HTML string-diff detects no change after a click because the code existed beforehand.

// Academic Justification: Interaction verification in Single Page Applications (SPAs) must distinguish between the DOM Tree (presence) and the Render Tree (visibility). By monitoring Computed Styles, the agent validates the success of an action based on actual user-perceivable UI state changes.

// 4. Native DOM Event Dispatching
// The Change: Implemented a dual-layer click strategy using native target.click() and MouseEvent dispatching (mousedown, mouseup) within the browser context.

// Reasoning: Puppeteer’s synthetic page.click() simulates coordinates and can be intercepted by invisible overlays or z-index filters (Backdrops). Native JS clicks bypass these visual obstructions.

// Academic Justification: Automated interaction with third-party overlays requires bypassing the Synthetic Event System of high-level drivers to ensure reliability against visual occlusion (e.g., modal backdrops).

// 5. Semantic Label Resolution (ARIA-Mapping)
// The Change: Overhauled findLabelForInput to resolve aria-labelledby (including multi-ID strings), aria-label, and implicit label relationships.

// Reasoning: Modern frameworks rarely use the classic <label for="..."> syntax. Without resolving ARIA relationships, extracted checkboxes/toggles remain "anonymous" and useless for LLM processing.

// Academic Justification: Addressing the Semantic Gap in automated audits. By implementing a Multi-tier Label Resolution Heuristic, the system reconstructs the Accessibility Object Model (AOM) relationships, turning raw technical nodes into semantically meaningful data points for the audit agent.










//Die Evaluation auf komplexen Domänen wie Swedbank zeigte, dass die Implementierung einer Render-Tree-basierten Sichtbarkeitsprüfung (mittels offsetParent) kritisch für den Erfolg der Extraktion ist. Während naive DOM-Scans an visuell verschleierten <input>-Tags scheiterten, konnte die angepasste Heuristik alle Consent-Checkboxen sowie deren Zustände (disabled/checked) fehlerfrei erfassen. Das auftretende 'Hintergrund-Rauschen' (irrelevante Navigationslinks) beeinträchtigt die nachgelagerte LLM-Verarbeitung nicht, da die semantische Eindeutigkeit der Consent-Elemente erhalten bleibt.