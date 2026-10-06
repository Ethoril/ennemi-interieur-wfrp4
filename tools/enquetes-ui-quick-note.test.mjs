import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './lib/enquetes-ui-fixture.mjs';
import { flush } from './lib/enquetes-test-dom.mjs';
test('desktop quick note uses the shared save and private link circuit',async()=>{
    const f=await fixture();const form=f.container.querySelector('.enq-quick-form'),text=form.querySelector('textarea');
    text.value='Un nom entendu';text.dispatch('input');form.dispatch('submit');await flush();
    const notes=f.calls.filter(c=>c.type==='notes');assert.equal(notes.length,1);assert.equal(notes[0].zone,'user:a');assert.equal(notes[0].body.titre,'');
    assert.equal(f.calls.filter(c=>c.type==='liens'&&c.body.b==='affaire').length,1);assert.equal(f.drafts.size,0);assert.equal(f.container.querySelector('.enq-status').textContent,'Notée');f.view.unmount();
});
test('quick draft restores by context after remount and remains after network failure',async()=>{
    const f=await fixture(),text=f.container.querySelector('.enq-quick-form').querySelector('textarea');text.value='Une piste à garder';text.dispatch('input');f.view.unmount();
    const g=await fixture({drafts:f.drafts});assert.equal(g.container.querySelector('.enq-quick-form').querySelector('textarea').value,'Une piste à garder');g.hook(()=>{throw new Error('Réseau coupé');});g.container.querySelector('.enq-quick-form').dispatch('submit');await flush();assert.equal(g.drafts.size,1);assert.match(g.container.querySelector('.enq-status').textContent,/brouillon est conservé/u);g.view.unmount();
});
test('mobile sheet stores each selected target and returns focus on close',async()=>{
    const f=await fixture({layout:'mobile'}),fab=f.button('✎ Note rapide');fab.focus();fab.click();const dialog=f.container.querySelector('.enq-quick-sheet');
    assert.equal(f.d.activeElement.tagName,'textarea');dialog.querySelector('textarea').value='Un suspect';dialog.querySelector('textarea').dispatch('input');
    const pnj=dialog.querySelectorAll('button').find(b=>b.textContent==='Johannes Teugen');pnj.click();dialog.querySelector('form').dispatch('submit');await flush();
    assert.equal(f.calls.filter(c=>c.type==='notes').length,1);assert.deepEqual(f.calls.filter(c=>c.type==='liens').map(c=>c.body.b).sort(),['affaire','marchand']);assert.equal(f.d.activeElement,fab);f.view.unmount();
});
test('mobile note on the list is unclassified and offline save retains its discoverable draft',async()=>{
    const f=await fixture({layout:'mobile',id:null});f.button('✎ Note rapide').click();const form=f.container.querySelector('.enq-quick-sheet').querySelector('form');form.querySelector('textarea').value='Sans dossier';form.dispatch('submit');await flush();assert.equal(f.calls.filter(c=>c.type==='liens').length,0);f.view.unmount();
    const g=await fixture();g.session.offline=true;g.emit();const quick=g.container.querySelector('.enq-quick-form');quick.querySelector('textarea').value='Hors ligne';quick.dispatch('submit');await flush();assert.equal(g.calls.length,0);assert.equal(g.drafts.size,1);assert.match(quick.querySelector('.enq-save-status').textContent,/Hors connexion/u);g.view.unmount();
});
test('typing while quick save is pending preserves the newer text',async()=>{
    const f=await fixture();let finish;f.hook(()=>new Promise(resolve=>{finish=resolve;}));const form=f.container.querySelector('.enq-quick-form'),text=form.querySelector('textarea');text.value='Version envoyée';text.dispatch('input');form.dispatch('submit');await flush();text.value='Version suivante';text.dispatch('input');finish();f.hook(null);await flush();
    assert.equal([...f.drafts.values()][0].body.texte,'Version suivante');assert.equal([...f.drafts.values()][0].baseRevision,1);f.view.unmount();
});
test('desktop quick note on a note follows a link added after opening it',async()=>{
    const f=await fixture({id:'nonclassee'});f.records.push({id:'lx',type:'liens',zone:'user:a',a:'nonclassee',b:'affaire',role:'',revision:1,authorUid:'a'});f.emit();await flush();
    const form=f.container.querySelector('.enq-quick-form');form.querySelector('textarea').value='Liée après coup';form.dispatch('submit');await flush();
    assert.deepEqual(f.calls.filter(c=>c.type==='liens').map(c=>c.body.b),['affaire']);f.view.unmount();
});
test('mobile notebook picks up the draft left in the quick sheet',async()=>{
    const f=await fixture({layout:'mobile'});f.button('✎ Note rapide').click();const dialog=f.container.querySelector('.enq-quick-sheet');
    dialog.querySelector('textarea').value='Brouillon de la feuille';dialog.querySelector('textarea').dispatch('input');dialog.querySelectorAll('button').find(b=>b.textContent==='Fermer').click();await flush();
    f.container.querySelectorAll('button').find(b=>b.textContent.startsWith('Mes notes')).click();await flush();
    assert.equal(f.container.querySelector('.enq-quick-form').querySelector('textarea').value,'Brouillon de la feuille');f.view.unmount();
});
test('mobile list scrolls back to the top when the space changes',async()=>{
    const f=await fixture({layout:'mobile',id:null});f.container.scrollTop=300;f.emit();await flush();assert.equal(f.container.scrollTop,300);
    f.container.querySelectorAll('button').find(b=>b.textContent.startsWith('Pièces')).click();await flush();assert.equal(f.container.scrollTop,0);f.view.unmount();
});
