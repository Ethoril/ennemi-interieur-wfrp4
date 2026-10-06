import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './lib/enquetes-ui-fixture.mjs';
import { createDocument,flush } from './lib/enquetes-test-dom.mjs';
import { createActionMenu } from '../js/enquetes-menu.js';

test('mobile reading position survives metadata and content updates',async()=>{
    const f=await fixture({layout:'mobile',id:'lettre'});f.container.scrollTop=360;
    f.records.find(r=>r.id==='lettre').fromCache=true;f.emit();await flush();assert.equal(f.container.scrollTop,360);
    f.records.find(r=>r.id==='lettre').description='Une description actualisée';f.emit();await flush();assert.equal(f.container.scrollTop,360);f.view.unmount();
});

test('quick note input and selection survive an update on desktop and mobile notebook',async()=>{
    for(const layout of ['desktop','mobile']){
        const f=await fixture({layout});if(layout==='mobile')f.button('Mes notes 1').click();
        const text=f.container.querySelector('.enq-quick-form').querySelector('textarea');text.value='Une piste à garder';text.dispatch('input');text.focus();text.setSelectionRange(3,8);
        f.records.find(r=>r.id==='hypothese').texte='Note existante actualisée';f.emit();await flush();
        assert.equal(f.container.querySelector('.enq-quick-form').querySelector('textarea'),text);assert.equal(f.d.activeElement,text);assert.deepEqual([text.selectionStart,text.selectionEnd],[3,8]);
        text.dispatch('keydown',{key:'/'});assert.equal(f.d.activeElement,text);f.view.unmount();
    }
});

test('quick note opened from a note targets its linked objects and never another note',async()=>{
    const f=await fixture({id:'hypothese'});assert.equal(f.button('Relier à ce dossier'),undefined);
    const form=f.container.querySelector('.enq-quick-form');form.querySelector('textarea').value='Nouvelle hypothèse';form.dispatch('submit');await flush();
    const links=f.calls.filter(c=>c.type==='liens');assert.ok(links.length);assert.ok(links.every(c=>['enquetes','documents','pnjs'].includes(f.records.find(r=>r.id===c.body.b)?.type)));assert.ok(links.every(c=>c.body.b!=='hypothese'));f.view.unmount();
});

test('two consecutive quick submissions create distinct notes even without local storage',async()=>{
    const f=await fixture({localDrafts:false}),form=f.container.querySelector('.enq-quick-form'),text=form.querySelector('textarea');
    text.value='Première piste';text.dispatch('input');assert.match(form.querySelector('.enq-save-status').textContent,/Brouillon local indisponible/);form.dispatch('submit');await flush();
    text.value='Seconde piste';text.dispatch('input');form.dispatch('submit');await flush();
    const notes=f.calls.filter(c=>c.type==='notes');assert.equal(notes.length,2);assert.notEqual(notes[0].id,notes[1].id);assert.deepEqual(notes.map(c=>c.baseRevision),[0,0]);f.view.unmount();
});

test('ArrowDown on menu trigger opens on the first item without bubbling navigation',()=>{
    const d=createDocument(),menu=createActionMenu({documentRef:d,label:'Actions',items:[{label:'Premier',action(){}},{label:'Second',action(){}}]});d.append(menu.element);
    menu.element.firstChild.dispatch('keydown',{key:'ArrowDown'});assert.equal(d.activeElement.textContent,'Premier');
});

test('zoom retains its own URL across rerenders and releases it only on close or unmount',async()=>{
    const f=await fixture({id:'lettre'});f.button('Agrandir').click();await flush();const dialog=f.container.querySelector('.enq-zoom');
    f.records.find(r=>r.id==='lettre').description='Actualisée';f.emit();await flush();
    assert.equal(dialog.open,true);assert.ok(f.container.contains(dialog));const before=f.released.length;dialog.close();assert.equal(f.released.length,before+1);
    f.button('Agrandir').click();await flush();const count=f.objectUrls.length;f.view.unmount();assert.equal(f.released.length,count);
});

test('an open dossier displays its conclusion before evidence on desktop and mobile',async()=>{
    for(const layout of ['desktop','mobile']){
        const f=await fixture({layout});if(layout==='mobile')f.button('Pièces 3').click();f.records.find(r=>r.id==='affaire').conclusion='Une conclusion encore provisoire';f.emit();await flush();
        const conclusion=f.container.querySelector('.enq-conclusion');assert.ok(conclusion);assert.equal(conclusion.querySelector('h3').textContent,'Conclusion');
        assert.ok(f.container.querySelector('.enq-detail').querySelectorAll('section').indexOf(conclusion)<f.container.querySelector('.enq-detail').querySelectorAll('section').indexOf(f.container.querySelector('.enq-pieces')));f.view.unmount();
    }
});

test('file metadata cache invalidates on file IDs and thumbnails request the small variant',async()=>{
    const f=await fixture();const initial=f.reads.filter(v=>v.action==='files').length;assert.ok(f.objectUrls.some(v=>v.options?.thumbnail));
    f.records.find(r=>r.id==='affaire').question='Question actualisée';f.emit();await flush();assert.equal(f.reads.filter(v=>v.action==='files').length,initial);
    f.records.find(r=>r.id==='lettre').files.push('nouveau');f.emit();await flush();assert.equal(f.reads.filter(v=>v.action==='files').length,initial+1);f.view.unmount();
});

test('history has a visible labelled heading and Escape closure restores its trigger',async()=>{
    const f=await fixture(),trigger=f.container.querySelector('.enq-actions').querySelector('.enq-icon-button');trigger.focus();trigger.click();f.button('Voir l’historique').click();await flush();
    const dialog=f.container.querySelector('dialog'),heading=dialog.querySelector('h2');assert.equal(heading.textContent,'Historique');assert.equal(dialog.getAttribute('aria-labelledby'),heading.id);
    dialog.close();assert.equal(f.container.querySelector('dialog'),null);assert.equal(f.d.activeElement,trigger);f.view.unmount();
});

test('restored mobile search remains visibly editable',async()=>{
    const f=await fixture({layout:'mobile',id:null});f.container.querySelectorAll('button').find(e=>e.getAttribute('aria-label')==='Ouvrir la recherche').click();const search=f.container.querySelectorAll('input').find(e=>e.getAttribute('aria-label')==='Rechercher dans cet espace');search.value='Teugen';search.dispatch('input');f.view.unmount();
    const g=await fixture({layout:'mobile',id:null}),restored=g.container.querySelectorAll('input').find(e=>e.getAttribute('aria-label')==='Rechercher dans cet espace');assert.equal(restored.value,'Teugen');assert.equal(restored.hidden,false);g.view.unmount();
});
