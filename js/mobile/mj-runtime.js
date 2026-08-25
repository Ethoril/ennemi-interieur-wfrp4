import { deleteApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    arrayRemove, collection, deleteField, doc, documentId, getDoc, getDocs, initializeFirestore,
    memoryLocalCache, onSnapshot, query, runTransaction, serverTimestamp, terminate, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage as getFirebaseStorage, ref, getBlob } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import { APP_CHECK_SITE_KEY, shouldInitializeAppCheck } from '../app-check.js';
import { FIREBASE_CONFIG, ADMIN_EMAIL } from '../firebase-config.js';
import { createMjSessionComposition } from './mj-composition.js';

const sdk = Object.freeze({
    getApps, initializeApp, getAuth, getRedirectResult, onAuthStateChanged,
    signInWithPopup, signInWithRedirect, signOut, GoogleAuthProvider, initializeFirestore, memoryLocalCache,
    getStorage: getFirebaseStorage, terminate, deleteApp, arrayRemove, collection, deleteField, doc,
    documentId, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch, onSnapshot,
    ref, getBlob, getFunctions, httpsCallable,
});

const appCheckApps = new WeakSet();

function initializeNamedAppCheck(app) {
    if (appCheckApps.has(app) || !shouldInitializeAppCheck(globalThis.location?.hostname)) return;
    initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
    });
    appCheckApps.add(app);
}

export function createDefaultMjSession(options = {}) {
    const apps = sdk.getApps();
    const existing = apps.find(candidate => candidate.name === 'mobile-mj');
    const app = existing || sdk.initializeApp(FIREBASE_CONFIG, 'mobile-mj');
    initializeNamedAppCheck(app);
    const auth = sdk.getAuth(app);
    const disposeAuthApp = async () => {
        if (!existing) {
            try { if (auth.currentUser) await sdk.signOut(auth); } catch { /* Fermeture best-effort. */ }
            try { await sdk.deleteApp(app); } catch { /* Une app externe ne doit jamais être supprimée. */ }
        }
    };
    return createMjSessionComposition({
        sdk: { ...sdk, auth },
        config: FIREBASE_CONFIG,
        options: { adminEmail: ADMIN_EMAIL, dispose: disposeAuthApp, ...options },
    });
}
