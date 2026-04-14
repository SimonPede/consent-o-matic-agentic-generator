const puppeteer = require("puppeteer");
const CMP_SELECTORS = require('../utils/cmp_selectors');

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
 * i have to consider this new idea: Store browserWSEndpoint in LangGraph agent state so that test_ruleset and
 * subsequent extract_dom calls can reconnect to the same browser instance via
 * puppeteer.connect() instead of launching a new browser.
 */

async function extractFromFrame(frame, selectors) {
    const result = await frame.evaluate((selectors) => {

        //with this function i try to find every relevant element even if it is in the shadow DOM
        function querySelectorAllDeep(selector, root = document) {
            let nodes = Array.from(root.querySelectorAll(selector));
            const children = Array.from(root.querySelectorAll('*'));
            for (let child of children) {
                if (child.shadowRoot) {
                    nodes = nodes.concat(querySelectorAllDeep(selector, child.shadowRoot));
                }
            }
            return nodes;
        }

        function extractAllAttributes(el) {
            attributes = {};
            for(const attr of el.attributes) {
                attributes[attr.name] = attr.value;
            }
            return attributes;
        }

        function findLabelForInput(input) {
            if (input.id) {
                const label = document.querySelector(`label[for="${input.id}"]`);
                if (label) {
                    return label.innerText.trim();
                }
            }
            const closestLabel = input.closest("label");
            return closestLabel ? closestLabel.innerText.trim() : "";
        }

        function extractParentInfo(el) {
            return {
                tag: el.parentElement ? el.parentElement.tagName : null,
                id: el.parentElement ? el.parentElement.id : null,
                className: el.parentElement ? el.parentElement.className : null
            };
        }

        function isVisible(el) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                el.innerText.length > 0 && 
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                parseFloat(style.opacity) > 0.05
            );
        }

        function isVisibleInput(el) {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                parseFloat(style.opacity) > 0.05
            );
        }

        //Step 1: trying to find banner container
        //here i have to implement: give LLM the Name of CMP Type! Also important for Pseudo-RAG
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                return { Cmpfound: true, Cmpselector: selector, html: el.outerHTML.slice(0, 500) };
            }
        }

        //extract structured and filtered DOM
        //as everything in this code: this is incomplete :)
        const NEGATIVE_SELECTORS = ["nav", "header", "footer", 
            "script", "style", "img", "svg", "noscript"];

        const body = document.body.cloneNode(true); //clone with subtrees (but at this point ignoring the shadow DOM)

        NEGATIVE_SELECTORS.forEach(sel => {
            body.querySelectorAll(sel).forEach(el => el.remove());
        });

        const buttons = querySelectorAllDeep("button, a, [role='button']")
            .filter(isVisible)
            .map(el => ({
                type: "button",
                text: el.innerText.trim(),
                tag: el.tagName,
                attributes: extractAllAttributes(el),
                parentInfo: extractParentInfo(el),
                selector: el.id ? `#${el.id}`                                  //best case
                    : el.getAttribute("aria-label") ? `[aria-label="${el.getAttribute('aria-label')}"]`  //often concrete
                        : el.className ? `.${el.className.trim().split(' ')[0]}`  //fallback
                            : el.tagName.toLowerCase(),
                outerHTML: el.outerHTML
            }));

        const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']")
            .filter(isVisibleInput)
            .map(el => ({
                type: "toggle",
                text: el.innerText.trim(),
                tag: el.tagName,
                attributes: extractAllAttributes(el),
                parentInfo: extractParentInfo(el),
                ariaChecked: el.getAttribute("aria-checked"),
                outerHTML: el.outerHTML
            }));

        const checkboxes = querySelectorAllDeep("input[type='checkbox']")
            .filter(isVisibleInput)
            .map(el => ({
                type: "checkbox",
                text: el.innerText.trim(),
                tag: el.tagName,
                attributes: extractAllAttributes(el),
                parentInfo: extractParentInfo(el),
                checked: el.checked,
                disabled: el.disabled,
                labelText: findLabelForInput(el),
                outerHTML: el.outerHTML
            }));

        return {
            buttons,
            checkboxes,
            toggles,
            cmpType: null,
            url: window.location.href,
            rawHtml: body.innerHTML,
            // htmlLength: body.innerHTML.length,
            //not complete!
        };
    }, selectors);

    const cleaned = cleanHtml(result.rawHtml);
    // console.log(cleaned.length);
    result.filteredHtml = cleaned.slice(0, 15000);
    // result.htmlLength = result.rawHtml.length;
    delete result.rawHtml;
    
    return result;
}


function cleanHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\s*style="[^"]*"/gi, '') //no inline-style
        .replace(/\s*on\w+="[^"]*"/gi, '')  //no event handler
        .replace(/\s+/g, ' ')               //
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

