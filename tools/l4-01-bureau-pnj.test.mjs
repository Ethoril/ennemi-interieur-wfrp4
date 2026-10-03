import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, pnjs, base, parchment, components, doodle, curves] = await Promise.all(
    ['pnjs.html', 'js/pnjs.js', 'css/base.css', 'css/theme-parchment.css', 'css/components.css', 'css/doodle.css', 'js/pnj-link-curves.js']
        .map(path => readFile(path, 'utf8')),
);

// Section PNJ de base.css : du bandeau « PNJs - Réseau interactif » à la modale.
const pnjCss = base.slice(base.indexOf('/* ── PNJs - Réseau interactif'), base.indexOf('/* ── PNJs – Modal édition'));
const rule = (source, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? '';
};

test('la barre d’outils n’a plus de séparateurs et masque les groupes vides', () => {
    assert.doesNotMatch(html, /filter-sep/u);
    for (const id of ['filter-statut', 'filter-vivant', 'filter-lieu', 'filter-groupe']) {
        assert.match(html, new RegExp(`id="${id}" hidden`, 'u'));
    }
    assert.match(pnjs, /el\.hidden = !vals\.length/u);
    assert.match(pnjCss, /\.filter-group\[hidden\]\s*\{\s*display: none;/u);
    assert.match(rule(pnjCss, '.pnj-section .pnj-toolbar'), /column-gap/u);
});

test('les boutons de la page PNJ héritent de la police du texte', () => {
    for (const selector of ['.filter-pill', '.colorby-btn', '.pnj-relation-chip', '.pnj-detail-close', '.btn-edit']) {
        assert.match(rule(pnjCss, selector), /font-family: inherit;/u, selector);
    }
});

test('l’en-tête est compact et l’aide reste pour les lecteurs d’écran', () => {
    assert.doesNotMatch(html, /class="page-header/u);
    assert.match(html, /<h1 class="pnj-title">Personnages<\/h1>/u);
    assert.match(html, /id="pnj-graph-help" class="visually-hidden"/u);
    assert.match(html, /id="pnj-graph"[^>]*aria-describedby="pnj-graph-help"/u);
    const title = rule(pnjCss, '.pnj-toolbar .pnj-title');
    assert.match(title, /font-size: 1\.45rem;/u);
    assert.match(title, /background: none;/u);
    const graph = rule(pnjCss, '#pnj-graph');
    assert.match(graph, /100dvh - var\(--nav-height\) - var\(--pnj-toolbar-h/u);
    assert.match(graph, /min-height: 420px;/u);
    assert.match(pnjs, /setProperty\('--pnj-toolbar-h'/u);
    assert.match(pnjs, /new ResizeObserver/u);
});

test('le module s’appuie sur seal.js et abandonne la transparence des défunts', () => {
    assert.match(pnjs, /import \{[^}]*sealMarkup[^}]*\} from '\.\/seal\.js';/u);
    assert.match(pnjs, /morrMarkup\(/u);
    assert.doesNotMatch(pnjs, /VIVANT_OPACITY|getNodeOpacity/u);
    assert.doesNotMatch(pnjs, /stroke-dasharray', d => \(d\.vivant/u);
    assert.match(rule(pnjCss, '.pnj-deceased'), /filter: grayscale\(1\) contrast\(0\.92\);/u);
    assert.match(pnjs, /node-fate-ring/u);
});

test('les nœuds du graphe sont des boutons clavier', () => {
    assert.match(pnjs, /\.attr\('tabindex', 0\)/u);
    assert.match(pnjs, /\.attr\('role', 'button'\)/u);
    assert.match(pnjs, /\.attr\('aria-label', nodeAriaLabel\)/u);
    assert.match(pnjs, /statut \$\{statutLabel\(d\.statut\)\.toLowerCase\(\)\}, \$\{vitalPhrase\(d\)\}, \$\{d\.lieu \|\| 'lieu inconnu'\}/u);
    assert.match(pnjs, /'sort inconnu'/u);
    assert.match(pnjs, /e\.key !== 'Enter' && e\.key !== ' '/u);
    assert.match(pnjs, /class', 'pnj-link-labels'\)\.attr\('aria-hidden', 'true'\)/u);
});

test('le focus d’un nœud a son propre anneau et le ramène dans le cadre', () => {
    assert.match(pnjs, /attr\('class', 'node-focus-ring'\)/u);
    assert.match(pnjCss, /\.pnj-node:focus-visible \.node-focus-ring \{\s*visibility: visible;/u);
    assert.doesNotMatch(pnjCss, /\.pnj-node:focus-visible \.node-card/u);
    assert.match(pnjCss, /\.pnj-node:hover,\n\.pnj-node:focus-visible \{\s*opacity: 1 !important;/u);
    assert.match(rule(pnjCss, '.node-focus-ring-dark'), /stroke: var\(--focus-ring-dark\);/u);
    assert.match(rule(pnjCss, '.node-focus-ring-light'), /stroke: var\(--focus-ring-light\);/u);
    for (const source of [base, parchment]) {
        assert.match(source, /--focus-ring-light:/u);
        assert.match(source, /--focus-ring-dark:/u);
    }
    assert.match(pnjs, /\.on\('focus', \(e, d\) => revealGraphNode\(d\)\)/u);
    assert.match(pnjs, /state\.zoom\.translateTo, d\.x, d\.y/u);
    // Un nœud filtré ne reçoit jamais le focus ; repli sur le graphe.
    assert.match(pnjs, /node\.getAttribute\('aria-hidden'\) === 'true'/u);
    assert.match(html, /id="pnj-graph" tabindex="-1"/u);
    assert.match(pnjs, /document\.getElementById\('pnj-graph'\)\?\.focus\(\)/u);
    assert.match(rule(pnjCss, '#pnj-graph .pnj-node .seal'), /filter: none;/u);
});

test('le redimensionnement recadre la vue sans toucher à la simulation', () => {
    const observer = pnjs.slice(pnjs.indexOf('const pnjGraph = document.getElementById'));
    assert.doesNotMatch(observer, /forceCenter/u);
    assert.match(observer, /fitGraphView\(\);/u);
    assert.match(observer, /setTimeout\([\s\S]*GRAPH_FIT_DELAY\)/u);
    assert.match(observer, /state\.pendingFit = true/u);
    assert.match(pnjs, /GRAPH_FIT_DELAY = 120/u);
    assert.match(pnjs, /GRAPH_INITIAL_SCALE = 0\.8, GRAPH_MIN_FIT_SCALE = 0\.3/u);
    assert.match(pnjs, /d3\.forceCenter\(state\.layoutW \/ 2, state\.layoutH \/ 2\)/u);
    assert.match(pnjs, /if \(state\.pendingFit\) \{\s*state\.pendingFit = false;\s*fitGraphView\(\);/u);
    assert.match(components, /#pnj-graph > svg \{/u);
    assert.doesNotMatch(components, /#pnj-graph svg \{/u);
});

test('le lien profond n’est honoré qu’une fois et la fiche MJ se réécrit après une relation', () => {
    assert.match(pnjs, /const pnjId = _deepLinkHonored \? null : /u);
    assert.match(pnjs, /if \(state\.nodes\.length\) _deepLinkHonored = true;/u);
    assert.match(pnjs, /_panelReturnId = d\.id;\n/u);
    assert.match(pnjs, /_panelRewrite = \{ id: sourceId, focus: '#add-rel-btn' \}/u);
    assert.match(pnjs, /_panelRewrite = \{ id: panelId, focus: `\.rel-edit-btn\[data-rel=/u);
    assert.match(pnjs, /if \(rewrite \|\| html !== _panelHtml\)/u);
    // Échap ferme d'abord le formulaire de relation ouvert, jamais depuis la recherche.
    assert.match(pnjs, /closest\?\.\('\.rel-edit-form-inline'\)/u);
    assert.match(pnjs, /closest\?\.\('\.rel-add-form'\)/u);
    assert.match(pnjs, /matches\?\.\('input, textarea, select, \[contenteditable\]'\)/u);
    assert.match(html, /id="pnj-deletion-status" class="pnj-cleanup-status" role="status"/u);
    assert.match(pnjs, /status\.setAttribute\('role', 'status'\)/u);
});

test('noms accessibles, états pressés et niveaux de titre du dossier', () => {
    assert.match(html, /<label for="pnj-search" class="visually-hidden">Rechercher un personnage<\/label>/u);
    assert.match(html, /class="view-btn active" data-view="graph" aria-pressed="true"/u);
    assert.match(html, /class="colorby-btn active" data-dim="statut" aria-pressed="true"/u);
    assert.match(pnjs, /b\.setAttribute\('aria-pressed', String\(b\.dataset\.view === view\)\)/u);
    assert.match(pnjs, /b\.setAttribute\('aria-pressed', String\(b\.dataset\.dim === dim\)\)/u);
    assert.match(pnjs, /btn\.setAttribute\('aria-pressed', String\(state\.active\[key\]\.has\(v\)\)\)/u);
    assert.match(pnjs, /aria-label="Modifier la relation avec \$\{esc\(nom\)\}"/u);
    assert.match(pnjs, /aria-label="Supprimer la relation avec \$\{esc\(nom\)\}"/u);
    assert.match(pnjs, /<span class="visually-hidden">État vital : <\/span>/u);
    assert.match(pnjs, /<h3>Relations/u);
    assert.match(pnjs, /<h3>Indices liés<\/h3>/u);
    assert.doesNotMatch(pnjs, /<h4>/u);
    assert.match(pnjCss, /\.pnj-detail-section h3 \{/u);
    assert.match(parchment, /\.pnj-detail-section h3 \{/u);
    assert.doesNotMatch(base + parchment, /\.pnj-detail-section h4/u);
    assert.match(pnjCss, /\.pnj-detail-panel button,\n#pnj-table-container button \{\s*font-family: inherit;/u);
    // Tableau : même clé et même libellé que la fiche pour l'état vital.
    assert.match(pnjs, /vivant-\$\{esc\(vk\)\}">\$\{esc\(vivantLabel\(d\.vivant \|\| 'oui'\)\)\}/u);
});

test('les tables indexées par une donnée passent par Object.hasOwn', () => {
    assert.match(pnjs, /const ownValue = \(table, key\) => Object\.hasOwn\(table, key\)/u);
    assert.match(pnjs, /ownValue\(STATUT_COLOR, /u);
    assert.match(pnjs, /ownValue\(LINK_COLORS, /u);
    assert.match(pnjs, /ownValue\(centers, d\[dim\]\)/u);
    assert.doesNotMatch(pnjs, /STATUT_COLOR\[|LINK_COLORS\[/u);
});

test('les libellés de lien s’écrivent à l’endroit et au centre', () => {
    assert.match(pnjs, /pnj-lpr-\$\{i\}/u);
    assert.match(pnjs, /d\.target\.x < d\.source\.x \? `#pnj-lpr-\$\{i\}` : `#pnj-lp-\$\{i\}`/u);
    assert.match(pnjs, /\.attr\('text-anchor', 'middle'\)/u);
    assert.match(curves, /function bezierPath\([^)]*reversed = false, nodeRadius = 30\)/u);
    assert.match(pnjs, /bezierPath\(d.source.x, d.source.y, d.target.x, d.target.y, d._curveScale \?\? 1, true, NODE_R\)/u);
});

test('les médaillons remplacent les cartouches', () => {
    assert.doesNotMatch(pnjs, /CARD_W|CARD_H|node-accent/u);
    assert.match(pnjs, /PORTRAIT_R = 27\.5, RING_W = 2\.5/u);
    assert.match(curves, /nodeRadius : 30\) \+ 3/u);
    assert.match(pnjs, /d3\.forceCollide\(70\)/u);
    assert.match(pnjCss, /paint-order: stroke;/u);
});

test('l’atténuation autour d’un PNJ sélectionné est plus douce', () => {
    assert.match(pnjs, /connected\.has\(d\.id\) \? 1 : 0\.25/u);
    assert.match(pnjs, /\(s === id \|\| t === id\) \? 0\.9 : 0\.15/u);
});

test('le tableau expose des boutons et l’état de tri', () => {
    assert.match(pnjs, /class="pnj-table-name" data-id=/u);
    assert.match(pnjs, /aria-sort="\$\{ariaSort\}"><button type="button" class="pnj-sort-btn"/u);
    assert.match(pnjs, /'ascending' : 'descending'\) : 'none'/u);
});

test('le panneau de fiche est inerte fermé et gère le focus', () => {
    assert.match(html, /<aside id="pnj-detail" class="pnj-detail-panel"[^>]*\binert>/u);
    assert.match(html, /aria-label="Fermer la fiche">×<\/button>/u);
    assert.doesNotMatch(html, /✕ Fermer/u);
    assert.match(pnjs, /panel\.inert = true;/u);
    assert.match(pnjs, /panel\.inert = false;/u);
    assert.match(pnjs, /<h2 id="pnj-detail-title" tabindex="-1">/u);
    assert.match(pnjs, /e\.key !== 'Escape'/u);
    assert.match(pnjs, /html !== _panelHtml\)/u);
    assert.match(pnjs, /focusPnjOrigin\(_panelReturnId\)/u);
});

test('le dossier : largeur, bandeau, liste de définitions et relations fusionnées', () => {
    assert.match(rule(pnjCss, '.pnj-detail-panel'), /--dossier-w: 420px;/u);
    assert.match(pnjCss, /\.pnj-panel-open \.pnj-section \{\s*padding-right: 420px;/u);
    assert.match(rule(pnjCss, '.pnj-dossier-banner'), /height: 230px;/u);
    assert.match(rule(pnjCss, '.pnj-dossier-portrait'), /object-fit: cover;/u);
    assert.match(pnjs, /<dl class="pnj-detail-meta">/u);
    assert.doesNotMatch(pnjs, /📍|⚔ \$\{/u);
    assert.match(pnjs, /dir: paired \? '↔'/u);
    assert.match(rule(pnjCss, '.rel-chip-row'), /border-left: 3px solid var\(--chip-color/u);
    // Bloc titre sur fond plein : nom et badges ne reposent plus sur le seul dégradé.
    assert.match(rule(pnjCss, '.pnj-dossier-title'), /background: var\(--dossier-bg\);/u);
    assert.match(rule(pnjCss, '.pnj-dossier-title .pnj-badge[class*="vivant-"]'), /var\(--dossier-bg\)\)/u);
});

test('les couleurs de statut passent par les jetons', () => {
    assert.match(base, /--statut-ennemi: #e06a6a;/u);
    assert.doesNotMatch(pnjCss, /\.pnj-badge\.[^{]*\{[^}]*#[0-9a-f]{3,6}/iu);
    assert.match(pnjCss, /\.pnj-badge\.statut-ennemi\s*\{ --badge-color: var\(--statut-ennemi\); \}/u);
    assert.doesNotMatch(rule(pnjCss, '.chip-type'), /opacity/u);
    assert.match(rule(pnjCss, '.pnj-relation-chip'), /color: var\(--text-primary\);/u);
    assert.doesNotMatch(pnjs, /legend-dot" style="background:#/u);
    assert.doesNotMatch(pnjs, /var\(--dim-\d, #/u);
    assert.match(rule(pnjCss, '.graph-legend'), /background: var\(--legend-bg\);/u);
});

test('le parchemin laisse l’anneau à la couleur de dimension', () => {
    // Le papier des médaillons est un jeton déclaré dans les deux thèmes.
    assert.match(base, /--node-paper: var\(--bg-card\);/u);
    assert.match(parchment, /--node-paper: #faf4e8;/u);
    assert.match(rule(pnjCss, '.node-card'), /fill: var\(--node-paper\);/u);
    assert.doesNotMatch(parchment, /\.node-card \{[^}]*stroke/u);
    assert.doesNotMatch(parchment.slice(parchment.indexOf('Médaillons du graphe')), /^[^\n]*#faf4e8/mu);
    assert.match(parchment, /\.pnj-badge\[class\*="statut-"\],\n\[data-theme="parchment"\] \.pnj-badge\[class\*="vivant-"\] \{\s*color: var\(--text-primary\);/u);
    // Pastille « oui » du Doodle : fond sombre sous le texte blanc.
    assert.match(base, /--statut-allie-fond: #2e7a55;/u);
    assert.match(parchment, /--statut-allie-fond: #2d6f47;/u);
    assert.match(doodle, /\.doodle-voter-badge-yes \{\s*background: var\(--statut-allie-fond\);/u);
    const legend = rule(parchment, '[data-theme="parchment"] .graph-legend');
    assert.match(legend, /background: var\(--bg-card\);/u);
    assert.match(legend, /border-color: var\(--border-gold\);/u);
    assert.doesNotMatch(parchment, /\.pnj-badge\.vivant-inconnu \{ color: #8b6508/u);
});

test('les modales d’édition et de cadrage sont de vraies boîtes de dialogue', async () => {
    const confirm = await readFile('js/ui-confirm.js', 'utf8');
    assert.match(html, /<dialog id="crop-modal" class="crop-modal-dialog" aria-labelledby="crop-modal-title">/u);
    assert.match(html, /<h3 id="crop-modal-title">/u);
    assert.match(html, /<dialog id="pnj-modal" class="pnj-modal-dialog" aria-labelledby="pnj-modal-title">/u);
    assert.doesNotMatch(html, /id="(?:crop|pnj)-modal"[^>]*style=/u);
    // Ouverture et fermeture natives, plus aucun basculement par style.display.
    assert.doesNotMatch(pnjs, /getElementById\('(?:pnj|crop)-modal'\)\??\.style/u);
    assert.match(pnjs, /if \(!dialog\.open\) dialog\.showModal\(\);/u);
    assert.match(pnjs, /if \(wasOpen\) dialog\.close\(\);/u);
    assert.match(pnjs, /document\.getElementById\(id\)\?\.open\)\) return;/u);
    assert.match(pnjs, /getElementById\('pnj-modal'\)\?\.open\n/u);
    // Échap passe par le même nettoyage que les boutons.
    assert.match(pnjs, /'crop-modal'\)\.addEventListener\('cancel', e => \{ e\.preventDefault\(\); cancelCropModal\(\); \}\)/u);
    assert.match(pnjs, /'pnj-modal'\)\.addEventListener\('cancel', e => \{ e\.preventDefault\(\); closePnjModal\(\); \}\)/u);
    // Échap dès keydown : un cadrage groupé avec l'édition ne doit pas fermer les deux.
    assert.ok(pnjs.includes("['crop-modal', 'pnj-modal'].forEach(id => document.getElementById(id).addEventListener('keydown'"));
    // Cropper s'initialise après l'ouverture du dialogue.
    assert.ok(pnjs.indexOf('dialog.showModal();\n    img.src = cropSourceUrl;') > 0);
    // Retour du focus au déclencheur, avec le repli de la vue.
    assert.match(pnjs, /_pnjModalReturn = opener && opener !== document\.body/u);
    assert.match(pnjs, /if \(wasOpen\) restorePnjModalFocus\(\);/u);
    assert.match(pnjs, /focusPnjOrigin\(null\);/u);
    assert.match(pnjs, /getElementById\('f-image'\)\.focus\(\)/u);
    // Le dialogue ne dessine rien : le cadre reste celui du contenu.
    const reset = rule(base, '.pnj-modal-dialog,\n.crop-modal-dialog');
    for (const decl of ['margin: auto;', 'padding: 0;', 'border: none;', 'background: transparent;', 'max-width: none;', 'max-height: none;']) {
        assert.ok(reset.includes(decl), decl);
    }
    assert.match(rule(base, '.pnj-modal-dialog::backdrop'), /background: var\(--bg-overlay\);/u);
    assert.match(rule(base, '.crop-modal-dialog::backdrop'), /background: var\(--bg-overlay\);/u);
    assert.doesNotMatch(base, /\.crop-modal-overlay/u);
    // La confirmation annonce son titre et son message à l'arrivée du focus.
    assert.match(confirm, /setAttribute\('aria-labelledby', 'ui-confirm-titre'\)/u);
    assert.match(confirm, /setAttribute\('aria-describedby', 'ui-confirm-message'\)/u);
    assert.match(confirm, /class="ui-confirm-titre" id="ui-confirm-titre"/u);
    assert.match(confirm, /class="ui-confirm-message" id="ui-confirm-message"/u);
});

test('les pastilles de filtre ne sont recréées que si les facettes changent', () => {
    const render = pnjs.slice(pnjs.indexOf('async function loadData'), pnjs.indexOf('async function savePnj'));
    assert.doesNotMatch(render, /clearFilters\(\);/u);
    assert.match(render, /buildFilters\(\);/u);
    assert.match(pnjs, /if \(signature === _filterSignature\) \{/u);
    assert.match(pnjs, /vals\.map\(v => \[v, filterPillLabel\(key, v\)\]\)/u);
    assert.match(pnjs, /reconcileFilterSets\(state\.active, available\);\n    const signature/u);
    assert.match(pnjs, /btn\.dataset\.dim = key;\n\s*btn\.dataset\.value = v;/u);
    // Focus rendu à la pastille équivalente, au groupe, puis à la recherche.
    assert.match(pnjs, /pills\.find\(btn => btn\.dataset\.value === focusedValue\) \|\| pills\[0\]\n\s*\|\| document\.getElementById\('pnj-search'\)\)\?\.focus\(\)/u);
    // Région live : pas de réécriture à l'identique.
    assert.match(pnjs, /if \(badge && badge\.textContent !== text\) badge\.textContent = text;/u);
    assert.doesNotMatch(pnjs, /badge\.textContent = activeCount/u);
});
