import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './lib/enquetes-ui-fixture.mjs';
import { flush } from './lib/enquetes-test-dom.mjs';
test('dossier numbers evidence once, separates cast and timeline, and releases thumbnails',async()=>{
    const f=await fixture();
    assert.deepEqual(f.container.querySelectorAll('.enq-slip-number').map(n=>n.textContent),['PIÈCE N° 1','PIÈCE N° 2','PIÈCE N° 3']);
    assert.equal(f.container.querySelector('.enq-links'),null);assert.ok(f.container.querySelector('.enq-cast'));assert.ok(f.container.querySelector('.enq-timeline'));
    assert.equal(f.container.querySelectorAll('.enq-slip-thumbnail').length,1);
    f.button('L’héritage de Kastor Lieberung').click();await flush();assert.deepEqual(f.released,['qa_image']);f.view.unmount();
});
test('dossier actions retain existing audience and author permissions',async()=>{
    const gm=await fixture();for(const label of ['Modifier','Relier un objet','Ajouter une relation','Ordonner les pièces','Rendre secret','Exporter','Voir l’historique','Mettre en corbeille'])assert.ok(gm.button(label),label);gm.view.unmount();
    const player=await fixture({role:'joueur'});
    const menu=player.container.querySelector('.enq-action-menu');
    const labels=menu.querySelectorAll('button').map(b=>b.textContent);
    assert.ok(!labels.includes('Modifier'));assert.ok(!labels.includes('Mettre en corbeille'));assert.ok(!labels.includes('Ordonner les pièces'));assert.ok(labels.includes('Exporter'));player.view.unmount();
});
