import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getFunctions }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import { APP_CHECK_SITE_KEY, shouldInitializeAppCheck } from './app-check.js';
import { ADMIN_EMAIL, FIREBASE_CONFIG, FIREBASE_FUNCTIONS_REGION } from './firebase-config.js';

export { ADMIN_EMAIL, FIREBASE_CONFIG };

// getApps évite qu’un double import réinitialise l’application par défaut pendant le développement.
const existingApp = getApps().find(candidate => candidate.name === '[DEFAULT]');
if (existingApp && !Object.entries(FIREBASE_CONFIG).every(([key, value]) => existingApp.options?.[key] === value)) {
    throw new Error('Configuration Firebase par défaut déjà initialisée avec une autre cible.');
}
export const app = existingApp ?? initializeApp(FIREBASE_CONFIG);
export const appCheck = shouldInitializeAppCheck(globalThis.location?.hostname)
    ? initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
    })
    : null;
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, FIREBASE_FUNCTIONS_REGION);
