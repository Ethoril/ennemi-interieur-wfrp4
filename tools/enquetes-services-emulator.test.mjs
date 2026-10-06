import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyDocumentId } from './lib/enquetes-import-model.mjs';

import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp,deleteApp } from 'firebase-admin/app';
import { getFirestore,Timestamp,GeoPoint,FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { saveEnqueteCommand,finalizeEnqueteFile,guardPnjVisibility,maintainEnquetes } from '../functions/src/enquetes/service.mjs';
import { mutatePublicContent,mutateMjContent,trashPublicContent,restorePublicContent } from '../functions/src/contributions/service.mjs';
import { captureEnqueteRecovery,restoreEnqueteRecovery } from './lib/enquetes-recovery.mjs';
let app,f,restoreApp;
const project='demo-enquetes-service',A={auth:{uid:'a',token:{email:'a@example.test',email_verified:true}}},GM={auth:{uid:'gm',token:{email:'ethoril@gmail.com',email_verified:true}}};
const command=(type,id,body,zone='commun',revision=0,action='save')=>({protocol:1,type,id,body,zone,baseRevision:revision,operationId:'op_'+id+'_'+revision+'_'+action,action});
before(async()=>{
  if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw new Error('Émulateurs requis');
  app=initializeApp({projectId:project,storageBucket:project+'.appspot.com'},'enquetes-services');
  f={db:getFirestore(app),bucket:getStorage(app).bucket(),timestamp:()=>FieldValue.serverTimestamp(),arrayUnion:(...v)=>FieldValue.arrayUnion(...v),deleteField:()=>FieldValue.delete()};
  await f.db.doc('campagne/acces').set({enqEnabled:true,bhelgi:['a@example.test'],enqMaintenance:null});
});
after(async()=>{await Promise.all([app,restoreApp].filter(Boolean).map(deleteApp));});
test('real transactions attach files and targeted old image grants disappear with the annotation',async()=>{
  await saveEnqueteCommand(command('documents','document',{titre:'Deux versions'},'commun'),A,f);
  for(const id of ['image1','image2'])await f.bucket.file('staging/a/'+id).save(Buffer.from([255,216,255,1]),{metadata:{contentType:'image/jpeg'}});
  const first=await finalizeEnqueteFile({...A,data:{docId:'document',uploadId:'image1',name:'carte.jpg'}},f);
  assert.equal(first.contentType,'image/jpeg');
  assert.equal((await f.bucket.file(first.path).getMetadata())[0].metadata?.firebaseStorageDownloadTokens,undefined);
  await saveEnqueteCommand(command('documents','document',{titre:'Deux versions',files:[first.id]},'commun',1),A,f);
  const annotation={document:'document',fileId:first.id,version:1,x:.2,y:.4,texte:'Mon repère'};
  await saveEnqueteCommand(command('annotations','annotation',annotation,'user:a'),A,f);
  const next=await finalizeEnqueteFile({...A,data:{docId:'document',uploadId:'image2',name:'carte.jpg',version:2}},f);
  await saveEnqueteCommand(command('documents','document',{titre:'Deux versions',files:[next.id]},'commun',2),A,f);
  let acl=(await f.db.doc('enq_file_access/'+first.id).get()).data();assert.equal(acl.current,false);assert.deepEqual(acl.annotationReaders,['a']);
  await saveEnqueteCommand(command('annotations','annotation',{},'user:a',1,'trash'),A,f);
  acl=(await f.db.doc('enq_file_access/'+first.id).get()).data();assert.deepEqual(acl.annotationReaders,[]);
});
test('legacy PNJ visibility and trash use the same durable access barrier',async()=>{
  const create={kind:'pnj',id:'pnj',action:'create',operationId:'pnjcreate',baseRevision:0,changes:{nom:'Marchand',visibleJoueurs:true}};
  await mutatePublicContent(create,GM,f);
  await saveEnqueteCommand(command('enquetes','affaire',{titre:'Affaire'}),GM,f);
  await saveEnqueteCommand(command('liens','pnjlink',{a:'affaire',b:'pnj'}),GM,f);
  const update={kind:'pnj',id:'pnj',operationId:'pnjhide',baseRevision:1,baseValues:{visibleJoueurs:true},changes:{visibleJoueurs:false}};
  await guardPnjVisibility(update,GM,f,mutateMjContent);
  assert.equal((await f.db.doc('pnjs/pnj').get()).data().visibleJoueurs,false);
  assert.equal((await f.db.doc('enq_registry/pnjlink').get()).data().zone,'mj');
  const publish={...update,operationId:'pnjshow',baseRevision:2,baseValues:{visibleJoueurs:false},changes:{visibleJoueurs:true}};
  await guardPnjVisibility(publish,GM,f,mutateMjContent);
  assert.equal((await f.db.doc('enq_registry/pnjlink').get()).data().zone,'commun');
  const trash={kind:'pnj',id:'pnj',operationId:'pnjtrash',baseRevision:3};
  await guardPnjVisibility(trash,GM,f,trashPublicContent,'trash');
  assert.equal((await f.db.doc('pnjs/pnj').get()).exists,false);
  assert.equal((await f.db.doc('enq_registry/pnjlink').get()).data().state,'trash');
  const restore={...trash,operationId:'pnjrestore',baseRevision:4};
  await guardPnjVisibility(restore,GM,f,restorePublicContent,'restore');
  assert.equal((await f.db.doc('pnjs/pnj').get()).exists,true);
  assert.equal((await f.db.doc('enq_registry/pnjlink').get()).data().state,'trash');
});
test('invalid PNJ revision releases a barrier without publishing or moving dependencies',async()=>{
  const stale={kind:'pnj',id:'pnj',operationId:'pnjstale',baseRevision:0,baseValues:{visibleJoueurs:true},changes:{visibleJoueurs:false}};
  await assert.rejects(guardPnjVisibility(stale,GM,f,mutateMjContent),e=>e.code==='aborted');
  assert.equal((await f.db.doc('campagne/acces').get()).data().enqMaintenance,null);
  assert.equal((await f.db.doc('enq_jobs/pnj_pnjstale').get()).data().status,'failed');
});
test('expired trash purges its data and files after the retention period',async()=>{
  await saveEnqueteCommand(command('documents','expiring',{titre:'À purger'},'user:a'),A,f);
  await saveEnqueteCommand(command('documents','expiring',{},'user:a',1,'trash'),A,f);
  await f.db.doc('enq_trash/expiring').update({expiresAt:1});
  await maintainEnquetes(f);
  assert.equal((await f.db.doc('enq_trash/expiring').get()).exists,false);
  assert.equal((await f.db.doc('enq_registry/expiring').get()).exists,false);
});

test('legacy import is replayable and leaves originals unchanged',async()=>{
  const original={titre:'Archive',description:'Texte conservé',decouvert:true,pnjsLies:['pnj'],type:'Lettre'};
  await f.db.doc('indices/legacy').set(original);
  const directory=await mkdtemp(join(tmpdir(),'enquetes-import-'));
  try{
    const args=['tools/enquetes-import.mjs','--project',project,'--bucket',f.bucket.name,'--apply','--report',join(directory,'report.json')];
    const run=()=>new Promise((resolve,reject)=>execFile(process.execPath,args,{cwd:process.cwd(),env:process.env},(error,stdout)=>error?reject(error):resolve(stdout)));
    await run();const id=legacyDocumentId('legacy'),first=(await f.db.doc('enq_commun/data/documents/'+id).get()).data();
    await run();const second=(await f.db.doc('enq_commun/data/documents/'+id).get()).data();
    assert.deepEqual(second,first);assert.deepEqual((await f.db.doc('indices/legacy').get()).data(),original);
    const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));assert.deepEqual(report.existing,['legacy']);assert.deepEqual(report.anomalies,[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('recovery round trip includes absent namespace parents, private notes, job cursors and Storage bytes',async()=>{
  await f.db.doc('enq_users/a/notes/recovery').set({texte:'Confidentiel',revision:7,createdAt:Timestamp.fromMillis(1234)});
  const snapshot=await captureEnqueteRecovery(f);
  assert.ok(snapshot.documents.some(d=>d.path==='enq_users/a/notes/recovery'));
  assert.ok(snapshot.documents.some(d=>d.path.startsWith('enq_jobs/')&&d.path.includes('/items/')));
  const targetProject='demo-enquetes-recovery';
  restoreApp=initializeApp({projectId:targetProject,storageBucket:targetProject+'.appspot.com'},'enquetes-recovery');
  const target={db:getFirestore(restoreApp),bucket:getStorage(restoreApp).bucket(),Timestamp,GeoPoint,project:targetProject};
  const result=await restoreEnqueteRecovery(snapshot,target);assert.equal(result.documents,snapshot.documents.length);
  assert.equal((await target.db.doc('enq_users/a/notes/recovery').get()).data().createdAt.toMillis(),1234);
  const restored=await captureEnqueteRecovery(target);
  assert.deepEqual(restored.documents.sort((a,b)=>a.path.localeCompare(b.path)),snapshot.documents.sort((a,b)=>a.path.localeCompare(b.path)));
  assert.deepEqual(restored.files,snapshot.files);
  await assert.rejects(restoreEnqueteRecovery(snapshot,target),/Destination non vide/);
});




