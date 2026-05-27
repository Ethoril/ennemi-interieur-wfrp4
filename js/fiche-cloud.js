import { auth, db } from './firebase-init.js';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, setDoc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

/* ── Configuration Personnage et Accès ─────────────────────────── */
const urlParams = new URLSearchParams(window.location.search);
const charId = urlParams.get('char');

if (!charId) {
    alert("Aucun personnage spécifié. Redirection vers le groupe...");
    window.location.href = "groupe.html";
}

const GM_EMAIL = 'ethoril@gmail.com';
const CHAR_OWNERS = {
    bhelgi: [],
    caelel: [],
    elysia: [],
    hellaya: [],
    wren: [],
    test: []
};

function isUserAuthorized(user, charId) {
    if (!user || !user.email) return false;
    if (user.email === GM_EMAIL) return true;
    const owners = CHAR_OWNERS[charId] || [];
    return owners.includes(user.email);
}

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
    if (!user) return;
    if (!isUserAuthorized(user, charId)) return;
    if (_isSaving) return;
    _isSaving = true;
    setStatus('Sauvegarde…', 'saving');
    try {
        await setDoc(doc(db, 'fiches', charId), { data, updatedAt: serverTimestamp() });
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

    if (user) {
        if (!isUserAuthorized(user, charId)) {
            // Utilisateur connecté mais sans accès
            bar.innerHTML = `
                <span class="fiche-auth-user">☁ ${user.displayName || user.email}</span>
                <button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
            document.getElementById('btn-cloud-signout')
                ?.addEventListener('click', () => signOut(auth));
            
            showLoginWall("Vous n'avez pas l'autorisation d'accéder à la fiche de " + charId + ".");
            return;
        }

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
            const snap = await getDoc(doc(db, 'fiches', charId));
            if (snap.exists() && typeof window.ficheLoadCloud === 'function') {
                const snapData   = snap.data();
                const cloudMillis = snapData.updatedAt?.toMillis?.() ?? 0;
                window.ficheLoadCloud(snapData.data, cloudMillis);
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

    } else {
        // ── Non connecté ──
        bar.innerHTML = `
            <button class="fiche-auth-btn" id="btn-cloud-signin">☁ Connexion Google</button>`;
        bindSignIn('btn-cloud-signin');
        bindSignIn('btn-login-wall');
        showLoginWall('Connexion requise pour accéder à la fiche.');
    }
});
