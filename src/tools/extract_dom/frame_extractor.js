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

/**
 * Core content extraction engine. Parses the document tree of a targeted frame context
 * to collect interactive nodes (buttons, checkboxes, toggles) and compile a filtered HTML matrix.
 *
 * @param {Frame} frame - The Puppeteer Frame instance to extract data from
 * @param {Array} selectors - keys values from selectorsMap
 * @param {Object} selectorsMap - CSS dictionary mapping selectors to corporate CMP classes
 * @param {string|null} cmpType - Pre-detected CMP classification name, or null
 * @returns {Promise<Object>} - Resolves with the extracted interactive node matrix and cleaned DOM string
 */
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
         * Performs a deep recursive lookup to isolate the first matching element reference 
         * while seamlessly piercing nested Shadow DOM boundaries.
         *
         * @param {string} selector - Functional CSS selector pattern
         * @param {Document|ShadowRoot|HTMLElement} root - Evaluation root
         * @returns {HTMLElement|null} - The discovered element reference, or null
         */
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

		// ======================================================================
        // ARCHITECTURAL ITERATION NOTE: Structural Dissolution via Naive Traversal
        // ======================================================================
        //Retained for historical validation and design matrix documentation:
        //
        //An early architectural iteration attempted to serialize the deep tree by flattening 
        //innerHTML nodes dynamically. However, this approach introduced two systemic critical failures:
        //
        //1. Structural Hierarchy Dissolution: Flattened string concatenation strips out parent-child 
        //   nesting context. An active target element (e.g., a consent button) trapped deep inside 
        //   a shadow container wrapper would be serialized as a detached sibling node on the same 
        //   logical tier as its host element, ruining downstream structural layout parsing.
        //
        //2. Multi-Level Shadow Frontier Blindness: Invoking querySelectorAll("*") on a top-level 
        //   document context isolates visible host nodes, but remains blind to nested shadow hosts 
        //   deeper within sub-layers. If a corporate CMP dynamically embeds a shadow-encapsulated 
        //   toggle element deep within the layout tree of an outer shadow boundary, a single flat 
        //   traversal tier completely skips the inner node structure.
        //
        //Therefore, strict hierarchical tree traversal with multi-level boundary piercing 
        //must be actively enforced in the production pipeline.
        //======================================================================

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
         * Compiles and extracts all active HTML attribute tokens of a given element node 
         * into a structured key-value map.
		 * 
		 * Provides the main LLM orchestration engine with the full semantic feature context 
         * (ids, class lists, accessibility labels, and dataset properties) required to synthesize 
         * deterministic and high-confidence CSS selectors for Consent-O-Matic engines.
         * 
         * @param {HTMLElement} element - HTML element to extract attributes from
         * @returns {Object} - Key-value pairs of all discovered node attributes (e.g. { id: "btn-accept", class: "cmp-button" })
         */
        function extractAllAttributes(element) {
            const attributes = {};
            for (const attr of element.attributes) {
                attributes[attr.name] = attr.value;
            }
            return attributes;
        }


		// ======================================================================
        // ARCHITECTURAL ITERATION NOTE: Accessibility-Driven Semantic Resolution
        // ======================================================================
        // A previous iteration prioritized native semantic layout elements (<label>) 
        // as the primary data source, treating ARIA properties as a last-resort fallback. 
        // However, empirical testing on production-grade corporate CMP frameworks revealed 
        // that reactive web architectures (e.g., React, Vue, or shadow-encapsulated layouts) 
        // regularly substitute native elements with custom styled <div> or <aside> blocks.
        //
        // In these highly non-standard environments, ARIA node metadata functions as the definitive 
        // single source of truth for assistive technologies. Prioritizing ARIA resolution ensures 
        // highest extraction fidelity for downstream LLM prompt classification inputs.
        //
        // Furthermore, a critical structural edge case was resolved: the 'aria-labelledby' 
        // specification explicitly permits space-separated multi-ID sequences. Passing raw 
        // multi-ID strings directly into querySelector triggers invalid token evaluation crashes. 
        // The production pipeline now splits token streams systematically and dynamically fallbacks 
        // across encapsulation roots.
        // ======================================================================

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
            const labelledByToken = input.getAttribute("aria-labelledby");

            if (labelledByToken && root.querySelector) {
                //aria-labelledby can reference MULTIPLE elements via space-separated IDs.
                //Example: aria-labelledby="title-id description-id"
                const labelIds = labelledByToken.split(/\s+/);
                //Old Version: Passed the entire string into querySelector("#" + labelledBy)
                //If the string contained a space, it created an invalid CSS selector and failed completely
                let combinedTextBuffer = [];
                for (const id of labelIds) {
                    //prefer getElementById() when available (faster than querySelector)
                    //because getElementById searches by ID directly without CSS parsing.
                    //However, ShadowRoot does not have getElementById()
                    //fall back to querySelector("#id") for Shadow DOM contexts.
                    const labelElement = root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
                    if (labelElement && labelElement.innerText.trim()) {
                        combinedTextBuffer.push(labelElement.innerText.trim());
                    }
                }

                if (combinedTextBuffer.length > 0) {
                    return combinedTextBuffer.join(" ");
                }
            }

            const ariaLabelText = input.getAttribute("aria-label");
            if (ariaLabelText && ariaLabelText.trim()) {
                return ariaLabelText.trim();
            }

            if (input.id && root.querySelector) {
                const declarativeLabel = root.querySelector(`label[for="${input.id}"]`);
                if (declarativeLabel && declarativeLabel.innerText.trim()) {
                    return declarativeLabel.innerText.trim();
                }
            }

            const closestLabelElement = input.closest("label");
            if (closestLabelElement && closestLabelElement.innerText.trim()) {
                return closestLabelElement.innerText.trim();
            }

            const elementTitleText = input.getAttribute("title");
            if (elementTitleText && elementTitleText.trim()) {
                return elementTitleText.trim();
            }

            return "";
        }

		/**
         * Extracts structural ancestry metadata (parent and grandparent nodes) for a given element.
         * Enriches the low-dimensional JSON schema with hierarchical layout depth, allowing the 
         * downstream LLM to synthesize highly specific and contextualized CSS selectors.
         * 
		 * Encapsulation Boundary Resolution:
         * Natively, elements at the root tier of a Shadow DOM return `null` for `parentElement`. 
         * This routine detects the encapsulation frontier via `instanceof ShadowRoot` and dynamically 
         * bridges the topological gap by mapping the host node (`root.host`) as the virtual parent.
         *
         * @param {HTMLElement} element - The target DOM element node to analyze
         * @returns {Object} - Structured ancestry metadata matrix including tags, IDs, and class selectors
         */
        function extractParentInfo(element) {
            const parentElement = element.parentElement;
            const rootNode = element.getRootNode();

            if (!parentElement && rootNode instanceof ShadowRoot) {
                return {
                    tag: "SHADOW-HOST",
                    id: rootNode.host ? rootNode.host.id : null,
                    className: rootNode.host ? rootNode.host.className : "shadow-root-boundary",
                    selector: rootNode.host ? 
                        (rootNode.host.id ? `#${rootNode.host.id}` : null) : null
                };
            }

            //Grandparent for deeper hierarchie
            const grandparentElement = parentElement ? parentElement.parentElement : null;

            return {
                tag: parentElement ? parentElement.tagName : null,
                id: parentElement ? parentElement.id : null,
                className: parentElement ? parentElement.className : null,
                selector: parentElement ? 
                    (parentElement.id ? `#${parentElement.id}` : 
                    parentElement.className ? `.${parentElement.className.trim().split(/\s+/)[0]}` : null) 
                    : null,
                grandparent: grandparentElement ? {
                    tag: grandparentElement.tagName,
                    id: grandparentElement.id || null,
                    className: grandparentElement.className || null,
                    selector: grandparentElement.id ? `#${grandparentElement.id}` :
                            grandparentElement.className ? `.${grandparentElement.className.trim().split(/\s+/)[0]}` : null
                } : null
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
                console.error("Telemetry Alert: generateDeepSelector execution exceeded maximum safe depth allocation.");
                return { 
					selector: el.tagName.toLowerCase(),
					selectorConfidence: "very low"
				};
            }

            const firstClass = el.className && typeof el.className === "string" 
                ? el.className.trim().split(" ")[0] : null;
            const classCount = firstClass ? searchRoot.querySelectorAll(`.${firstClass}`).length : 0;

            const selector = el.id ? `#${el.id}`
                : el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute("aria-label")}"]`
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
            const activeBoundary = el.getRootNode();
    
            if (activeBoundary instanceof ShadowRoot) { //am i currently in a shadow DOM?
                const shadowHostElement = activeBoundary.host; //to generate the click, puppeteer needs to know what the host in the light DOM is

                const parentResult = generateDeepSelector(shadowHostElement, shadowHostElement.getRootNode(), depth + 1);
                
                return {
                    //using special puppeteer syntax: https://pptr.dev/guides/page-interactions#querying-elements-in-shadow-dom
                    selector: `${parentResult.selector} >>> ${selector}`,
                    selectorConfidence: parentResult.selectorConfidence === "very high" ? selectorConfidence : "medium" 
                };
            }

            return {
				selector,
				selectorConfidence
			};
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

            if (!host || ["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) {
				continue;
			}
        
                const searchRoot = host.shadowRoot || host;

                const buttons = querySelectorAllDeep("button, a, [role='button']", searchRoot)
                    .filter(element => isVisible(element))
                    .filter(element => element.tagName !== "INPUT") //Safeguard against misclassified form controls
                    .map(element => {
                        const deepSelectorData = generateDeepSelector(element, searchRoot);
                        return {
                            type: "button or anchor",
                            text: element.innerText.trim() || element.getAttribute("aria-label") || element.title || "",
                            tag: element.tagName,
                            attributes: extractAllAttributes(element),
                            parentInfo: extractParentInfo(element),
                            selector: deepSelectorData.selector,
                            selectorConfidence: deepSelectorData.selectorConfidence,
                            role: element.getAttribute("role") || null,
                            isDisabled: element.disabled || element.getAttribute("aria-disabled") === "true",
                        }
                    });
                    
                //TODO: Toggle detection via class names (.toggle, .switch) may produce false positives.
                //Consider adding a text-based filter using cookie-related keywords to reduce noise.
                //aria-checked is the key attribute: "true" = consent given, "false" = consent denied.
                //Note: Modern CMPs often use div/span elements styled as toggles instead of 
                //native <input type="checkbox"> – hence the role="switch" selector.
                const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle'] [class*='switch']", searchRoot)
                    .filter(element => isVisible(element))
                    .map(element => {
                        const deepSelectorData = generateDeepSelector(element, searchRoot);
                        return {
                            type: "toggle",
                            text: element.innerText.trim() || element.getAttribute("aria-label") || findLabelForInput(element) || "",
                            tag: element.tagName,
                            attributes: extractAllAttributes(element),
                            parentInfo: extractParentInfo(element),
                            selector: deepSelectorData.selector,
                            selectorConfidence: deepSelectorData.selectorConfidence,
                            ariaChecked: element.getAttribute("aria-checked") ? element.getAttribute("aria-checked") : element.checked !== undefined ? String(element.checked) : null,
                            isDisabled: element.disabled || element.getAttribute("aria-disabled") === "true",
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
                    .filter(element => isVisible(element))
                    .map(element => {
                        const deepSelectorData = generateDeepSelector(element, searchRoot);
                        return {
                            type: "checkbox",
                            labelText: findLabelForInput(element),
                            tag: element.tagName,
                            attributes: extractAllAttributes(element),
                            parentInfo: extractParentInfo(element),
                            selector: deepSelectorData.selector,
                            selectorConfidence: deepSelectorData.selectorConfidence,
                            isChecked: element.checked,
                            isDisabled: element.disabled || element.getAttribute("aria-disabled") === "true",
                        }
                    });

                const interactiveElementsCount = buttons.length + checkboxes.length + toggles.length;
                if (interactiveElementsCount > maxInteractiveElements && interactiveElementsCount > 0) {
                    maxInteractiveElements = interactiveElementsCount;
                    
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
                        url: window.location.href,
                        html: tempDiv.innerHTML
                    };
                }
            }; //end of for-loop

            if (bestResult) {
                return bestResult;
            }
        
		//Step 2: Fallback Extraction Sequence: Executed when no known corporate CMP is detected.
        //Falls back to a generic extraction across the entire document body context.
        
        //Architectural Iteration Note: A previous configuration blacklisted "header" and "footer" tags.
        //However, empirical testing revealed that major frameworks (such as Usercentrics) frequently 
        //nest critical interactive content inside semantic <header> and <footer> elements. 
        //To prevent data loss, these tags are intentionally omitted from the negative selector matrix.
        const NEGATIVE_SELECTORS = ["nav", "script", "style", "img", "svg", "noscript"];

        const hostClone = document.body.cloneNode(false);
        hostClone.innerHTML = getDeepInnerHTML(document.body);

        const filterBody = document.createElement("div");
        filterBody.appendChild(hostClone);

        NEGATIVE_SELECTORS.forEach(selector => {
            filterBody.querySelectorAll(selector).forEach(element => element.remove());
        });

        const buttons = querySelectorAllDeep("button, a, [role='button']")
            .filter(element => isVisible(element))
            .filter(element => element.tagName !== "INPUT")
            .map(element => {
                const deepSelectorData = generateDeepSelector(element);
                return {
                    type: "button or anchor",
                    text: element.innerText.trim() || element.getAttribute("aria-label") || element.title || "",
                    tag: element.tagName,
                    attributes: extractAllAttributes(element),
                    parentInfo: extractParentInfo(element),
                    selector: deepSelectorData.selector,
                    selectorConfidence: deepSelectorData.selectorConfidence,
                    role: element.getAttribute("role") || null,
                    isDisabled: element.disabled || element.getAttribute("aria-disabled") === "true",
                }
            });

        const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']")
            .filter(element => isVisible(element))
            .map(element => {
                const deepSelectorData = generateDeepSelector(element);
                return {
                    type: "toggle",
                    text: element.innerText.trim(),
                    tag: element.tagName,
                    attributes: extractAllAttributes(element),
                    parentInfo: extractParentInfo(element),
                    selector: deepSelectorData.selector,
                    selectorConfidence: deepSelectorData.selectorConfidence,
                    ariaChecked: element.getAttribute("aria-checked") ? element.getAttribute("aria-checked") : element.checked !== undefined ? String(element.checked) : null,
                    isDisabled: element.disabled || element.getAttribute("aria-disabled") === "true",
                }
            });

        const checkboxes = querySelectorAllDeep("input[type='checkbox']")
            .filter(element => isVisible(element))
            .map(element => {
                const deepSelectorData = generateDeepSelector(element);
                return {
                    type: "checkbox",
                    labelText: findLabelForInput(element),
                    tag: element.tagName,
                    attributes: extractAllAttributes(element),
                    parentInfo: extractParentInfo(element),
                    selector: deepSelectorData.selector,
                    selectorConfidence: deepSelectorData.selectorConfidence,
                    isChecked: element.checked,
                    isDisabled: element.disabled || element.getAttribute("aria-disabled") === "true",
                }
            });

        return {
            buttons,
            checkboxes,
            toggles,
            cmpFound: false,
            cmpType: null,
            cmpSelector: null,
            url: window.location.href,
            html: filterBody.innerHTML,
        };
    }, selectors, selectorsMap);

    if (result.html) {
        const cleaned = cleanHtml(result.html);

		//Capping the payload string length at 100k characters 
        //acts as a strict token budget constraint, ensuring optimal LLM inference performance 
    	//and preventing context window overflows during prompt generation loops.
        result.filteredHtml = cleaned.slice(0, 100000);
		
        delete result.html;
    }

    result.cmpType = cmpType;
    
    return result;
}

module.exports = extractFromFrame;