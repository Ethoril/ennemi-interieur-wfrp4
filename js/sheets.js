/* ================================================
   GOOGLE SHEETS — Dynamic Data Fetcher & Renderer
   ================================================ */

const SHEET_ID = '1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs';

const TABS = [
    { id: 'couts-xp', name: 'Coûts XP', icon: '📈', sheet: 'Co%C3%BBts%20XP' },
    { id: 'magie', name: 'Magie', icon: '✨', sheet: 'Magie' },
    { id: 'miracles', name: 'Miracles', icon: '🙏', sheet: 'Miracles' },
    { id: 'armes-cac', name: 'Armes CàC', icon: '⚔️', sheet: 'Armes%20Corps%20%C3%A0%20Corps' },
    { id: 'armes-dist', name: 'Armes à Distance', icon: '🏹', sheet: 'Armes%20%C3%A0%20Distance' },
    { id: 'armures', name: 'Armures', icon: '🛡️', sheet: 'Armures' },
    { id: 'talents', name: 'Talents', icon: '🎭', sheet: 'Talents' },
    { id: 'mots-cles', name: 'Mots Clés', icon: '🔑', sheet: 'Mots%20Cl%C3%A9s%20Armes%20et%20Armures' }
];

// Cache to avoid refetching
const dataCache = {};

// ── CSV Parser ────────────────────────────────────
function parseCSV(csv) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];

    for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        const next = csv[i + 1];

        if (inQuotes) {
            if (ch === '"' && next === '"') {
                current += '"';
                i++;
            } else if (ch === '"') {
                inQuotes = false;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(current.trim());
                current = '';
            } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
                row.push(current.trim());
                if (row.some(cell => cell !== '')) rows.push(row);
                row = [];
                current = '';
                if (ch === '\r') i++;
            } else {
                current += ch;
            }
        }
    }
    // Last row
    row.push(current.trim());
    if (row.some(cell => cell !== '')) rows.push(row);

    return rows;
}

// ── Fetch Sheet Data ──────────────────────────────
async function fetchSheetData(sheetName) {
    if (dataCache[sheetName]) return dataCache[sheetName];

    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const csv = await response.text();
        const rows = parseCSV(csv);

        if (rows.length < 2) return { headers: [], data: [] };

        let headers = rows[0];
        let dataStart = 1;

        // Fix: detect corrupted first row from merged cells in Google Sheets
        // If a header cell contains newlines, it means multiple data values got merged
        const firstRowCorrupted = headers.some(h => h.includes('\n'));
        if (firstRowCorrupted) {
            // Extract real header names (first word/line of each cell)
            headers = headers.map(h => {
                const firstLine = h.split('\n')[0].trim();
                return firstLine;
            });
            // Skip this corrupted row entirely (data starts from row 2)
            dataStart = 1;
        }

        const data = rows.slice(dataStart).filter(r => r.some(c => c !== ''));

        dataCache[sheetName] = { headers, data };
        return { headers, data };
    } catch (err) {
        console.error('Erreur fetch sheet:', err);
        return { headers: [], data: [], error: err.message };
    }
}

// ── Render Cards ──────────────────────────────────
function renderCards(container, headers, data, tabId) {
    if (data.length === 0) {
        container.innerHTML = '<p class="sheet-empty">Aucune donnée disponible.</p>';
        return;
    }

    // Special layout for Coûts XP (simple table works better)
    if (tabId === 'couts-xp') {
        container.style.display = 'block';
        renderTable(container, headers, data);
        return;
    }

    // Special layout for Mots Clés (definition list)
    if (tabId === 'mots-cles') {
        container.style.display = 'block';
        renderDefinitions(container, headers, data);
        return;
    }

    // Card layout for everything else
    container.style.display = 'grid';
    let html = '';
    data.forEach((row, idx) => {
        // For magic tab, detect wind of magic from Type column
        let windAttr = '';
        if (tabId === 'magie') {
            const typeIdx = headers.findIndex(h => h.toLowerCase() === 'type' || h.toLowerCase() === 'catégorie');
            if (typeIdx >= 0 && row[typeIdx]) {
                const windName = row[typeIdx].split(/[\s–-]/)[0].trim().toLowerCase();
                windAttr = ` data-wind="${windName}"`;
            }
        }
        html += `<div class="sheet-card"${windAttr} style="animation-delay: ${idx * 0.03}s">`;

        // Title: use 2nd column (Nom) if it exists, else 1st
        const nameIdx = headers.findIndex(h => h.toLowerCase() === 'nom');
        const titleIdx = nameIdx >= 0 ? nameIdx : 0;
        const title = row[titleIdx] || '';

        // Type/Category badge
        const typeIdx = headers.findIndex(h =>
            h.toLowerCase() === 'type' || h.toLowerCase() === 'catégorie'
        );
        const typeBadge = typeIdx >= 0 && row[typeIdx]
            ? `<span class="sheet-badge">${escapeHtml(row[typeIdx])}</span>`
            : '';

        html += `<div class="sheet-card-header">
      <h4 class="sheet-card-title">${escapeHtml(title)}</h4>
      ${typeBadge}
    </div>`;

        // Other fields as key-value pairs
        html += '<div class="sheet-card-body">';
        headers.forEach((header, i) => {
            if (i === titleIdx || (typeIdx >= 0 && i === typeIdx)) return;
            if (!row[i] || row[i] === '') return;

            const isLong = row[i].length > 100;
            html += `<div class="sheet-field ${isLong ? 'sheet-field-full' : ''}">
        <span class="sheet-field-label">${escapeHtml(header)}</span>
        <span class="sheet-field-value">${formatText(row[i])}</span>
      </div>`;
        });
        html += '</div></div>';
    });

    container.innerHTML = html;
}

