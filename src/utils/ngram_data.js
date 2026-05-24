/**
 * N-gram phrases for cookie consent dialog detection.
 * Adapted from DarkDialogs paper, Appendix A.3
 * Used in calculateFrameScore() – longer n-grams get higher weight.
 */
const N_GRAM_DATA = {
	5: [
		//EN:
		"access information on a device", "and or access information on",
		"store and or access information", "use cookies and similar technologies",
		"ad and content measurement audience", "and content measurement audience insights",
		"audience insights and product development", "content measurement audience insights and",
		"improve your experience on our", "measurement audience insights and product",
		//DE:
		"verwendung von cookies und ähnlichen", "basierend auf browsereinstellungen und gerätekennungen",
		"informationen auf einem gerät speichern", "speichern von oder zugriff auf",
		"Inhalte und Anzeigen zu personalisieren", "erkenntnisse über zielgruppen und produktentwicklung",
		//French
        "stocker et ou accéder à", "des informations sur un terminal", "mesure de performance des publicités",
        "développer et améliorer les produits", "utiliser des données de géolocalisation",
        //Spanish
        "almacenar o acceder a información", "información en un dispositivo", "medir el rendimiento de los anuncios",
        "desarrollar y mejorar nuevos productos", "utilizar datos de localización geográfica",
        //Italian
        "archiviare e o accedere a", "informazioni su un dispositivo", "misurare le prestazioni degli annunci",
        "sviluppare e migliorare i prodotti", "dati di geolocalizzazione precisi",
        //NL (Dutch)
        "informatie op een apparaat opslaan", "opslag van en toegang tot", "meten van advertentie en contentprestaties",
        //Polish
        "przechowywanie informacji na urządzeniu", "pomiar wydajności reklam i treści"
	],
	4: [
		"we use cookies to", "use cookies and similar", "cookies and similar technologies", "information on a device",
		"at any time by", "and or access information", "access information on a", "you can change your",
		"you can change your", "or access information on", "store and or access",
		//DE:
		"cookies und ähnliche technologien", "sie können ihre einstellungen",
		"diese webseite verwendet Cookies", "wir verwenden cookies um",
        "jederzeit mit wirkung für", "auf ihrem gerät speichern",
		//FR
        "nous utilisons des cookies", "cookies et technologies similaires", "vous pouvez modifier vos",
        "informations sur un appareil", "à tout moment en",
        //ES
        "utilizamos cookies para", "cookies y tecnologías similares", "puede cambiar su configuración",
        "en cualquier momento",
        //IT
        "utilizziamo i cookie per", "cookie e tecnologie simili", "puoi modificare le tue",
        //NL
        "wij gebruiken cookies om", "cookies en vergelijkbare technologieën", "u kunt uw instellingen",
        //PL
        "używamy plików cookie aby", "pliki cookie i podobne"
	],
	3: [
		"we use cookies", "at any time", "our cookie policy", "use cookies and", "use cookies to", "cookies and similar",
		"use of cookies", "learn more about", "and our partners", "and similar technologies", "our cookie policy",
		//DE
		"wir verwenden cookies", "und unsere partner", "und ähnliche technologien",
        "unsere cookie richtlinie", "jederzeit wieder ändern", "berechtigtes interesse",
		//FR
        "et nos partenaires", "politique de cookies", "à tout moment",
        //ES
        "y nuestros socios", "política de cookies", "en cualquier momento",
        //IT
        "e i nostri partner", "informativa sui cookie", "in qualsiasi momento",
        //NL
        "en onze partners", "ons cookiebeleid", "te allen tijde",
        //PL
        "i nasi partnerzy", "polityka plików cookie", "w dowolnym momencie"
	],
	2: [
		"use cookies", "cookies and", "cookies to", "we use", "accept all", "any time", "at any", "you agree",
		"learn more", "manage preferences",
		//DE
		"cookies verwenden", "alle akzeptieren", "mehr erfahren", "einstellungen verwalten",
		//FR
        "tout accepter", "en savoir", "gérer les", "intérêt légitime",
        //ES
        "aceptar todo", "saber más", "gestionar preferencias", "interés legítimo",
        //IT
        "accetta tutti", "scopri di", "gestisci preferenze", "interesse legittimo",
        //NL
        "alles accepteren", "meer lezen", "voorkeuren beheren", "gerechtvaardigd belang",
        //PL
        "zaakceptuj wszystko", "dowiedz się", "zarządzaj preferencjami"
	],
	1: [
		"cookies", "cookie", "track", "tracking", "einwilligung", "datenschutz", 
        "consent", "privacy", "confidentialité", "privacidad", "privacyverklaring", "prywatność"
	]
};

module.exports = N_GRAM_DATA;