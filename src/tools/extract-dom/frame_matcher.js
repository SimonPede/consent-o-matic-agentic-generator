const { calculateFrameScore, frameWordCounter } = require("./element_scorer");

/**
 * Heuristically identifies and isolates the functional iframe boundary most likely 
 * to host the active cookie consent interface.
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