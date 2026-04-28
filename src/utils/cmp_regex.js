/**
 * Multilingual regex for detecting CMP-related frame URLs and names.
 * Covers some known CMP providers, privacy-related terms, and EU languages.
 * Used in findCorrectFrame() Tier 2 detection.
 */
const CMP_REGEX = new RegExp(
	[
		//central terms and some providers
		"cmp|consent|cookie|gdpr|onetrust|usercentrics|cookiebot|didomi|iubenda|trustarc|quantcast|osano|cookieyes|complianz|termsfeed|cookienotice|cookiescript|moove|consentmanager",
		//"Privacy" & "Center" variation
		"privacy[\\s\\-_]*center", "privacy[\\s\\-_]*manager", "privac", "privatsp", "preferenc",
		//international
		"protection", "protec", "données", "dati", "datos", "adat", "privacidad", "polityka", "confiden",
		//German & eastern europe
		"verarbeitung", "Datenschutz", "personvern", "integritet", "nastavení", "asetukset", "настройки"
	].join("|"), "i"
);

module.exports = CMP_REGEX;