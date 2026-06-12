const { calculateFrameScore, frameWordCounter } = require("./element_scorer");

/**
 * Heuristically identifies and isolates the functional iframe boundary most likely 
 * to host the active cookie consent interface.
 * Uses a two-step approach:
 * 
 * Step 1: CMP Type Detection (main frame scan):
 *   Scans the main frame for known CMP container elements using CMP_SELECTORS_MAP
 *   (Nouwens et al. 2025, Appendix C). Returns the CMP name if found (e.g. "Sourcepoint").
 *   Runs on main frame only: CMP providers always place a bootstrap container there
 *   even when the banner itself loads in an iframe.
 *   Verified on: heise.de (Sourcepoint), spiegel.de, usercentrics.com
 * 
 * Step 2: Score-based Frame Selection (calculateFrameScore):
 *   All frames are scored. The score incorporates:
 *   - Domain matching against known CMP CDN domains (+50 bonus)
 *   - URL/name regex matching against CMP-related keywords (+20 bonus)
 *   - N-gram analysis of visible text content
 *   - CSS selector matching (general: +5, CMP-specific: +10)
 *   - Word count penalties
 *   - iframe element CSS properties: position:fixed + z-index > 10 (+10 bonus)
 *     Adaptation of Nouwens et al. (2025) banner candidate detection to iframe level.
 *     Original paper applies this to DOM elements; here applied to iframe elements
 *     in the parent page context.
 *     Additionally reduce iFrameBonus by 30 if it is not inside the current viewport
 *     and should therefore not be visible (mainly inspired by Accept All Exploits: Exploring the Security Impact of Cookie Banners paper
 *     & Cookiescanner: An Automated Tool for Detecting and Evaluating GDPR Consent Notices on Websites)
 *   The highest-scoring frame is returned if score > 0.
 *   Inspired by: DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs
 * 
 * @param {Page} page - Puppeteer page instance
 * @param {Object} selectorMap - CSS selector --> CMP name map (CMP_SELECTORS_MAP)
 * @returns {Promise<Frame|null>} - Resolves with the highest-scoring candidate Frame instance, 
 * 	or null if no context satisfies the positive threshold criteria
 */
async function findCorrectFrame(page, selectorMap) {
    const frames = page.frames();

    //just for debugging:
    console.error(`I found ${frames.length} frames.`);

    const avgWordCount = await frameWordCounter(frames);
    let bestFrame = null;
    let maxScore = -101;

    for (const frame of frames) {
        let iFrameBonus = 0;
        
        try {
            const frameElement = await frame.frameElement();

            if (frameElement) {
                const frameInfo = await frameElement.evaluate(el => {
                    const style = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();

                    return {
                        highZAndIsFixed: style.position === "fixed" && parseInt(style.zIndex) > 10,
                        inViewport: r.top < window.innerHeight &&
                                    r.bottom > 0 &&
                                    r.left < window.innerWidth &&
                                    r.right > 0
                    };
                });

                if (frameInfo.highZAndIsFixed) {
                    iFrameBonus += 10; //TODO: evaluate
                }

                if (!frameInfo.inViewport) {
                    iFrameBonus -= 30; //TODO: evaluate
                }
            }
        } catch (err) {
            //silently skip cross-origin failures e.g.
        }
        const score = await calculateFrameScore(frame, avgWordCount, selectorMap, iFrameBonus);

        if (score > maxScore) {
            maxScore = score;
            bestFrame = frame;
        }
    }

    if (bestFrame && maxScore > 0) {
        console.error(`a frame was picked by score: ${bestFrame.url()} with Score: ${maxScore}`);
        return bestFrame;
    }
    //TODO: maybe return a list of frames with at least score > -50 as fallback instead of nothing?

    return null;
}

module.exports = findCorrectFrame;