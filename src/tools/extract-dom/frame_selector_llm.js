/**
 * LLM fallback for selecting the most likely cookie-banner frame.
 * Uses lightweight frame summaries (no full HTML extraction) to reduce cost.
 *
 * @param {import('puppeteer').Page} page
 * @param {Object} selectorsMap - CMP selector -> cmpName mapping
 * @returns {Promise<import('puppeteer').Frame|null>}
 */

function buildEndpoint(baseUrl, suffix) {
    if (!baseUrl) {
        return "";
    }

    const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
    return `${normalizedBase}${suffix}`;
}

function normalizeUrlForPrompt(url) {
    if (!url) {
        return "about:blank";
    }

    if (url.length > 240) {
        return `${url.slice(0, 240)}...`;
    }

    return url;
}

async function summarizeFrame(frame, index, selectorsMap) {
    try {
        const summary = await frame.evaluate((cmpSelectorMap) => {
            const body = document.body;
            if (!body) {
                return {
                    hasBody: false,
                    cmpSelectorHit: null,
                    buttonCount: 0,
                    checkboxCount: 0,
                    switchCount: 0,
                    sampleButtonTexts: []
                };
            }

            const visibleButtonCandidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
            const sampleButtonTexts = visibleButtonCandidates
                .map((element) => (element.innerText || element.getAttribute("aria-label") || element.title || "").trim())
                .filter(Boolean)
                .slice(0, 20);

            let cmpSelectorHit = null;
            for (const selector of Object.keys(cmpSelectorMap)) {
                const hit = document.querySelector(selector);
                if (hit) {
                    cmpSelectorHit = selector;
                    break;
                }
            }

            return {
                hasBody: true,
                cmpSelectorHit,
                buttonCount: visibleButtonCandidates.length,
                checkboxCount: document.querySelectorAll("input[type='checkbox']").length,
                switchCount: document.querySelectorAll("[role='switch']").length,
                sampleButtonTexts,
            };
        }, selectorsMap);

        return {
            index,
            url: frame.url() || "about:blank",
            ...summary
        };
    } catch (err) {
        return {
            index,
            url: frame.url() || "about:blank",
            hasBody: false,
            cmpSelectorHit: null,
            buttonCount: 0,
            checkboxCount: 0,
            switchCount: 0,
            sampleButtonTexts: [],
            evaluationError: err.message
        };
    }
}

async function pickFrameIndexViaLiteLlm(frameSummaries, cmpTypeHint = null) {
    const liteLlmUrl = process.env.LITELLM_BASE_URL || "";
    const liteLlmApiKey = process.env.LITELLM_API_KEY || "";
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "";
    const ollamaBearerToken = process.env.OLLAMA_BEARER_TOKEN || "";

    const liteLlmEndpoint = buildEndpoint(liteLlmUrl, "/chat/completions");
    const ollamaEndpoint = buildEndpoint(ollamaUrl, "/api/generate");

    if (!liteLlmEndpoint && !ollamaEndpoint) {
        console.error("LLM frame-selector skipped: missing LITELLM_BASE_URL and OLLAMA_BASE_URL.");
        return null;
    }

    const compactSummaries = frameSummaries.map((summary) => ({
        index: summary.index,
        url: normalizeUrlForPrompt(summary.url),
        hasBody: summary.hasBody,
        cmpSelectorHit: summary.cmpSelectorHit,
        buttonCount: summary.buttonCount,
        checkboxCount: summary.checkboxCount,
        switchCount: summary.switchCount,
        sampleButtonTexts: summary.sampleButtonTexts,
        evaluationError: summary.evaluationError || null
    }));

    const prompt = `
You are selecting the most likely browser frame containing a consent banner.
Return ONLY valid JSON with this schema:
{"frameIndex": <number>, "reason": "<short text>"}
If no frame looks plausible, return: {"frameIndex": -1, "reason": "none"}

Hints:
- Prioritize frames with cmpSelectorHit
- Then prioritize consent-like button texts (accept, reject, cookie, preferences, consent)
- Ignore captcha or ad/analytics helper frames
- cmpTypeHint: ${cmpTypeHint || "null"}

Frame summaries:
${JSON.stringify(compactSummaries)}
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
                console.error(`LLM frame-selector call failed: ${response.status}`);
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
                console.error(`Ollama frame-selector call failed: ${response.status}`);
                return null;
            }

            const data = await response.json();
            rawContent = data.response?.trim() || "";
        }

        const cleaned = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (typeof parsed.frameIndex !== "number") {
            return null;
        }

        console.error(`LLM frame-selector picked index ${parsed.frameIndex} (${parsed.reason || "no reason"}).`);
        return parsed.frameIndex;
    } catch (err) {
        console.error("LLM frame-selector failed:", err.message);
        return null;
    }
}

async function findBannerFrameViaLlm(page, selectorsMap, cmpTypeHint = null) {
    const frames = page.frames().filter((frame) => frame.url() && frame.url() !== "about:blank");

    if (!frames.length) {
        return null;
    }

    const frameSummaries = [];
    for (let index = 0; index < frames.length; index++) {
        const summary = await summarizeFrame(frames[index], index, selectorsMap);
        frameSummaries.push(summary);
    }

    const chosenIndex = await pickFrameIndexViaLiteLlm(frameSummaries, cmpTypeHint);
    if (chosenIndex === null || chosenIndex < 0 || chosenIndex >= frames.length) {
        return null;
    }

    return frames[chosenIndex];
}

module.exports = findBannerFrameViaLlm;
