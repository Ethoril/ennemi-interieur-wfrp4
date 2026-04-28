import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import Cropper from 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.esm.js';
import { esc, cap, stripAccents } from './utils.js';

// ── Config ─────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyD5W5U2fyXkiPzUzOOgAGusoiXn2iZbp5U',
    authDomain: 'campagne-wrpg.firebaseapp.com',
    projectId: 'campagne-wrpg',
    storageBucket: 'campagne-wrpg.firebasestorage.app',
    messagingSenderId: '1097155283992',
    appId: '1:1097155283992:web:27976b947ea8bc5b87476d',
};
const ADMIN_EMAIL = 'ethoril@gmail.com';

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Constants ──────────────────────────────────────────────────
const STATUT_COLOR   = { 'allié': '#4caf7d', 'ennemi': '#c94c4c', 'neutre': '#8a8a9a' };
const VIVANT_OPACITY = { 'oui': 1, 'non': 0.35, 'inconnu': 0.65 };
const LINK_COLORS    = { 'allié': '#4caf7d', 'ennemi': '#c94c4c', 'famille': '#c9a84c', 'mentor': '#7a9ac9', 'rival': '#c97a4c' };
const DIM_PALETTE    = ['#c9a84c','#4c8fc9','#c94c8e','#5bc994','#8e4cc9','#c97a4c','#4cc9c9','#9ac94c','#c9a87a','#7a9ac9'];
const TABLE_COLS     = [
    { key: 'nom',         label: 'Nom' },
    { key: 'statut',      label: 'Statut' },
    { key: 'vivant',      label: 'Vivant' },
    { key: 'lieu',        label: 'Lieu' },
    { key: 'groupe',      label: 'Groupe' },
    { key: 'description', label: 'Description' },
];

// ── State ──────────────────────────────────────────────────────
const state = {
    isAdmin: false,
    nodes: [], links: [],
    active: { statut: new Set(), vivant: new Set(), lieu: new Set(), groupe: new Set() },
    searchQ: '',
    nodeSel: null, linkSel: null, simulation: null,
    colorBy: 'statut', dimColorMap: null,
    graphW: 800, graphH: 550,
    view: 'graph',
    sortCol: 'nom', sortDir: 1,
    editingId: null, panelId: null,
    croppedBlob: null,
};

// ── Utils ──────────────────────────────────────────────────────
const getStatutColor = s => STATUT_COLOR[(s || '').toLowerCase()] || '#7a7a8a';
const getLinkColor   = s => LINK_COLORS[(s || '').toLowerCase()]  || stringToColor(s || '');
const getNodeOpacity = d => VIVANT_OPACITY[(d.vivant || '').toLowerCase()] ?? 1;

function stringToColor(str) {
    let h = 0;
    for (const c of str) h = ((h << 5) - h) + c.charCodeAt(0);
    return `hsl(${Math.abs(h) % 360}, 45%, 55%)`;
}

async function uploadImage(blob) {
    const storage = getStorage(app);
    const fileRef = ref(storage, `portraits/${Date.now()}.webp`);
    await uploadBytes(fileRef, blob, { contentType: 'image/webp' });
    return getDownloadURL(fileRef);
}

// ── Auth ───────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
    state.isAdmin = !!(user && user.email === ADMIN_EMAIL);
    document.getElementById('auth-btn').textContent = state.isAdmin ? '🔓 Déconnexion' : '🔑 Admin';
    document.getElementById('add-pnj-btn').style.display = state.isAdmin ? '' : 'none';
    if (state.panelId) {
        const node = state.nodes.find(n => n.id === state.panelId);
        if (node) openPanel(node);
    }
});

document.getElementById('auth-btn').addEventListener('click', async () => {
    if (state.isAdmin) {
        await signOut(auth);
    } else {
        try { await signInWithPopup(auth, new GoogleAuthProvider()); }
        catch (e) { if (e.code !== 'auth/popup-closed-by-user') alert('Connexion impossible : ' + e.message); }
    }
});

// ── Data ───────────────────────────────────────────────────────
function applySnapshots(pnjSnap, relSnap) {
    const rawNodes = pnjSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const nodeIds  = new Set(rawNodes.map(n => n.id));
    state.nodes = rawNodes;
    state.links = relSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(l => nodeIds.has(l.source) && nodeIds.has(l.cible))
        .map(l => ({ ...l, source: l.source, target: l.cible }));
}

