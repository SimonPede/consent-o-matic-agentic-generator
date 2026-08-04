/**
 * LLM-based fallback for settings button detection.
 * Called when SETTINGS_TERMS_REGEX fails to identify a settings button.
 * Sends filteredHtml to LiteLLM (preferred) or Ollama and expects JSON with selector and text.
 *
 * @param {string} html - filteredHtml from extractFromFrame()
 * @returns {{selector: string, text: string}|null}
 */

/**
 * Cleans HTML for LLM consumption by removing low-value noise.
 *
 * @param {string} html - Raw HTML string to clean
 * @returns {string} - Cleaned HTML string
 */
function cleanHtml(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/\s*style="[^"]*"/gi, "")
        // Remove inline JS event handlers (e.g., onclick, onload).
        .replace(/\s*on\w+="[^"]*"/gi, "")
        // Collapse repeated whitespace into a single space.
        .replace(/\s+/g, " ")
        .trim();
}

const MAX_FALLBACK_HTML_CHARS = 70000;

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

    //Defensively clean and cap HTML to avoid provider payload/context limits.
    const preparedHtml = cleanHtml(String(html || "")).slice(0, MAX_FALLBACK_HTML_CHARS);

    const prompt = `
    You are analysing HTML of a website.
    Find the button or link that opens the settings or preferences page of the consent banner.
    Return ONLY a valid JSON object with exactly two fields, nothing else.
    No explanation, no markdown, no code blocks.

    Example of a valid response:
    {"selector": "[aria-label='Settings']", "text": "Settings"}

    HTML: ${preparedHtml}
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
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`LiteLLM call failed: ${response.status} ${response.statusText}`);
                console.error(`LiteLLM error body: ${errorBody.slice(0, 1500)}`);
            } else {
                const data = await response.json();
                rawContent = data.choices?.[0]?.message?.content || "";
            }

            if (!rawContent && ollamaEndpoint) {
                console.error("LiteLLM returned no usable result. Falling back to Ollama...");
            }
        }

        if (!rawContent && ollamaEndpoint) {
            const headers = { "Content-Type": "application/json" };
            if (ollamaBearerToken) {
                headers.Authorization = `Bearer ${ollamaBearerToken}`;
            }

            const response = await fetch(ollamaEndpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: "gemma4:31b",
                    prompt,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`Ollama call failed: ${response.status} ${response.statusText}`);
                console.error(`Ollama error body: ${errorBody.slice(0, 1500)}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.response?.trim() || "";

        } else if (!rawContent) {
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
