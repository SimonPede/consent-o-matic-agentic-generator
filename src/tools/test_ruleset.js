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
 * Note: This function intentionally does NOT return the frame as the banner frame.
 * The host element may be in the main frame while the actual banner content
 * loads inside an iframe – frame selection is delegated to findCorrectFrame().
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


// Schritt 1: Argumente einlesen (url + ruleset von Python)
// Schritt 2: CoM-Source vorbereiten (buildCoMSource)
// Schritt 3: Browser öffnen, Seite laden, Engine injizieren
// Schritt 4: Ergebnis als JSON auf stdout ausgeben


//THANK YOU JANUS FOR THE HELP!!! 

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

//Arguments from Python subprocess call:
//node test_ruleset.js <url> <ruleset_json>
const url = process.argv[2];
const rulesetJson = process.argv[3];

if (!url || !rulesetJson) {
    console.log(JSON.stringify({ error: "Missing arguments: url and ruleset_json required" }));
    process.exit(1);
}

let ruleset;
try {
    ruleset = JSON.parse(rulesetJson);
} catch (e) {
    console.log(JSON.stringify({ error: "Invalid JSON: " + e.message }));
    process.exit(1);
}

console.log(JSON.stringify({ debug: "Arguments parsed", url, rulesetKeys: Object.keys(ruleset) }));

//files in dependency order - Tools first, ConsentEngine last
const COM_DIR = path.join(__dirname, "consent-engine");
const COM_FILES = [
    "Tools.js",
    "Matcher.js",
    "Consent.js",
    "Action.js",
    "Detector.js",
    "CMP.js",
    "ConsentEngine.js",
];

function buildCoMSource() {
    return COM_FILES.map((file) => {
        let content = fs.readFileSync(path.join(COM_DIR, file), "utf8");
        //Remove all import lines
        content = content.replace(/^import .+$/gm, "");
        //"export default class X" --> "class X"
        content = content.replace(/^export default /gm, "");
        //"export class X {" --> "class X {"
        content = content.replace(/^export /gm, "");
        return content;
    }).join("\n");
}

const comSource = buildCoMSource();

async function runTest() {
	console.error("Starting CoM Test Engine...");

	//browser gets initiated exactly as in my extract script
	const browser = await puppeteer.launch({
	headless: true, //users the mor modern headless mode (instead of "shell") --> harder to detect as a bot
		args: [
			"--no-sandbox", //important for WSL/Linux
			"--disable-setuid-sandbox", //important for WSL/Linux
			"--disable-blink-features=AutomationControlled", //when chrome is not controlled by an actual user it sets navigator.webdriver = true.
			//CMPs can detect that and block the banner or nerver render it
			"--window-size=1920,1080", //unsure if really necessary, but ensures that puppeteer launches desktop version
			"--lang=en-US,en"
		]
	});
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

        //inject CoM engine globally into the page
        await page.addScriptTag({ content: comSource });

        //run the test with the ruleset
        const result = await page.evaluate((ruleConfig) => {
            return new Promise((resolve) => {
				//define window.chrome as an empty function because ConsentEngine.js
				//at one point calls chrome.runtime.sendMessage();
				//this would otherwise crash my code as chrome is undefined in puppeteer context
                if (typeof chrome === "undefined") {
                    window.chrome = { runtime: { sendMessage: () => {} } };
                }

				ConsentEngine.singleton = null;
                ConsentEngine.generalSettings = { hideInsteadOfPIP: true };
                ConsentEngine.debugValues = {
                    // clickDelay: false,
                    // skipSubmit: false,
                    // paintMatchers: false,
                    // debugClicks: false,
                    // skipHideMethod: false,
                    // debugLog: false,
                    // skipSubmitConfirmation: false,
                    // dontHideProgressDialog: true,
					"clickDelay": false,
					"skipSubmit": true,
					"paintMatchers": false,
					"debugClicks": false,
					"alwaysForceRulesUpdate": false,
					"skipHideMethod": false,
					"debugLog": true,
					"debugTranslations": false,
					"skipSubmitConfirmation": false,
					"dontHideProgressDialog": false
                };

				ConsentEngine.singleton = new ConsentEngine(ruleConfig, {
					"A": false,
					"B": false,
					"D": false,
					"E": false,
					"F": false,
					"X": false
					}, (evt)=>{
						resolve(evt);
				});
            });
        }, ruleset);

        console.log(JSON.stringify({ handled: result.handled, cmpName: result.cmpName || null, clicks: result.clicks || 0, error: null }));

    } catch (err) {
        console.log(JSON.stringify({ 
            handled: false, 
            cmpName: null, 
            clicks: 0, 
            error: `Puppeteer Error: ${err.message}` 
        }));
    } finally {
        await browser.close();
    }
}

runTest();