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
