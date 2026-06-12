const GENERAL_SELECTORS = require("../../utils/general_selectors.js");
const N_GRAM_DATA = require("../../utils/n_gram_data");
const CMP_FRAME_REGEX = require("../../utils/cmp_frame.js");
const CMP_DOMAINS = require("../../utils/cmp_domains.js");
const TRIGGER_WORDS_REGEX = require("../../utils/trigger_words");

/**
 * Calculates the average word count across all frames on the page.
 * Used as a baseline by calculateFrameScore() to detect frames that are
 * exceptionally long compared to other frames (word count > average + 100).
 * 
 * Frames that cannot be evaluated (e.g. cross-origin iframes) are silently
 * skipped via try/catch to avoid crashing the scoring pipeline.
 * 
 * Shadow DOM traversal not needed here: document.body.innerText returns
 * rendered text which includes Shadow DOM content automatically.
 * 
 * @param {Frame[]} frames - array of all Puppeteer frames on the page
 * @returns {Promise<number>} - Dynamic average word count baseline, or 0 if unassessable
 */
async function frameWordCounter(frames) {
    const wordCounts = [];

    for (const frame of frames) {
        try {
            const count =  await frame.evaluate(() => {
                const text = document.body ? document.body.innerText.trim() : "";
                return text.split(/\s+/).filter(w => w.length > 0).length;
            });
            wordCounts.push(count);
        } catch (err) {
            continue;
        }
    }

    if (!wordCounts.length) {
        return 0;
    }

    const sum = wordCounts.reduce((acc, curr) => acc + curr, 0);
    return sum / wordCounts.length;
}

/**
 * Scores a frame based on how likely it is to contain a cookie consent banner.
 * Inspired by and partially adapted from the scoring system in:
 * "DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs"
 * 
 * Scoring factors (see paper Appendix A.3 for original weights):
 * 
 * Positive:
 *   +5  General CSS selector match (GENERAL_SELECTORS)
 *   +10 CMP-specific selector match (CMP_SELECTORS_MAP, Nouwens et al., 2025 + Singh et al., 2026)
 *   +n  N-gram match (weight = n-gram length: unigram +1, bigram +2, ..., 5-gram +5)
 *   +2  per trigger word match (multilingual consent vocabulary, Nouwens et al., 2025 + Singh et al., 2026)
 *       capped at +10 to avoid over-weighting frames with many cookie-related mentions
 *   +15 element within frame has position:fixed + z-index > 10
 *        Direct adaptation of Nouwens et al. (2025) Section 3.3 to frame-internal elements.
 *   +10 iframe element itself has position:fixed + z-index > 10 (passed as iframeBonus)
 *        Adaptation of same principle to the iframe element in the parent page context.
 *   +5  element within frame is displayed at the top of the screen
 *        Direct adaption of Klein and Musch et al., 2022, p.914
 *        applied only to fixed/high-z elements to avoid false positives from header/nav elements
 * 
 * Negative:
 *   -20  Word count < 5 (likely a clickable element, not a dialog)
 *   -20  Word count > average + 100 (likely contains non-banner content)
 *   -100 No text content (very unlikely to be a cookie dialog)
 *   -100 Element not visible (display:none, visibility:hidden, or zero dimensions)
 *        Inspired by paper's screenshot-based visibility check (S.18), adapted for Puppeteer
 *   -30  iframe element itself is not inside the current viewport and should therefore not be visible
 *        (passed as iframeBonus)
 *   [excluded from +15 bonus] fixed/high-z elements with >10 internal same-origin links
 *        (nav/footer filter, inspired by CookieCrumbler, Brave Software)
 *   [excluded from +15 bonus] fixed/high-z elements smaller than 100x100px
 *        (revoke button filter, adapted from frameHasBanner() findAnchors() from `test_ruleset.js`)
 * 
 * Deviations from paper:
 *   - Applying the scoring logic not to candidates of banners but iframe
 *   - No screenshot-based visibility check
 *     --> replaced with CSS computed style + bounding box check
 *   - No sub-string/duplicate candidate comparison (out of scope for this prototype)
 *   - N-grams extended with German phrases; full multilingual support is a TODO
 *   - Evaluation of the URL and the iframe name (my own idea)
 *   - and i dont comply to: "iframes were also
        assessed to be less important as there is typically a wide
        range of content that can be contained within an iframe
        not just cookie dialogs."
 *   - position:fixed + z-index check adapted from Nouwens et al. (2025), not DarkDialogs
        & reduced iFrameBonus by 30 if it is not inside the current viewport and should therefore not be visible
        (Gundelach & Herrman, 2023; Klein and Musch et al., 2022)
        & and evaluation if element within frame is displayed at the top of the screen (Klein and Musch et al., 2022, p.914)
 *   - fixed/high-z elements with >10 internal links excluded from scoring
 *      (CookieCrumbler-inspired heuristic to filter nav/footer false positives)
 *   - Trigger word matching uses a RegExp over full frame text
 *      (multilingual vocabulary from Nouwens et al. 2025 Appendix B + Singh et al. 2026 Table 7)
 * 
 * @param {Frame} frame - Puppeteer frame to score
 * @param {number} avgWordCount - average word count across all frames (from frameWordCounter())
 * @param {Object} selectorMap - CMP_SELECTORS_MAP for domain-specific selector matching
 * @param {number} iframeBonus - Bonus calculated in `findCorrectFrame` based on frames z-index and position value
 * @returns {number} - score (higher = more likely to be a cookie banner frame)
 */
