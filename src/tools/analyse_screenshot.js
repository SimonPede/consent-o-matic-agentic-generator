const puppeteer = require("puppeteer");
const CMP_SELECTORS_MAP = require("../utils/cmp_selectors_map");
const waitForCmpUi = require("../utils/wait_for_cmp_ui");

const url = process.argv[2];

if (!url) {
    console.log(JSON.stringify({ error: "Missing argument: url required" }));
    process.exit(1);
}

async function run() {

	const browser = await puppeteer.launch({
		headless: true, //users the more modern headless mode (instead of "shell") --> harder to detect as a bot
		executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
			args: [
				"--no-sandbox", //important for WSL/Linux
				"--disable-setuid-sandbox", //important for WSL/Linux
				"--disable-blink-features=AutomationControlled", //when chrome is not controlled by an actual user it sets navigator.webdriver = true.
				//CMPs can detect that and block the banner or nerver render it
				"--window-size=1920,1080", //Standardizes the desktop viewport dimensions
				"--lang=en-US,en"
			]
	});

	//Debug configuration for non-headless execution inspection:
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

		//Pure Synchronization Barrier: The return value is intentionally ignored here.
        //The script only requires this helper to block execution until the CMP layout 
        //is fully rendered and stable before capturing the visual state. If a timeout 
        //occurs (returning null), execution must proceed regardless, as the website 
        //might not feature a cookie banner at all, which the downstream vision LLM 
        //will correctly evaluate from the screenshot.
		await waitForCmpUi(page, CMP_SELECTORS_MAP);

		//the gemma model on the SNET Server (using Ollama) has no problem with this config
		//const screenshot = await page.screenshot({ encoding: "base64" });

		//for LiteLLM i will use:
		const screenshot = await page.screenshot({ 
			encoding: "base64",
			type: "jpeg",
			quality: 60 
		});
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