'use strict';

const SHEET_ID = '1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs';

const STATUT_COLOR = { 'allié': '#4caf7d', 'ennemi': '#c94c4c', 'neutre': '#8a8a9a' };
const VIVANT_OPACITY = { 'oui': 1, 'non': 0.35, 'inconnu': 0.65 };
const LINK_COLORS = {
    'allié': '#4caf7d', 'ennemi': '#c94c4c',
    'famille': '#c9a84c', 'mentor': '#7a9ac9', 'rival': '#c97a4c',
};

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getStatutColor(s) {
    return STATUT_COLOR[(s || '').toLowerCase()] || '#7a7a8a';
}

function getLinkColor(s) {
    return LINK_COLORS[(s || '').toLowerCase()] || stringToColor(s || '');
}

function getNodeOpacity(d) {
    return VIVANT_OPACITY[(d.Vivant || '').toLowerCase()] ?? 1;
}

function stringToColor(str) {
    let h = 0;
    for (const c of str) h = ((h << 5) - h) + c.charCodeAt(0);
    return `hsl(${Math.abs(h) % 360}, 45%, 55%)`;
}

// ── CSV parser ─────────────────────────────────────────────────
function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i], nx = text[i + 1];
        if (inQ) {
            if (ch === '"' && nx === '"') { field += '"'; i++; }
            else if (ch === '"') inQ = false;
            else field += ch;
        } else {
            if (ch === '"') inQ = true;
            else if (ch === ',') { row.push(field.trim()); field = ''; }
            else if (ch === '\r' || ch === '\n') {
                if (ch === '\r' && nx === '\n') i++;
                row.push(field.trim());
                if (row.some(Boolean)) rows.push(row);
                row = []; field = '';
            } else field += ch;
        }
    }
    if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
    if (!rows.length) return [];
    const hdrs = rows[0];
    return rows.slice(1).map(vs => Object.fromEntries(hdrs.map((h, i) => [h, vs[i] ?? ''])));
}

async function fetchSheet(name) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(name);
    return parseCSV(await res.text());
}

// ── State ──────────────────────────────────────────────────────
let d3nodes = [], d3links = [];
const active = { statut: new Set(), vivant: new Set(), lieu: new Set(), groupe: new Set() };
let searchQ = '';
let nodeSel, linkSel, simulation;

// ── Init ───────────────────────────────────────────────────────
async function init() {
    try {
        const [pnjRows, relRows] = await Promise.all([
            fetchSheet('pnjs'),
            fetchSheet('relations'),
        ]);

        const allNodes = pnjRows.filter(d => d.ID && d.Nom);
        const allLinks = relRows.filter(d => d.Source && d.Cible);

        const nodeById = new Map(allNodes.map(d => [d.ID, d]));
        d3nodes = allNodes.map(d => ({ ...d }));
        d3links = allLinks
            .filter(l => nodeById.has(l.Source) && nodeById.has(l.Cible))
            .map(l => ({ ...l, source: l.Source, target: l.Cible }));

        buildFilters(allNodes);
        buildGraph();
        document.getElementById('pnj-loading').style.display = 'none';
        document.getElementById('graph-legend').style.display = 'flex';
    } catch {
        const el = document.getElementById('pnj-loading');
        el.querySelector('.pnj-spinner').style.display = 'none';
        el.childNodes[el.childNodes.length - 1].textContent = 'Impossible de charger les données.';
    }
}

// ── Filters ────────────────────────────────────────────────────
function buildFilters(allNodes) {
    const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
    [
        ['filter-statut', 'Statut',  'statut', uniq(allNodes.map(d => d.Statut))],
        ['filter-vivant', 'Vivant',  'vivant', uniq(allNodes.map(d => d.Vivant))],
        ['filter-lieu',   'Lieu',    'lieu',   uniq(allNodes.map(d => d.Lieu))],
        ['filter-groupe', 'Groupe',  'groupe', uniq(allNodes.map(d => d.Groupe))],
    ].forEach(([id, label, key, vals]) => {
        if (!vals.length) return;
        const el = document.getElementById(id);
        const lbl = document.createElement('span');
        lbl.className = 'filter-group-label';
        lbl.textContent = label;
        el.appendChild(lbl);
        vals.forEach(v => {
            const btn = document.createElement('button');
            btn.className = 'filter-pill';
            btn.textContent = v;
            btn.addEventListener('click', () => {
                active[key].has(v) ? active[key].delete(v) : active[key].add(v);
                btn.classList.toggle('active', active[key].has(v));
                updateVisibility();
            });
            el.appendChild(btn);
        });
    });
}

