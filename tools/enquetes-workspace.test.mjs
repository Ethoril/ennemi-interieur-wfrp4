
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createEnqueteWorkspaceView } from '../js/enquetes-workspace.js';
import { buildSearch } from '../js/data/enquetes-domain.js';
import { selectEnqueteExport } from '../js/data/enquetes-export.js';
import { convertLegacyIndice,legacyStoragePath } from './lib/enquetes-import-model.mjs';
import { Element, createDocument } from './lib/enquetes-test-dom.mjs';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
async function fixture({role='joueur',id=null}={}){
  let counter=0,onChange,saveHook=null;
  const records=[{id:'e',type:'enquetes',titre:'Affaire',zone:'commun',authorUid:'gm',revision:1,ordre:[]},{id:'n',type:'notes',texte:'Mon texte',titre:'Note',zone:'user:a',authorUid:'a',revision:1,etiquettes:[]}];
  const drafts=new Map(),receipts=new Map(),calls=[],session={uid:'a',active:true,role,maintenance:false};
  const d=createDocument();
  const container=new Element(d,'main'),emit=()=>onChange({session,records:[...records],pnjs:[]});
  const runtime={newEnqueteId:()=> 'new'+(++counter),saveEnqueteDraft:(uid,id,v)=>{drafts.set(id,{...globalThis.structuredClone(v),uid});return true;},readEnqueteDraft:(uid,id)=>drafts.get(id),removeEnqueteDraft:(uid,id)=>drafts.delete(id),listEnqueteDrafts:uid=>[...drafts].filter(([,v])=>v.uid===uid).map(([id,v])=>({id,...v})),createEnqueteClient(options){onChange=options.onChange;globalThis.queueMicrotask(emit);return{
    async save(c){calls.push(globalThis.structuredClone(c));if(saveHook)await saveHook(c);if(receipts.has(c.operationId))return receipts.get(c.operationId);const current=records.find(r=>r.id===c.id);if((current?.revision||0)!==(c.baseRevision||0)){const error=new Error('La note a changé');error.code='aborted';error.current=current;throw error;}const value={...c.body,id:c.id||runtime.newEnqueteId(),type:c.type,zone:c.zone||'user:a',authorUid:'a',revision:(current?.revision||0)+1};if(current)records.splice(records.indexOf(current),1);records.push(value);const result={id:value.id,zone:value.zone,revision:value.revision};if(c.operationId)receipts.set(c.operationId,result);emit();return result;},
    read:async()=>({items:[{id:'trash',type:'documents',titre:'Pièce supprimée',zone:'user:a',authorUid:'a',revision:2}],id:null}),close(){},signOut(){},action:async()=>{}
  };}};
  const view=createEnqueteWorkspaceView({container,id,loadRuntime:async()=>runtime});await view.mount();await flush();
  const button=label=>container.querySelectorAll('button').find(b=>b.textContent===label||b.getAttribute('role')==='tab'&&b.textContent.startsWith(({Enquêtes:'Dossiers',Documents:'Pièces','Mon carnet':'Carnet'}[label]||label)+' '));
  const field=label=>container.querySelectorAll('label').find(l=>l.textContent===label).children[0];
  return{view,container,records,drafts,calls,emit,button,field,hook:fn=>{saveHook=fn;},session};
}
test('player entry points keep enquiries read-only and notes private',async()=>{
  const f=await fixture();assert.equal(f.button('Nouvelle enquête'),undefined);
  f.button('Mon carnet').dispatch('click');await flush();assert.ok(f.button('Nouvelle note'));
  f.button('Nouvelle note').dispatch('click');assert.equal(f.field('Audience').disabled,true);assert.equal(f.field('Audience').value,'user:a');f.view.unmount();
});
test('unsaved new draft remains discoverable after leaving the editor',async()=>{
  const f=await fixture();f.button('Mon carnet').dispatch('click');f.button('Nouvelle note').dispatch('click');
  f.field('Titre').value='À reprendre';f.field('Texte').value='Une piste';f.container.querySelector('.enq-editor').dispatch('input');
  f.button('Fermer en conservant le brouillon').dispatch('click');assert.ok(f.button('Reprendre le brouillon : À reprendre'));f.view.unmount();
});
test('trash async response renders despite the detail pane refresh',async()=>{
  const f=await fixture();f.button('Corbeille').dispatch('click');await flush();
  assert.ok(f.button('Restaurer sans publier'));f.view.unmount();
});
test('editing during an outstanding save keeps the newer body and the updated revision',async()=>{
  const f=await fixture({id:'n'});f.button('Modifier').dispatch('click');
  let resolve;f.hook(()=>new Promise(r=>{resolve=r;}));
  f.field('Texte').value='Première version';f.container.querySelector('.enq-editor').dispatch('input');f.container.querySelector('.enq-editor').dispatch('submit');await flush();
  f.field('Texte').value='Version plus récente';f.container.querySelector('.enq-editor').dispatch('input');resolve();await flush();
  assert.equal(f.records.find(r=>r.id==='n').texte,'Première version');
  const draft=f.drafts.get('n');assert.equal(draft.body.texte,'Version plus récente');assert.equal(draft.baseRevision,2);assert.equal(draft.pending,null);
  f.hook(null);f.container.querySelector('.enq-editor').dispatch('submit');await flush();
  assert.equal(f.records.find(r=>r.id==='n').texte,'Version plus récente');assert.equal(f.records.find(r=>r.id==='n').revision,3);f.view.unmount();
});
test('conflict preserves the local text until explicit comparison choice',async()=>{
  const f=await fixture({id:'n'});f.button('Modifier').dispatch('click');f.field('Texte').value='Mon brouillon';f.container.querySelector('.enq-editor').dispatch('input');
  f.records.find(r=>r.id==='n').revision=2;f.records.find(r=>r.id==='n').texte='Autre appareil';f.emit();
  f.container.querySelector('.enq-editor').dispatch('submit');await flush();
  assert.equal(f.drafts.get('n').body.texte,'Mon brouillon');assert.ok(f.button('Garder mon texte après comparaison'));assert.equal(f.records.find(r=>r.id==='n').texte,'Autre appareil');f.view.unmount();
});
test('an enquiry export includes authorized evidence and timeline, with private content only by choice',()=>{
  const records=[{id:'e',type:'enquetes',zone:'commun'},{id:'d',type:'documents',zone:'commun'},{id:'n',type:'notes',zone:'user:a'},{id:'s',type:'documents',zone:'mj'},
    {id:'l',type:'liens',zone:'commun',a:'e',b:'d'},{id:'nl',type:'liens',zone:'user:a',a:'e',b:'n'},{id:'a',type:'annotations',zone:'user:a',document:'d'},{id:'t',type:'evenements',zone:'commun',enquete:'e'}];
  const shared=selectEnqueteExport(records,[],{root:records[0]});assert.deepEqual(shared.objects.map(v=>v.id).sort(),['d','e','t']);assert.equal(shared.links.length,1);
  const personal=selectEnqueteExport(records,[],{root:records[0],includePersonal:true});assert.ok(personal.objects.some(v=>v.id==='n'));assert.ok(personal.objects.some(v=>v.id==='a'));assert.ok(!personal.objects.some(v=>v.id==='s'));
});
test('legacy conversion is stable, preserves source and denies foreign buckets',()=>{
  const a=convertLegacyIndice('old',{titre:'Lettre',description:'Transcription',decouvert:true,pnjsLies:['p','p'],source:'Marchand'});
  assert.equal(a.zone,'commun');assert.deepEqual(a.pnjsLies,['p']);assert.equal(a.texte,'Transcription');assert.equal(convertLegacyIndice('old',{}).id,a.id);
  assert.equal(legacyStoragePath({imageUrl:'https://evil.test/file.jpg'},'bucket'),null);
  assert.equal(legacyStoragePath({imageUrl:'https://firebasestorage.googleapis.com/v0/b/other/o/indices%2Fid%2Ffile.jpg'},'bucket'),null);
});
test('search handles the reference campaign volume, case and accents in under 200ms',()=>{
  const records=Array.from({length:1000},(_,i)=>({id:'r'+i,titre:'Témoignage '+i,texte:'Le sceau et le conseiller. '.repeat(120),etiquettes:['énigme']}));
  const start=performance.now();assert.equal(buildSearch(records,'temoignage 42').length,11);assert.ok(performance.now()-start<200);
});


test('switching accounts closes the private editor and preserves its draft only for the original owner',async()=>{
  const f=await fixture({id:'n'});f.button('Modifier').dispatch('click');f.field('Texte').value='Confidentiel A';f.container.querySelector('.enq-editor').dispatch('input');
  f.session.uid='b';f.records.splice(0);f.emit();
  assert.equal(f.container.querySelector('.enq-editor'),null);assert.equal(f.button('Reprendre le brouillon : Note'),undefined);
  assert.equal(f.drafts.get('n').body.texte,'Confidentiel A');f.view.unmount();
});

