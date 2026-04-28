const SETTINGS_TERMS = [
    //English/International
    "settings", "preferences", "manage", "customize", "options", 
    "manage options", "manage preferences", "manage settings", "Show Purposes",

    //Deutsch (DACH)
    "einstellungen", "optionen", "mehr optionen", "weitere optionen", 
    "datenschutzeinstellungen", "einstellungen verwalten", "zwecke anzeigen",

    //Northern Europe (Denmark, Sweden, Norway, Finland, Estonia)
    "asetukset","inställningar", "seaded", "kohanda",
    "küpsiste seaded", "küpsiste sätted", "halda",
    "seadistusi", "muudan küpsiste seadistusi",

    //Western Europe (France, Belgium, Netherlands, Luxembourg)
    "paramètres", "gérer les cookies", "instellen", "instellingen",
    "voorkeuren", "privacy-instellingen", "gérer", 
    //added myself:
    "En savoir plus sur la gestion des cookies",

    //Southern Europe (Italy, Spain, Portugal, Greece, Malta)
    "impostazioni", "preferenze", "configuración", "ajustes", "preferencias",
    "personalizar", "opciones", "ρυθμίσεις", "περισσοτερες επιλογες", 
    "ρυθμίσεις ςοοκιες", "προτιμησεις", "aktar dwar il cookies",

    //Central & Eastern Europe (Poland, Czech, Slovak, Hungary, Slovenia, Croatia
    "ustawienia", "opcje", "nastavení", "podrobné nastavení", "další volby", 
    "upravit mé předvolby", "nastavenia", "nastavenie cookies", "ďalšie informácie", 
    "bližšie informácie", "nastavitve", "več možnosti", "nastavitve piškotov", 
    "prilagodi", "po meri", "beállítások", "további opciók", "beállítások kezelése", 
    "lehetőségek", "részletek",

    //Baltic & Balkans (Latvia, Lithuania, Bulgaria, Romania)
    "iestatījumi", "pielagot", "papildu opcijas", "parvaldības iespejas",
    "nustatymai", "tvarkyti parinktis", "slapukų nustatymai", "rodyti informaciją", 
    "rinktis", "tinkinti", "nuostatos", "настройки", "подробни настройки", 
    "опции за управление", "други възможности",
    "setări", "modific setările", "mai multe opțiuni", "gestionati opțiunile", "setari cookie-uri"
];
//TODO: verify if this is enough or too much even (--> false positives)
let SETTINGS_PATTERN = new RegExp(SETTINGS_TERMS.join("|"), "i");
module.exports = SETTINGS_PATTERN;