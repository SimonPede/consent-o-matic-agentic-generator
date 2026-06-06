/**
 * Known CMP CDN domains for deterministic frame detection.
 * Based on DarkDialogs paper, Appendix B.
 * 
 * Utilized in `calculateFrameScore()` to provide absolute, deterministic identification 
 * of a CMP iframe when its source URL matches any of these infrastructure domains (+ 50).
 * * TODO: Systematically expand with additional high-frequency CMP domains during evaluation.
 */
const CMP_DOMAINS = [
	"quantcast.mgr.consensu.org", //Quantcast Choice
	"cdn.cookielaw.org", // OneTrust
	"consent.trustarc.com", //TrustArc
	"consentcdn.cookiebot.com", //Cookiebot
	"gdpr.privacymanager.io", //LiveRamp
	"c.evidon.com" //Crownpeak (Evidon)
];

module.exports = CMP_DOMAINS;