import { db, storage } from './firebase-init.js';
import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { esc, stripAccents } from './utils.js';
import { confirmAction } from './ui-confirm.js';
import { visiblePourJoueurs } from './visibility.js';

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

// ── Auth Monitoring ────────────────────────────────────────────
watchAuth((user, isAdmin) => {
    const roleChanged = state.isAdmin !== isAdmin;
    state.isAdmin = isAdmin;
    document.getElementById('auth-btn').textContent = state.isAdmin ? '🔓 Déconnexion' : '🔑 Admin';
    document.getElementById('add-clue-btn').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('filter-group').style.display = state.isAdmin ? 'flex' : 'none';
    document.getElementById('admin-sep').style.display = state.isAdmin ? '' : 'none';
    if (roleChanged && !state.isAdmin) {
        // Déconnexion : retirer les indices MJ et les PNJs masqués avant tout nouveau chargement.
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
        state.clues = cluesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
        'imageUrl', 'visibleJoueurs', 'createdAt', 'updatedAt', 'ordre']
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
        // Search query filter
        if (searchVal) {
            const inTitle = stripAccents((c.titre || '').toLowerCase()).includes(searchVal);
            const inDesc = stripAccents((c.description || '').toLowerCase()).includes(searchVal);
            if (!inTitle && !inDesc) return false;
        }

        // Admin status filter
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
            </div>` : '';

        // Generate PNJ chips
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

    // Attach edit button listeners
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
    state.editingId = clueId;
    document.getElementById('clue-form').reset();
    document.getElementById('f-image-preview').innerHTML = '';
    document.getElementById('f-image-preview').dataset.existingUrl = '';
    document.getElementById('clue-modal-title').textContent = clueId ? "Modifier l'indice" : "Nouvel indice";
    document.getElementById('clue-delete-btn').style.display = clueId ? '' : 'none';

    // Reset checkboxes
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
    document.getElementById('clue-modal').style.display = 'none';
    state.editingId = null;
}

// ── Event Handlers ─────────────────────────────────────────────
document.getElementById('f-image').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById('f-image-preview');
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Aperçu" style="max-height: 100px; border-radius: 4px;">`;
    preview.dataset.existingUrl = '';
});

document.getElementById('clue-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('clue-save-btn');
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';

    try {
        const titre = document.getElementById('f-titre').value.trim();
        const description = document.getElementById('f-description').value.trim();
        const decouvert = document.getElementById('f-decouvert').value === 'true';
        
        // Get linked PNJs
        const checkedPnjs = [];
        document.querySelectorAll('#f-pnjs-grid input[name="pnjsLies"]:checked').forEach(cb => {
            checkedPnjs.push(cb.value);
        });

        const preview = document.getElementById('f-image-preview');
        let imageUrl = preview.dataset.existingUrl || '';

        const fileInput = document.getElementById('f-image');
        if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const fileRef = ref(storage, `indices/${Date.now()}_${file.name}`);
            btn.textContent = 'Upload image…';
            await uploadBytes(fileRef, file);
            imageUrl = await getDownloadURL(fileRef);
        }

        const clueData = {
            titre,
            description,
            decouvert,
            pnjsLies: checkedPnjs,
            imageUrl,
            updatedAt: serverTimestamp(),
        };

        if (state.editingId) {
            await updateDoc(doc(db, 'indices', state.editingId), clueData);
        } else {
            clueData.createdAt = serverTimestamp();
            await addDoc(collection(db, 'indices'), clueData);
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
    const clue = state.clues.find(c => c.id === state.editingId);
    const ok = await confirmAction({
        titre: "Supprimer l'indice",
        message: `L'indice « ${clue?.titre || 'cet indice'} » sera définitivement supprimé.`,
        libelleAction: 'Supprimer',
        danger: true,
    });
    if (!ok) return;

    const btn = document.getElementById('clue-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Suppression…';
    
    try {
        await deleteDoc(doc(db, 'indices', state.editingId));
        closeClueModal();
        await loadData();
    } catch (err) {
        alert("Erreur lors de la suppression : " + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🗑 Supprimer';
    }
});

// Search input
document.getElementById('clue-search').addEventListener('input', e => {
    state.searchQ = e.target.value;
    renderClues();
});

// Filter controls
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

// Add clue button
document.getElementById('add-clue-btn').addEventListener('click', () => {
    openClueModal();
});

// Modal close controls
document.getElementById('clue-modal-close').addEventListener('click', () => {
    closeClueModal();
});

document.getElementById('clue-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('clue-modal')) {
        closeClueModal();
    }
});
