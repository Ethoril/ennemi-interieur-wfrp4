import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { MIDDENHEIM_MAP } from '../js/middenheim-map.js';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Middenheim est public et sa visionneuse ne dépend pas des données Carnaval', async () => {
    const [cards, viewer, maps] = await Promise.all([read('cartes.html'), read('carte.html'), read('js/maps.js')]);
    assert.match(cards, /href="carte\.html\?map=middenheim"/u);
    assert.match(cards, /img\/thumb-middenheim\.webp/u);
    assert.match(viewer, /js\/maps\.js/u);
    assert.doesNotMatch(maps, /carnaval-repository|bureau-data|watchAuth|firebase/iu);
    assert.equal(MIDDENHEIM_MAP.places.length, 5);
    for (const place of MIDDENHEIM_MAP.places) {
        assert.ok(place.x > 0 && place.x < MIDDENHEIM_MAP.width);
        assert.ok(place.y > 0 && place.y < MIDDENHEIM_MAP.height);
    }
});

test('le shell précaché contient les modules mais aucune source ou campagne privée', async () => {
    const [html, ui, sw, composition] = await Promise.all([read('carnaval.html'), read('js/carnaval.js'), read('sw.js'), read('js/bureau-data.js')]);
    assert.match(html, /id="carnaval-app" hidden/u);
    assert.match(ui, /watchAuth\(handleAuth\)/u);
    assert.match(composition, /const carnaval = isAdmin/u);
    assert.match(sw, /'\.\/carnaval\.html'/u);
    assert.match(sw, /'\.\/js\/data\/carnaval-repository\.js'/u);
    assert.doesNotMatch(`${html}${ui}${sw}`, /carnaval-source\.json|data-privees|carnaval_sources\/current/u);
    assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/u);
});

test('le bureau propose les rendez-vous et les lieux libres dans le formulaire et la barre d’outils', async () => {
    const html = await read('carnaval.html');
    assert.match(html, /id="show-rendezvous"/u);
    assert.match(html, /<option value="rendezvous"/u);
    assert.match(html, /name="placeName"/u);
    assert.match(html, /id="place-name-wrap"/u);
});

test('l’interface du Carnaval gère rendez-vous et lieux libres sans stockage local', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /import \{[^}]*\bcampaignPlaces\b[^}]*\} from '\.\/carnaval-model\.js'/u);
    assert.match(ui, /campaignPlaces\(state\.source, ?state\.campaign\)/u);
    assert.match(ui, /showRendezvous/u);
    assert.match(ui, /is-rendezvous/u);
    assert.match(ui, /__other__/u);
    assert.match(ui, /Un rendez-vous exige une heure de début\./u);
    assert.doesNotMatch(ui, /localStorage|indexedDB/u);
});

test('le bureau propose le bandeau des camps et la gestion des détenteurs de voix', async () => {
    const html = await read('carnaval.html');
    for (const id of ['court-tally', 'open-holders', 'holders-dialog', 'holders-list', 'holder-form']) assert.match(html, new RegExp(`id="${id}"`, 'u'));
});

test('l’interface du Carnaval totalise et modifie les détenteurs sans stockage local', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /import \{[^}]*\bholderTally\b[^}]*\} from '\.\/carnaval-model\.js'/u);
    assert.match(ui, /import \{[^}]*\bCAMPS\b[^}]*\} from '\.\/carnaval-model\.js'/u);
    assert.match(ui, /holderTally\(/u);
    assert.match(ui, /changedAt/u);
    for (const message of ['Détenteur enregistré.', 'Détenteur supprimé.', 'Camp modifié.']) assert.ok(ui.includes(message), message);
    assert.doesNotMatch(ui, /localStorage|indexedDB/u);
});

test('le bureau propose les filtres de suivi de la vue PNJ', async () => {
    const html = await read('carnaval.html');
    for (const id of ['character-tracking-filters', 'met-filter', 'camp-filter']) assert.match(html, new RegExp(`id="${id}"`, 'u'));
});

test('l’interface du Carnaval note le suivi des personnages sans stockage local', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /import \{[^}]*\bATTITUDES\b[^}]*\} from '\.\/carnaval-model\.js'/u);
    assert.match(ui, /import \{[^}]*\bholderOfCharacter\b[^}]*\} from '\.\/carnaval-model\.js'/u);
    assert.match(ui, /[.]{3}ATTITUDES/u);
    assert.match(ui, /holderOfCharacter\(/u);
    assert.match(ui, /character-tracking/u);
    assert.match(ui, /tracking/u);
    for (const text of ['Suivi enregistré.', 'Rencontré', 'Attitude envers les PJ', 'Note de suivi']) assert.ok(ui.includes(text), text);
    assert.doesNotMatch(ui, /last-of-type/u);
    assert.doesNotMatch(ui, /localStorage|indexedDB/u);
});