// ── Graph ──────────────────────────────────────────────────────
function buildGraph() {
    const container = document.getElementById('pnj-graph');
    const W = container.clientWidth || window.innerWidth * 0.85;
    const H = container.clientHeight || 550;

    const degree = new Map(d3nodes.map(d => [d.ID, 0]));
    d3links.forEach(l => {
        degree.set(l.Source, (degree.get(l.Source) || 0) + 1);
        degree.set(l.Cible,  (degree.get(l.Cible)  || 0) + 1);
    });
    const nodeR = d => 13 + Math.min((degree.get(d.ID) || 0) * 2, 10);

    const svg = d3.select('#pnj-graph').append('svg')
        .attr('width', '100%').attr('height', '100%');

    const g = svg.append('g');

    svg.call(
        d3.zoom().scaleExtent([0.1, 5])
            .on('zoom', e => g.attr('transform', e.transform))
    );

    svg.on('click', () => closePanel());

    linkSel = g.append('g').selectAll('line').data(d3links).join('line')
        .attr('class', 'pnj-link')
        .attr('stroke', d => getLinkColor(d.Type))
        .attr('stroke-width', 2)
        .attr('stroke-opacity', 0.55);

    const nodeG = g.append('g').selectAll('g').data(d3nodes).join('g')
        .attr('class', 'pnj-node')
        .call(d3.drag()
            .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on('end',   (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }))
        .on('click', (e, d) => { e.stopPropagation(); openPanel(d); });

    nodeG.append('circle')
        .attr('r', nodeR)
        .attr('fill', d => getStatutColor(d.Statut))
        .attr('stroke', '#0e0e18')
        .attr('stroke-width', 2.5);

    nodeG.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', d => nodeR(d) + 14)
        .attr('class', 'node-label')
        .text(d => d.Nom);

    nodeSel = nodeG;

    simulation = d3.forceSimulation(d3nodes)
        .force('link', d3.forceLink(d3links).id(d => d.ID).distance(130))
        .force('charge', d3.forceManyBody().strength(-380))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collide', d3.forceCollide(d => nodeR(d) + 14))
        .on('tick', () => {
            linkSel
                .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
        });

    updateVisibility();
}

// ── Visibility ─────────────────────────────────────────────────
function isVisible(d) {
    const q = searchQ.toLowerCase();
    if (q && !d.Nom.toLowerCase().includes(q) && !(d.Description || '').toLowerCase().includes(q)) return false;
    if (active.statut.size && !active.statut.has(d.Statut)) return false;
    if (active.vivant.size && !active.vivant.has(d.Vivant)) return false;
    if (active.lieu.size   && !active.lieu.has(d.Lieu))     return false;
    if (active.groupe.size && !active.groupe.has(d.Groupe)) return false;
    return true;
}

function updateVisibility() {
    if (!nodeSel) return;
    const visIds = new Set(d3nodes.filter(isVisible).map(d => d.ID));

    nodeSel
        .style('opacity', d => isVisible(d) ? getNodeOpacity(d) : 0.06)
        .style('pointer-events', d => isVisible(d) ? 'all' : 'none');

    nodeSel.select('circle')
        .attr('stroke-dasharray', d => (d.Vivant || '').toLowerCase() === 'non' ? '5 3' : null);

    linkSel.style('opacity', d => {
        const s = d.source.ID ?? d.source, t = d.target.ID ?? d.target;
        return visIds.has(s) && visIds.has(t) ? 0.55 : 0.04;
    });
}

