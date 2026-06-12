/**
 * Multilingual regex for detecting CMP-related frame URLs and names.
 * Covers some known CMP providers, privacy-related terms, and EU languages.
 * 
 * The compilation of this specific regex and the 
 * approach of combining provider names with structural/multilingual privacy 
 * vocabulary is a custom, self-developed heuristic for this project.
 * --> needs to be evaluated!
 * Utilized in `calculateFrameScore()` to flag iframes whose metadata strongly 
 * indicates they host a cookie consent interface (+20 bonus score).
 */
const CMP_REGEX = new RegExp(
	[
		//central terms and some providers
		"onetrust", "usercentrics", "cookiebot", "didomi", "iubenda", 
        "trustarc", "quantcast", "osano", "cookieyes", "complianz", 
        "termsfeed", "moove", "consentmanager", "sourcepoint",
		//Strong structural keywords
		"cmp", "gdpr", "cookie[-_]?notice", "cookie[-_]?script", 
        "privacy[-_]?center", "privacy[-_]?manager", "consent", "cookie",
		//Multilingual exact matches (Safer than substrings)
        "privacy", "privatsphäre", "datenschutz", "personvern", "integritet",
        "privacidad", "polityka"
	].join("|"), "i"
);

module.exports = CMP_REGEX;