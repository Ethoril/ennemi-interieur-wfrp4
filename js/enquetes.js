import { db, storage } from './firebase-init.js';
import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { collection, getDocs, deleteDoc, doc, query, where, serverTimestamp, deleteField, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { esc, stripAccents } from './utils.js';
import { confirmAction } from './ui-confirm.js';
import { visiblePourJoueurs } from './visibility.js';
import { createProtectedImageScope } from './protected-images.js';
import { uploadProtectedImage } from './protected-upload.js';
import { forgetProtectedUpload, rememberProtectedUpload } from './protected-upload-journal.js';
import { recoverPendingProtectedUploads } from './protected-upload-recovery.js';
import { cleanupUnreferencedImage } from './image-lifecycle.js';
import { safeStorageReference } from './storage-reference.js';

function clueImagePlaceholder(clue) {
    if (!clue.imagePath) return '';
    return `<div class="clue-image-placeholder" role="status">${clue.imageState === 'access-denied' ? 'Image protégée inaccessible' : 'Image indisponible'}</div>`;
}

// ── State ──────────────────────────────────────────────────────
const state = {
    isAdmin: false,
    clues: [],
    pnjs: [],
    searchQ: '',
    filter: 'all', // 'all', 'discovered', 'hidden'
    editingId: null
};

let currentLoadId = 0;
let editorSession = 0;
let authSessionKey = '';
const imageScope = createProtectedImageScope(storage);
let localPreviewUrl = null;
window.addEventListener('pagehide', () => imageScope.invalidate());

// ── Auth Monitoring ────────────────────────────────────────────
watchAuth((user, isAdmin) => {
    const roleChanged = state.isAdmin !== isAdmin;
    const nextAuthSessionKey = user?.uid || '';
    const identityChanged = authSessionKey !== nextAuthSessionKey;
    authSessionKey = nextAuthSessionKey;
    state.isAdmin = isAdmin;
    if (isAdmin) void recoverPendingProtectedUploads(db, storage);
    document.getElementById('auth-btn').textContent = state.isAdmin ? '🔓 Déconnexion' : '🔑 Admin';
    document.getElementById('add-clue-btn').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('filter-group').style.display = state.isAdmin ? 'flex' : 'none';
    document.getElementById('admin-sep').style.display = state.isAdmin ? '' : 'none';
    if (roleChanged || identityChanged) {
        // Un changement d’identité invalide les lectures et vide la fenêtre immédiatement.
        editorSession += 1;
        currentLoadId += 1;
        imageScope.invalidate();
        closeClueModal();
    }
    if ((roleChanged || identityChanged) && !state.isAdmin) {
        // Déconnexion : retirer les indices MJ avant tout chargement public.
        state.pnjs = [];
        state.clues = [];
        renderClues();
    }
    
    loadData();
});

// ── Auth Button Click ──────────────────────────────────────────
document.getElementById('auth-btn').addEventListener('click', async () => {
    if (state.isAdmin) {
        await logout();
    } else {
        try { 
            await loginWithGoogle(); 
        } catch (e) { 
            if (e.code !== 'auth/popup-closed-by-user') {
                alert('Connexion impossible : ' + e.message); 
            }
        }
    }
});

// ── Data Fetching ──────────────────────────────────────────────
async function loadData() {
    const loadId = ++currentLoadId;
    try {
        if (state.isAdmin) void recoverPendingProtectedUploads(db, storage);
        clearLocalPreview();
        const imageGeneration = imageScope.beginGeneration();
        const container = document.getElementById('clues-container');
        if (container) {
            container.innerHTML = `
                <div id="clues-loading" class="pnj-loading">
                    <div class="pnj-spinner"></div>
                    <span class="loading-text">Chargement du grimoire d'enquêtes...</span>
                </div>`;
        }

        // 1. Fetch PNJs list
        const pnjQuery = state.isAdmin
            ? collection(db, 'pnjs')
            : query(collection(db, 'pnjs'), where('visibleJoueurs', '==', true));
        const pnjSnap = await getDocs(pnjQuery);
        if (loadId !== currentLoadId) return;
        const loadedPnjs = pnjSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // La règle filtre côté serveur ; cette garde évite aussi qu'un cache ancien expose un
        // PNJ masqué dans les liens d'un indice.
        state.pnjs = (state.isAdmin ? loadedPnjs : loadedPnjs.filter(visiblePourJoueurs).map(toPublicPnj))
            .sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));

        // 2. Fetch Clues based on auth state
        // Note : la contrainte decouvert == true est requise par la règle Firestore
        // pour les non-MJ ; ne pas la retirer sous peine de refus d'autorisation.
        let cluesSnap;
        if (state.isAdmin) {
            cluesSnap = await getDocs(collection(db, 'indices'));
        } else {
            cluesSnap = await getDocs(query(collection(db, 'indices'), where('decouvert', '==', true)));
        }
        if (loadId !== currentLoadId) return;
        state.clues = cluesSnap.docs.map(d => ({ id: d.id, ...d.data(), legacyImageUrl: d.data().imageUrl || '' }));
        await Promise.all(state.clues.map(async clue => {
            if (!clue.imagePath) {
                clue.imageState = clue.imageUrl ? 'legacy' : 'missing';
                clue.imageError = null;
                return;
            }
            const result = await imageScope.load(clue.imagePath, imageGeneration);
            clue.imageState = result.url ? 'ready' : (['storage/unauthorized', 'storage/unauthenticated'].includes(result.error?.code) ? 'access-denied' : 'missing');
            clue.imageError = result.error?.code || null;
            if (result.url) clue.imageUrl = result.url;
            else clue.imageUrl = '';
        }));
        if (loadId !== currentLoadId) return;

        // 3. Render
        renderClues();

        // 4. Fill form checkboxes
        populatePnjsCheckboxGrid();

        // 5. Highlight clue if requested in URL
        highlightClueFromUrl();

    } catch (e) {
        if (loadId !== currentLoadId) return;
        console.error("Erreur lors du chargement des données :", e);
        const container = document.getElementById('clues-container');
        if (container) {
            container.innerHTML = `
                <div class="pnj-loading">
                    <span class="loading-text">${e?.code === 'permission-denied'
                        ? 'Accès refusé : certaines données ne sont pas visibles pour ce compte.'
                        : 'Impossible de charger le grimoire d’enquêtes. Réessayez dans un instant.'}</span>
                </div>`;
        }
    }
}

