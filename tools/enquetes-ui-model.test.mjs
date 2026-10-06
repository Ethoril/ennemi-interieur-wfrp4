import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../js/enquetes-view-model.js';
import { createActionMenu } from '../js/enquetes-menu.js';
import { records, pnjs } from './fixtures/enquetes-qa-data.js';
import { createDocument } from './lib/enquetes-test-dom.mjs';
test('projections preserve partial order, dossier boundaries and their inputs',()=>{
    const source=globalThis.structuredClone(records),enquete=source[0],index=model.buildLinksIndex(source);
    source.push({id:'outside',type:'relations',a:'lettre',b:'temoin',nature:'Contredit'});
    const before=JSON.stringify(source),pieces=model.dossierPieces(enquete,source,index);
    assert.deepEqual(pieces.map(p=>[p.record.id,p.numero]),[['lettre',1],['registre',2],['plan',3]]);
    assert.deepEqual(pieces[0].relations,[{nature:'Appuie',autreNumero:2}]);
    assert.deepEqual(model.pieceContext('registre',enquete,source,index),{numero:2,total:3,precedent:'lettre',suivant:'plan'});
    assert.equal(model.pieceContext('temoin',enquete,source,index),null);
    assert.equal(model.pieceContext('lettre',null,source,index),null);
    assert.deepEqual(model.dossierSummary(enquete,source,pnjs,index),{pieces:3,pnjs:2,notes:1,lastSession:'13'});
    assert.equal(model.dossierPnjs(enquete,source,pnjs)[0].role,'Suspect');
    assert.deepEqual(model.dossierTimeline(enquete,source).map(e=>e.ordre),[1,2]);
    assert.deepEqual(model.linkedNotes(enquete,source,index).map(n=>n.id),['hypothese']);
    assert.equal(model.isUnclassified(source.find(n=>n.id==='nonclassee'),source),true);
    assert.equal(model.isUnclassified(source.find(n=>n.id==='hypothese'),source),false);
    assert.equal(JSON.stringify(source),before);
});
test('counters use authorized records and exclude archives from active states',()=>{
    const source=[...records,{id:'archive',type:'enquetes',archive:true,etat:'Ouverte'}];
    assert.deepEqual(model.countSpaces(source),{enquetes:4,documents:4,notes:2});
    assert.deepEqual(model.countStates(source),{Ouverte:2,'En pause':1,Résolue:1,archive:1});
    assert.deepEqual(model.countStates(source.filter(r=>r.zone!=='mj')),{Ouverte:1,'En pause':1,Résolue:1,archive:1});
});
test('action menu opens at the first item, wraps arrows, closes on Escape and outside click',()=>{
    const d=createDocument();let calls=0;
    const menu=createActionMenu({documentRef:d,label:'Actions',items:[{label:'Modifier',action:()=>calls++},{label:'Secret',hidden:true},{label:'Exporter',action:()=>{}}]});
    d.append(menu.element);const [trigger,body]=menu.element.children;
    trigger.dispatch('keydown',{key:'Enter'});assert.equal(body.hidden,false);assert.equal(d.activeElement,body.firstChild);
    body.firstChild.dispatch('keydown',{key:'ArrowUp'});assert.equal(d.activeElement,body.children[1]);
    body.children[1].dispatch('keydown',{key:'Escape'});assert.equal(body.hidden,true);assert.equal(d.activeElement,trigger);
    trigger.click();body.firstChild.click();assert.equal(calls,1);assert.equal(body.hidden,true);
    trigger.click();d.dispatch('click');assert.equal(body.hidden,true);
});
