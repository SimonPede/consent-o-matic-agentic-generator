const puppeteer = require("puppeteer");
const diff = require("diff");
const fs = require("fs");
//utils imports
const CMP_SELECTORS_MAP = require("../../utils/cmp_selectors_map");
const CMP_SELECTORS = Object.keys(CMP_SELECTORS_MAP);
const SETTINGS_TERMS_REGEX = require("../../utils/settings_buttons_terms");
const waitForCmpUi = require("../../utils/wait_for_cmp_ui.js");

//Modular Sub-Components
const findCorrectFrame = require("./frame_matcher.js");
const extractFromFrame = require("./frame_extractor");
const clickAndExtractSettings = require("./settings_extractor");
const findSettingsButtonViaLLM = require("./llm_fallback");

// ---------------
// IMPORTANT!!!!
// for get a quicker understanding what the logic of this file is
// please look in the root because i addeded 040626-extract_dom-Flow in root for visualizing the strcuture and logic of extract_dom.js
// ----------------

/**
 * Normalizes button text for robust matching.
 * Removes accents, spaces, and punctuation, converting everything to lowercase.
 * Example: "Cookie Settings" --> "cookiesettings"
 * 
 * @param {string} text - text string to normalize
 */
function normalizeText(text) {
    if (!text) {
		return "";
	}
	
    return text.normalize("NFKD")
                .replace(/[\u0300-\u036f]/g, "") //deletes floating accents
                .replace(/[^a-z0-9]/gi, "")      //deletes everything except a-z & 0-9 (incl. whitespaces)
                .toLowerCase();
}

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

        console.error("Navigating to the page...");
        await page.goto(url, {
            waitUntil: "networkidle2",
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 2000));

        console.error("page is loaded!");

        const waitResult = await waitForCmpUi(page, CMP_SELECTORS_MAP);

        const cmpType = waitResult ? waitResult.cmpType : null;

        if (waitResult) {
            console.error(`waitForCmpUI detected CMP Type: ${cmpType}`);
            //wait shortly in case of more CSS animation
            await new Promise(resolve => setTimeout(resolve, 1500)); 
        }

        const cookieBannerFrame = await findCorrectFrame(page, CMP_SELECTORS_MAP);
        let results = [];

        if (cookieBannerFrame) {
            const data = await extractFromFrame(cookieBannerFrame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);

            results.push({
                frame: cookieBannerFrame,
                frameUrl: cookieBannerFrame.url(),
                isMainFrame: cookieBannerFrame  === page.mainFrame(),
                isCookieBannerFrame: true,
                cmpType,
                data
            });
        } else {
            for (const frame of page.frames()) {
                console.error("Heuristic scoring failed to find a banner frame. Falling back to all-frame scan.");
                if (!frame.url() || frame.url() === "about:blank") {
					continue; //TODO: also implement visbilty check?
				}

                const data = await extractFromFrame(frame, CMP_SELECTORS, CMP_SELECTORS_MAP, cmpType);
                const looksLikeBanner = data.cmpFound //TODO: consider also using other factors like buttons. But likely not reliable and already done before in the code

                results.push({
                    frame,
                    frameUrl: frame.url(),
                    isMainFrame: frame === page.mainFrame(),
                    isCookieBannerFrame: looksLikeBanner,
                    cmpType,
                    data
                });
            }   
        }

        if (results.length === 0) {
            return null;
        }

        let settingsExtracted = false;

        for (const result of results) {
            if (!settingsExtracted) {
                let settingsButton = null;

                for (const btn of result.data.buttons) {
                    if (btn.tag === "BUTTON" || btn.tag === "A") {
                        const normalizedBtnText = normalizeText(btn.text);

                        //Max length 30 chars: real settings button labels are short.
                        //Prevents false positives on long IAB purpose descriptions
                        //(e.g. "storing or accessing information on an end device")
                        //which contain short substrings from the settings word corpus. (happens e.g. for heise.de)
                        if (SETTINGS_TERMS_REGEX.test(normalizedBtnText) && normalizedBtnText.length < 30) {
                            console.error(`Settings match: "${btn.text}" --> normalized: "${normalizedBtnText}"`);
                            
                            const href = (btn.attributes && btn.attributes.href) ? btn.attributes.href.toLowerCase() : "";;
                            const isRealNavigation = 
                                href.startsWith("http") || 
                                href.includes("policy") || 
                                href.includes("privacy")
                            
                            if (isRealNavigation) {
                                console.error("Settings Match dismissed!")
                                continue;
                            }

                            settingsButton = btn;
                            break;
                        }
                    }
                }
                
                if (settingsButton) {
                    result.settings = await clickAndExtractSettings(result.frame, settingsButton, page, cmpType);
                } else {
                    console.error(`Regex failed in frame ${result.frame.url()}, trying LLM fallback...`);
                    const llmSettingsButton = await findSettingsButtonViaLLM(result.data.filteredHtml);

                    if (llmSettingsButton) {
                        result.settings = await clickAndExtractSettings(result.frame, llmSettingsButton, page, cmpType);
                    } else {
                        result.settings = null;
                    }
                }

                if (result.settings) {
                    settingsExtracted = true;
                }
                
            } else {
                result.settings = null;
            }

            //frame object needs to be deleted (too big, only necessary for clicking the settings-button)
            delete result.frame;
        }

        printExtractionSummary(results);

        fs.writeFileSync("extraction_debug.json", JSON.stringify(results, null, 2));
        console.error("Output was stored in extraction_debug.json.");

        await browser.close();
        console.error("browser closed!");

        console.log(JSON.stringify(results))
        return results;
    } catch (err) {
        console.error(`extractStructuredDom critical execution failure: ${err.message}`);
        return null;
    } finally {
        console.error("extractStructuredDom finished");
    }
}