function toPublicPnj(pnj) {
    return Object.fromEntries(['id', 'nom', 'statut', 'vivant', 'lieu', 'groupe', 'description',
        'imagePath', 'imageUrl', 'visibleJoueurs', 'createdAt', 'updatedAt', 'ordre']
        .filter(key => Object.hasOwn(pnj, key)).map(key => [key, pnj[key]]));
}

// ── Populate PNJ checkbox grid in form ──────────────────────────
function populatePnjsCheckboxGrid() {
    const grid = document.getElementById('f-pnjs-grid');
    if (!grid) return;
    grid.innerHTML = state.pnjs.map(p => `
        <label class="pnjs-checkbox-label" title="${esc(p.nom)}">
            <input type="checkbox" name="pnjsLies" value="${esc(p.id)}">
            <span>${esc(p.nom)}</span>
        </label>
    `).join('');
}

// ── Render Clues ────────────────────────────────────────────────
function renderClues() {
    const container = document.getElementById('clues-container');
    if (!container) return;

    const searchVal = stripAccents(state.searchQ.toLowerCase());
    const filtered = state.clues.filter(c => {
        // Filtre de recherche.
        if (searchVal) {
            const inTitle = stripAccents((c.titre || '').toLowerCase()).includes(searchVal);
            const inDesc = stripAccents((c.description || '').toLowerCase()).includes(searchVal);
            if (!inTitle && !inDesc) return false;
        }

        // Filtre du statut MJ.
        if (state.isAdmin) {
            if (state.filter === 'discovered' && !c.decouvert) return false;
            if (state.filter === 'hidden' && c.decouvert) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div id="pnj-empty" class="pnj-loading" style="position:static; opacity:1; grid-column:1/-1; display:flex; flex-direction:column; align-items:center; width:100%; border:none; background:none; padding:var(--space-2xl) 0;">
                <p>Aucun indice trouvé.</p>
                ${state.isAdmin ? '<span class="pnj-empty-hint">Créez un nouvel indice à l\'aide du bouton ＋ Indice.</span>' : ''}
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const isDecouvert = !!c.decouvert;
        const statusBadge = state.isAdmin ? `
            <span class="pnj-badge ${isDecouvert ? 'vivant-oui' : 'vivant-non'} clue-badge-status">
                ${isDecouvert ? 'Découvert' : 'Secret'}
            </span>` : '';

        const editBtn = state.isAdmin ? `
            <button class="clue-edit-btn" data-id="${esc(c.id)}" title="Modifier l'indice">✏️</button>
        ` : '';

        const imageHtml = c.imageUrl ? `
            <div class="clue-image-container">
                <img src="${esc(c.imageUrl)}" class="clue-image" alt="${esc(c.titre)}" loading="lazy">
            </div>` : (c.imagePath ? `<div class="clue-image-container">${clueImagePlaceholder(c)}</div>` : '');

        // Génération des pastilles PNJ.
        const linkedPnjIds = c.pnjsLies || [];
        const linkedPnjs = linkedPnjIds.map(id => state.pnjs.find(p => p.id === id)).filter(Boolean);
        const pnjsSection = linkedPnjs.length > 0 ? `
            <div class="clue-pnjs-section">
                <span class="clue-pnjs-title">Personnages concernés</span>
                <div class="clue-pnjs-list">
                    ${linkedPnjs.map(p => `
                        <a href="pnjs.html?id=${esc(p.id)}" class="clue-pnj-chip">👤 ${esc(p.nom)}</a>
                    `).join('')}
                </div>
            </div>` : '';

        return `
            <div class="clue-card ${!isDecouvert ? 'clue-hidden' : ''}" id="clue-card-${esc(c.id)}">
                <div class="clue-header">
                    <div>
                        <h3 class="clue-title">${esc(c.titre)}</h3>
                        ${statusBadge}
                    </div>
                    ${editBtn}
                </div>
                ${imageHtml}
                <p class="clue-description">${esc(c.description).replace(/\n/g, '<br>')}</p>
                ${pnjsSection}
            </div>`;
    }).join('');

    // Branche les boutons d’édition.
    container.querySelectorAll('.clue-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            openClueModal(btn.dataset.id);
        });
    });
}

