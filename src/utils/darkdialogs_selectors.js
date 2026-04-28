/**
 * General CSS selectors for detecting cookie consent dialog candidates.
 * Adapted from DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs,
 * Appendix A.2 (Table 6).
 * 
 * Used in calculateFrameScore() to give a small bonus (+2) to frames that contain
 * elements matching these selectors, indicating a higher likelihood of being a CMP banner.
 * These are general selectors (less specific than CMP_SELECTORS_MAP, +10).
 * 
 * Note: Only div elements are targeted to reduce false positives.
 */
const TABLE_6_CUSTOM_SELECTORS = [
    'div[class*="gdpr"]', 'div[class*="Cookie"]', 'div[class*="cookie"]',
    'div[class*="Privacy"]', 'div[class*="privacy"]', 'div[class*="Policy"]',
    'div[class*="policy"]', 'div[class*="Consent"]', 'div[class*="consent"]',
    'div[class*="Notice"]', 'div[class*="notice"]', 'div[class*="Dialog"]',
    'div[class*="dialog"]', 'div[id*="gdpr"]', 'div[id*="Cookie"]',
    'div[id*="cookie"]', 'div[id*="Privacy"]', 'div[id*="privacy"]',
    'div[id*="Policy"]', 'div[id*="policy"]', 'div[id*="Consent"]',
    'div[id*="consent"]', 'div[id*="Notice"]', 'div[id*="notice"]',
    'div[id*="Dialog"]', 'div[id*="dialog"]', 'div[data-project*="cmp"]',
    'div[id*="cmp"]'
];

module.exports = TABLE_6_CUSTOM_SELECTORS;