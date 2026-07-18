/**
 * LLM-based fallback for settings button detection.
 * Called when SETTINGS_TERMS_REGEX fails to identify a settings button.
 * Sends filteredHtml to Ollama or LiteLLM and expects a JSON object including the CSS selector and text of the button.
 * 
 * @param {string} html - filteredHtml from extractFromFrame()
 * @returns {{selector: string, text: string}|null} - button object or null
 */
async function findSettingsButtonViaLlm(html) {
    //Configuration Toggle
    const use_liteLlm = true;

    const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "";
    const OLLAMA_BEARER_TOKEN = process.env.OLLAMA_BEARER_TOKEN || "";

    const LITELLM_URL = process.env.LITELLM_BASE_URL || ""; 
    const LITELLM_API_KEY = process.env.LITELLM_API_KEY || "";

    const prompt = `
    You are analysing HTML of a website.
    Find the button or link that opens the settings or preferences page of the Cookie Banner.
    Return ONLY a valid JSON object with exactly two fields, nothing else.
    No explanation, no markdown, no code blocks.

    Example of a valid response:
    {"selector": "[aria-label='Settings']", "text": "Settings"}

    HTML: ${html}
    `

    try {
        let rawContent = "";

        if (use_liteLlm) {
            const response = await fetch(`${LITELLM_URL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${LITELLM_API_KEY}`
                },
                body: JSON.stringify({
                    model: "natai/kimi-k2.5",
                    messages: [
                        { role: "user", content: prompt }
                    ],
                    stream: false
                })
            });

            if (!response.ok) {
                console.error(`LiteLLM call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.choices?.[0]?.message?.content || "";
            
        } else {
            const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OLLAMA_BEARER_TOKEN}`
                },
                body: JSON.stringify({
                    model: "gemma4:latest",
                    prompt: prompt,
                    stream: false
                })
            });

            if (!response.ok) {
                console.error(`LLM call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.response?.trim() || "";
        }

        const cleanedText = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
        
        try {
            const parsed = JSON.parse(cleanedText);
            if (!parsed.selector) {
                return null;
            }
            console.error(`LLM suggested settings button - selector: "${parsed.selector}", text: "${parsed.text}"`);
            return parsed;
        } catch (e) {
            console.error("LLM response was not valid JSON. Cleaned string was:", cleanedText);
            return null;
        }
        
    } catch(err) {
        console.error("findSettingsButtonViaLLM failed:", err.message);
        return null;
    }
}

module.exports = findSettingsButtonViaLlm;