async function extractStructuredDOM(url) {
    try {
        console.log("puppeteer-browser is getting started...");
        const browser = await puppeteer.launch({
            headless: "shell", //true should also work
            args: ["--no-sandbox", "--disable-setuid-sandbox"] //these flags are important for Linux/WSL
        });

        const page = await browser.newPage();

        console.log("Navigating to the page...");
        await page.goto(url, {
            waitUntil: "networkidle2", //waits until only to network request are active at page
            timeout: 30000
        });

        await new Promise(resolve => setTimeout(resolve, 2000)); //additionally wait 2s

        console.log("page is loaded!");

        const cmpFrame = await findCorrectFrame(page);

        //LLM needs to no the extracted DOM is in an IFrame because this information is critical for the JSON-Rule
        let results = [];
        if (cmpFrame) {
            const data = await extractFromFrame(cmpFrame, CMP_SELECTORS);
            results.push({frame: cmpFrame, frameUrl: cmpFrame.url(), isMainFrame: cmpFrame === page.mainFrame(), isCmpFrame: true, data})
        } else {
            for (const frame of page.frames()) {
                if (!frame.url() || frame.url() === "about:blank") continue;
                const data = await extractFromFrame(frame, CMP_SELECTORS);
                results.push({ frame, frameUrl: frame.url(), isMainFrame: frame === page.mainFrame(), isCmpFrame: false, data });
            }   
        }

        //originally based on A Cross-Country Analysis of GDPR Cookie Banners and Flexible Methods For Scraping Them.pdf, Appendix B,
        //but used Gemini for additional keywords. Have to check their reliability
        const SETTINGS_TERMS = [
            // --- English / International ---
            "settings", "preferences", "manage", "customize", "options", 
            "manage options", "manage preferences", "manage settings",

            // --- Deutsch (DACH) ---
            "einstellungen", "optionen", "mehr optionen", "weitere optionen", 
            "datenschutzeinstellungen", "einstellungen verwalten", "zwecke anzeigen",

            // --- Northern Europe (Denmark, Sweden, Norway, Finland, Estonia) ---
            "asetukset","inställningar", "seaded", "kohanda",
            "küpsiste seaded", "küpsiste sätted", "halda",
            "seadistusi", "muudan küpsiste seadistusi",

            // --- Western Europe (France, Belgium, Netherlands, Luxembourg) ---
            "paramètres", "gérer les cookies", "instellen", "instellingen",
            "voorkeuren", "privacy-instellingen", "gérer",

            // --- Southern Europe (Italy, Spain, Portugal, Greece, Malta) ---
            "impostazioni", "preferenze", "configuración", "ajustes", "preferencias",
            "personalizar", "opciones", "ρυθμίσεις", "περισσοτερες επιλογες", 
            "ρυθμίσεις ςοοκιες", "προτιμησεις", "aktar dwar il cookies",

            // --- Central & Eastern Europe (Poland, Czech, Slovak, Hungary, Slovenia, Croatia) ---
            "ustawienia", "opcje", "nastavení", "podrobné nastavení", "další volby", 
            "upravit mé předvolby", "nastavenia", "nastavenie cookies", "ďalšie informácie", 
            "bližšie informácie", "nastavitve", "več možnosti", "nastavitve piškotov", 
            "prilagodi", "po meri", "beállítások", "további opciók", "beállítások kezelése", 
            "lehetőségek", "részletek",

            // --- Baltic & Balkans (Latvia, Lithuania, Bulgaria, Romania) ---
            "iestatījumi", "pielagot", "papildu opcijas", "parvaldības iespejas",
            "nustatymai", "tvarkyti parinktis", "slapukų nustatymai", "rodyti informaciją", 
            "rinktis", "tinkinti", "nuostatos", "настройки", "подробни настройки", 
            "опции за управление", "други възможности",
            "setări", "modific setările", "mai multe opțiuni", "gestionati opțiunile", "setari cookie-uri"
        ];

        const SETTINGS_PATTERN = new RegExp(SETTINGS_TERMS.join('|'), 'i');

        for (let result of results) {
            //i prioritize buttons
            const settingsButton = result.data.buttons.find(btn => SETTINGS_PATTERN.test(btn.text) && btn.tag === "BUTTON") ||
                result.data.buttons.find(btn => SETTINGS_PATTERN.test(btn.text) && btn.tag === 'A');
            
            if (settingsButton) {
                console.log(`Settings button found: "${settingsButton.text}"`);
                //the problem: i dont know what the click causes. Sometimes the DOM is updated in the same frame, sometimes a new iframe pops up
                //two options: extract from all frames again
                //or compare the DOM of the frame before and after the click --> is it different? then extract from this frame
                //otherwise look for new iframes that got loaded
                const framesBefore = page.frames().map(f => f.url()); //which frames are there before the click?
                const htmlBefore = await result.frame.evaluate(() => document.body.innerHTML.length);

                await result.frame.click(settingsButton.selector);
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
                    setTimeout(() => { clearInterval(check); resolve(null); }, 5000); // max 5s
                });

            const newFrame = await newFramePromise;
                
                //debugging
                // const framesAfterClick = page.frames();
                // console.log("Frames nach Klick:");
                // framesAfterClick.forEach((f, i) => console.log(`Frame ${i}: ${f.url()}`));
                // await page.screenshot({ path: 'after_click.png' });
                ///////////

                if (newFrame) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    result.settings = await extractFromFrame(newFrame, CMP_SELECTORS);
                    result.settings.isIframe = newFrame !== page.mainFrame(); //important for Rule later. Is element in iframe? Important for every element!
                    // console.log(JSON.stringify(result.settings.buttons, null, 2));
                } else {
                    const htmlAfter = await result.frame.evaluate(() => document.body.innerHTML.length);
                    const contentChanged = Math.abs(htmlAfter - htmlBefore) > 500; // signifikante Änderung

                    if (contentChanged) {
                        result.settings = await extractFromFrame(result.frame, CMP_SELECTORS);
                        result.settings.isIframe = result.frame !== page.mainFrame();
                        // console.log(JSON.stringify(result.settings.buttons, null, 2));
                    } else {
                        result.settings = null;
                        console.log("Settings click had no effect");
                    }
                }

            } else {
                result.settings = null;
            }
            
            delete result.frame; //Frame-Objekt nicht zurückgeben, nicht serialisierbar
        }

        console.log(results);

        await browser.close();
        console.log("browser closed!");
        return results;
    } catch (error) {
        console.error("extractStructuredDOM failed:", error.message);
        return null;
    } finally {
        console.log("extractStructuredDOM finished");
    }
    
};

