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
