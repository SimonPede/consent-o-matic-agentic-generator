/**
 * Polls all frames until a known CMP container with rendered buttons is found.
 * Serves two purposes:
 * 1. Waits for the banner to be fully rendered before extraction starts
 * 2. Detects the CMP type early (returned as cmpType) so findCorrectFrame()
 *    does not need to repeat the main frame scan
 *
 * Host detection uses document.querySelector() (Light DOM only). Much faster than
 * querySelectorAllDeep and sufficient since CMP host elements are always in the
 * Light DOM. Button detection inside the container uses querySelectorAllDeep()
 * to handle Shadow DOM CMPs like Usercentrics.
 *
 * Note: This function intentionally does NOT return the host frame as the final banner frame.
 * The host injection point may reside in the main frame while the actual content layers load 
 * inside an asynchronous iframe. Frame selection is decoupled and delegated to `findCorrectFrame()`.
 *
 * @param {Page} page - Puppeteer page instance
 * @param {Object} selectorMap - CSS selector --> CMP name map (CMP_SELECTORS_MAP)
 * @param {number} timeout - max polling time in ms (default: 10000)
 * @returns {{ frame: Frame, selector: string, cmpType: string }|null}
 */
async function waitForCmpUi(page, selectorMap, timeout = 10000) {
    console.error("waitForCmpUI started...");
    const start = Date.now();

    while (Date.now() - start < timeout) {
        for (const frame of page.frames()) {
            try {
                const result = await frame.evaluate((map) => {

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
                        return nodes;
                    }

                    for (const [selector, cmpName] of Object.entries(map)) {
                        const host = document.querySelector(selector); //much faster than also searching the Shadow DOM and completely enough until now
                        if (host && !["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) {
                            
                            const searchRoot = host.shadowRoot || host;
                            const buttons = querySelectorAllDeep("button, a, [role='button']", searchRoot);
                            
                            if (buttons.length > 0) {
                                return { selector, cmpName };
                            }
                        }
                    }
                    return null;
                }, selectorMap);

                if (result) {
                    console.error(`CMP UI seems to be rendered via: "${result.selector}" (${result.cmpName}) in frame: ${frame.url()}`);
                    return { frame, selector: result.selector, cmpType: result.cmpName };
                }
            } catch (e) {
                continue;
            }
        }
        //Wait 500ms before the next polling attempt
        await new Promise(r => setTimeout(r, 500));
    }

    console.error("Timeout: CMP UI was not fully rendered in time!");
    return null;
}

module.exports = waitForCmpUi;