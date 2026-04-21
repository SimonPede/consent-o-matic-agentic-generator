const CMP_SELECTORS = {
    //8works
    '[id*="eightworks-cookie-consent"]': "8works",
    '[class*="eightworks-cookie-consent"]': "8works", 

    //Acris
    '[id*="acris-cookie-settings"]': "Acris",
    '[class*="acris-cookie-settings"]': "Acris", 

    //Amasty (Magento Plugin)
    '[id*="amgdprcookie-button"]' : "Amasty",
    '[class*="amgdprcookie-button"]': "Amasty", 

    //Axeptio (prefix)
    '[id^="axeptio"]' : "Axeptio",
    '[class^="axeptio"]' : "Axeptio", 

    //Borlabs (prefix)
    '[id^="borlabs"]' : "Borlabs",
    '[class^="borlabs"]' : "Borlabs", 

    //CCM19
    '[id*="ccm-modal-inner"]' : "CCM19",
    '[class*="ccm-modal-inner"]' : "CCM19", 

    //CIVIC
    '[id*="ccc-overlay"]' : "CIVIC",
    '[class*="ccc-overlay"]' : "CIVIC", 

    //Complianz
    '[id*="cmplz"]' : "Complianz",
    '[class*="cmplz"]' : "Complianz", 

    //Consent-Magic
    '[id*="cs-privacy-content-text"]' : "Consent-Magic",
    '[class*="cs-privacy-content-text"]' : "Consent-Magic", 

    //Cookie Bar (generic script adapted by many)
    '[id*="cb-enable"]' : "Cookie Bar",
    '[class*="cb-enable"]' : "Cookie Bar",

    //Cookie Info Script
    '[id*="cookieinfo-close"]' : "Cookie Info",
    '[class*="cookieinfo-close"]' : "Cookie Info",

    //Cookie Information (prefix "coi": short, could lead to false positives) 
    '[id^="coi"]' : "Cookie Information",
    '[class^="coi"]' : "Cookie Information", 

    //Cookie Notice
    '[id*="cn-notice-text"]' : "Cookie Notice",
    '[class*="cn-notice-text"]' : "Cookie Notice",

    //Cookie-Script (prefix)
    '[id^="cookiescript_"]' : "Cookie-Script",
    '[class^="cookiescript_"]' : "Cookie-Script",

    //CookieConsent
    '[id*="cm__desc"]' : "CookieConsent",
    '[class*="cm__desc"]' : "CookieConsent",

    //CookieFirst
    '[id*="cf3E9g"]' : "CookieFirst",
    '[class*="cf3E9g"]' : "CookieFirst",

    //CookieHint
    '[id*="cookiecontent"]' : "CookieHint",
    '[class*="cookiecontent"]' : "CookieHint",

    //CookieHub (prefix)
    '[id^="ch2-"]' : "CookieHub",
    '[class^="ch2-"]' : "CookieHub",

    //CookieYes (partially prefix)
    '[id*="-cli-"]' : "CookieYes",
    '[class*="-cli-"]' : "CookieYes",
    '[id*="cookie-law-info-bar"]' : "CookieYes",
    '[class*="cookie-law-info-bar"]' : "CookieYes",
    '[id*="cookie_action_close_header"]' : "CookieYes",
    '[class*="cookie_action_close_header"]' : "CookieYes",
    '[id^="cky"]' : "CookieYes",
    '[class^="cky"]' : "CookieYes",

    //Didomi
    '[id*="didomi"]' : "Didomi",
    '[class*="didomi"]' : "Didomi",

    //Digital Control Room (prefix)
    '[id^="CookieReports"]' : "Digital Control Room",
    '[class^="CookieReports"]' : "Digital Control Room",

    //Django Cookie Consent
    '[id*="cc-cookie-accept"]' : "Django Cookie Consent",
    '[class*="cc-cookie-accept"]' : "Django Cookie Consent",

    //Drupal
    '[id*="eu-cookie-compliance-categories"]' : "Drupal",
    '[class*="eu-cookie-compliance-categories"]' : "Drupal",

    //FireCask
    '[id*="pea_cook_btn"]' : "FireCask",
    '[class*="pea_cook_btn"]' : "FireCask",

    //Gomag
    '[id*="__gomagCookiePolicy"]' : "Gomag",
    '[class*="__gomagCookiePolicy"]' : "Gomag",

    //HubSpot (prefix)
    '[id^="hs-en-cookie-"]' : "HubSpot",
    '[class^="hs-en-cookie-"]' : "HubSpot",

    //I Have Cookies
    '[id*="gdpr-cookie-accept"]' : "I Have Cookies",
    '[class*="gdpr-cookie-accept"]' : "I Have Cookies",

    //IQIT commerce
    '[id*="iqitcookielaw"]' : "IQIT commerce",
    '[class*="iqitcookielaw"]' : "IQIT commerce",

    //IdoSell
    '[id*="iai_cookie"]' : "IdoSell",
    '[class*="iai_cookie"]' : "IdoSell",

    //InMobi
    '[id*="qc-cmp2-ui"]' : "InMobi",
    '[class*="qc-cmp2-ui"]' : "InMobi",

    //Jimdo
    '[id*="cookie-settings-necessary"]' : "Jimdo",
    '[class*="cookie-settings-necessary"]' : "Jimdo",

    //Klaro
    '[id*="id-cookie-notice"]' : "Klaro",
    '[class*="id-cookie-notice"]' : "Klaro",

    //Moove (prefix)
    '[id^="moove-gdpr"]' : "Moove",
    '[class^="moove-gdpr"]' : "Moove",

    //Mozello CookieBar
    '[id*="cookie-notification-text"]' : "Mozello CookieBar",
    '[class*="cookie-notification-text"]' : "Mozello CookieBar",

    //OneTrust
    '[id*="onetrust"]' : "OneTrust",
    '[class*="onetrust"]' : "OneTrust", 
    '[id*="ot-sdk-container"]' : "OneTrust",
    '[class*="ot-sdk-container"]' : "OneTrust",
    '[class*="optanon"]' : "OneTrust",
    '[id*="optanon"]' : "OneTrust",
    
    //Osano
    '[id*="cc-window"]' : "Osano",
    '[class*="cc-window"]' : "Osano",
    '[id*="cc_container"]' : "Osano",
    '[class*="cc_container"]' : "Osano",
    '[id*="osano"]' : "Osano",
    '[class*="osano"]' : "Osano",
    '[class*="cookieconsent\\:desc"]' : "Osano",
    '[id*="cookieconsent\\:desc"]' : "Osano",

    //Piwik (prefix)
    '[id^="ppms_cm"]' : "Piwik",
    '[class^="ppms_cm"]' : "Piwik",

    //Serviceform
    '[id*="sf-cookie-settings"]' : "Serviceform",
    '[class*="sf-cookie-settings"]' : "Serviceform",

    //Shoper
    '[id*="consents__advanced-buttons"]' : "Shoper",
    '[class*="consents__advanced-buttons"]' : "Shoper",

    //Shopify
    '[id*="shopify-pc__banner"]' : "Shopify",
    '[class*="shopify-pc__banner"]' : "Shopify",

    //Shoprenter
    '[id*="nanobar-buttons"]' : "Shoprenter",
    '[class*="nanobar-buttons"]' : "Shoprenter",

    //Shoptet
    '[id*="siteCookies"]' : "Shoptet",
    '[class*="siteCookies"]' : "Shoptet",

    //Shopware (Em-Dash!)
    '[id*="page-wrap–cookie-permission"]' : "Shopware",
    '[class*="page-wrap–cookie-permission"]' : "Shopware",
    '[id*="cookie-permission–container"]' : "Shopware",
    '[class*="cookie-permission–container"]' : "Shopware",
    '[id*="cookie-consent–header"]' : "Shopware",
    '[class*="cookie-consent–header"]' : "Shopware",

    //Sourcepoint
    '[id*="sp_message_container"]' : "Sourcepoint",
    '[class*="sp_message_container"]' : "Sourcepoint",

    //Squarespace
    '[id*="sqs-cookie-banner-v2-cta"]' : "Squarespace",
    '[class*="sqs-cookie-banner-v2-cta"]' : "Squarespace",

    //Termly
    '[id*="termly"]' : "Termly",
    '[class*="termly"]' : "Termly",

    //TermsFeed
    '[id*="cc_div"]' : "TermsFeed",
    '[class*="cc_div"]' : "TermsFeed",
    '[id*="cc-nb-text"]' : "TermsFeed",
    '[class*="cc-nb-text"]' : "TermsFeed",

    //TrustArc (prefix)
    '[id^="truste"]' : "TrustArc",
    '[class^="truste"]' : "TrustArc",

    //Unidentified CMPs
    '[id*="ct-ultimate-gdpr-"]' : "Unidentified CMP",
    '[class*="ct-ultimate-gdpr-"]' : "Unidentified CMP",
    '[id*="w-cookie-modal"]' : "Unidentified CMP",
    '[class*="w-cookie-modal"]' : "Unidentified CMP",
    '[id*="bemCookieOverlay"]' : "Unidentified CMP",
    '[class*="bemCookieOverlay"]' : "Unidentified CMP",
    '[id*="consents__wrapper"]' : "Unidentified CMP",
    '[class*="consents__wrapper"]' : "Unidentified CMP",
    '[id^="cookie-policy-overlay"]' : "Unidentified CMP",
    '[class^="cookie-policy-overlay"]' : "Unidentified CMP",
    '[id^="cookie-policy-details"]' : "Unidentified CMP",
    '[class^="cookie-policy-details"]' : "Unidentified CMP",
    '[id*="lgcookieslaw"]' : "Unidentified CMP",
    '[class*="lgcookieslaw"]' : "Unidentified CMP",
    '[id*="module-notification-137"]' : "Unidentified CMP",
    '[class*="module-notification-137"]' : "Unidentified CMP",
    '[id*="cookieNoticeContent"]' : "Unidentified CMP",
    '[class*="cookieNoticeContent"]' : "Unidentified CMP",
    // Unidentified CMP 006 (ends with "popup-text" --> generic, which could lead to false positives)
    '[id$="popup-text"]' : "Unidentified CMP",
    '[class$="popup-text"]' : "Unidentified CMP",

    //Usercentrics
    '[id*="cNkVwm"]' : "Usercentrics",
    '[class*="cNkVwm"]' : "Usercentrics",
    '[id*="CybotCookiebot"]' : "Usercentrics",
    '[class*="CybotCookiebot"]' : "Usercentrics",
    '[id^="usercentrics"]' : "Usercentrics",
    '[class^="usercentrics"]' : "Usercentrics",
    '[id^="uc-"]' : "Usercentrics",
    '[class^="uc-"]' : "Usercentrics",

    //Wix
    '[id*="ccsu-banner-text-container"]' : "Wix",
    '[class*="ccsu-banner-text-container"]' : "Wix",
    '[id*="consent-banner-root-container"]' : "Wix",
    '[class*="consent-banner-root-container"]' : "Wix",

    //WordPress Themes
    '[id*="fusion-privacy-bar"]' : "WordPress Themes",
    '[class*="fusion-privacy-bar"]' : "WordPress Themes",
    '[id*="avia-cookie-"]' : "WordPress Themes",
    '[class*="avia-cookie-"]' : "WordPress Themes",
    '[id*="flatsome-cookies"]' : "WordPress Themes",
    '[class*="flatsome-cookies"]' : "WordPress Themes",
    '[id*="wd-cookies-inner"]' : "WordPress Themes",
    '[class*="wd-cookies-inner"]' : "WordPress Themes",

    //consentmanager.net
    '[id*="cmpwelcomebtnsave"]' : "consentmanager.net",
    '[class*="cmpwelcomebtnsave"]' : "consentmanager.net",
    '[id*="cmpbox"]' : "consentmanager.net",
    '[class*="cmpbox"]' : "consentmanager.net",

    //idnovate
    '[id^="cookiesplus"]' : "idnovate",
    '[class^="cookiesplus"]' : "idnovate",

    //iubenda
    '[id*="iubenda"]' : "iubenda",
    '[class*="iubenda"]' : "iubenda",

    //jQuery EU Cookie Law
    '[id*="eupopup-body"]' : "jQuery EU Cookie Law",
    '[class*="eupopup-body"]' : "jQuery EU Cookie Law",

    //tarteaucitron
    '[id*="tarteaucitron"]' : "tarteaucitron",
    '[class*="tarteaucitron"]' : "tarteaucitron",

};

module.exports = CMP_SELECTORS;