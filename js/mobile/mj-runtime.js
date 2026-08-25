import { deleteApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    arrayRemove, collection, deleteField, doc, documentId, getDoc, getDocs, initializeFirestore,
    memoryLocalCache, onSnapshot, query, runTransaction, serverTimestamp, terminate, where, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage as getFirebaseStorage, ref, getBlob, uploadBytes, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { FIREBASE_CONFIG, ADMIN_EMAIL } from '../firebase-config.js';
import { createMjSessionComposition } from './mj-composition.js';

const sdk = Object.freeze({
    getApps, initializeApp, getAuth, getRedirectResult, onAuthStateChanged,
    signInWithPopup, signInWithRedirect, signOut, GoogleAuthProvider, initializeFirestore, memoryLocalCache,
    getStorage: getFirebaseStorage, terminate, deleteApp, arrayRemove, collection, deleteField, doc,
    documentId, getDoc, getDocs, query, runTransaction, serverTimestamp, where, writeBatch, onSnapshot,
    ref, getBlob, uploadBytes, deleteObject,
});

export function createDefaultMjSession(options = {}) {
    const apps = sdk.getApps();
    const existing = apps.find(candidate => candidate.name === 'mobile-mj');
    const app = existing || sdk.initializeApp(FIREBASE_CONFIG, 'mobile-mj');
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
