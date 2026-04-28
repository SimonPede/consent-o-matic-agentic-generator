/**
 * Known CMP CDN domains for deterministic frame detection.
 * Based on DarkDialogs paper, Appendix B.
 * TODO: extend with more known CMP domains.
 */
const CMP_DOMAINS = [
	"quantcast.mgr.consensu.org",
	"cdn.cookielaw.org", // OneTrust
	"consent.trustarc.com",
	"consentcdn.cookiebot.com",
	"gdpr.privacymanager.io", //LiveRamp
	"c.evidon.com" //Crownpeak
];

module.exports = CMP_DOMAINS;