/**
 * N-gram phrases for cookie consent dialog detection.
 * Adapted from DarkDialogs paper, Appendix A.3
 * Used in calculateFrameScore() – longer n-grams get higher weight.
 * TODO: extend with more EU languages (currently EN + DE only)
 */
const N_GRAM_DATA = {
	5: [
		"access information on a device", "and or access information on",
		"store and or access information", "use cookies and similar technologies",
		"ad and content measurement audience", "and content measurement audience insights",
		"audience insights and product development", "content measurement audience insights and",
		"improve your experience on our", "informationen auf einem gerät speichern",
		"measurement audience insights and product",
		"verwendung von cookies und ähnlichen", "basierend auf browsereinstellungen und gerätekennungen"
	],
	4: [
		"we use cookies to", "use cookies and similar", "cookies and similar technologies", "information on a device",
		"at any time by", "and or access information", "access information on a", "you can change your",
		"you can change your", "wir verwenden cookies um", "or access information on", "store and or access",
		"cookies und ähnliche technologien", "sie können ihre einstellungen"
	],
	3: [
		"we use cookies", "at any time", "our cookie policy", "use cookies and", "use cookies to", "cookies and similar",
		"use of cookies", "learn more about", "and our partners", "and similar technologies", "our cookie policy",
		"wir verwenden cookies", "jederzeit wieder ändern", "unsere cookie richtlinie"
	],
	2: [
		"use cookies", "cookies and", "cookies to", "we use", "accept all", "any time", "at any", "you agree",
		"learn more", "manage preferences",
		"alle akzeptieren", "mehr erfahren", "einstellungen verwalten"
	],
	1: [
		"cookies", "cookie", "track", "tracking", "einwilligung", "datenschutz"
	]
};

module.exports = N_GRAM_DATA;