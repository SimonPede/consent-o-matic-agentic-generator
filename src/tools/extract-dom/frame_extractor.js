/**
 * Cleans raw HTML for LLM consumption by removing irrelevant content.
 * Reduces token count while preserving structure required for selector
 * generation and CMP analysis.
 *
 * Removes:
 * - <script> tags and their content (irrelevant for DOM structure analysis)
 * - Inline event handlers (onclick, onload etc.): not needed for CoM rulesets
 * - Inline styles (style="..."): reduces tokens; CoM's styleFilter is rarely
 *   used in practice and styles are still preserved in the structured
 *   attributes field of each extracted element
 *
 * @param {string} html - Raw HTML string to clean
 * @returns {string} - Cleaned HTML string
 */
function cleanHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/\s*style="[^"]*"/gi, "")
        // Remove inline JS event handlers (e.g., onclick, onload).
        .replace(/\s*on\w+="[^"]*"/gi, "")
        // Collapse repeated whitespace into a single space.
        .replace(/\s+/g, " ")   
        .trim();
}

/**
 * Core content extraction engine. Parses the document tree of a targeted frame context
 * to collect interactive nodes (buttons, checkboxes, toggles) and compile a structured HTML output.
 *
 * @param {Frame} frame - The Puppeteer Frame instance to extract data from
 * @param {Array} selectors - Selector keys from selectorsMap
 * @param {Object} selectorsMap - CSS dictionary mapping selectors to corporate CMP classes
 * @param {string|null} cmpType - Pre-detected CMP classification name, or null
 * @returns {Promise<Object>} - Extraction result containing `buttons`, `checkboxes`,
 * `toggles`, `cmpFound`, `cmpType`, `cmpSelector`, `url`, and `filteredHtml`
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
         * Performs a deep recursive lookup to isolate the first matching element reference 
         * while piercing nested Shadow DOM boundaries.
         *
         * @param {string} selector - Functional CSS selector pattern
         * @param {Document|ShadowRoot|HTMLElement} root - Evaluation root
         * @returns {HTMLElement|null} - The discovered element reference, or null
         */
        function querySelectorDeep(selector, root = document) {
            let found = root.querySelector(selector);
            if (found) {
                return found;
            }

            const all = root.querySelectorAll("*");
            for (const el of all) {
                if (el.shadowRoot) {
                    found = querySelectorDeep(selector, el.shadowRoot);
                    if (found){
                        return found;
                    }
                }
            }
            return null;
        }

        //Preserve tree hierarchy during serialization.
        //A flattened traversal loses parent/child structure and can miss nested
        //shadow hosts. The recursive approach below avoids both issues.

        /**
         * Recursively collects the full HTML of a node including all Shadow DOM content.
         * 
         * Standard innerHTML and outerHTML cannot see inside Shadow Roots. This function rebuilds the HTML tree by walking
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
        function getDeepInnerHtml(node) {
            let htmlResult = "";

            //If the node is a shadow host, traverse from its ShadowRoot.
            const root = node.shadowRoot || node;

            for (const child of root.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    //Clone only the shell first (no descendants).
                    let clone = child.cloneNode(false);

                    //Recursively inject deep content to include nested shadow layers.
                    clone.innerHTML = getDeepInnerHtml(child);
                    htmlResult += clone.outerHTML;

                } else if (child.nodeType === Node.TEXT_NODE) {
                    htmlResult += child.textContent;
                }
            }
            return htmlResult;
        }

        /**
         * Extracts all attributes of an element into a key-value object.
         *
         * @param {HTMLElement} element - HTML element to extract attributes from
         * @returns {Object} - Attribute map (e.g. { id: "btn-accept", class: "cmp-button" })
         */
        function extractAllAttributes(element) {
            const attributes = {};
            for (const attr of element.attributes) {
                if (attr.name === "class") {
                    attributes[attr.name] = attr.value
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 7)
                        .join(" ");
                } else {
                    attributes[attr.name] = attr.value;
                }
            }
            return attributes;
        }

        function compactClassName(classNameValue) {
            if (typeof classNameValue !== "string") {
                return classNameValue || null;
            }

            const normalized = classNameValue
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 7)
                .join(" ");

            return normalized || null;
        }

        //Prefer ARIA-based label resolution first.
        //In modern CMP UIs, native <label> bindings are often replaced by custom
        //structures, while ARIA metadata remains the most reliable signal.

        /**
         * Finds the human-readable label text associated with a checkbox or toggle input.
         * Labels are critical for the LLM to map UI elements to consent categories (A-F).
         * 
         * Shadow DOM aware: standard document.querySelector() cannot find labels that live
         * inside a Shadow Root. The fix: input.getRootNode() returns either document (normal DOM)
         * or the ShadowRoot the input lives in. Calling querySelector() on that root searches
         * within the correct DOM context.
         * 
         * Five strategies in priority order:
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

            //Step 1: `aria-labelledby` can reference one or more label elements.
            const labelledByToken = input.getAttribute("aria-labelledby");

            if (labelledByToken && root.querySelector) {
                //Example: aria-labelledby="title-id description-id"
                const labelIds = labelledByToken.split(/\s+/);
                let combinedTextBuffer = [];
                for (const id of labelIds) {
                    //Prefer `getElementById` when available; ShadowRoot does not provide it.
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
         * Extracts structural metadata (parent and grandparent nodes) for a given element.
         * Enriches the low-dimensional JSON schema with hierarchical layout depth, allowing the 
         * LLM to synthesize highly specific and contextualized CSS selectors.
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
                    className: rootNode.host ? compactClassName(rootNode.host.className) : "shadow-root-boundary",
                    selector: rootNode.host ? 
                        (rootNode.host.id ? `#${rootNode.host.id}` : null) : null
                };
            }

            //Include grandparent information for additional selector context.
            const grandparentElement = parentElement ? parentElement.parentElement : null;

            return {
                tag: parentElement ? parentElement.tagName : null,
                id: parentElement ? parentElement.id : null,
                className: parentElement ? compactClassName(parentElement.className) : null,
                selector: parentElement ? 
                    (parentElement.id ? `#${parentElement.id}` : 
                    parentElement.className ? `.${parentElement.className.trim().split(/\s+/)[0]}` : null) 
                    : null,
                grandparent: grandparentElement ? {
                    tag: grandparentElement.tagName,
                    id: grandparentElement.id || null,
                    className: compactClassName(grandparentElement.className),
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
            //TODO: Evaluate optimal classCount threshold empirically (currently <= 5).

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

            selectorConfidence = el.id ? "very high"
                : el.getAttribute("aria-label") ? "high"
                    : firstClass && classCount === 1 ? "medium"
                        : firstClass ? "low" : "very low";
            

            /**
             * Inside-out strategy: if the element is in a ShadowRoot, recursively
             * resolve its host selector and append the local selector part.
             */
            const activeBoundary = el.getRootNode();
    
            if (activeBoundary instanceof ShadowRoot) { //Element is inside Shadow DOM.
                const shadowHostElement = activeBoundary.host;

                const parentResult = generateDeepSelector(shadowHostElement, shadowHostElement.getRootNode(), depth + 1);
                
                return {
                    //Puppeteer-specific shadow-piercing syntax.
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
         * Note: intentionally avoids strict viewport checks, so elements below the
         * fold can still be detected.
         * 
         * @param {HTMLElement} element - element to check
         * @returns {boolean}
         */
        function isVisible(element) {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            //INPUT controls are often visually hidden and rendered via styled wrappers.
            //Keep them if they are present in the render tree and not explicitly hidden.
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

            //`offsetParent === null` typically indicates `display:none` on self/ancestor.
            //Fixed-position elements are excluded because they also return null.
            if (element.offsetParent === null && style.position !== "fixed") {
                return false;
            }

			const hasFunctionalDimensions = rect.width > 0 && rect.height > 0;
            const hasActiveAlphaChannel = parseFloat(style.opacity) > 0.05;

            return hasFunctionalDimensions && 
				style.visibility !== "hidden" && 
				hasActiveAlphaChannel;
        }

        //Step 1: Try known CMP container selectors in the current frame.
        //`cmpFound: true` means a direct match; otherwise Step 2 performs a generic scan.
        //
        //If the matched host has a ShadowRoot, use it as the search root.
        //`getDeepInnerHtml()` serializes both light and shadow DOM content.

        //Choose the candidate with the highest count of interactive elements.
        //This avoids returning stale/hidden containers when multiple matches exist.
        
        let bestResult = null;
        let maxInteractiveElements = -1;

        for (const selector of selectors) {
            
            //`document.querySelector()` is intentionally used here for performance.
            //CMP host containers are expected in Light DOM; deep traversal is applied
            //later for interactive elements within the selected container.
            const host = document.querySelector(selector);

            //Do not exclude `header`/`footer`: some CMPs place primary controls there.
            if (!host || ["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) {
				continue;
			}
        
                const searchRoot = host.shadowRoot || host;
                
                const buttons = querySelectorAllDeep("button, a, [role='button'], [class*='__btn'], .btn", searchRoot)
                    .filter(element => isVisible(element))
                    .filter(element => element.tagName !== "INPUT") //Guard against misclassified form controls.
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
                    
                //TODO: class-based toggle detection may produce false positives.
                //Consider adding text-based cookie keyword filtering if needed.
                //`aria-checked` is the primary state signal for custom switch controls.
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

                //Extract native checkboxes via `input[type='checkbox']`.
                //`isChecked` captures UI state; semantic meaning is resolved downstream
                //using `labelText` and surrounding context.
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
                    hostClone.innerHTML = getDeepInnerHtml(host);
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
        
		//Step 2: generic fallback when no known CMP selector matches.
        
        const NEGATIVE_SELECTORS = ["nav", "script", "style", "img", "svg", "noscript"];

        const hostClone = document.body.cloneNode(false);
        hostClone.innerHTML = getDeepInnerHtml(document.body);

        const filterBody = document.createElement("div");
        filterBody.appendChild(hostClone);

        NEGATIVE_SELECTORS.forEach(selector => {
            filterBody.querySelectorAll(selector).forEach(element => element.remove());
        });

        const buttons = querySelectorAllDeep("button, a, [role='button'], [class*='__btn'], .btn")
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

		//For unusually large pages, remove HTML payload entirely to avoid context blow-ups.
        if (cleaned.length > 100000) {
            result.filteredHtml = "";
            result.llmFallbackHtml = cleaned.slice(0, 70000);
            result.filteredHtmlOmitted = true;
            result.filteredHtmlOriginalChars = cleaned.length;
        } else {
            //Cap payload to 70k chars to control prompt size and token budget.
            result.filteredHtml = cleaned.slice(0, 70000);
            result.filteredHtmlOmitted = false;
            result.filteredHtmlOriginalChars = cleaned.length;
        }
			
        delete result.html;
    }

    result.cmpType = cmpType;
    
    return result;
}

module.exports = extractFromFrame;