function findCorrectFrame(page) {
    //these regex-Patterns are just educated guesses at this moment, not based on actaul data/facts
    const cmpRegex = /cmp|consent|cookie|onetrust|usercentrics|cookiebot|didomi|iubenda|trustarc|quantcast|osano|cookieyes|osano|complianz|termsfeed|cookienotice|cookiinformation|cookiescript|moove|consentmanager|consent/i;
    //DOMAINS ARRAY could be filled with iFrame-URLS used by common CMPs.
    const DOMAINS = [];
    const frames = page.frames(); //frames[0] should be main page
    console.log(`I found ${frames.length} frames.`);

    if (frames.length) {
        frames.forEach((frame, index) => {
            console.log(`Frame ${index} has the URL: ${frame.url()}`);
        });
    }
    //page.evaluate runs in the main frame: if banner in iframe (which is highly likely), we have to search in this Iframe
    //could run through all IFrames and filter all of them and let LLM find right one
    //but i would try to filter the correct one in this funtion and give LLM only the correct one
    //but is this possible?
        
    let cmpFrame = frames.find(frame => cmpRegex.test(frame.url()));

    // if(!cmpFrame) {
    //     // cmpFrame = frames.find(frame => DOMAINS.some(domain => frame.url().includes(domain)));

    //     if (!cmpFrame) {
    //         return page.mainFrame();
    //     }
    // }
    if(cmpFrame) {
        return cmpFrame;
    }
    return null;
}




(async () => {
    const foundData = await extractStructuredDOM("https://heise.de");

    if (foundData) {
        console.log("huuh");
    }
})();

//Erweiterungen, die nötig sind:
// - Shadow-DOM traversen
// - erweiterte Frame-Filterung (es muss eigentlich nur einer traversiert werden, nicht alle, oder?)
// - nicht nur Buttons/Links, sondern auch checkboxes und toggles
//      - für jeden Typen sammeln wir: type, text, attributes, tags, id, class, checked, disabled, labelText, ariaChecked, parent-Struktur und immer outer-HTML!
//      - sollte auch gleich gefiltert werden, ob es für Nutzer sichtbar ist. Nur sichtbare weiter betrachten!
//      - mit Hilfe von Texten in Buttons oder labeln könnte man auch eine heuristische Klassifizierung implementieren
//              - z.B.: also ein Button mit "Akzeptieren" würde dann "likely_action: ACCEPT_ALL" bekommen
//      - das sammeln wir jeweils in einem Objekt ( pro Element-Typ). Wird dann in einem Objekt zusammengefügt, was dann auch hmtl des frames, url und evlt weitere meta-daten enthält
//      - angenommen das Ergebnis von all all dem ist ein Objekt namens FrameData, würden wir dann pro Frame (im Idealfall nur ein Eins) zurückgeben:
//          results.push({
                //     frameUrl: frame.url(),
                //     isMainFrame: frame === page.mainFrame(),
                //     const isCMPFrame = frameUrl.includes('cmp') || 
                //      frameUrl.includes('consent') ||
                //      frameUrl.includes('cookie');
                //     data: frameData
                // });
// - diese Sammlung an Objekten wird dann weiter nach dem Blacklist-Ansatz gefiltert
// - gesammelte Attribute werden gefiltert, wenn nicht relevant und insb. der gesammelte HMTL-Code wird gekürzt (scripts, img, inline-css etc. wird gelöscht)


    // //1. Test für Vision-Modell später
    // console.log('Mache Screenshot...');
    // await page.screenshot({ path: 'heise_view.png' });


//heise.de is an interesting example because of the structure of the settings-subpage. there are 3 buttons directyl in one row that correspond to each other
//LLM needs to be able to identify which button is relevant for which other button/setting!
//needs enough parent/sibling info --> maybe i can jsut solve it by giving enough of the body DOM additionally to the structured information (filtered but not structured)