async function calculateFrameScore(frame, avgWordCount, selectorMap, iframeBonus = 0) {
    try {
        const url = frame.url();
        const name = frame.name();
        let frameScoreBonus = 0;

        if (CMP_DOMAINS.some(domain => url.includes(domain))) {
            frameScoreBonus += 50; //TODO: evaluate!
        }

        if (CMP_FRAME_REGEX.test(url) || CMP_FRAME_REGEX.test(name)) {
            frameScoreBonus += 20; //TODO: evaluate!
        }

		const triggerWordsPattern = TRIGGER_WORDS_REGEX.source;

        const score = await frame.evaluate((customS, avg, selectorMap, nGrams, triggerWords) => {
            const bodyNode = document.body;
            if (!bodyNode) {
                return -100;
            }

            const rect = bodyNode.getBoundingClientRect();
            const style = window.getComputedStyle(bodyNode);
            const isVisible = rect.width > 0 && 
                            rect.height > 0 && 
                            style.display !== "none" &&
                            style.visibility !== "hidden";

            if (!isVisible) {
                return -100;
            }

            /**
             * Recursively queries the DOM including all Shadow DOM trees.
             * 
             * Standard querySelectorAll() cannot pierce Shadow DOM boundaries – elements
             * inside Shadow Roots are completely invisible to it. This function solves this
             * by first querying the current root (document or ShadowRoot), then finding all
             * elements that host a Shadow Root and recursing into each one.
             * 
             * Why this works: querySelectorAll() CAN search inside a ShadowRoot if called
             * directly ON the ShadowRoot object. So instead of trying to pierce the boundary,
             * we step through the door: find the host via el.shadowRoot, then call
             * querySelectorAll on the ShadowRoot itself.
             * 
             * Limitation: only works for open Shadow DOMs (mode: "open").
             * Closed Shadow DOMs (mode: "closed") are inaccessible via JavaScript by design.
             * In practice, CMPs use open Shadow DOMs (verified: Usercentrics).
             * 
             * Performance note: uses root.querySelectorAll("*") without Array.from() to avoid
             * unnecessary array allocation on large DOMs.
             * 
             * @param {string} selector - Functional CSS selector pattern to discover (e.g. "button", "[role='switch']")
             * @param {Document|ShadowRoot|HTMLElement} root - Boundary evaluation root (defaults to document)
             * @returns {Array<HTMLElement>} - All matching elements across light DOM and all Shadow DOMs
             */
            function querySelectorAllDeep(selector, root = document) {
                let nodes = Array.from(root.querySelectorAll(selector));
                const elements = root.querySelectorAll("*");
                for (let el of elements) {
                    if (el.shadowRoot) {
                        nodes = nodes.concat(querySelectorAllDeep(selector, el.shadowRoot));
                    }
                }
                //to get a feeling how well this works and how necessary it is:
                // console.error(`querySelectorAllDeep found ${nodes.length} nodes for ${selector}`);
                // let nodesStandard = Array.from(root.querySelectorAll(selector));
                // console.error(`querySelectorAll (standard) found ${nodesStandard.length} nodes for ${selector}`);
                return nodes;
            }

            //functionality really similiar to getDeepInnerHtml() in `frame_extractor.js`
            function getDeepText(node) {
                let text = "";
                const root = node.shadowRoot || node;

                for (const child of root.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        text += " " + child.textContent;
                    } else if(child.nodeType === Node.ELEMENT_NODE) {
                        text += " " + getDeepText(child);
                    }
                }
                return text.trim();
            }

            let localScore = 0;
            const text = getDeepText(document.body).replace(/\s+/g, " ").trim();
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const wordsCounter = words.length;

            if (wordsCounter === 0) {
                return -100;
            } else if (wordsCounter < 5) {
                localScore -= 20;
            } else if (wordsCounter > (avg + 100)) {
                localScore -= 20;
            }

            for (const selector of customS) {
                const results = querySelectorAllDeep(selector);
                if (results.length > 0) {
                    localScore += 5;
                    break;
                }
            }

            for (const selector of Object.keys(selectorMap)) {
                const results = querySelectorAllDeep(selector);
                if (results.length > 0) {
                    localScore += 10;
                    break;
                }
            }

            const matches = text.match(new RegExp(triggerWords, "gi")) || []; //finds ALL matches (g = global, i = case-insensitive)
            localScore += Math.min(matches.length * 2, 10); //Math.min(..., 10) caps the bonus at +10 to avoid over-weighting
            //TODO: Evaluate!

            //N-Gram Analyse used by paper would need translation into english
            //far to slow and costly for my agent system. i try to use a similar but simplified version
            for (const [n, phrases] of Object.entries(nGrams).reverse()) {
                const weight = parseInt(n);
                for (const phrase of phrases) {
                    const regex = new RegExp(phrase, "i");
                    if (regex.test(text)) {
                        localScore += weight;
                    }
                }
            }

            const frameElements = querySelectorAllDeep("*");

            let hasFixedHighZ = false;
            let topLevelCount = 0;

            for (const element of frameElements) {
                const style = window.getComputedStyle(element);

                if (style.position === "fixed" && parseInt(style.zIndex) > 10) {
                    const rect = element.getBoundingClientRect();

                    if (rect.width > 0 && rect.width <= 100 && rect.height > 0 && rect.height <= 100) {
                        continue;
                    }

                    const elementsWithLink = element.querySelectorAll("a[href], button[data-href], button[data-url], button[href], [role='link']");
                    let internalLinkCount = 0

                    for (const linkElement of elementsWithLink) {
                        try {
                            const targetUrl = linkElement.getAttribute("href") || linkElement.getAttribute("data-href") || linkElement.getAttribute("data-url");

                            if (!targetUrl) {
                                continue;
                            }
                            
                            const linkUrl = new URL(targetUrl, window.location.origin);

                            if (linkUrl.hostname === window.location.hostname) {
                                internalLinkCount++;
                            }
                        } catch (err) {
                            //Ignore invalid or pseudo-URLs
                        }
                    }

                    if (internalLinkCount > 10) {
                        //Skip elements with many internal links (e.g. nav, footer):
                        //cookie banners rarely contain navigation structures.
                        //Inspired by CookieCrumbler (Brave, github.com/brave/cookiecrumbler).
                        continue;
                    }

                    hasFixedHighZ = true;
                    //NOTE: the logic for computing topLevelCount is copied from
                    //"Accept All Exploits: Exploring the Security Impact of Cookie Banners" paper, p. 914
                    //the bonus and the topLevelCount > 1 threshold is my own addition to this logic
                    //to avoid false positives by header or nav elements i include this evaluation only if the element
                    //has already a large z-index and is fixed

                    //i think it would be even better to calculate the coordinates the middle of the object not just the left corner
                    //so instead of "const {x, y} = el.getBoundingClientRect();" -->
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    if (element === document.elementFromPoint(centerX, centerY)) {
                        topLevelCount++;
                    }
                }
            }

            if (hasFixedHighZ) {
                localScore += 15; //TODO: evaluate bonus!
            }
            if (topLevelCount) {
                localScore += 5; //TODO: evaluate bonus!
            }

            return localScore;
        }, GENERAL_SELECTORS, avgWordCount, selectorMap, N_GRAM_DATA, triggerWordsPattern);

        if (score < -100) {
            return score;
        }

        return score + frameScoreBonus + iframeBonus;
    } catch (err) {
        console.error("frame could not be scored!");
        return -100;
    }
}

module.exports = {
    calculateFrameScore,
	frameWordCounter
};