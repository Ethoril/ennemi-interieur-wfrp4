import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './lib/enquetes-ui-fixture.mjs';
import { flush } from './lib/enquetes-test-dom.mjs';
test('mobile list contains only the rail and opening a card navigates without stacking detail',async()=>{
    const f=await fixture({layout:'mobile',id:null});assert.equal(f.container.querySelector('.enq-detail'),null);assert.ok(f.container.querySelector('.enq-list'));
    f.button('Qui finance la Main Pourpre ?').click();assert.deepEqual(f.opened,['affaire']);assert.equal(f.container.querySelector('.enq-detail'),null);f.view.unmount();
});
test('mobile dossier has four keyboard tabs, no rail, and an external action menu',async()=>{
    const f=await fixture({layout:'mobile'});assert.equal(f.container.querySelector('.enq-list'),null);
    const tabs=f.container.querySelectorAll('button').filter(b=>b.getAttribute('role')==='tab');assert.equal(tabs.length,4);
    tabs[0].dispatch('keydown',{key:'ArrowRight'});assert.ok(f.container.querySelector('.enq-cast'));assert.equal(f.d.activeElement.textContent,'PNJ 2');
    const anchor=f.d.createElement('button');f.d.append(anchor);f.view.openMenu(anchor);assert.equal(f.container.querySelector('.enq-header-menu').querySelector('.enq-menu').hidden,false);assert.ok(f.button('Tableau des liens'));
    f.container.querySelector('.enq-header-menu').querySelector('.enq-menu').dispatch('keydown',{key:'Escape'});assert.equal(f.d.activeElement,anchor);f.view.unmount();
});
test('mobile piece contains the sheet, annotation and note actions',async()=>{
    const f=await fixture({layout:'mobile',id:'lettre'});await flush();assert.equal(f.container.querySelector('.enq-list'),null);assert.ok(f.container.querySelector('.enq-piece-sheet'));assert.ok(f.button('Noter'));assert.ok(f.button('Annoter'));f.view.unmount();
});
test('mobile returns to the same list space and toggled filter',async()=>{
    const f=await fixture({layout:'mobile',id:null});f.button('Carnet 2').click();f.button('Non classées').click();f.view.unmount();
    const g=await fixture({layout:'mobile',id:null});assert.equal(g.button('Non classées').getAttribute('aria-pressed'),'true');assert.ok(!g.container.querySelectorAll('button').some(b=>b.textContent==='Le sceau'));g.view.unmount();
});
