/**
 * LLM fallback for selecting a cookie-banner container selector inside a chosen frame.
 * Input is a compact candidate list (selector/text/button stats), not full frame HTML.
 *
 * @param {Array} candidates
 * @param {string|null} cmpTypeHint
 * @returns {Promise<{selector: string, confidence: number, reason: string}|null>}
 */

function buildEndpoint(baseUrl, suffix) {
    if (!baseUrl) {
        return "";
    }

    const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
    return `${normalizedBase}${suffix}`;
}

async function findBannerContainerViaLlm(candidates, cmpTypeHint = null) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }

    const liteLlmUrl = process.env.LITELLM_BASE_URL || "";
    const liteLlmApiKey = process.env.LITELLM_API_KEY || "";

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "";
    const ollamaBearerToken = process.env.OLLAMA_BEARER_TOKEN || "";

    const liteLlmEndpoint = buildEndpoint(liteLlmUrl, "/chat/completions");
    const ollamaEndpoint = buildEndpoint(ollamaUrl, "/api/generate");

    if (!liteLlmEndpoint && !ollamaEndpoint) {
        console.error("LLM banner-selector skipped: missing LITELLM_BASE_URL and OLLAMA_BASE_URL.");
        return null;
    }

    const compactCandidates = candidates
        .filter(candidate => candidate && typeof candidate.selector === "string" && candidate.selector.length > 0)
        .slice(0, 16)
        .map(candidate => ({
            selector: candidate.selector,
            tag: candidate.tag || null,
            buttonCount: candidate.buttonCount || 0,
            checkboxCount: candidate.checkboxCount || 0,
            switchCount: candidate.switchCount || 0,
            textSample: candidate.textSample || "",
            cookieKeywordScore: candidate.cookieKeywordScore || 0,
            fixedLike: Boolean(candidate.fixedLike),
            areaRatio: candidate.areaRatio || 0
        }));

    if (!compactCandidates.length) {
        return null;
    }

    const prompt = `
You are selecting the most likely cookie consent banner CONTAINER from a candidate list.
Return ONLY valid JSON with schema:
{"selector":"<css>","confidence":<0..1>,"reason":"<short>"}
If nothing is plausible, return:
{"selector":"","confidence":0,"reason":"none"}

Decision hints:
- Prefer candidates with cookie/consent/privacy text and interactive controls.
- Prefer fixed/high-overlay containers in the viewport.
- Avoid tiny elements, footer links, captcha, ads, nav/header wrappers.
- cmpTypeHint: ${cmpTypeHint || "null"}

Candidates:
${JSON.stringify(compactCandidates)}
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
                    stream: false,
                    temperature: 0
                })
            });

            if (!response.ok) {
                console.error(`LLM banner-selector call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.choices?.[0]?.message?.content || "";
        } else {
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
                console.error(`Ollama banner-selector call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.response?.trim() || "";
        }

        const cleaned = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!parsed || typeof parsed.selector !== "string") {
            return null;
        }

        const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
        if (!parsed.selector || confidence <= 0) {
            return null;
        }

        console.error(`LLM banner-selector suggested "${parsed.selector}" with confidence ${confidence}.`);

        return {
            selector: parsed.selector,
            confidence,
            reason: typeof parsed.reason === "string" ? parsed.reason : ""
        };
    } catch (err) {
        console.error("LLM banner-selector failed:", err.message);
        return null;
    }
}

module.exports = findBannerContainerViaLlm;
