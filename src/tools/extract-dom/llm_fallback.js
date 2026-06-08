/**
 * LLM-based fallback for settings button detection.
 * Called when SETTINGS_TERMS_REGEX fails to identify a settings button.
 * Sends filteredHtml to Ollama and expects a JSON object including the CSS selector and text of the button.
 * 
 * @param {string} html - filteredHtml from extractFromFrame()
 * @returns {{selector: string, text: string}|null} - button object or null
 */
async function findSettingsButtonViaLLM(html) {
    const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const OLLAMA_BEARER_TOKEN = process.env.OLLAMA_BEARER_TOKEN || "";

    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OLLAMA_BEARER_TOKEN}`
            },
            body: JSON.stringify({
                model: "gemma4:latest",
                prompt: `You are analysing HTML of a website.
                        Find the button or link that opens the settings or preferences page of the Cookie Banner.
                        Return ONLY a valid JSON object with exactly two fields, nothing else.
                        No explanation, no markdown, no code blocks.

                        Example of a valid response:
                        {"selector": "[aria-label='Settings']", "text": "Settings"}

                        HTML: ${html}`,
                stream: false
            })
        });

        if (!response.ok) {
            console.error(`LLM call failed: ${response.status}`);
            return null;
        }

        const data = await response.json();
        const raw = data.response?.trim();
        
        try {
            const parsed = JSON.parse(raw);
            if (!parsed.selector) {
                return null;
            }
            console.error(`LLM suggested settings button - selector: "${parsed.selector}", text: "${parsed.text}"`);
            return parsed;
        } catch (e) {
            console.error("LLM response was not valid JSON:", raw);
            return null;
        }

    } catch (error) {
        console.error("findSettingsButtonViaLLM failed:", error.message);
        return null;
    }
}

module.exports = findSettingsButtonViaLLM;