test('l’interface du Carnaval tient les présentations sans stockage local ni écriture des relations', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /import \{[^}]*\bintroductionsFor\b[^}]*\} from '\.\/carnaval-model\.js'/u);
    assert.match(ui, /introductionsFor\(/u);
    assert.match(ui, /character-introductions/u);
    for (const text of ['Peut présenter à', 'Présenté par', 'Présentation ajoutée.', 'Présentation retirée.']) assert.ok(ui.includes(text), text);
    assert.doesNotMatch(ui, /localStorage|indexedDB/u);
    assert.doesNotMatch(ui, /relations\??\.(?:add|set|save|update|delete|remove|create|put|write)\w*\(/u);
});

const sliceOf = (source, start, end) => { const from = source.indexOf(start), to = source.indexOf(end, from); assert.ok(from >= 0 && to > from, `${start} introuvable`); return source.slice(from, to); };

test('openCharacter ne lie qu’une fois le suivi, les présentations et l’association d’un personnage sans fiche', async () => {
    const ui = await read('js/carnaval.js');
    const body = sliceOf(ui, 'async function openCharacter(', 'function renderRelations(');
    assert.equal(body.split('bindTracking(id)').length - 1, 2);
    assert.equal(body.split('bindIntroductions(id)').length - 1, 2);
    assert.equal(body.split("'#associate-pnj'").length - 1, 1);
});

test('le moment du suivi et du changement de camp vient de l’horloge de campagne', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /state\.campaign\?\.clock\?\.day/u);
    assert.match(ui, /state\.campaign\?\.clock\?\.minute/u);
    for (const [start, end] of [['function trackingHtml(', 'function bindTracking('], ['function bindTracking(', 'function introductionsHtml('], ['$(\'#holders-list\').addEventListener(\'change\'', '$(\'#holder-form\').addEventListener(\'submit\''], ['$(\'#holder-form\').addEventListener(\'submit\'', 'function collectClock(']])
        assert.doesNotMatch(sliceOf(ui, start, end), /changedAt:\{ day:state\.selectedDay|state\.selectedDay\)|\?\? state\.selectedDay/u, start);
});

test('le détenteur du personnage s’affiche dans l’itinéraire de la vue PNJ', async () => {
    const ui = await read('js/carnaval.js');
    const body = sliceOf(ui, 'function renderLocations(', "$('#locations-view').addEventListener");
    assert.match(body, /holderLine\(/u);
    assert.match(body, /holderOfCharacter\(state\.campaign, character\.id\)/u);
});

test('les messages d’état atteignent la zone du dialogue modal ouvert', async () => {
    const [html, ui, css] = await Promise.all([read('carnaval.html'), read('js/carnaval.js'), read('css/carnaval.css')]);
    for (const id of ['holders-dialog', 'event-dialog']) assert.match(sliceOf(html, `<dialog id="${id}"`, '</dialog>'), /<p class="carnaval-dialog-status" role="status" aria-live="polite" data-dialog-status><\/p>/u, id);
    assert.match(sliceOf(ui, 'function setStatus(', 'function clearDialogStatus('), /dialog\[open\] \[data-dialog-status\]/u);
    assert.match(css, /\.carnaval-dialog-status/u);
});

test('rafraîchir le panneau conserve la saisie et le focus, et « Présentations » replace le focus', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /async function renderDrawerIfOpen\(/u);
    assert.match(sliceOf(ui, 'async function renderDrawerIfOpen(', 'function closeDrawer('), /await openCharacter\(/u);
    assert.match(ui, /focusHeading/u);
    assert.match(ui, /openCharacter\(button\.dataset\.openCharacter, ?\{ focusHeading: ?true \}\)/u);
});

test('petits points d’accessibilité du Carnaval', async () => {
    const [html, ui] = await Promise.all([read('carnaval.html'), read('js/carnaval.js')]);
    assert.match(html, /<section class="carnaval-clock" aria-label=/u);
    assert.match(html, /<div id="court-tally" class="carnaval-tally"><span id="court-tally-text" role="status">/u);
    assert.match(html, /id="holder-form"[^>]*aria-labelledby="holder-form-title"/u);
    assert.match(ui, /<h3 id="introductions-heading" tabindex="-1">|<h3 tabindex="-1">Présentations/u);
    assert.ok(ui.includes('Présenter à'));
    assert.match(ui, /aria-label="Modifier le détenteur \$\{esc\(holder\.label\)\}"/u);
    assert.match(ui, /aria-label="Supprimer le détenteur \$\{esc\(holder\.label\)\}"/u);
});

test('le changement de camp attend le bouton « Appliquer » au lieu d’enregistrer à chaque choix', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /data-apply-camp="\$\{esc\(holder\.id\)\}" aria-label="Appliquer le camp de \$\{esc\(holder\.label\)\}" disabled>Appliquer<\/button>/u);
    const onChange = ui.slice(ui.indexOf("$('#holders-list').addEventListener('change'"), ui.indexOf('async function applyCamp'));
    assert.ok(onChange.length > 0 && !onChange.includes('commit'), 'le choix du camp ne doit rien enregistrer');
    assert.match(ui, /async function applyCamp\(id\)[\s\S]*?commitHolders\(/u);
});

test('une présence dans un rendez-vous parle des horaires du rendez-vous, pas du spectacle', async () => {
    const ui = await read('js/carnaval.js');
    assert.match(ui, /horaires \$\{event\.kind === 'rendezvous' \? 'du rendez-vous' : 'du spectacle'\}/u);
});
