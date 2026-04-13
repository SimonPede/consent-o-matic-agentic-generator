const puppeteer = require("puppeteer");
const CMP_SELECTORS = require('../utils/cmp_selectors');
//Plan:
// Stufe 1: CMP-Selektoren (Regex-Patterns) → Banner-Container gefunden
//               ↓ nicht gefunden
// Stufe 2: Negativfilterung → entferne nav, header, footer, script, 
//          style, img → gib gefiltertes HTML ans LLM
//               ↓
// Stufe 3: LLM findet Banner im gefilterten HTML selbst

async function extractFromFrame(frame, selectors) {
    return await frame.evaluate((selectors) => {
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

        //Step 1: trying to find banner container
        //here i have to implement: give LLM the Name of CMP Type! Also important for Pseudo-RAG
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                return { Cmpfound: true, Cmpselector: selector, html: el.outerHTML.slice(0, 500) };
            }
        }

        //Step 2 is used if Step 1 fales
        //extract structured and filtered DOM
        //as everything in this code: this is incomplete :)
        const NEGATIVE_SELECTORS = ["nav", "header", "footer", 
            "script", "style", "img", "svg", "noscript"];

        const body = document.body.cloneNode(true); //clone with subtrees

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
                outerHTML: el.outerHTML
            }));

        const toggles = querySelectorAllDeep("[role='switch'], .toggle, .switch, [class*='toggle']")
            .filter(isVisible)
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
            .filter(isVisible)
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
            filteredHtml: body.innerHTML.slice(0, 5000)
            //not complete!
        };
    }, selectors);
}

async function extractStructuredDOM(url) {
    try {
        console.log("puppeteer-browser is getting started...");
        const browser = await puppeteer.launch({
            headless: "shell", //true should also work
            args: ['--no-sandbox', '--disable-setuid-sandbox'] //these flags are important for Linux/WSL
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
        let frameData = 0;
        if (cmpFrame) {
            frameData = await extractFromFrame(cmpFrame, CMP_SELECTORS);
            results.push(frameData);
        } else {
            for (const frame of page.frames()) {
                if (!frame.url() || frame.url() === 'about:blank') continue;
                const data = await extractFromFrame(frame, CMP_SELECTORS);
                results.push({ frameUrl: frame.url(), isMainFrame: frame === page.mainFrame(), data });
            }   
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
    const foundData = await extractStructuredDOM("https://www.heise.de");

    if (foundData) {
        console.log(JSON.stringify(foundData, null, 2));
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