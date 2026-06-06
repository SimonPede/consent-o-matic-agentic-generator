/**
 * Multilingual word corpus extracted from WordBoxGatherer.js.
 * Source: https://github.com/cavi-au/consent-observatory.eu --> https://github.com/cavi-au/consent-observatory.eu/blob/master/rules/Gatherers/WordBoxGatherer.js
 * Copyright (c) 2023 Rolf Bagge, Janus Kristensen
 * Copyright (c) 2024, 2025 Janus Kristensen
 * License: Mozilla Public License 2.0 (MPL 2.0)
 *
 * Modification (2026, Simon Pede):
 * Simplified the original corpus structure down to a flat array containing 
 * only the multilingual trigger strings, omitting anti-triggers.
 */
const WORD_BOX_TRIGGERS = [
	//international
	"cookie", "cookies", "GDPR",
	//Austria
	"alle akzeptieren", "einstellungen verwalten", "zwecke anzeigen", "ablehnen", "datenschutzerklärung",
	//Belgium
	"accepter", "en savoir plus", "akkoord", "meer informatie", "alle cookies aanvaarden", "paramètres", "accepteren", "d'accord",
	//Bulgaria
	"Политика за поверителност", "Приемане", "затваряне", "Настройки", "Отхвърли Всички", "Приеми Всички", "Научете повече",
	"Приемане и затваряне", "Приемам", "към сайта", "Опции за управление", "Подробни настройки", "продължи", "бисквитки", "бисквитките", "приемете",
	"Политика за защита на личните данни", "Политика за бисквитките", "съгласие", "Научете повече", "Политика за използване на бисквитки",
	"други възможности", "приемате", "декларацията за поверителност", "съгласявате", "персонализираме съдържанието",
	//Croatia
	"Prihvati i zatvori", "Prihvaćam", "Saznaj više", "Saznajte više", "Prihvati sve kolačiće", "Prihvaćam sve", "Postavke", "Postavke kolačića",
	"Slažem se", "Pogledajte naše partnere", "Upravljanje opcijama", "Ne prihvaćam", "Više informacija", "Politika privatnosti", "Pravila privatnosti",
	"Odbaci sve", "Prihvati i zatvori", "Prihvati", "na stranicu", "Opcije za upravljanje", "Detaljne postavke", "nastavi", "kolačići", "kolačići", "prihvati",
	"Pravila o kolačićima", "pristanak", "Pravila o kolačićima", "druge opcije", "prihvaćam", "izjava o privatnosti", "slažem se", "prilagodite sadržaj",
	//Cyprus
	"ΑΠΟΔΟΧΗ ΟΛΩΝ", "ΔΙΑΔΟΧΗ ΟΛΩΝ", "ΑΠΟΡΡΙΨΗ ΟΛΩΝ", "ΣΥΜΦΩΝΩ", "Ρυθμίσεις Cookies", "Αποδοχή όλων", "ΔΙΑΦΩΝΩ", "ΠΡΟΤΙΜΗΣΕΙΣ", "Πολιτική Απορρήτου",
	//Czech Republic
	"Podrobné nastavení", "Povolit vše", "Souhlasím", "Odmítnout", "Rozumím", "Povolit nezbytné", "Další volby", "Přijmout vše", "Upravit mé předvolby", "Nastavení", "Zásady ochrany osobních údajů",
	//Germany
	"datenschutz", "akzeptieren", "stimme zu", "zustimmen", "berechtigtes interesse", "Privatsphäre",
	//Denmark
	"privatliv", "samtykke", "acceptér", "tillad", "legitim interesse",
	//Estonia
	"nõustun", "keeldu", "luba kõik", "kohanda", "küpsiste seaded", "küpsiste sätted", "küpsised", "nõustu", "halda", "privaatsus",
	"küpsiseid", "küpsistega", "küpsistest", "privaatsuspoliitika", "sulge", "seaded", "rohkem teavet", "keeldun", "kuva eesmärgid",
	"muudan küpsiste seadistusi", "küpsiste seadetega", "sain aru", "loen veel", "privaatsuspõhimõtete", "nõustun kõigi küpsistega", "selge", "lisainfo",
	"isikupärastamiseks", "isikupärastatud", "isikupärasem", "seaded", "tingimused", "tingimustega", "seadistusi",
	//England/US
	"we and our \\d+ partners", "privacy", "consent", "accept", "agree", "legitimate interest",
	//Spain
	"privacidad", "acept", "acceptar", "acordar", "interés legítimo",
	//Finland
	"evästeitä","evästeiden", "tietosuoja", "hyväksy", "hylkää", "asetukset", "suostumustasi", "suostumuksesi",
	//France
	"confidentialité", "accepter", "accord", "intérêt légitime",
	//Greece
	"ΠΕΡΙΣΣΟΤΕΡΕΣ ΕΠΙΛΟΓΕΣ", "ΣΥΜΦΩΝΩ", "ΔΙΑΦΩΝΩ", "ΑΠΟΔΟΧΗ", "ΑΠΟΡΡΙΨΗ", "Περισσότερα", "ΑΠΟΡΡΗΤΗΝ", "Πολιτική Απορρήτου",
	//Hungary
	"cookie-kat", "Elfogadom", "TOVÁBBI OPCIÓK", "NEM ELFOGADOM", "További információ", "Elfogadás és bezárás", "Beállítások",
	"Beállítások kezelése", "Hozzájárulás", "ÖSSZES ENGEDÉLYEZÉSE", "Mindent elfogadok", " Adatvédelmi szabályzat", "Elfogadás",
	"Adatvédelmi szabályzat", "sütik", "Az Ön adatainak védelme fontos számunkra", "Tartalom testreszabása", "Lehetőségek", "További lehetőségek",
	"Részletek", "Cookie-k", "Információ", "Cookie-szabályzat", "kapcsolódó sütikkel kapcsolatos információk",
	//Iceland
	"vefkökur", "kökur", "vafrakökur", "samþykkja", "hafna", "vefköku stillingar", "leyfa", "vista val", "fótspor",
	//Ireland
	"fianáin", "cuacha", "lean ar aghaidh", "cosanta sonraí", "socruithe fianán", "glac le gach fianán", "diúltú neamhriachtanach", "bainistigh fianáin",
	//Italy
	"politica", "consenso", "accetta", "concordare", "interesse legittimo",
	//Latvia
	"Piekrītu", "PIELĀGOT", "PAPILDU OPCIJAS", "Uzzināt vairāk", "Atļaut visas sīkdatnes", "Apstiprināt", "Pārvaldības iespējas", "Apstiprināt",
	"Pārvaldības iespējas", "СОГЛАСЕН", "NEPIEKRIŢU", "ДОПОЛНИТЕЛЬНЫЕ ПАРАМЕТРЫ", "Privātuma politika", "Piekrist", "aizvērt", "Iestatījumi",
	"Noraidīt visu", "Pieņemt visu", "Uzzināt vairāk", "Pieņemt un aizvērt", "Piekrist", "Opcijas pārvaldība", "Detalizēti iestatījumi", "Turpināt",
	"sīkfaili", "pieņemt", "piekrišana", "Uzzināt vairāk", "Sīkfailu politika", "cits opcijas", "Es piekrītu", "paziņojums par konfidencialitāti", "Es piekrītu", "pielāgot saturu",
	//Lithuania
	"Sutinku", "Tvarkyti parinktis", "Leisti visus slapukus", "DAUGIAU PASIRINKIMŲ", "Atsisakyti visų", "Supratau", "Slapukų nustatymai", "Sutikimas",
	"Rodyti informaciją", "Patvirtinti", "Privatumo politika", "Rinktis", "Slapuku politikoje", "nesutinku", "Tinkinti", "Priimti", "Slapukai",
	"Slapukų politika", "Privatumo pareiškimas", "Nustatymai", "Rodyti paskirtis", "Privatumas", "Slapukuose", "Tvarkyti parinktis",
	"Slapuku politikoje", "Nuostatos", "Rinkodara", "Slapukus",
	//Luxembourg
	"J'accepte", "Je refuse", "Gérer les cookies", "Paramètres des cookies", "Accepter tout", "Afficher toutes les finalités", "Privatsphär",
	//Malta
	"il-privatezza", "il-cookies", "tal-cookies", "naqbel", "naċċetta", "aktar dwar il cookies", "aċċetta", "irrifjuta",
	//Netherlands
	"accepteren", "afwijzen", "akkoord", "instellen", "toestemming", "privacy-instellingen", "instellingen", "cookiebeleid", "privacyverklaring",
	//Norway
	"informasjonskapsler", "personvern", "godta", "avvis",
	//Poland
	"plików", "plikach", "akceptuję", "odrzucenie wszystkich", "zaakceptuj", "ordzuć", "prwatność",
	//Portugal
	"privacidade", "consentimento", "aceitar", "concordo", "interesse legítimo",
	//Romania
	"cookie-uri", "ACCEPT TOATE", "VREAU SA MODIFIC SETARILE INDIVIDUAL", "MODIFIC SETĂRILE",
	"MAI MULTE OPȚIUNI", "Respinge toate", "Gestionajți opțiunile", "Consimțământ", "Setari cookie-uri",
	"SETĂRI COOKIES", "Politica de confidențialitate",
	//Slovakia
	"Pokračovať s nevyhnutnými cookies", "Nastavenia", "Súhlasím", "Prijať všetko", "Akceptovať", "Zamietnuť",
	"Nastavenie cookies", "Nastavenia cookies", "Ďalšie informácie", "Bližšie informácie", "Zásady ochrany osobných údajov",
	//Slovenia
	"STRINJAM SE", "VEČ MOŽNOSTI", "NASTAVITVE", "SPREJMI", "SPREJMEM", "NE STRINJAM SE", "NASTAVITVE PIŠKOTOV", "Sprejmem vse",
	"Dovoli vse in zapri", "PRILAGODI", "Politika zasebnosti", "zavrni vse", "namesti vse", "po meri", "vi redu", "razumem", "piškotkov",
	"piškotke", "piškotki", "piškotkih",
	//Sweden
	"acceptera", "godkänn", "kakor"
];

module.exports = WORD_BOX_TRIGGERS;