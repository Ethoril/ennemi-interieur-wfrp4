import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './lib/enquetes-ui-fixture.mjs';
import { flush } from './lib/enquetes-test-dom.mjs';

test('keyboard annotation creation starts at normalized image center',async()=>{
    const f=await fixture({id:'lettre'});
    assert.equal(f.button('Ajouter une annotation au centre').hidden,true);
    f.button('Mode annotation').click();
    assert.equal(f.button('Ajouter une annotation au centre').hidden,false);
    f.button('Ajouter une annotation au centre').click();
    const fields=f.container.querySelector('.enq-editor').querySelectorAll('label');
    for(const name of ['Position horizontale','Position verticale'])assert.equal(fields.find(l=>l.textContent.startsWith(name)).firstChild.value,.5);
    f.view.unmount();
});
test('image click enlarges by default and annotates only in explicit mode',async()=>{
    const f=await fixture({id:'lettre'});const image=f.container.querySelector('.enq-image-box').querySelector('img');
    image.getBoundingClientRect=()=>({left:10,top:20,width:200,height:100});image.dispatch('click',{clientX:60,clientY:70});await flush();
    assert.equal(f.container.querySelector('.enq-editor'),null);assert.ok(f.container.querySelector('.enq-zoom'));
    f.button('Fermer').click();assert.equal(f.d.activeElement,f.button('Agrandir'));
    f.button('Mode annotation').click();image.dispatch('click',{clientX:60,clientY:70});
    const fields=f.container.querySelectorAll('label');assert.equal(fields.find(l=>l.textContent.startsWith('Position horizontale')).firstChild.value,.25);assert.equal(fields.find(l=>l.textContent.startsWith('Position verticale')).firstChild.value,.5);f.view.unmount();
});
test('pins are numbered in file order and linked to focusable annotation rows',async()=>{
    const f=await fixture({id:'lettre'});const markers=f.container.querySelectorAll('.enq-marker');
    assert.deepEqual(markers.map(m=>m.textContent),['1','2']);assert.equal(markers[1].getAttribute('aria-label'),'Annotation 2 : Cette signature semble familière.');
    markers[1].click();assert.equal(f.d.activeElement,f.container.querySelectorAll('.enq-annotation-row')[1]);assert.equal(markers[1].getAttribute('data-highlight'),'true');
    assert.equal(f.button('Pièce suivante'),undefined);f.view.unmount();
});
test('piece navigation follows the dossier order and visibility actions retain their conditions',async()=>{
    const f=await fixture();f.container.querySelector('.enq-slip').click();await flush();
    assert.ok(f.button('Pièce suivante'));assert.equal(f.button('Pièce précédente'),undefined);
    f.button('Pièce suivante').click();await flush();assert.ok(f.button('Pièce précédente'));f.button('Pièce suivante').click();await flush();assert.equal(f.button('Pièce suivante'),undefined);assert.ok(f.button('Publier dans le groupe'));assert.equal(f.button('Masquer chez son auteur'),undefined);f.view.unmount();
    const player=await fixture({role:'joueur',id:'lettre'});assert.equal(player.button('Rendre secret'),undefined);assert.equal(player.button('Mettre en corbeille'),undefined);assert.ok(!player.container.querySelector('.enq-piece-actions').querySelectorAll('button').some(b=>b.textContent==='Modifier'));player.view.unmount();
});