async function loadData({ init = false } = {}) {
    try {
        const [ps, rs] = await Promise.all([
            getDocs(collection(db, 'pnjs')),
            getDocs(collection(db, 'relations')),
        ]);
        applySnapshots(ps, rs);

        d3.select('#pnj-graph svg').remove();
        state.nodeSel = null;
        state.linkSel = null;
        if (state.simulation) { state.simulation.stop(); state.simulation = null; }

        clearFilters();
        buildFilters();
        if (state.nodes.length) buildGraph();

        if (init) document.getElementById('pnj-loading').style.display = 'none';
        document.getElementById('pnj-empty').style.display    = state.nodes.length ? 'none' : 'flex';
        document.getElementById('graph-legend').style.display = state.nodes.length ? 'flex' : 'none';
        if (state.view === 'table') renderTable();

    } catch (e) {
        if (init) {
            const el = document.getElementById('pnj-loading');
            el.querySelector('.pnj-spinner').style.display = 'none';
            el.childNodes[el.childNodes.length - 1].textContent = 'Impossible de charger les données.';
        }
    }
}

// ── CRUD ───────────────────────────────────────────────────────
async function savePnj(data, imageFile) {
    const btn = document.getElementById('pnj-save-btn');
    btn.disabled = true;
    btn.textContent = imageFile ? 'Upload…' : 'Enregistrement…';
    try {
        if (imageFile) data.imageUrl = await uploadImage(imageFile);
        if (state.editingId) await updateDoc(doc(db, 'pnjs', state.editingId), data);
        else                 await addDoc(collection(db, 'pnjs'), data);
        const prevEditingId = state.editingId;
        closePnjModal();
        await loadData();
        if (prevEditingId && state.panelId === prevEditingId) {
            const node = state.nodes.find(n => n.id === prevEditingId);
            if (node) openPanel(node);
        }
    } catch (e) {
        alert('Erreur : ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
    }
}

async function deletePnj(id) {
    if (!confirm('Supprimer ce personnage et toutes ses relations ?')) return;
    const relSnap = await getDocs(collection(db, 'relations'));
    const batch = writeBatch(db);
    relSnap.docs.forEach(d => {
        const { source, cible } = d.data();
        if (source === id || cible === id) batch.delete(d.ref);
    });
    batch.delete(doc(db, 'pnjs', id));
    await batch.commit();
    closePanel();
    await loadData();
}

async function saveRelation(sourceId, cibleId, type, label) {
    if (!sourceId || !cibleId || !type) { alert('Choisissez un PNJ et entrez un type de relation.'); return; }
    await addDoc(collection(db, 'relations'), { source: sourceId, cible: cibleId, type, label: label || type });
    await loadData();
    const node = state.nodes.find(n => n.id === sourceId);
    if (node) openPanel(node);
}

async function deleteRelation(relId) {
    if (!confirm('Supprimer cette relation ?')) return;
    await deleteDoc(doc(db, 'relations', relId));
    await loadData();
    const node = state.nodes.find(n => n.id === state.panelId);
    if (node) openPanel(node);
}

// ── PNJ Modal ──────────────────────────────────────────────────
function openPnjModal(pnjId = null) {
    state.editingId  = pnjId;
    state.croppedBlob = null;
    const preview = document.getElementById('f-image-preview');
    document.getElementById('pnj-form').reset();
    preview.innerHTML = '';
    preview.dataset.existingUrl = '';
    document.getElementById('pnj-modal-title').textContent = pnjId ? 'Modifier le personnage' : 'Nouveau personnage';
    document.getElementById('pnj-delete-btn').style.display = pnjId ? '' : 'none';

    if (pnjId) {
        const p = state.nodes.find(n => n.id === pnjId);
        if (p) {
            document.getElementById('f-nom').value         = p.nom         || '';
            document.getElementById('f-statut').value      = p.statut      || '';
            document.getElementById('f-vivant').value      = p.vivant      || 'oui';
            document.getElementById('f-lieu').value        = p.lieu        || '';
            document.getElementById('f-groupe').value      = p.groupe      || '';
            document.getElementById('f-description').value = p.description || '';
            if (p.imageUrl) {
                preview.innerHTML = `<img src="${esc(p.imageUrl)}" alt="Portrait actuel">`;
                preview.dataset.existingUrl = p.imageUrl;
            }
        }
    }
    document.getElementById('pnj-modal').style.display = 'flex';
}

function closePnjModal() {
    document.getElementById('pnj-modal').style.display = 'none';
    state.editingId   = null;
    state.croppedBlob = null;
}

document.getElementById('pnj-form').addEventListener('submit', async e => {
    e.preventDefault();
    const preview = document.getElementById('f-image-preview');
    await savePnj({
        nom:         document.getElementById('f-nom').value.trim(),
        statut:      document.getElementById('f-statut').value,
        vivant:      document.getElementById('f-vivant').value,
        lieu:        document.getElementById('f-lieu').value.trim(),
        groupe:      document.getElementById('f-groupe').value.trim(),
        description: document.getElementById('f-description').value.trim(),
        imageUrl:    preview.dataset.existingUrl || '',
    }, state.croppedBlob);
});

document.getElementById('f-image').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    openCropModal(file);
});