// ── Render Table (for Coûts XP) ───────────────────
function renderTable(container, headers, data) {
    // "Coûts XP" has two sub-tables side by side:
    // Left: cols 0-2 (Augmentations, Caractéristiques, Compétences)
    // Right: cols 5-6 (Augmentations, Coût en PX)
    // Cols 3-4 are spacers

    // Fix known missing value: +1 Talent cost
    const TALENT_COST_FIX = '100 PX + 100 PX par fois où le Talent a déjà été pris';

    // Left table (Augmentations de Caractéristiques/Compétences)
    let html = '<h4 style="color: var(--gold); margin-bottom: var(--space-sm);">Augmentations de Caractéristiques & Compétences</h4>';
    html += '<div class="sheet-table-wrapper"><table class="rules-table">';
    html += '<thead><tr><th>Augmentations</th><th>Caractéristiques</th><th>Compétences</th></tr></thead><tbody>';
    data.forEach(row => {
        if (row[0] && row[0] !== '') {
            html += `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1] || '')}</td><td>${escapeHtml(row[2] || '')}</td></tr>`;
        }
    });
    html += '</tbody></table></div>';

    // Right table (Coûts fixes)
    html += '<h4 style="color: var(--gold); margin-top: var(--space-xl); margin-bottom: var(--space-sm);">Autres Coûts</h4>';
    html += '<div class="sheet-table-wrapper"><table class="rules-table">';
    html += '<thead><tr><th>Augmentation</th><th>Coût en PX</th></tr></thead><tbody>';
    data.forEach(row => {
        if (row[5] && row[5] !== '') {
            let cost = row[6] || '';
            if (row[5] === '+1 Talent' && cost === '') {
                cost = TALENT_COST_FIX;
            }
            html += `<tr><td>${escapeHtml(row[5])}</td><td>${escapeHtml(cost)}</td></tr>`;
        }
    });
    html += '</tbody></table></div>';

    container.innerHTML = html;
}

// ── Render Definitions (for Mots Clés) ────────────
function renderDefinitions(container, headers, data) {
    let html = '';
    data.forEach((row, idx) => {
        html += `<div class="sheet-definition" style="animation-delay: ${idx * 0.03}s">
      <dt class="sheet-def-term">${escapeHtml(row[0] || '')}</dt>
      <dd class="sheet-def-desc">${formatText(row[1] || '')}</dd>
    </div>`;
    });
    container.innerHTML = `<dl class="sheet-def-list">${html}</dl>`;
}

// ── Escape HTML special characters ────────────────
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Format text (line breaks, bullet points) ──────
function formatText(text) {
    return escapeHtml(text)
        .replace(/\n/g, '<br>')
        .replace(/•/g, '<br>•');
}

// ── Search / Filter ───────────────────────────────
function stripAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function filterCards(container, query) {
    const cards = container.querySelectorAll('.sheet-card, .sheet-definition, .sheet-table-wrapper tr');
    const q = stripAccents(query.toLowerCase());

    cards.forEach(card => {
        const text = stripAccents(card.textContent.toLowerCase());
        card.style.display = text.includes(q) ? '' : 'none';
    });
}

// ── Initialize ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const tabContainer = document.getElementById('sheet-tabs');
    const contentContainer = document.getElementById('sheet-content');
    const searchInput = document.getElementById('sheet-search');
    const loadingEl = document.getElementById('sheet-loading');
    const sheetLink = document.getElementById('sheet-link');

    if (!tabContainer || !contentContainer) return;

    // Set direct link
    if (sheetLink) {
        sheetLink.href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`;
    }

    // Build tab buttons
    let tabsHtml = '';
    TABS.forEach((tab, i) => {
        tabsHtml += `<button class="sheet-tab ${i === 0 ? 'active' : ''}"
      data-tab="${tab.id}" data-sheet="${tab.sheet}">
      <span class="sheet-tab-icon">${tab.icon}</span>
      <span class="sheet-tab-name">${tab.name}</span>
    </button>`;
    });
    tabContainer.innerHTML = tabsHtml;

    // Load first tab
    loadTab(TABS[0]);

    // Tab click handlers
    tabContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.sheet-tab');
        if (!btn) return;

        tabContainer.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');

        const tabId = btn.dataset.tab;
        const tab = TABS.find(t => t.id === tabId);
        if (tab) loadTab(tab);

        // Clear search
        if (searchInput) searchInput.value = '';
    });

    // Search handler
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterCards(contentContainer, e.target.value);
        });
    }

    async function loadTab(tab) {
        if (loadingEl) loadingEl.style.display = 'flex';
        contentContainer.innerHTML = '';

        const { headers, data, error } = await fetchSheetData(tab.sheet);

        if (loadingEl) loadingEl.style.display = 'none';

        if (error) {
            contentContainer.innerHTML = `<p class="sheet-error">Erreur de chargement : ${error}</p>`;
            return;
        }

        renderCards(contentContainer, headers, data, tab.id);
    }
});
