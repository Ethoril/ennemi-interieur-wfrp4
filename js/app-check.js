// App Check est activé uniquement sur l'origine de production.
// Aucun jeton de debug ne doit être ajouté au dépôt public.
export const APP_CHECK_PRODUCTION_HOST = 'ethoril.github.io';
export const APP_CHECK_SITE_KEY = '6Lfx25YtAAAAAAkRJrYSQsH6rdE1buedQzw0xTXb';

export function shouldInitializeAppCheck(hostname) {
    return hostname === APP_CHECK_PRODUCTION_HOST;
}