// ── Crop Modal ─────────────────────────────────────────────────
let cropperInstance = null;

function openCropModal(file) {
    const img = document.getElementById('crop-img');
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    img.src = URL.createObjectURL(file);
    document.getElementById('crop-modal').style.display = 'flex';
    img.onload = () => {
        cropperInstance = new Cropper(img, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 0.85,
            movable: true,
            zoomable: true,
            scalable: false,
            guides: true,
        });
    };
}

function closeCropModal() {
    document.getElementById('crop-modal').style.display = 'none';
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
}

document.getElementById('crop-confirm-btn').addEventListener('click', () => {
    if (!cropperInstance) return;
    cropperInstance.getCroppedCanvas({ width: 500, height: 500 }).toBlob(blob => {
        state.croppedBlob = blob;
        const preview = document.getElementById('f-image-preview');
        preview.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Aperçu">`;
        preview.dataset.existingUrl = '';
        closeCropModal();
    }, 'image/webp', 0.85);
});

document.getElementById('crop-cancel-btn').addEventListener('click', () => {
    document.getElementById('f-image').value = '';
    closeCropModal();
});

document.getElementById('pnj-modal-close').addEventListener('click', closePnjModal);
document.getElementById('pnj-modal').addEventListener('click', e => { if (e.target === document.getElementById('pnj-modal')) closePnjModal(); });
document.getElementById('pnj-delete-btn').addEventListener('click', () => { if (state.editingId) deletePnj(state.editingId); });
document.getElementById('add-pnj-btn').addEventListener('click', () => openPnjModal());

// ── Colors ─────────────────────────────────────────────────────
function buildDimColorMap() {
    if (state.colorBy === 'statut') { state.dimColorMap = null; return; }
    const vals = [...new Set(state.nodes.map(d => d[state.colorBy]).filter(Boolean))].sort();
    state.dimColorMap = new Map(vals.map((v, i) => [v, DIM_PALETTE[i % DIM_PALETTE.length]]));
}

const getDimColor = d => state.dimColorMap ? (state.dimColorMap.get(d[state.colorBy]) || '#7a7a8a') : getStatutColor(d.statut);

function updateLegend() {
    const legend = document.getElementById('graph-legend');
    if (state.colorBy === 'statut') {
        legend.innerHTML = `
            <div class="legend-item"><span class="legend-dot" style="background:#4caf7d"></span>Allié</div>
            <div class="legend-item"><span class="legend-dot" style="background:#c94c4c"></span>Ennemi</div>
            <div class="legend-item"><span class="legend-dot" style="background:#8a8a9a"></span>Neutre</div>
            <div class="legend-item"><span class="legend-ring"></span>Décédé</div>`;
    } else {
        const items = state.dimColorMap ? [...state.dimColorMap.entries()].map(([v, c]) =>
            `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span>${esc(v)}</div>`).join('') : '';
        legend.innerHTML = items + `<div class="legend-item"><span class="legend-ring"></span>Décédé</div>`;
    }
}