/**
 * Standard out diagnostic logger that aggregates and prints structured 
 * summaries of the extracted node matrix.
 * * @param {Array} results - The compiled array of extraction data structures
 */
function printExtractionSummary(results) {
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
            console.error(`      "${cb.labelText}" | checked: ${cb.isChecked} | disabled: ${cb.isDisabled} --> selector: ${cb.selector}`);
        }

        console.error(`\n  Toggles found (${result.data.toggles.length}):`);
        for (const tgl of result.data.toggles) {
            console.error(`      "${tgl.text}" | aria-checked: ${tgl.ariaChecked} --> selector: ${tgl.selector}`);
        }

        if (result.settings) {
            console.error(`\n   Settings page extracted (isIframe: ${result.settings.isIframe}):`);
            console.error(`\n  Buttons found (${result.settings.buttons.length}):`);
            for (const btn of result.settings.buttons) {
                console.error(`      [${btn.tag}] "${btn.text}" --> selector: ${btn.selector}`);
            }

            console.error(`\n   Checkboxes found (${result.settings.checkboxes.length}):`);
            for (const cb of result.settings.checkboxes) {
                console.error(`      "${cb.labelText}" | checked: ${cb.isChecked} | disabled: ${cb.isDisabled} --> selector: ${cb.selector}`);
            }

            console.error(`\n  Toggles found (${result.settings.toggles.length}):`);
            for (const tgl of result.settings.toggles) {
                console.error(`      "${tgl.text}" | aria-checked: ${tgl.ariaChecked} --> selector: ${tgl.selector}`);
            }
        } else {
            console.error(`\n   No settings page found`);
        }
    }
    console.error("========================================\n");
}

(async () => {
    const url = process.argv[2];
    if (!url) {
        console.error("No URL provided");
        process.exit(1);
    }
    const foundData = await extractStructuredDom(url);
    if (foundData) {
        console.error("foundData was filled with a value");
    }
})();


//for testing this script seperatly
//i now only use console.error() instead of .log for debugging etc, because this would otherwise get implemented in the input for the langgraph script
// (async () => {
//     const foundData = await extractStructuredDom("https://www.transavia.com/");
//     if (foundData) {
//         console.error("foundData was filled with a value");
//     }
// })();

//script works on:
//https://usercentrics.com
//https://zalando.de
//https://heise.de --> do not use heise.com! Valid website, but without Cookie-Banner :)
//https://spiegel.de
//https://www.flightaware.com/
//https://www.affinity.com/
//https://cookieinformation.com
//https://www.cookiebot.com/
//https://www.swedbank.com/
//https://www.transavia.com/

//Problems with:
//https://ameliconnect.ameli.fr/ --> weird strcuture, where my script fails to extract the settings page
//https://www.skyscanner.de --> detects puppeteer and blocks it

//URLs i want to test:
//https://teamworksplus.de