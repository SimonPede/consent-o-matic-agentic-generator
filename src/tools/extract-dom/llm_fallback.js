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
        //Remove inline JS event handlers (e.g., onclick, onload).
        .replace(/\s*on\w+="[^"]*"/gi, "")
        //Collapse repeated whitespace into a single space.
        .replace(/\s+/g, " ")
        .trim();
}

const MAX_FALLBACK_HTML_CHARS = 70000;
const LLM_FALLBACK_TIMEOUT_MS = 180000; //3min

function buildEndpoint(baseUrl, suffix) {
    if (!baseUrl) {
        return "";
    }

    const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
    return `${normalizedBase}${suffix}`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * LLM-based fallback for settings button detection.
 * Called when SETTINGS_TERMS_REGEX fails to identify a settings button.
 * Sends filteredHtml to LiteLLM (preferred) or Ollama and expects JSON with selector and text.
 *
 * @param {string} html - filteredHtml from extractFromFrame()
 * @returns {{selector: string, text: string}|null}
 */
async function findSettingsButtonViaLlm(html) {
    if (!html || typeof html !== "string" || html.trim().length === 0) {
        console.error("findSettingsButtonViaLlM skipped: filteredHtml missing/omitted.");
        return null;
    }

    const llmBackend = (process.env.LLM_BACKEND || "litellm").trim().toLowerCase();

    const liteLlmUrl = process.env.LITELLM_BASE_URL || "";
    const liteLlmApiKey = process.env.LITELLM_API_KEY || "";
    const liteLlmModelName = process.env.LLM_FALLBACK_NAME || "";

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "";
    const ollamaBearerToken = process.env.OLLAMA_BEARER_TOKEN || "";
    const ollamaModelName = process.env.OLLAMA_MODEL_NAME || process.env.LLM_FALLBACK_NAME || "";

    const liteLlmEndpoint = buildEndpoint(liteLlmUrl, "/chat/completions");
    const ollamaEndpoint = buildEndpoint(ollamaUrl, "/api/generate");

    //Defensively clean and cap HTML to avoid provider payload/context limits.
    const preparedHtml = cleanHtml(String(html || "")).slice(0, MAX_FALLBACK_HTML_CHARS);

    const prompt = `
    You are analyzing HTML of a website.
    Find the button or link that opens the settings or preferences page of the consent banner.
    Return ONLY a valid JSON object with exactly two fields, nothing else.
    No explanation, no markdown, no code blocks.

    Example of a valid response:
    {"selector": "[aria-label='Settings']", "text": "Settings"}

    HTML: ${preparedHtml}
    `;

    try {
        let rawContent = "";

        if (llmBackend === "litellm") {
            if (!liteLlmEndpoint) {
                console.error("findSettingsButtonViaLlM skipped: missing LITELLM_BASE_URL.");
                return null;
            }
            if (!liteLlmModelName) {
                console.error("findSettingsButtonViaLlM skipped: missing LITELLM_MODEL_NAME.");
                return null;
            }

            const headers = { "Content-Type": "application/json" };
            if (liteLlmApiKey) {
                headers.Authorization = `Bearer ${liteLlmApiKey}`;
            }

            const response = await fetchWithTimeout(liteLlmEndpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: liteLlmModelName,
                    messages: [{ role: "user", content: prompt }],
                })
            }, LLM_FALLBACK_TIMEOUT_MS);

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`LiteLLM call failed: ${response.status} ${response.statusText}`);
                console.error(`LiteLLM error body: ${errorBody.slice(0, 1500)}`);
            } else {
                const data = await response.json();
                rawContent = data.choices?.[0]?.message?.content || "";
            }
        } else if (llmBackend === "ollama") {
            if (!ollamaEndpoint) {
                console.error("findSettingsButtonViaLlM skipped: missing OLLAMA_BASE_URL.");
                return null;
            }
            if (!ollamaModelName) {
                console.error("findSettingsButtonViaLlM skipped: missing OLLAMA_MODEL_NAME.");
                return null;
            }

            const headers = { "Content-Type": "application/json" };
            if (ollamaBearerToken) {
                headers.Authorization = `Bearer ${ollamaBearerToken}`;
            }

            const response = await fetchWithTimeout(ollamaEndpoint, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    model: ollamaModelName,
                    prompt,
                    stream: false
                })
            }, LLM_FALLBACK_TIMEOUT_MS);

            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`findSettingsButtonViaLlM: Ollama call failed: ${response.status} ${response.statusText}`);
                console.error(`findSettingsButtonViaLlM: Ollama error body: ${errorBody.slice(0, 1500)}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.response?.trim() || "";
        } else {
            console.error(`Unsupported LLM_BACKEND: "${llmBackend}"`);
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
        if (err && err.name === "AbortError") {
            console.error(`findSettingsButtonViaLlM timed out after ${LLM_FALLBACK_TIMEOUT_MS}ms`);
            return null;
        }
        console.error("findSettingsButtonViaLlM failed:", err.message);
        return null;
    }
}

module.exports = findSettingsButtonViaLlm;