// ── Filters ────────────────────────────────────────────────────
function clearFilters() {
    ['filter-statut', 'filter-vivant', 'filter-lieu', 'filter-groupe'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

function buildFilters() {
    const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
    [
        ['filter-statut', 'Statut', 'statut', uniq(state.nodes.map(d => d.statut))],
        ['filter-vivant', 'Vivant', 'vivant', uniq(state.nodes.map(d => d.vivant))],
        ['filter-lieu',   'Lieu',   'lieu',   uniq(state.nodes.map(d => d.lieu))],
        ['filter-groupe', 'Groupe', 'groupe', uniq(state.nodes.map(d => d.groupe))],
    ].forEach(([id, label, key, vals]) => {
        if (!vals.length) return;
        const el  = document.getElementById(id);
        const lbl = document.createElement('span');
        lbl.className = 'filter-group-label';
        lbl.textContent = label;
        el.appendChild(lbl);
        vals.forEach(v => {
            const btn = document.createElement('button');
            btn.className = 'filter-pill' + (state.active[key].has(v) ? ' active' : '');
            btn.textContent = v;
            btn.addEventListener('click', () => {
                state.active[key].has(v) ? state.active[key].delete(v) : state.active[key].add(v);
                btn.classList.toggle('active', state.active[key].has(v));
                updateVisibility();
                if (state.view === 'table') renderTable();
            });
            el.appendChild(btn);
        });
    });
}

// ── Graph ──────────────────────────────────────────────────────
function buildGraph() {
    const container = document.getElementById('pnj-graph');
    state.graphW = container.clientWidth  || window.innerWidth * 0.85;
    state.graphH = container.clientHeight || 550;

    const degree = new Map(state.nodes.map(d => [d.id, 0]));
    state.links.forEach(l => {
        const s = typeof l.source === 'object' ? l.source.id : l.source;
        const t = typeof l.target === 'object' ? l.target.id : l.target;
        degree.set(s, (degree.get(s) || 0) + 1);
        degree.set(t, (degree.get(t) || 0) + 1);
    });
    const nodeR = d => 13 + Math.min((degree.get(d.id) || 0) * 2, 10);

    buildDimColorMap();

    const svg = d3.select('#pnj-graph').append('svg').attr('width', '100%').attr('height', '100%');
    const g   = svg.append('g');

    svg.call(d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => g.attr('transform', e.transform)));
    svg.on('click', () => closePanel());

    state.linkSel = g.append('g').selectAll('line').data(state.links).join('line')
        .attr('class', 'pnj-link')
        .attr('stroke', d => getLinkColor(d.type))
        .attr('stroke-width', 2).attr('stroke-opacity', 0.55);

    const nodeG = g.append('g').selectAll('g').data(state.nodes).join('g')
        .attr('class', 'pnj-node')
        .call(d3.drag()
            .on('start', (e, d) => { if (!e.active) state.simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on('end',   (e, d) => { if (!e.active) state.simulation.alphaTarget(0); d.fx = null; d.fy = null; }))
        .on('click', (e, d) => { e.stopPropagation(); openPanel(d); });

    // Clip path pour le portrait circulaire
    nodeG.append('clipPath')
        .attr('id', d => `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`)
        .append('circle')
        .attr('r', nodeR);

    // Fond coloré (visible si pas de portrait)
    nodeG.append('circle')
        .attr('class', 'node-bg')
        .attr('r', nodeR)
        .attr('fill', getDimColor)
        .attr('stroke', '#0e0e18')
        .attr('stroke-width', 2);

    // Portrait clipé
    nodeG.append('image')
        .attr('href', d => d.imageUrl || null)
        .attr('x', d => -nodeR(d))
        .attr('y', d => -nodeR(d))
        .attr('width',  d => nodeR(d) * 2)
        .attr('height', d => nodeR(d) * 2)
        .attr('clip-path', d => `url(#clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')})`)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .style('display', d => d.imageUrl ? '' : 'none')
        .on('error', function() { d3.select(this).style('display', 'none'); });

    // Anneau coloré (statut/dimension) — toujours visible par-dessus le portrait
    nodeG.append('circle')
        .attr('class', 'node-ring')
        .attr('r', nodeR)
        .attr('fill', 'none')
        .attr('stroke', getDimColor)
        .attr('stroke-width', 3);

    nodeG.append('text')
        .attr('text-anchor', 'middle').attr('dy', d => nodeR(d) + 14)
        .attr('class', 'node-label').text(d => d.nom);

    state.nodeSel = nodeG;

    state.simulation = d3.forceSimulation(state.nodes)
        .force('link',    d3.forceLink(state.links).id(d => d.id).distance(130))
        .force('charge',  d3.forceManyBody().strength(-380))
        .force('center',  d3.forceCenter(state.graphW / 2, state.graphH / 2))
        .force('collide', d3.forceCollide(d => nodeR(d) + 14))
        .on('tick', () => {
            state.linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            state.nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
        });

    updateVisibility();
    updateLegend();
}

function applyColorBy(dim) {
    state.colorBy = dim;
    buildDimColorMap();
    state.nodeSel?.select('.node-bg').attr('fill', getDimColor);
    state.nodeSel?.select('.node-ring').attr('stroke', getDimColor);
    if (dim === 'statut') {
        state.simulation?.force('cluster-x', null).force('cluster-y', null).alpha(0.15).restart();
    } else {
        const vals = state.dimColorMap ? [...state.dimColorMap.keys()] : [];
        const n = vals.length || 1, r = Math.min(state.graphW, state.graphH) * 0.28;
        const centers = Object.fromEntries(vals.map((v, i) => [v, {
            x: state.graphW / 2 + r * Math.cos((2 * Math.PI * i / n) - Math.PI / 2),
            y: state.graphH / 2 + r * Math.sin((2 * Math.PI * i / n) - Math.PI / 2),
        }]));
        state.simulation
            ?.force('cluster-x', d3.forceX(d => centers[d[dim]]?.x ?? state.graphW / 2).strength(0.07))
            .force('cluster-y', d3.forceY(d => centers[d[dim]]?.y ?? state.graphH / 2).strength(0.07))
            .alpha(0.4).restart();
    }
    updateLegend();
    document.querySelectorAll('.colorby-btn').forEach(b => b.classList.toggle('active', b.dataset.dim === dim));
}

// ── Visibility ─────────────────────────────────────────────────
function isVisible(d) {
    const q = stripAccents(state.searchQ.toLowerCase());
    if (q && !stripAccents((d.nom || '').toLowerCase()).includes(q) &&
             !stripAccents((d.description || '').toLowerCase()).includes(q)) return false;
    if (state.active.statut.size && !state.active.statut.has(d.statut)) return false;
    if (state.active.vivant.size && !state.active.vivant.has(d.vivant)) return false;
    if (state.active.lieu.size   && !state.active.lieu.has(d.lieu))     return false;
    if (state.active.groupe.size && !state.active.groupe.has(d.groupe)) return false;
    return true;
}

function updateVisibility() {
    if (!state.nodeSel) return;
    const visIds = new Set(state.nodes.filter(isVisible).map(d => d.id));
    state.nodeSel
        .style('opacity', d => isVisible(d) ? getNodeOpacity(d) : 0.06)
        .style('pointer-events', d => isVisible(d) ? 'all' : 'none');
    state.nodeSel.select('.node-ring').attr('stroke-dasharray', d => (d.vivant || '').toLowerCase() === 'non' ? '5 3' : null);
    state.linkSel?.style('opacity', d => {
        // d.source/.target peuvent être soit un id (string) soit l'objet node après simulation
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return visIds.has(s) && visIds.has(t) ? 0.55 : 0.04;
    });
}

// ── Detail panel ───────────────────────────────────────────────
function openPanel(d) {
    state.panelId = d.id;
    const nodeById = new Map(state.nodes.map(n => [n.id, n]));

    const related = state.links.filter(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        return s === d.id || t === d.id;
    }).map(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        const isSource = s === d.id;
        return { relId: l.id, node: nodeById.get(isSource ? t : s), type: l.type, label: l.label || l.type || 'Lié', dir: isSource ? '→' : '←' };
    }).filter(r => r.node);

    const vKey   = (d.vivant || '').toLowerCase();
    const vLabel = { oui: 'Vivant', non: 'Décédé', inconnu: 'Inconnu' }[vKey] || cap(d.vivant);

    const portraitHtml = d.imageUrl
        ? `<img src="${esc(d.imageUrl)}" class="pnj-detail-portrait" alt="${esc(d.nom)}">`
        : `<div class="pnj-portrait-placeholder">${esc((d.nom || '?').charAt(0).toUpperCase())}</div>`;

    const metaHtml = (d.lieu || d.groupe) ? `
        <div class="pnj-detail-meta">
            ${d.lieu   ? `<span>📍 ${esc(d.lieu)}</span>`   : ''}
            ${d.groupe ? `<span>⚔ ${esc(d.groupe)}</span>` : ''}
        </div>` : '';

    const descHtml = d.description ? `
        <div class="pnj-detail-section">
            <p class="pnj-desc">${esc(d.description).replace(/\n/g, '<br>')}</p>
        </div>` : '';

    const editActions = state.isAdmin ? `
        <div class="pnj-edit-actions">
            <button class="btn-edit" id="panel-edit-btn">✏ Modifier</button>
        </div>` : '';

    const relDeleteBtn = relId => state.isAdmin
        ? `<button class="rel-delete-btn" data-rel="${esc(relId)}" title="Supprimer">×</button>` : '';

    const relHtml = `
        <div class="pnj-detail-section">
            <h4>Relations${related.length ? ` (${related.length})` : ''}</h4>
            <div class="pnj-relation-list">
                ${related.map(r => `
                    <div class="rel-chip-row">
                        <button class="pnj-relation-chip" data-id="${esc(r.node.id)}" style="--chip-color:${getLinkColor(r.type)}">
                            <span class="chip-name">${esc(r.node.nom)}</span>
                            <span class="chip-type"><span class="chip-dir">${r.dir}</span> ${esc(r.label)}</span>
                        </button>
                        ${relDeleteBtn(r.relId)}
                    </div>`).join('')}
            </div>
            ${state.isAdmin ? `
                <button class="btn-add-rel" id="add-rel-btn">＋ Relation</button>
                <div class="rel-add-form" id="rel-add-form" style="display:none;">
                    <select id="rel-target">
                        <option value="">— Choisir un PNJ —</option>
                        ${state.nodes.filter(n => n.id !== d.id).map(n => `<option value="${esc(n.id)}">${esc(n.nom)}</option>`).join('')}
                    </select>
                    <input type="text" id="rel-type" placeholder="Type (Patronage, Rival…)">
                    <input type="text" id="rel-label" placeholder="Label (optionnel)">
                    <div class="rel-form-btns">
                        <button id="rel-save-btn" class="btn-primary-sm">Ajouter</button>
                        <button id="rel-cancel-btn" class="btn-ghost-sm">Annuler</button>
                    </div>
                </div>` : ''}
        </div>`;

    document.getElementById('pnj-detail-content').innerHTML = `
        ${portraitHtml}
        <div class="pnj-detail-header">
            <h2>${esc(d.nom || '?')}</h2>
            <div class="pnj-badges">
                <span class="pnj-badge statut-${esc((d.statut || '').toLowerCase())}">${esc(cap(d.statut) || '?')}</span>
                <span class="pnj-badge vivant-${esc(vKey)}">${esc(vLabel)}</span>
            </div>
        </div>
        ${editActions}${metaHtml}${descHtml}${relHtml}`;

    document.getElementById('pnj-detail').classList.add('open');
    highlightConnected(d.id);
}

function closePanel() {
    document.getElementById('pnj-detail').classList.remove('open');
    state.panelId = null;
    updateVisibility();
}

function highlightConnected(id) {
    const connected = new Set([id]);
    state.links.forEach(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        if (s === id) connected.add(t);
        if (t === id) connected.add(s);
    });
    state.nodeSel?.style('opacity', d => isVisible(d) ? (connected.has(d.id) ? getNodeOpacity(d) : 0.15) : 0.06);
    state.linkSel?.style('opacity', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return (s === id || t === id) ? 0.9 : 0.04;
    });
}

