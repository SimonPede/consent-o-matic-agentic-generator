const puppeteer = require("puppeteer");
const CMP_SELECTORS_MAP = require("../utils/cmp_selectors_map");

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
 *
 * @param {Page} page - Puppeteer page instance
 * @param {Object} selectorMap - CSS selector --> CMP name map (CMP_SELECTORS_MAP)
 * @param {number} timeout - max polling time in ms (default: 10000)
 * @returns {{ frame: Frame, selector: string, cmpType: string }|null}
 */
async function waitForCmpUI(page, selectorMap, timeout = 10000) {
    console.error("waitForCmpUI started...");
    const start = Date.now();

    while (Date.now() - start < timeout) {
        for (const frame of page.frames()) {
            try {
                const result = await frame.evaluate((map) => {

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
        await new Promise(r => setTimeout(r, 500));
    }

    console.error("Timeout: CMP UI was not fully rendered in time!");
    return null;
}

const url = process.argv[2];

if (!url) {
    console.log(JSON.stringify({ error: "Missing argument: url required" }));
    process.exit(1);
}

async function run() {

	const browser = await puppeteer.launch({
		headless: true, //users the more modern headless mode (instead of "shell") --> harder to detect as a bot
			args: [
				"--no-sandbox", //important for WSL/Linux
				"--disable-setuid-sandbox", //important for WSL/Linux
				"--disable-blink-features=AutomationControlled", //when chrome is not controlled by an actual user it sets navigator.webdriver = true.
				//CMPs can detect that and block the banner or nerver render it
				"--window-size=1920,1080", //unsure if really necessary, but ensures that puppeteer launches desktop version
				"--lang=en-US,en"
			]
	});
	//when it seems helpful to see what puppeteer does use this browser config:
	// const browser = await puppeteer.launch({
	//     headless: false,
	//     slowMo: 1000,
	//     defaultViewport: null,
	//     args: ["--start-maximized"]
	// });
	const page = await browser.newPage();

	await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
	await page.setExtraHTTPHeaders({
		"Accept-Language": "en-US,en;q=0.9"
	});

	await page.evaluateOnNewDocument(() => {
		Object.defineProperty(navigator, "language", {
			get: function() { return "en-US"; }
		});
		Object.defineProperty(navigator, "languages", {
			get: function() { return ["en-US", "en"]; }
		});
	});

	try {
		console.error("Navigating to the page...");
		await page.goto(url, {
			waitUntil: "networkidle2",
			timeout: 30000
		});

		await new Promise(resolve => setTimeout(resolve, 2000));

		console.error("page is loaded!");

		const waitResult = await waitForCmpUI(page, CMP_SELECTORS_MAP);

		const screenshot = await page.screenshot({ encoding: "base64" });
		console.log(JSON.stringify({ screenshot: screenshot }));

	} catch (err) {
		console.log(JSON.stringify({ 
            error: `Puppeteer Error: ${err.message}` 
        }));
	} finally {
		await browser.close();
	}
}

run();