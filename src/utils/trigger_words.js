// These trigger phrases are heavily inspired by two academic papers:
//1. "A Cross-Country Analysis of GDPR Cookie Banners and Flexible Methods For Scraping Them" (Nouwens et al., 2025), Appendix B
//2. "When the Abyss Looks Back: Unveiling Evolving Dark Patterns in Cookie Consent Banners" (Singh et al., 2026), Appendix Table 7, p. 15
//		(Only a subset was adopted, as the full lexicon targets Dark Pattern detection, not banner frame identification)
//NOTE: Settings terms from the former "settingsButtons_term.js" have been merged into this list.

const triggerWordsList = [
    //English/International
    "settings", "preferences", "manage", "customize", "options", 
    "manage options", "manage preferences", "manage settings", "Show Purposes",
	"gdpr", "cookie", "cookies", "privacy", "consent",
	"accept", "agree", "legitimate interest",
	//added based on When the Abyss Looks Back...
	"cookies are small text files", "cookies are small files", "cookies (small text files", "cookies contain", "cookies hold", "cookies identify", "cookies track",
	"Cookies and other tools store or retrieve personal data" ,"script (e.g. cookies)", "script such as cookies", "small files called cookies", "A cookie is a small text file",
	"profiling", "personalized advertising", "interest-based advertising",
	"advertising cookies", "for analytics", "for statistical purposes",
	"for A/B testing", "store and access information",
	"to remember your preferences", "third party advertising",
	"tracking", "reject", "refuse", "deny", "opt-out",
	"edpb", "eprivacy", "ccpa", "legitimate interest (gdpr)",


    //Deutsch (DACH)
    "einstellungen", "optionen", "mehr optionen", "weitere optionen", 
    "datenschutzeinstellungen", "einstellungen verwalten", "zwecke anzeigen",
	"alle akzeptieren", "ablehnen", "datenschutzerklärung", "datenschutz", "akzeptieren",
	"stimme zu", "zustimmen", "berechtigtes interesse", "privatsphäre",
	"Cookies sind kleine Textdateien",

    //Northern Europe (Denmark, Sweden, Norway, Finland, Estonia, Iceland, Ireland)
    "asetukset","inställningar", "seaded",
    "küpsiste seaded", "küpsiste sätted", "halda",
    "seadistusi", "muudan küpsiste seadistusi",
	"privatliv", "samtykke", "acceptér", "tillad", "legitim interesse",
	"evästeitä", "evästeiden", "tietosuoja", "hyväksy", "hylkää", "suostumustasi", "suostumuksesi",
	"vefkökur", "kökur", "vafrakökur", "samþykkja", "hafna", "vefköku stillingar", "leyfa", "vista val","fótspor",
	"fianáin", "cuacha", "lean ar aghaidh", "cosanta sonraí", "socruithe fianán", "glac le gach fianán", "diúltú neamhriachtanach", "bainistigh fianáin",
	"informasjonskapsler", "personvern", "godta", "avvis",
	"acceptera", "godkänn", "kakor",

    //Western Europe (France, Belgium, Netherlands, Luxembourg, Spain, Portugal)
    "paramètres", "gérer les cookies", "instellen", "instellingen",
    "voorkeuren", "privacy-instellingen", "gérer", "accepter", "en savoir plus",
	"akkoord", "meer informatie", "alle cookies aanvaarden", "accepteren", "d’accord",
	"privacidad", "acept", "acceptar", "acordar", "interés legítimo",
	"confidentialité", "accord", "intérêt légitime",
	"j’accepte", "je refuse", "paramètres des cookies", "accepter tout", "afficher",
	"toutes les finalités", "privatsphär",
	"afwijzen", "toestemming", "cookiebeleid", "privacyverklaring",
	"privacidade", "consentimento", "aceitar", "concordo", "interesse legítimo",
    //added myself:
    "En savoir plus sur la gestion des cookies",

    //Southern Europe (Italy, Spain, Portugal, Greece, Malta, Cyprus)
    "impostazioni", "preferenze", "configuración", "ajustes", "preferencias",
    "personalizar", "opciones", "ρυθμίσεις", "περισσοτερες επιλογες", 
    "ρυθμίσεις ςοοκιες", "προτιμησεις", "aktar dwar il cookies",
	"αποδοχη ολων", "διαδοχη ολων", "απορριψη ολων", "συμφωνω", "αποδοχή όλων", "διαφωνω", "πολιτική απορρήτου",
	"περισσότερα", "απορρητην", "politica", "consenso", "accetta", "concordare", "interesse legittimo",
	"il-privatezza", "il-cookies", "tal-cookies", "naqbel", "naccetta", "irrifjuta",

	//Central & Eastern Europe (Poland, Czech, Slovak, Hungary, Slovenia, Croatia, Romania)
	"ustawienia", "opcje", "nastavení", "podrobné nastavení", "další volby", 
	"upravit mé předvolby", "nastavenia", "nastavenie cookies", "ďalšie informácie", 
	"bližšie informácie", "nastavitve", "več možnosti", "nastavitve piškotov", 
	"prilagodi", "po meri", "beállítások", "további opciók", "beállítások kezelése", 
	"lehetőségek", "részletek",
	// Croatian
	"prihvati i zatvori", "prihvaćam", "saznaj više", "saznajte više", 
	"prihvati sve kolačiće", "prihvaćam sve", "postavke", "postavke kolačića", 
	"slažem se", "pogledajte naše partnere", "upravljanje opcijama", "ne prihvaćam", 
	"više informacija", "politika privatnosti", "pravila privatnosti", "odbaci sve", 
	"prihvati", "na stranicu", "opcije za upravljanje", "detaljne postavke", 
	"nastavi", "kolačići", "pravila o kolačićima", "pristanak", 
	"druge opcije", "izjava o privatnosti", "prilagodite sadržaj",
	// Czech Republic
	"povolit vše", "souhlasím", "odmítnout", "rozumím", "povolit nezbytné",
	"přijmout vše", "zásady ochrany osobních údajů",
	// Hungarian
	"cookie-kat", "elfogadom", "nem elfogadom", "további információ", 
	"elfogadás és bezárás", "hozzájárulás", "összes engedélyezése", 
	"mindent elfogadok", "adatvédelmi szabályzat", "elfogadás", "sütik", 
	"az ön adatainak védelme fontos számunkra", "tartalom testreszabása", 
	"további lehetőségek", "cookie-k", "információ", "cookie-szabályzat", 
	"kapcsolódó sütikkel kapcsolatos információk",
	"plików", "plikach", "akceptuję", "odrzucenie wszystkich", 
	"zaakceptuj", "odrzuć", "prywatność",

    //Baltic & Balkans (Latvia, Lithuania, Bulgaria, Romania)
	"iestatījumi", "pielagot", "papildu opcijas", "parvaldības iespejas",
	"nustatymai", "tvarkyti parinktis", "slapukų nustatymai", "rodyti informaciją", 
	"rinktis", "tinkinti", "nuostatos", "настройки", "подробни настройки", 
	"опции за управление", "други възможности",
	"политика за поверителност", "приемане", "затваряне", "отхвърли всички",
	"приеми всички", "научете повече", "приемане и затваряне", "приемам",
	"към сайта", "продължи", "бисквитки", "бисквитките", "приемете",
	"политика за защита на личните данни", "политика за бисквитките",
	"съгласие", "политика за използване на бисквитки", "приемате",  "декларацията за поверителност", "съгласявате", "персонализираме",
	"съдържанието", "setări", "modific setările", "mai multe opțiuni", "gestionati opțiunile", "setari cookie-uri",
	// Estonian
	"nõustun", "keeldu", "luba kõik", "kohanda", "küpsiste seaded", 
	"küpsiste sätted", "küpsised", "nõustu", "halda", "privaatsus", 
	"küpsiseid", "küpsistega", "küpsistest", "privaatsuspoliitika", "sulge", 
	"seaded", "rohkem teavet", "keeldun", "kuva eesmärgid", 
	"muudan küpsiste seadistusi", "küpsiste seadetega", "sain aru", 
	"loen veel", "privaatsuspõhimõtete", "nõustun kõigi küpsistega", 
	"selge", "lisainfo", "isikupärastamiseks", "isikupärastatud", 
	"isikupärasem", "tingimused", "tingimustega", "seadistusi",
	// Latvian
	"piekrītu", "pielagot saturu", "uzzinat vairāk", "atļaut visas sīkdatnes",
	"apstiprināt", "pārvaldības iespējas", "согласен", "nepiekrītu",
	"дополнительные параметры", "privātuma politika", "piekrist", "aizvērt",
	"noraidīt visu", "pieņemt visu", "pieņemt un aizvērt",
	"opcijas pārvaldība", "detalizēti iestatījumi", "turpināt",
	"sīkfaili", "pieņemt", "piekrīšana", "sīkfailu politika",
	"citas opcijas", "es piekrītu", "paziņojums par konfidencialitāti",
	// Lithuanian 
	"sutinku", "leisti visus slapukus", "daugiau pasirinkimų", 
	"atsisakyti visų", "supratau", "sutikimas", "patvirtinti", 
	"privatumo politika", "slapukų politikoje", "nesutinku", 
	"priimti", "slapukai", "slapukų politika", "privatumo pareiškimas", 
	"rodyti paskirtis", "privatumas", "slapukuose", "rinkodara", "slapukus",
	"cookie-uri", "accept toate", "vreau sa modific setarile individual", 
	"respinge toate", "consimțământ", "setări cookies", 
	"politica de confidențialitate",
	"pokračovať s nevyhnutnými cookies", "súhlasím", "prijať všetko", 
	"akceptovať", "zamietnuť", "nastavenia cookies", 
	"zásady ochrany osobných údajov",
	"strinjam se", "sprejmi", "sprejmem", "ne strinjam se", 
	"sprejmem vse", "dovoli vse in zapri", "politika zasebnosti", 
	"zavrni vse", "namesti vse", "v redu", "razumem", 
	"piškotkov", "piškotke", "piškotki", "piškotkih",
];

const escaped = triggerWordsList.map(phrase => 
    phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
);
const TRIGGER_WORDS_REGEX = new RegExp(escaped.join("|"), "i");

module.exports = TRIGGER_WORDS_REGEX;