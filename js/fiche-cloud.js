import { initializeApp }                                           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider,
         onAuthStateChanged, signOut }                             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, serverTimestamp }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Config ────────────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyD5W5U2fyXkiPzUzOOgAGusoiXn2iZbp5U',
    authDomain:        'campagne-wrpg.firebaseapp.com',
    projectId:         'campagne-wrpg',
    storageBucket:     'campagne-wrpg.firebasestorage.app',
    messagingSenderId: '1097155283992',
    appId:             '1:1097155283992:web:27976b947ea8bc5b87476d',
};

const ALLOWED_EMAIL = 'ethoril@gmail.com';

const app  = initializeApp(FIREBASE_CONFIG, 'fiche');
const auth = getAuth(app);
const db   = getFirestore(app);

/* ── Indicateur de statut ──────────────────────────────────────── */
function setStatus(msg, cls = '') {
    const el = document.getElementById('fiche-cloud-status');
    if (!el) return;
    el.textContent = msg;
    el.dataset.state = cls;
}

/* ── Sauvegarde cloud (appelée depuis fiche.js via window.cloudSave) */
let _isSaving = false;
window.cloudSave = async (data) => {
    const user = auth.currentUser;
    if (!user || user.email !== ALLOWED_EMAIL) return;
    if (_isSaving) return;
    _isSaving = true;
    setStatus('Sauvegarde…', 'saving');
    try {
        await setDoc(doc(db, 'fiches', user.uid), { data, updatedAt: serverTimestamp() });
        setStatus('☁ Sauvegardé', 'saved');
        setTimeout(() => setStatus(''), 3000);
    } catch (e) {
        setStatus('⚠ Erreur', 'error');
        console.error('[fiche-cloud] save error:', e);
    } finally {
        _isSaving = false;
    }
};

/* ── Helpers visibilité ────────────────────────────────────────── */
function showFiche() {
    document.getElementById('fiche-login-wall').style.display    = 'none';
    document.getElementById('fiche-content-section').style.display = '';
}

function showLoginWall(msg = '') {
    document.getElementById('fiche-content-section').style.display = 'none';
    document.getElementById('fiche-login-wall').style.display      = '';
    const msgEl = document.querySelector('.fiche-login-msg');
    if (msgEl && msg) msgEl.textContent = msg;
}

function bindSignIn(btnId) {
    document.getElementById(btnId)?.addEventListener('click', () => {
        signInWithPopup(auth, new GoogleAuthProvider()).catch(e => {
            if (e.code !== 'auth/popup-closed-by-user')
                alert('Connexion impossible : ' + e.message);
        });
    });
}

/* ── Auth state ────────────────────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
    const bar = document.getElementById('fiche-auth-bar');
    if (!bar) return;

    if (user && user.email === ALLOWED_EMAIL) {
        // ── Connecté et autorisé ──
        bar.innerHTML = `
            <span class="fiche-auth-user">☁ ${user.displayName || user.email}</span>
            <span class="fiche-cloud-status" id="fiche-cloud-status"></span>
            <button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
        document.getElementById('btn-cloud-signout')
            ?.addEventListener('click', () => signOut(auth));

        // Charger la fiche depuis Firestore, puis révéler le contenu
        setStatus('Chargement…', 'saving');
        try {
            const snap = await getDoc(doc(db, 'fiches', user.uid));
            if (snap.exists() && typeof window.ficheLoadCloud === 'function') {
                window.ficheLoadCloud(snap.data().data);
                setStatus('☁ Chargé', 'saved');
                setTimeout(() => setStatus(''), 2000);
            } else {
                setStatus('');
            }
        } catch (e) {
            setStatus('⚠ Erreur de chargement', 'error');
            console.error('[fiche-cloud] load error:', e);
        }
        showFiche();

    } else if (user) {
        // ── Connecté mais non autorisé ──
        bar.innerHTML = `
            <span class="fiche-auth-user warn">⚠ ${user.email} — compte non autorisé</span>
            <button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
        document.getElementById('btn-cloud-signout')
            ?.addEventListener('click', () => signOut(auth));
        showLoginWall(`Compte ${user.email} non autorisé. Contactez le MJ.`);

    } else {
        // ── Non connecté ──
        bar.innerHTML = `
            <button class="fiche-auth-btn" id="btn-cloud-signin">☁ Connexion Google</button>`;
        bindSignIn('btn-cloud-signin');
        bindSignIn('btn-login-wall');
        showLoginWall('Connexion requise pour accéder à la fiche.');
    }
});
