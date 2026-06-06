/**
 * Polling utility that waits until a known CMP container is fully rendered with interactive elements.
 * Acts as a strict synchronization barrier to ensure screenshots are captured only when the UI is stable.
 *
 * @param {Page} page - Puppeteer page instance
 * @param {Object} selectorMap - CSS selector --> CMP name map (CMP_SELECTORS_MAP)
 * @param {number} timeout - max polling time in ms (default: 10000)
 * @returns {boolean} - Returns true if a valid CMP interface is rendered, false on timeout
 */
async function waitForCmpUi(page, selectorMap, timeout = 10000) {
	console.error("waitForCmpUI started...");
	const start = Date.now();

	while (Date.now() - start < timeout) {
		for (const frame of page.frames()) {
			try {
				const isRendered = await frame.evaluate((map) => {

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

					for (const [selector, cmpName] of Object.entries(map)) {
						const host = document.querySelector(selector);
						if (host && !["SCRIPT", "STYLE", "LINK", "META"].includes(host.tagName)) {
							
							const searchRoot = host.shadowRoot || host;
							const buttons = querySelectorAllDeep("button, a, [role='button']", searchRoot);
							
							if (buttons.length > 0) {
								return true
							}
						}
					}
					return false;
				}, selectorMap);

				if (isRendered) {
					console.error(`CMP UI successfully stabilized in frame: ${frame.url()}`);
					return true;
				}
			} catch (e) {
				continue;
			}
		}
		await new Promise(r => setTimeout(r, 500));
	}

	console.error("Timeout: CMP UI was not fully rendered in time!");
	return false;
}

module.exports = waitForCmpUi