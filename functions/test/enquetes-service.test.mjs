import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecord, restrictiveZone, references, zonePath, member } from '../src/enquetes/domain.mjs';
import { getEnqueteSession, saveEnqueteCommand, enquiryRead, resumeEnqueteCascade, detectFile } from '../src/enquetes/service.mjs';
const A={auth:{uid:'a',token:{email:'a@example.test',email_verified:true}}};
const B={auth:{uid:'b',token:{email:'b@example.test',email_verified:true}}};
const GM={auth:{uid:'gm',token:{email:'ethoril@gmail.com',email_verified:true}}};
function fixture(){
  const data=new Map([['campagne/acces',{bhelgi:['a@example.test','b@example.test'],enqEnabled:true,enqMaintenance:null}]]);
  const clone=v=>v===undefined?undefined:structuredClone(v);
  const snapshot=(path)=>({id:path.split('/').at(-1),ref:ref(path),exists:data.has(path),data:()=>clone(data.get(path))});
  const ref=path=>({path,get:async()=>snapshot(path),set:async(v,o)=>apply(['set',path,v,o]),update:async v=>apply(['set',path,v,{merge:true}]),delete:async()=>data.delete(path),collection:name=>query(path+'/'+name)});
  const query=(path,filters=[],order=null)=>({path,filters,doc:id=>ref(path+'/'+id),where:(f,op,v)=>query(path,[...filters,[f,op,v]],order),orderBy:f=>query(path,filters,f),get:async()=>{
    const prefix=path+'/';let docs=[...data.keys()].filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).filter(p=>filters.every(([f,op,v])=>op==='=='?data.get(p)[f]===v:op==='in'?v.includes(data.get(p)[f]):op==='<='?data.get(p)[f]<=v:false)).map(snapshot);
    if(order)docs.sort((a,b)=>a.id.localeCompare(b.id));return {docs};
  }});
  const apply=([kind,path,value,options])=>{if(kind==='delete'){data.delete(path);return;}const old=data.get(path)||{},next=options?.merge?{...old,...clone(value)}:clone(value);for(const [k,v]of Object.entries(next))if(v?.union)next[k]=[...new Set([...(old[k]||[]),...v.union])];data.set(path,next);};
  const writer=()=>{const pending=[];return {set:(r,v,o)=>pending.push(['set',r.path,v,o]),update:(r,v)=>pending.push(['set',r.path,v,{merge:true}]),delete:r=>pending.push(['delete',r.path]),commit:async()=>pending.forEach(apply),get:async r=>{assert.equal(pending.length,0,'A transaction must read before writing');return r.get();}};};
  const db={doc:ref,collection:query,batch:writer,runTransaction:async fn=>{const tx=writer(),result=await fn(tx);await tx.commit();return result;}};
  return {data,db,bucket:{file:()=>({delete:async()=>{}})},timestamp:()=>123,arrayUnion:(...v)=>({union:v})};
}
const cmd=(type,id,body,zone='commun',revision=0,action='save')=>({protocol:1,type,id,body,zone,baseRevision:revision,operationId:'op_'+id+'_'+revision+'_'+action,action});
test('personal audiences are incomparable, including for the GM',()=>{
  assert.equal(restrictiveZone(['commun','user:a'],{uid:'a'}),'user:a');
  assert.throws(()=>restrictiveZone(['user:a','user:b'],{uid:'a'}));
  assert.throws(()=>restrictiveZone(['user:a'],{uid:'gm'}));
  assert.equal(zonePath('user:a','notes','n'),'enq_users/a/notes/n');
  assert.throws(()=>zonePath('user:../a','notes','n'));
  assert.equal(member({email:'b@example.test',gm:false},{bhelgi:['b@example.test']}),true);
});
test('payloads reject unknown fields, invalid links and unbounded text',()=>{
  assert.throws(()=>normalizeRecord('notes',{texte:'a',authorUid:'b'}));
  assert.throws(()=>normalizeRecord('notes',{texte:'x'.repeat(100001)}));
  assert.throws(()=>normalizeRecord('liens',{a:'x',b:'x'}));
  assert.deepEqual(references('evenements',{enquete:'e',documents:['d'],pnjs:['p']}),['e','d','p']);
  assert.throws(()=>normalizeRecord('annotations',{document:'d',fileId:'f',version:1,x:2,y:.1}));
});
test('create, replay and stale revision are atomic',async()=>{
  const f=fixture(),c=cmd('documents','d',{titre:'Lettre',texte:'Texte',origine:'piece'});
  const result=await saveEnqueteCommand(c,A,f);
  assert.equal(f.data.get('enq_commun/data/documents/d').origine,'contribution');
  assert.deepEqual(await saveEnqueteCommand(c,A,f),result);
  await assert.rejects(saveEnqueteCommand({...c,operationId:'stale',body:{titre:'Autre'}},A,f),e=>e.code==='aborted');
  await assert.rejects(saveEnqueteCommand({...c,baseRevision:1,operationId:'foreign',body:{titre:'Vol'}},B,f),e=>e.code==='permission-denied');
  assert.equal(f.data.get('enq_commun/data/documents/d').titre,'Lettre');
});
test('secret objects cannot be referenced from the common zone',async()=>{
  const f=fixture();
  await saveEnqueteCommand(cmd('documents','secret',{titre:'Secret'},'mj'),GM,f);
  await saveEnqueteCommand(cmd('enquetes','e',{titre:'Affaire'},'commun'),GM,f);
  await assert.rejects(saveEnqueteCommand(cmd('liens','l',{a:'e',b:'secret'}),A,f),e=>e.code==='permission-denied');
  await assert.rejects(saveEnqueteCommand(cmd('liens','l',{a:'e',b:'secret'}),GM,f),e=>e.code==='permission-denied');
  await saveEnqueteCommand(cmd('liens','l',{a:'e',b:'secret'},'mj'),GM,f);
  assert.ok(!f.data.has('enq_commun/data/liens/l'));
});
test('deterministic uniqueness prevents duplicated associations',async()=>{
  const f=fixture();
  await saveEnqueteCommand(cmd('documents','d',{titre:'Lettre'}),A,f);
  await saveEnqueteCommand(cmd('enquetes','e',{titre:'Affaire'}),GM,f);
  await saveEnqueteCommand(cmd('liens','l',{a:'e',b:'d'}),A,f);
  await assert.rejects(saveEnqueteCommand(cmd('liens','l2',{a:'d',b:'e'}),A,f),e=>e.code==='already-exists');
});
test('visibility cascade removes shared dependencies and preserves personal notes',async()=>{
  const f=fixture();
  await saveEnqueteCommand(cmd('documents','d',{titre:'Lettre'}),GM,f);
  await saveEnqueteCommand(cmd('enquetes','e',{titre:'Affaire',ordre:['d']}),GM,f);
  await saveEnqueteCommand(cmd('liens','l',{a:'e',b:'d'}),GM,f);
  await saveEnqueteCommand(cmd('notes','n',{texte:'Mon hypothèse'},'user:a'),A,f);
  await saveEnqueteCommand(cmd('liens','private',{a:'n',b:'d'},'user:a'),A,f);
  await saveEnqueteCommand(cmd('documents','d',{},'mj',1,'visibility'),GM,f);
  assert.ok(!f.data.has('enq_commun/data/documents/d'));
  assert.ok(f.data.has('enq_mj/data/documents/d'));
  assert.ok(!f.data.has('enq_commun/data/liens/l'));
  assert.deepEqual(f.data.get('enq_commun/data/enquetes/e').ordre,[]);
  assert.equal(f.data.get('enq_users/a/notes/n').texte,'Mon hypothèse');
  assert.equal(f.data.get('enq_users/a/liens/private').b,'d');
  assert.equal(f.data.get('campagne/acces').enqMaintenance,null);
  await assert.rejects(enquiryRead({...A,data:{action:'history',id:'d'}},f),e=>e.code==='permission-denied');
});
test('trash keeps the independent pieces and restore does not publish',async()=>{
  const f=fixture();
  await saveEnqueteCommand(cmd('documents','d',{titre:'Lettre'}),GM,f);
  await saveEnqueteCommand(cmd('enquetes','e',{titre:'Affaire'}),GM,f);
  await saveEnqueteCommand(cmd('liens','l',{a:'e',b:'d'}),GM,f);
  await saveEnqueteCommand(cmd('enquetes','e',{},undefined,1,'trash'),GM,f);
  assert.ok(f.data.has('enq_commun/data/documents/d'));
  assert.ok(f.data.has('enq_trash/e'));
  await saveEnqueteCommand(cmd('enquetes','e',{},undefined,2,'restore'),GM,f);
  assert.ok(!f.data.has('enq_commun/data/enquetes/e'));
  assert.ok(f.data.has('enq_users/gm/enquetes/e'));
});
test('failed cascades resume from their durable plan',async()=>{
  const f=fixture();
  await saveEnqueteCommand(cmd('documents','d',{titre:'Lettre'}),GM,f);
  const original=f.db.batch;let failed=false;
  f.db.batch=()=>{const batch=original();const commit=batch.commit;batch.commit=async()=>{if(!failed){failed=true;throw new Error('network');}return commit();};return batch;};
  const c=cmd('documents','d',{},'mj',1,'visibility');
  await assert.rejects(saveEnqueteCommand(c,GM,f),/network/);
  assert.equal(f.data.get('campagne/acces').enqMaintenance,'gm_'+c.operationId);
  f.db.batch=original;await resumeEnqueteCascade('gm_'+c.operationId,f);
  assert.ok(f.data.has('enq_mj/data/documents/d'));
  assert.equal(f.data.get('campagne/acces').enqMaintenance,null);
});
test('file signatures reject executable and invalid text uploads',()=>{
  assert.equal(detectFile(Buffer.from('%PDF-1.7\n'),'x.pdf'),'application/pdf');
  assert.equal(detectFile(Buffer.from('texte français'),'x.md'),'text/plain');
  assert.throws(()=>detectFile(Buffer.from('<svg onload=evil>'),'x.svg'));
  assert.throws(()=>detectFile(Buffer.from([0xff,0]),'x.txt'));
});