// ── Highlight clue from URL param ──────────────────────────────
function highlightClueFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const clueId = urlParams.get('id') || urlParams.get('clue');
    if (clueId) {
        setTimeout(() => {
            const card = document.getElementById(`clue-card-${clueId}`);
            if (card) {
                card.classList.add('highlighted');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
}

// ── CRUD Modals ────────────────────────────────────────────────
function openClueModal(clueId = null) {
    editorSession += 1;
    clearLocalPreview();
    state.editingId = clueId;
    document.getElementById('clue-form').reset();
    document.getElementById('f-image-preview').innerHTML = '';
    document.getElementById('f-image-preview').dataset.existingUrl = '';
    document.getElementById('f-image-preview').dataset.existingPath = '';
    document.getElementById('f-image-preview').dataset.existingLegacyUrl = '';
    document.getElementById('clue-modal-title').textContent = clueId ? "Modifier l'indice" : "Nouvel indice";
    document.getElementById('clue-delete-btn').style.display = clueId ? '' : 'none';

    // Réinitialise les cases à cocher.
    const checkboxes = document.querySelectorAll('#f-pnjs-grid input[name="pnjsLies"]');
    checkboxes.forEach(cb => cb.checked = false);

    if (clueId) {
        const c = state.clues.find(cl => cl.id === clueId);
        if (c) {
            document.getElementById('f-titre').value = c.titre || '';
            document.getElementById('f-description').value = c.description || '';
            document.getElementById('f-decouvert').value = String(!!c.decouvert);
            if (c.imageUrl) {
                document.getElementById('f-image-preview').innerHTML = `<img src="${esc(c.imageUrl)}" alt="Illustration" style="max-height: 100px; border-radius: 4px;">`;
                document.getElementById('f-image-preview').dataset.existingUrl = c.imageUrl;
            }
            document.getElementById('f-image-preview').dataset.existingPath = c.imagePath || '';
            document.getElementById('f-image-preview').dataset.existingLegacyUrl = c.legacyImageUrl || (!c.imagePath ? (c.imageUrl || '') : '');
            const lies = c.pnjsLies || [];
            checkboxes.forEach(cb => {
                if (lies.includes(cb.value)) {
                    cb.checked = true;
                }
            });
        }
    }
    document.getElementById('clue-modal').style.display = 'flex';
}

function closeClueModal() {
    editorSession += 1;
    clearLocalPreview();
    document.getElementById('clue-modal').style.display = 'none';
    document.getElementById('clue-form').reset();
    document.getElementById('f-image-preview').innerHTML = '';
    document.getElementById('f-image-preview').dataset.existingUrl = '';
    document.getElementById('f-image-preview').dataset.existingPath = '';
    document.getElementById('f-image-preview').dataset.existingLegacyUrl = '';
    document.getElementById('f-image').value = '';
    state.editingId = null;
}

function clearLocalPreview() {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    localPreviewUrl = null;
}

// ── Event Handlers ─────────────────────────────────────────────
document.getElementById('f-image').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById('f-image-preview');
    clearLocalPreview();
    localPreviewUrl = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${localPreviewUrl}" alt="Aperçu" style="max-height: 100px; border-radius: 4px;">`;
    preview.dataset.existingUrl = '';
});

document.getElementById('clue-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('clue-save-btn');
    const capturedEditingId = state.editingId;
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const editorStillCurrent = () => capturedSession === editorSession
        && capturedEditingId === state.editingId && capturedRole === state.isAdmin
        && document.getElementById('clue-modal')?.style.display !== 'none';
    const requireCurrentEditor = () => {
        if (!editorStillCurrent()) throw new Error('Édition annulée : la session ou le rôle a changé.');
    };
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';

    try {
        const titre = document.getElementById('f-titre').value.trim();
        const description = document.getElementById('f-description').value.trim();
        const decouvert = document.getElementById('f-decouvert').value === 'true';
        
        // Récupère les PNJ liés.
        const checkedPnjs = [];
        document.querySelectorAll('#f-pnjs-grid input[name="pnjsLies"]:checked').forEach(cb => {
            checkedPnjs.push(cb.value);
        });

        const preview = document.getElementById('f-image-preview');
        let imagePath = preview.dataset.existingPath || '';
        let uploadedImage = null;
        const previousImagePath = imagePath;
        const previousLegacyUrl = preview.dataset.existingLegacyUrl || '';
        const clueRef = capturedEditingId ? doc(db, 'indices', capturedEditingId) : doc(collection(db, 'indices'));

        const fileInput = document.getElementById('f-image');
        if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            // L’identifiant Firestore est réservé avant l’upload pour obtenir un
            // dossier déterministe et une référence rejouable.
            btn.textContent = 'Upload image…';
            requireCurrentEditor();
            const result = await uploadProtectedImage(file, { kind: 'indice', ownerId: clueRef.id, contentType: file.type });
            imagePath = result.imagePath;
            uploadedImage = ref(storage, result.imagePath);
            if (!rememberProtectedUpload({ collection: 'indices', ownerId: clueRef.id, path: result.imagePath })) {
                try { await deleteObject(uploadedImage); }
                catch { throw new Error(`Upload annulé. Nettoyage manuel requis pour ${result.imagePath}.`); }
                throw new Error('Upload annulé : impossible de journaliser sa reprise locale.');
            }
            if (!editorStillCurrent()) {
                try { await deleteObject(uploadedImage); forgetProtectedUpload(result.imagePath); }
                catch { throw new Error(`Édition annulée. Nettoyage manuel requis pour ${uploadedImage.fullPath}.`); }
                throw new Error('Édition annulée : la session ou le rôle a changé.');
            }
        }

        const clueData = {
            titre,
            description,
            decouvert,
            pnjsLies: checkedPnjs,
            updatedAt: serverTimestamp(),
        };
        if (imagePath) clueData.imagePath = imagePath;
        if (uploadedImage && capturedEditingId) clueData.imageUrl = deleteField();

        try {
            requireCurrentEditor();
            await runTransaction(db, async transaction => {
                const pnjSnapshots = [];
                for (const pnjId of checkedPnjs) pnjSnapshots.push(await transaction.get(doc(db, 'pnjs', pnjId)));
                const clueSnapshot = capturedEditingId ? await transaction.get(clueRef) : null;
                if (pnjSnapshots.some(snapshot => !snapshot.exists()
                    || snapshot.data()?.suppressionEnCours === true)) {
                    throw new Error('Enregistrement refusé : un PNJ lié est absent ou en cours de suppression.');
                }
                requireCurrentEditor();
                if (capturedEditingId) {
                    if (!clueSnapshot?.exists()) throw new Error('Indice introuvable.');
                    transaction.update(clueRef, clueData);
                } else {
                    transaction.set(clueRef, { ...clueData, createdAt: serverTimestamp() });
                }
            });
        } catch (error) {
            if (uploadedImage) {
                try { await deleteObject(uploadedImage); forgetProtectedUpload(imagePath); }
                catch { throw new Error(`${error.message}. Nettoyage manuel requis pour ${uploadedImage.fullPath}.`); }
            }
            throw error;
        }
        if (uploadedImage) forgetProtectedUpload(imagePath);
        if (uploadedImage) {
            const oldReferences = [previousImagePath, previousLegacyUrl].filter(Boolean);
            const removed = new Set();
            for (const oldReference of oldReferences) {
                if (oldReference === imagePath || removed.has(oldReference)) continue;
                removed.add(oldReference);
                try {
                    await cleanupUnreferencedImage({
                        db, storage, reference: oldReference, ownerCollection: 'indices', ownerId: clueRef.id,
                    });
                } catch (error) {
                    alert(`Enregistrement réussi, mais ancienne image à nettoyer : ${error.message}`);
                }
            }
        }

        closeClueModal();
        await loadData();
    } catch (err) {
        alert("Erreur lors de l'enregistrement : " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
    }
});

