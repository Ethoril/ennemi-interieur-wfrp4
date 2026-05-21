import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyD5W5U2fyXkiPzUzOOgAGusoiXn2iZbp5U',
    authDomain:        'campagne-wrpg.firebaseapp.com',
    projectId:         'campagne-wrpg',
    storageBucket:     'campagne-wrpg.firebasestorage.app',
    messagingSenderId: '1097155283992',
    appId:             '1:1097155283992:web:27976b947ea8bc5b87476d',
};

export const ADMIN_EMAIL = 'ethoril@gmail.com';

export const app     = initializeApp(FIREBASE_CONFIG);
export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
