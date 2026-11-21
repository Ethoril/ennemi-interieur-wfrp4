import {
    GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    arrayRemove, clearIndexedDbPersistence, collection, deleteField, doc, documentId, getDoc, getDocs,
    onSnapshot, query, runTransaction, serverTimestamp, terminate, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, getBlob } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
    app, auth, db, storage, functions, isDefaultFirestorePersisted, markDefaultFirestorePersisted,
} from '../firebase-init.js';
import { createBureauClient } from '../data/firebase-clients.js';
import { FIREBASE_CONFIG, ADMIN_EMAIL } from '../firebase-config.js';
import { createMjSessionComposition, DEFAULT_BUILDERS } from './mj-composition.js';

async function signOutSharedAuth(targetAuth = auth) {
    await signOut(targetAuth);
    if (isDefaultFirestorePersisted()) {
        markDefaultFirestorePersisted(false);
        try { await terminate(db); } catch { /* nettoyage best-effort */ }
        try { await clearIndexedDbPersistence(db); } catch { /* nettoyage best-effort */ }
        globalThis.location?.reload?.();
    }
}

const sdk = Object.freeze({
    getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect,
    signOut: signOutSharedAuth, GoogleAuthProvider, arrayRemove, collection, deleteField, doc,
    documentId, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch, onSnapshot,
    ref, getBlob, httpsCallable,
});

async function createSharedMjClient({ sdk: clientSdk } = {}) {
    if (isDefaultFirestorePersisted()) {
        markDefaultFirestorePersisted(false);
        try { await terminate(db); } catch { /* nettoyage best-effort */ }
        try { await clearIndexedDbPersistence(db); } catch { /* nettoyage best-effort */ }
        globalThis.location?.reload?.();
        throw Object.assign(new Error('rechargement pour garantir un Firestore MJ en mémoire'), { code: 'auth/cancelled' });
    }
    const base = createBureauClient({ sdk: clientSdk, app, auth, db, storage, functions });
    return Object.freeze({
        ...base,
        mode: 'mobile-mj',
        appName: app.name,
        cache: Object.freeze({ mode: 'memory', persistent: false, fallback: false }),
    });
}

export function createDefaultMjSession(options = {}) {
    // La session MJ partage l'app Firebase par défaut ([DEFAULT]) avec Fiches,
    // Enquêtes, Contributions et le bureau : une seule connexion Google suffit
    // sur tout le site, et l'arrêt du cycle de vie (pagehide) ferme uniquement
    // les abonnements/caches mémoire sans jamais déconnecter Firebase Auth.
    return createMjSessionComposition({
        sdk: { ...sdk, auth },
        config: FIREBASE_CONFIG,
        builders: { ...DEFAULT_BUILDERS, client: createSharedMjClient },
        options: { adminEmail: ADMIN_EMAIL, ...options },
    });
}
