// Quelle: Nouwens et al. (2025) - A Cross-Country Analysis of GDPR Cookie Banners
// Appendix C: CMP CSS Selectors
const CMP_SELECTORS = [
    //8works
    '[id*="eightworks-cookie-consent"]',
    '[class*="eightworks-cookie-consent"]', 

    //Acris
    '[id*="acris-cookie-settings"]',
    '[class*="acris-cookie-settings"]', 

    //Amasty (Magento Plugin)
    '[id*="amgdprcookie-button"]',
    '[class*="amgdprcookie-button"]', 

    //Axeptio (prefix)
    '[id^="axeptio"]',
    '[class^="axeptio"]', 

    //Borlabs (prefix)
    '[id^="borlabs"]',
    '[class^="borlabs"]', 

    //CCM19
    '[id*="ccm-modal-inner"]',
    '[class*="ccm-modal-inner"]', 

    //CIVIC
    '[id*="ccc-overlay"]',
    '[class*="ccc-overlay"]', 

    //Complianz
    '[id*="cmplz"]',
    '[class*="cmplz"]', 

    //Consent-Magic
    '[id*="cs-privacy-content-text"]',
    '[class*="cs-privacy-content-text"]', 

    //Cookie Bar (generic script adapted by many)
    '[id*="cb-enable"]',
    '[class*="cb-enable"]',

    //Cookie Info Script
    '[id*="cookieinfo-close"]',
    '[class*="cookieinfo-close"]',

    //Cookie Information (prefix "coi": short, could lead to false positives) 
    '[id^="coi"]',
    '[class^="coi"]', 

    //Cookie Notice
    '[id*="cn-notice-text"]',
    '[class*="cn-notice-text"]',

    //Cookie-Script (prefix)
    '[id^="cookiescript_"]',
    '[class^="cookiescript_"]',

    //CookieConsent
    '[id*="cm__desc"]',
    '[class*="cm__desc"]',

    //CookieFirst
    '[id*="cf3E9g"]',
    '[class*="cf3E9g"]',

    //CookieHint
    '[id*="cookiecontent"]',
    '[class*="cookiecontent"]',

    //CookieHub (prefix)
    '[id^="ch2-"]',
    '[class^="ch2-"]',

    //CookieYes (partially prefix)
    '[id*="-cli-"]',
    '[class*="-cli-"]',
    '[id*="cookie-law-info-bar"]',
    '[class*="cookie-law-info-bar"]',
    '[id*="cookie_action_close_header"]',
    '[class*="cookie_action_close_header"]',
    '[id^="cky"]',
    '[class^="cky"]',

    //Didomi
    '[id*="didomi"]',
    '[class*="didomi"]',

    //Digital Control Room (prefix)
    '[id^="CookieReports"]',
    '[class^="CookieReports"]',

    //Django Cookie Consent
    '[id*="cc-cookie-accept"]',
    '[class*="cc-cookie-accept"]',

    //Drupal
    '[id*="eu-cookie-compliance-categories"]',
    '[class*="eu-cookie-compliance-categories"]',

    //FireCask
    '[id*="pea_cook_btn"]',
    '[class*="pea_cook_btn"]',

    //Gomag
    '[id*="__gomagCookiePolicy"]',
    '[class*="__gomagCookiePolicy"]',

    //HubSpot (prefix)
    '[id^="hs-en-cookie-"]',
    '[class^="hs-en-cookie-"]',

    //I Have Cookies
    '[id*="gdpr-cookie-accept"]',
    '[class*="gdpr-cookie-accept"]',

    //IQIT commerce
    '[id*="iqitcookielaw"]',
    '[class*="iqitcookielaw"]',

    //IdoSell
    '[id*="iai_cookie"]',
    '[class*="iai_cookie"]',

    //InMobi
    '[id*="qc-cmp2-ui"]',
    '[class*="qc-cmp2-ui"]',

    //Jimdo
    '[id*="cookie-settings-necessary"]',
    '[class*="cookie-settings-necessary"]',

    //Klaro
    '[id*="id-cookie-notice"]',
    '[class*="id-cookie-notice"]',

    //Moove (prefix)
    '[id^="moove-gdpr"]',
    '[class^="moove-gdpr"]',

    //Mozello CookieBar
    '[id*="cookie-notification-text"]',
    '[class*="cookie-notification-text"]',

    //OneTrust
    '[id*="onetrust"]',
    '[class*="onetrust"]', 
    '[id*="ot-sdk-container"]',
    '[class*="ot-sdk-container"]',
    '[class*="optanon"]',
    '[id*="optanon"]',
    
    //Osano
    '[id*="cc-window"]',
    '[class*="cc-window"]',
    '[id*="cc_container"]',
    '[class*="cc_container"]',
    '[id*="osano"]',
    '[class*="osano"]',
    '[class*="cookieconsent\\:desc"]',
    '[id*="cookieconsent\\:desc"]',

    //Piwik (prefix)
    '[id^="ppms_cm"]',
    '[class^="ppms_cm"]',

    //Serviceform
    '[id*="sf-cookie-settings"]',
    '[class*="sf-cookie-settings"]',

    //Shoper
    '[id*="consents__advanced-buttons"]',
    '[class*="consents__advanced-buttons"]',

    //Shopify
    '[id*="shopify-pc__banner"]',
    '[class*="shopify-pc__banner"]',

    //Shoprenter
    '[id*="nanobar-buttons"]',
    '[class*="nanobar-buttons"]',

    //Shoptet
    '[id*="siteCookies"]',
    '[class*="siteCookies"]',

    //Shopware (Em-Dash!)
    '[id*="page-wrap–cookie-permission"]',
    '[class*="page-wrap–cookie-permission"]',
    '[id*="cookie-permission–container"]',
    '[class*="cookie-permission–container"]',
    '[id*="cookie-consent–header"]',
    '[class*="cookie-consent–header"]',

    //Sourcepoint
    '[id*="sp_message_container"]',
    '[class*="sp_message_container"]',

    //Squarespace
    '[id*="sqs-cookie-banner-v2-cta"]',
    '[class*="sqs-cookie-banner-v2-cta"]',

    //Termly
    '[id*="termly"]',
    '[class*="termly"]',

    //TermsFeed
    '[id*="cc_div"]',
    '[class*="cc_div"]',
    '[id*="cc-nb-text"]',
    '[class*="cc-nb-text"]',

    //TrustArc (prefix)
    '[id^="truste"]',
    '[class^="truste"]',

    //Unidentified CMPs
    '[id*="ct-ultimate-gdpr-"]',
    '[class*="ct-ultimate-gdpr-"]',
    '[id*="w-cookie-modal"]',
    '[class*="w-cookie-modal"]',
    '[id*="bemCookieOverlay"]',
    '[class*="bemCookieOverlay"]',
    '[id*="consents__wrapper"]',
    '[class*="consents__wrapper"]',
    '[id^="cookie-policy-overlay"]',
    '[class^="cookie-policy-overlay"]',
    '[id^="cookie-policy-details"]',
    '[class^="cookie-policy-details"]',
    '[id*="lgcookieslaw"]',
    '[class*="lgcookieslaw"]',
    '[id*="module-notification-137"]',
    '[class*="module-notification-137"]',
    '[id*="cookieNoticeContent"]',
    '[class*="cookieNoticeContent"]',
    // Unidentified CMP 006 (ends with "popup-text" --> generic, which could lead to false positives)
    '[id$="popup-text"]',
    '[class$="popup-text"]',

    //Usercentrics
    '[id*="cNkVwm"]',
    '[class*="cNkVwm"]',
    '[id*="CybotCookiebot"]',
    '[class*="CybotCookiebot"]',
    '[id^="usercentrics"]',
    '[class^="usercentrics"]',
    '[id^="uc-"]',
    '[class^="uc-"]',

    //Wix
    '[id*="ccsu-banner-text-container"]',
    '[class*="ccsu-banner-text-container"]',
    '[id*="consent-banner-root-container"]',
    '[class*="consent-banner-root-container"]',

    //WordPress Themes
    '[id*="fusion-privacy-bar"]',
    '[class*="fusion-privacy-bar"]',
    '[id*="avia-cookie-"]',
    '[class*="avia-cookie-"]',
    '[id*="flatsome-cookies"]',
    '[class*="flatsome-cookies"]',
    '[id*="wd-cookies-inner"]',
    '[class*="wd-cookies-inner"]',

    //consentmanager.net
    '[id*="cmpwelcomebtnsave"]',
    '[class*="cmpwelcomebtnsave"]',
    '[id*="cmpbox"]',
    '[class*="cmpbox"]',

    //idnovate
    '[id^="cookiesplus"]',
    '[class^="cookiesplus"]',

    //iubenda
    '[id*="iubenda"]',
    '[class*="iubenda"]',

    //jQuery EU Cookie Law
    '[id*="eupopup-body"]',
    '[class*="eupopup-body"]',

    //tarteaucitron
    '[id*="tarteaucitron"]',
    '[class*="tarteaucitron"]',

];

module.exports = CMP_SELECTORS;