// ── Detail panel ───────────────────────────────────────────────
function openPanel(d) {
    const nodeById = new Map(d3nodes.map(n => [n.ID, n]));

    const related = d3links.filter(l => {
        const s = l.source.ID ?? l.source, t = l.target.ID ?? l.target;
        return s === d.ID || t === d.ID;
    }).map(l => {
        const s = l.source.ID ?? l.source, t = l.target.ID ?? l.target;
        return { node: nodeById.get(s === d.ID ? t : s), type: l.Type, label: l.Label || l.Type || 'Lié' };
    }).filter(r => r.node);

    const vKey = (d.Vivant || '').toLowerCase();
    const vLabel = { oui: 'Vivant', non: 'Décédé', inconnu: 'Inconnu' }[vKey] || escapeHtml(d.Vivant);

    const portraitHtml = d.Image
        ? `<img src="${escapeHtml(d.Image)}" class="pnj-detail-portrait" alt="${escapeHtml(d.Nom)}">`
        : `<div class="pnj-portrait-placeholder">${escapeHtml(d.Nom.charAt(0).toUpperCase())}</div>`;

    const metaHtml = (d.Lieu || d.Groupe) ? `
        <div class="pnj-detail-meta">
            ${d.Lieu   ? `<span>📍 ${escapeHtml(d.Lieu)}</span>` : ''}
            ${d.Groupe ? `<span>⚔ ${escapeHtml(d.Groupe)}</span>` : ''}
        </div>` : '';

    const descHtml = d.Description ? `
        <div class="pnj-detail-section">
            <p class="pnj-desc">${escapeHtml(d.Description).replace(/\n/g, '<br>')}</p>
        </div>` : '';

    const relHtml = related.length ? `
        <div class="pnj-detail-section">
            <h4>Relations</h4>
            <div class="pnj-relation-list">
                ${related.map(r => `
                    <button class="pnj-relation-chip" data-id="${escapeHtml(r.node.ID)}"
                        style="--chip-color:${getLinkColor(r.type)}">
                        <span class="chip-name">${escapeHtml(r.node.Nom)}</span>
                        <span class="chip-type">${escapeHtml(r.label)}</span>
                    </button>`).join('')}
            </div>
        </div>` : '';

    document.getElementById('pnj-detail-content').innerHTML = `
        ${portraitHtml}
        <div class="pnj-detail-header">
            <h2>${escapeHtml(d.Nom)}</h2>
            <div class="pnj-badges">
                <span class="pnj-badge statut-${escapeHtml((d.Statut || '').toLowerCase())}">${escapeHtml(d.Statut || '?')}</span>
                <span class="pnj-badge vivant-${escapeHtml(vKey)}">${escapeHtml(vLabel)}</span>
            </div>
        </div>
        ${metaHtml}${descHtml}${relHtml}`;

    document.querySelectorAll('.pnj-relation-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = d3nodes.find(n => n.ID === btn.dataset.id);
            if (target) openPanel(target);
        });
    });

    document.getElementById('pnj-detail').classList.add('open');
    highlightConnected(d.ID);
}

function closePanel() {
    document.getElementById('pnj-detail').classList.remove('open');
    updateVisibility();
}

function highlightConnected(id) {
    const connected = new Set([id]);
    d3links.forEach(l => {
        const s = l.source.ID ?? l.source, t = l.target.ID ?? l.target;
        if (s === id) connected.add(t);
        if (t === id) connected.add(s);
    });

    nodeSel.style('opacity', d => {
        if (!isVisible(d)) return 0.06;
        return connected.has(d.ID) ? getNodeOpacity(d) : 0.15;
    });
    linkSel.style('opacity', d => {
        const s = d.source.ID ?? d.source, t = d.target.ID ?? d.target;
        return (s === id || t === id) ? 0.9 : 0.04;
    });
}

// ── Events ─────────────────────────────────────────────────────
document.getElementById('pnj-search').addEventListener('input', e => {
    searchQ = e.target.value.trim();
    updateVisibility();
});

document.getElementById('pnj-detail-close').addEventListener('click', closePanel);

init();
