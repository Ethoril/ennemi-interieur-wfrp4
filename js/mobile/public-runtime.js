import { getApps, initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, enableNetwork, enableMultiTabIndexedDbPersistence, terminate, collection, doc, query, where, documentId, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { FIREBASE_CONFIG } from '../firebase-config.js';
import { createPublicSessionComposition } from './public-composition.js';

const firestoreSdk = Object.freeze({
    getApps, initializeApp, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    memoryLocalCache, enableNetwork, enableMultiTabIndexedDbPersistence, getStorage, terminate, deleteApp,
    collection, doc, query, where, documentId, onSnapshot,
});

export function createDefaultPublicSession(options = {}) {
    return createPublicSessionComposition({
        sdk: firestoreSdk,
        config: FIREBASE_CONFIG,
        options,
    });
}
