const puppeteer = require('puppeteer');
const fs = require('fs');
//Code zum testen, ob Installation erfolgreich
(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto('https://heise.de');
    await new Promise(res => setTimeout(res, 2000));
    
    // Hole den gesamten HTML-Code
    const html = await page.content();
    
    // Speichere in Datei
    fs.writeFileSync('example-full.html', html);
    
    console.log('HTML gespeichert: example-full.html');
    console.log(`Größe: ${html.length} Zeichen`);
    
    await browser.close();
})();