document.getElementById('clue-delete-btn').addEventListener('click', async () => {
    if (!state.editingId) return;
    const capturedEditingId = state.editingId;
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const deletionStillCurrent = () => capturedEditingId === state.editingId
        && capturedSession === editorSession && capturedRole === state.isAdmin;
    const clue = state.clues.find(c => c.id === capturedEditingId);
    const ok = await confirmAction({
        titre: "Supprimer l'indice",
        message: `L'indice « ${clue?.titre || 'cet indice'} » sera définitivement supprimé.`,
        libelleAction: 'Supprimer',
        danger: true,
    });
    if (!ok || !deletionStillCurrent()) return;
    const imageReferences = [clue?.imagePath, clue?.imageUrl].filter(Boolean);
    const protectedImageReferences = imageReferences.map(reference => safeStorageReference(storage, reference))
        .filter(imageRef => imageRef?.fullPath.split('/').length === 3)
        .map(imageRef => imageRef.fullPath);
    const legacyImageCount = imageReferences.length - protectedImageReferences.length;

    const btn = document.getElementById('clue-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Suppression…';
    
    try {
        if (!deletionStillCurrent()) return;
        for (const path of protectedImageReferences) {
            if (!rememberProtectedUpload({
                collection: 'indices', ownerId: capturedEditingId, path,
            })) throw new Error(`Suppression annulée : impossible de journaliser ${path}.`);
        }
        await deleteDoc(doc(db, 'indices', capturedEditingId));
        let storageError = null;
        for (const reference of protectedImageReferences) {
            try {
                await cleanupUnreferencedImage({
                    db, storage, reference, ownerCollection: 'indices', ownerId: capturedEditingId,
                });
            } catch (error) { storageError = error; }
        }
        if (storageError) {
            alert(`Indice supprimé dans Firestore, mais nettoyage Storage à reprendre : ${storageError.message}`);
        }
        if (legacyImageCount) alert('Indice supprimé. L’image legacy reste signalée dans l’inventaire administratif pour nettoyage contrôlé.');
        closeClueModal();
        await loadData();
    } catch (err) {
        alert("Erreur lors de la suppression : " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🗑 Supprimer';
    }
});

// Champ de recherche.
document.getElementById('clue-search').addEventListener('input', e => {
    state.searchQ = e.target.value;
    renderClues();
});

// Contrôles de filtrage.
document.getElementById('btn-filter-all').addEventListener('click', () => {
    setActiveFilter('all');
});
document.getElementById('btn-filter-discovered').addEventListener('click', () => {
    setActiveFilter('discovered');
});
document.getElementById('btn-filter-hidden').addEventListener('click', () => {
    setActiveFilter('hidden');
});

function setActiveFilter(filter) {
    state.filter = filter;
    document.querySelectorAll('#filter-group .colorby-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (filter === 'all') document.getElementById('btn-filter-all').classList.add('active');
    if (filter === 'discovered') document.getElementById('btn-filter-discovered').classList.add('active');
    if (filter === 'hidden') document.getElementById('btn-filter-hidden').classList.add('active');
    
    renderClues();
}

// Bouton d’ajout d’indice.
document.getElementById('add-clue-btn').addEventListener('click', () => {
    openClueModal();
});

// Contrôles de fermeture de la fenêtre.
document.getElementById('clue-modal-close').addEventListener('click', () => {
    closeClueModal();
});

document.getElementById('clue-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('clue-modal')) {
        closeClueModal();
    }
});
