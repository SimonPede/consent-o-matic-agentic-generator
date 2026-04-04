const puppeteer = require('puppeteer');
const fs = require('fs');
//code is only here for testing...
(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto('https://heise.de');
    await new Promise(res => setTimeout(res, 2000));
    
    const html = await page.content();

    
    console.log('HTML stored: example-full.html');
    console.log(`Size: ${html.length} `);
    
    await browser.close();
})();