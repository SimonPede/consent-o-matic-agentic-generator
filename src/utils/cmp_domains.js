/**
 * Known CMP domains for deterministic frame detection.
 * Based on "DarkDialogs: Automated detection of 10 dark patterns on cookie dialogs" paper, Appendix B.
 * 
 * Utilized in `calculateFrameScore()` to provide absolute, deterministic identification 
 * of a CMP iframe when its source URL matches any of these infrastructure domains (+ 50).
 */
const CMP_DOMAINS = [
	"quantcast.mgr.consensu.org", //Quantcast
	"cdn.cookielaw.org", //OneTrust
	"consent.trustarc.com", //TrustArc
	"consentcdn.cookiebot.com", //Cookiebot
	"gdpr.privacymanager.io", //LiveRamp
	"c.evidon.com" //Crownpeak
];

module.exports = CMP_DOMAINS;