/**
 * LLM-based fallback for settings button detection.
 * Called when SETTINGS_TERMS_REGEX fails to identify a settings button.
 * Sends filteredHtml to LiteLLM (preferred) or Ollama and expects JSON with selector and text.
 *
 * @param {string} html - filteredHtml from extractFromFrame()
 * @returns {{selector: string, text: string}|null}
 */

function buildEndpoint(baseUrl, suffix) {
    if (!baseUrl) {
        return "";
    }

    const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
    return `${normalizedBase}${suffix}`;
}

async function findSettingsButtonViaLlm(html) {
    const liteLlmUrl = process.env.LITELLM_BASE_URL || "";
    const liteLlmApiKey = process.env.LITELLM_API_KEY || "";

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "";
    const ollamaBearerToken = process.env.OLLAMA_BEARER_TOKEN || "";

    const liteLlmEndpoint = buildEndpoint(liteLlmUrl, "/chat/completions");
    const ollamaEndpoint = buildEndpoint(ollamaUrl, "/api/generate");

    const prompt = `
    You are analysing HTML of a website.
    Find the button or link that opens the settings or preferences page of the Cookie Banner.
    Return ONLY a valid JSON object with exactly two fields, nothing else.
    No explanation, no markdown, no code blocks.

    Example of a valid response:
    {"selector": "[aria-label='Settings']", "text": "Settings"}

    HTML: ${html}
    `;

    try {
        let rawContent = "";

        if (liteLlmEndpoint) {
            const headers = { "Content-Type": "application/json" };
            if (liteLlmApiKey) {
                headers.Authorization = `Bearer ${liteLlmApiKey}`;
            }

            const response = await fetch(liteLlmEndpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: "natai/kimi-k2.5",
                    messages: [{ role: "user", content: prompt }],
                    stream: false
                })
            });

            if (!response.ok) {
                console.error(`LiteLLM call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.choices?.[0]?.message?.content || "";

        } else if (ollamaEndpoint) {
            const headers = { "Content-Type": "application/json" };
            if (ollamaBearerToken) {
                headers.Authorization = `Bearer ${ollamaBearerToken}`;
            }

            const response = await fetch(ollamaEndpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: "gemma4:latest",
                    prompt,
                    stream: false
                })
            });

            if (!response.ok) {
                console.error(`Ollama call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.response?.trim() || "";

        } else {
            console.error("findSettingsButtonViaLLM skipped: missing LITELLM_BASE_URL and OLLAMA_BASE_URL.");
            return null;
        }

        const cleanedText = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedText);

        if (!parsed.selector) {
            return null;
        }

        console.error(`LLM suggested settings button - selector: "${parsed.selector}", text: "${parsed.text}"`);
        return parsed;
    } catch (err) {
        console.error("findSettingsButtonViaLLM failed:", err.message);
        return null;
    }
}

module.exports = findSettingsButtonViaLlm;
