import { db } from './firebase-init.js';
import { auth, watchAuth, loginWithGoogle, logout } from './auth.js';
import { doc, setDoc, getDoc, serverTimestamp, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ficheLoadCloud, exportData, markCloudSaved } from './fiche.js';
import { esc } from './utils.js';

/* ── Configuration Personnage et Accès ─────────────────────────── */
const CHAR_IDS = ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren', 'test'];
const urlParams = new URLSearchParams(window.location.search);
const charId = urlParams.get('char');

if (!charId || !CHAR_IDS.includes(charId)) {
    alert("Aucun personnage valide spécifié. Redirection vers le groupe…");
    window.location.href = 'groupe.html';
    throw new Error('charId invalide');   // stoppe l'évaluation du module
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
let _enAttente = null;

export const cloudSave = async (data) => {
    const user = auth.currentUser;
    if (!user) return;

    // Une écriture est en vol : mémoriser la demande au lieu de la jeter. Seule la
    // dernière image de l'état compte, d'où l'écrasement. L'ancienne garde
    // abandonnait silencieusement toute modification arrivant dans cette fenêtre.
    if (_isSaving) { _enAttente = data; return; }

    _isSaving = true;
    setStatus('Sauvegarde…', 'saving');
    try {
        await setDoc(doc(db, 'fiches', charId), { data, updatedAt: serverTimestamp() });
        markCloudSaved();            // lève `_dirty` sur la copie locale
        setStatus('☁ Sauvegardé', 'saved');
        setTimeout(() => setStatus(''), 3000);
    } catch (e) {
        // Un refus n'est plus silencieux : la lecture peut réussir et l'écriture
        // échouer, et le joueur n'avait alors aucun retour — il croyait avoir
        // enregistré. C'est ce qui a masqué la perte de données du 17 août 2026.
        if (e.code === 'permission-denied') {
            setStatus('⚠ Non enregistré — droits insuffisants', 'error');
        } else {
            setStatus('⚠ Non enregistré', 'error');
        }
        console.error('[fiche-cloud] save error:', e);
    } finally {
        _isSaving = false;
        if (_enAttente) {
            const suivant = _enAttente;
            _enAttente = null;
            cloudSave(suivant);
        }
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
        loginWithGoogle().catch(e => {
            if (e.code !== 'auth/popup-closed-by-user')
                alert('Connexion impossible : ' + e.message);
        });
    });
}

/* ── Auth state ────────────────────────────────────────────────── */
watchAuth(async (user, isAdmin) => {
    const bar = document.getElementById('fiche-auth-bar');
    if (!bar) return;

    if (!user) {
        // ── Non connecté ──
        bar.innerHTML = `
            <button class="fiche-auth-btn" id="btn-cloud-signin">☁ Connexion Google</button>`;
        bindSignIn('btn-cloud-signin');
        bindSignIn('btn-login-wall');
        showLoginWall('Connexion requise pour accéder à la fiche.');
        return;
    }

    // L'autorisation est tranchée par les règles Firestore, qui lisent
    // campagne/acces côté serveur : le navigateur ne voit jamais les adresses
    // des joueurs. Un refus se manifeste par une erreur permission-denied.
    showLoginWall('Vérification des accès…');

    let snap;
    try {
        snap = await getDoc(doc(db, 'fiches', charId));
    } catch (e) {
        if (e.code === 'permission-denied') {
            bar.innerHTML = `
                <span class="fiche-auth-user">☁ ${esc(user.displayName || user.email)}</span>
                <button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
            document.getElementById('btn-cloud-signout')
                ?.addEventListener('click', () => logout());
            showLoginWall("Vous n'avez pas l'autorisation d'accéder à cette fiche.");
            return;
        }
        setStatus('⚠ Erreur de chargement', 'error');
        console.error('[fiche-cloud] load error:', e);
        showLoginWall('Chargement impossible. Réessayez plus tard.');
        return;
    }

    // ── Connecté et autorisé ──
    let resetButtonHtml = '';
    if (isAdmin) {
        resetButtonHtml = `<button class="fiche-auth-btn" id="btn-cloud-reset" style="background-color: var(--color-danger); color: white; border-color: darkred; margin-right: 10px;">🗑️ Reset Fiche</button>`;
    }

    bar.innerHTML = `
        <span class="fiche-auth-user">☁ ${esc(user.displayName || user.email)}</span>
        <span class="fiche-cloud-status" id="fiche-cloud-status"></span>
        ${resetButtonHtml}
        <button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
    document.getElementById('btn-cloud-signout')
        ?.addEventListener('click', () => logout());

    const btnReset = document.getElementById('btn-cloud-reset');
    if (btnReset) {
        btnReset.addEventListener('click', async () => {
            const conf1 = confirm("ATTENTION : Vous êtes sur le point de supprimer TOUTES les données de cette fiche. Continuer ?");
            if (conf1) {
                const conf2 = confirm("Êtes-vous VRAIMENT sûr ? Cette action est irréversible !");
                if (conf2) {
                    try {
                        await deleteDoc(doc(db, 'fiches', charId));
                        localStorage.removeItem('wfrp4-fiche-' + charId);
                        localStorage.removeItem('wfrp4-fiche-test'); // Nettoyage ancienne clé générique
                        alert("Fiche réinitialisée avec succès ! La page va se recharger.");
                        window.location.reload();
                    } catch (e) {
                        alert("Erreur lors de la réinitialisation : " + e.message);
                    }
                }
            }
        });
    }

    // Si snap.exists(), charger les données du cloud, puis showFiche()
    if (snap.exists() && typeof ficheLoadCloud === 'function') {
        const snapData    = snap.data();
        const cloudMillis = snapData.updatedAt?.toMillis?.() ?? 0;
        ficheLoadCloud(snapData.data, cloudMillis);
        setStatus('☁ Chargé', 'saved');
        setTimeout(() => setStatus(''), 2000);
    } else {
        setStatus('');
    }
    showFiche();
});

