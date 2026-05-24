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
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

		//TODO: replace fixed sleep with waitForCmpUI() polling for robustness
		//See extract_dom.js for implementation
        await new Promise((r) => setTimeout(r, 3000));

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
        console.log(JSON.stringify({ handled: false, cmpName: null, clicks: 0, error: err.message }));
    } finally {
        await browser.close();
    }
}

runTest();