// ── Detail panel events (délégation — bindé une seule fois) ────
document.getElementById('pnj-detail-content').addEventListener('click', e => {
    const chip = e.target.closest('.pnj-relation-chip');
    if (chip) {
        const n = state.nodes.find(n => n.id === chip.dataset.id);
        if (n) openPanel(n);
        return;
    }

    const delBtn = e.target.closest('.rel-delete-btn');
    if (delBtn) { deleteRelation(delBtn.dataset.rel); return; }

    if (e.target.closest('#panel-edit-btn')) { openPnjModal(state.panelId); return; }

    if (e.target.closest('#add-rel-btn')) {
        document.getElementById('rel-add-form').style.display = 'block';
        document.getElementById('add-rel-btn').style.display  = 'none';
        return;
    }

    if (e.target.closest('#rel-cancel-btn')) {
        document.getElementById('rel-add-form').style.display = 'none';
        document.getElementById('add-rel-btn').style.display  = '';
        return;
    }

    if (e.target.closest('#rel-save-btn')) {
        saveRelation(
            state.panelId,
            document.getElementById('rel-target').value,
            document.getElementById('rel-type').value.trim(),
            document.getElementById('rel-label').value.trim(),
        );
        return;
    }
});

// ── Table ──────────────────────────────────────────────────────
function renderTable() {
    const container = document.getElementById('pnj-table-container');
    const sorted = [...state.nodes.filter(isVisible)].sort((a, b) =>
        state.sortDir * (a[state.sortCol] || '').localeCompare(b[state.sortCol] || '', 'fr', { sensitivity: 'base' }));

    const thead = TABLE_COLS.map(c => {
        const arrow = c.key === state.sortCol ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '';
        return `<th data-col="${esc(c.key)}" class="sortable">${esc(c.label)}${arrow}</th>`;
    }).join('') + (state.isAdmin ? '<th></th>' : '');

    const tbody = sorted.map(d => {
        const cells = TABLE_COLS.map(c => {
            if (c.key === 'statut') return `<td><span class="pnj-badge statut-${esc((d.statut || '').toLowerCase())}">${esc(cap(d.statut) || '—')}</span></td>`;
            if (c.key === 'vivant') {
                const vk = (d.vivant || '').toLowerCase();
                return `<td><span class="pnj-badge vivant-${esc(vk)}">${esc({ oui: 'Vivant', non: 'Décédé', inconnu: 'Inconnu' }[vk] || d.vivant || '—')}</span></td>`;
            }
            if (c.key === 'description') {
                const full = d.description || '', short = full.length > 90 ? full.slice(0, 90) + '…' : full;
                return `<td class="pnj-td-desc" title="${esc(full)}">${esc(short || '—')}</td>`;
            }
            return `<td>${esc(d[c.key] || '—')}</td>`;
        }).join('');
        const editCell = state.isAdmin ? `<td><button class="btn-edit-sm" data-id="${esc(d.id)}">✏</button></td>` : '';
        return `<tr>${cells}${editCell}</tr>`;
    }).join('');

    container.innerHTML = `
        <p class="pnj-table-count">${sorted.length} personnage${sorted.length !== 1 ? 's' : ''}</p>
        <div class="pnj-table-scroll">
            <table class="rules-table pnj-table-el">
                <thead><tr>${thead}</tr></thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>`;

    container.querySelectorAll('th.sortable').forEach(th =>
        th.addEventListener('click', () => {
            state.sortDir = state.sortCol === th.dataset.col ? state.sortDir * -1 : 1;
            state.sortCol = th.dataset.col;
            renderTable();
        }));
    container.querySelectorAll('.btn-edit-sm').forEach(btn =>
        btn.addEventListener('click', () => openPnjModal(btn.dataset.id)));
}

// ── View toggle ────────────────────────────────────────────────
function setView(view) {
    state.view = view;
    document.getElementById('pnj-graph').style.display           = view === 'graph' ? '' : 'none';
    document.getElementById('pnj-table-container').style.display = view === 'table' ? '' : 'none';
    document.getElementById('colorby-group').style.display       = view === 'graph' ? '' : 'none';
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'table') renderTable();
}

// ── Events ─────────────────────────────────────────────────────
document.getElementById('pnj-search').addEventListener('input', e => {
    state.searchQ = e.target.value.trim();
    updateVisibility();
    if (state.view === 'table') renderTable();
});
document.getElementById('pnj-detail-close').addEventListener('click', closePanel);
document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
document.querySelectorAll('.colorby-btn').forEach(btn => btn.addEventListener('click', () => applyColorBy(btn.dataset.dim)));

loadData({ init: true });