test('the GM cannot restore or purge another user personal trash',async()=>{
  const f=fixture();await saveEnqueteCommand(cmd('notes','private',{texte:'Secret'},'user:a'),A,f);
  await saveEnqueteCommand(cmd('notes','private',{},'user:a',1,'trash'),A,f);
  await assert.rejects(saveEnqueteCommand(cmd('notes','private',{},'user:a',2,'purge'),GM,f),e=>e.code==='permission-denied');
  await assert.rejects(saveEnqueteCommand(cmd('notes','private',{},'user:a',2,'restore'),GM,f),e=>e.code==='permission-denied');
  assert.equal(f.data.get('enq_trash/private').body.texte,'Secret');
});
test('publication cannot expose private notes or restricted endpoint identifiers',async()=>{
  const f=fixture();await saveEnqueteCommand(cmd('notes','n',{texte:'Privé'},'user:a'),A,f);
  await assert.rejects(saveEnqueteCommand(cmd('notes','n',{},'commun',1,'visibility'),A,f),e=>e.code==='permission-denied');
  await saveEnqueteCommand(cmd('documents','s',{titre:'Secret'},'mj'),GM,f);
  await saveEnqueteCommand(cmd('enquetes','e',{titre:'Affaire',ordre:['s']},'mj'),GM,f);
  await saveEnqueteCommand(cmd('enquetes','e',{},'commun',1,'visibility'),GM,f);
  assert.deepEqual(f.data.get('enq_commun/data/enquetes/e').ordre,[]);
  assert.deepEqual(f.data.get('enq_registry/e').refs,[]);
  assert.deepEqual(f.data.get('enq_mj/data/ordres/e').ordre,['s']);
  await saveEnqueteCommand(cmd('liens','private',{a:'e',b:'s'},'user:gm'),GM,f);
  await assert.rejects(saveEnqueteCommand(cmd('liens','private',{},'commun',1,'visibility'),GM,f),e=>e.code==='permission-denied');
});
test('an interrupted purge prevents restore, resumes and removes its work payloads',async()=>{
  const f=fixture();await saveEnqueteCommand(cmd('documents','d',{titre:'Privé',texte:'À effacer'},'user:a'),A,f);
  f.data.set('enq_files/f',{docId:'d',path:'documents/d/f/1',version:1});
  await saveEnqueteCommand(cmd('documents','d',{},'user:a',1,'trash'),A,f);
  const purge=cmd('documents','d',{},'user:a',2,'purge');
  f.bucket.file=()=>({delete:async()=>{throw new Error('interrupted');}});
  await assert.rejects(saveEnqueteCommand(purge,A,f),/interrupted/);
  await assert.rejects(saveEnqueteCommand(cmd('documents','d',{},'user:a',2,'restore'),A,f),e=>e.code==='failed-precondition');
  f.bucket.file=()=>({delete:async()=>{}});
  const result=await saveEnqueteCommand(purge,A,f);assert.equal(result.status,'purged');
  assert.equal(f.data.has('enq_trash/d'),false);assert.equal(f.data.has('enq_registry/d'),false);assert.equal(f.data.has('enq_files/f'),false);
  assert.equal(f.data.get('campagne/acces').enqMaintenance,null);
  for(const [path,value]of f.data)if(path.startsWith('enq_jobs/'))assert.equal(JSON.stringify(value).includes('À effacer'),false);
});

test('enrollment admits campaign members, preserves former private access and refuses strangers',async()=>{
  const f=fixture();
  assert.equal((await getEnqueteSession(A,f)).role,'joueur');
  assert.equal(f.data.get('enq_accounts/a').enrolled,true);
  f.data.set('campagne/acces',{enqEnabled:true});
  assert.equal((await getEnqueteSession(A,f)).role,'ancien');
  await assert.rejects(getEnqueteSession(B,f),e=>e.code==='permission-denied');
  await assert.rejects(saveEnqueteCommand(cmd('notes','intruder',{texte:'Interdit'},'user:b'),B,f),e=>e.code==='permission-denied');
});
