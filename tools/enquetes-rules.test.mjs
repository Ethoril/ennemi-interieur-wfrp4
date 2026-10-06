import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment,assertFails,assertSucceeds } from '@firebase/rules-unit-testing';
import { doc,setDoc,getDoc,updateDoc,serverTimestamp,runTransaction } from 'firebase/firestore';
import { ref,getBytes,uploadBytes } from 'firebase/storage';
let env,A,B,GM,old;
before(async()=>{
  const [fh,fp]=(process.env.FIRESTORE_EMULATOR_HOST||'').split(':');
  const [sh,sp]=(process.env.FIREBASE_STORAGE_EMULATOR_HOST||'').split(':');
  if(!fh||!sh)throw new Error('Émulateurs locaux requis');
  env=await initializeTestEnvironment({projectId:'demo-enquetes',firestore:{host:fh,port:Number(fp),rules:await readFile('firestore.rules','utf8')},storage:{host:sh,port:Number(sp),rules:await readFile('storage.rules','utf8')}});
  A=env.authenticatedContext('a',{email:'a@example.test',email_verified:true});B=env.authenticatedContext('b',{email:'b@example.test',email_verified:true});GM=env.authenticatedContext('gm',{email:'ethoril@gmail.com',email_verified:true});old=env.authenticatedContext('old',{email:'old@example.test',email_verified:true});
  await env.withSecurityRulesDisabled(async c=>{
    for(const uid of ['a','b','gm','old'])await setDoc(doc(c.firestore(),'enq_accounts/'+uid),{uid,enrolled:true});

    await setDoc(doc(c.firestore(),'campagne/acces'),{bhelgi:['a@example.test','b@example.test'],enqEnabled:true,enqMaintenance:null});

    await setDoc(doc(c.firestore(),'enq_commun/data/documents/d'),{titre:'Lettre'});

    await setDoc(doc(c.firestore(),'enq_mj/data/documents/s'),{titre:'Secret'});

    await setDoc(doc(c.firestore(),'enq_users/a/notes/n'),{id:'n',type:'notes',authorUid:'a',texte:'Privé',etiquettes:[],revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});

    await setDoc(doc(c.firestore(),'enq_users/old/notes/n'),{texte:'Ancien compte'});

    await setDoc(doc(c.firestore(),'enq_registry/d'),{type:'documents',zone:'commun'});
    for(const [id,zone,current,ownerUid]of [['f','commun',true,'a'],['secret','mj',true,'gm'],['personal','user:a',true,'a'],['prior','commun',false,'a']]){
  
    await setDoc(doc(c.firestore(),'enq_file_access/'+id),{docId:id,zone,active:true,current,ownerUid,version:1,annotationReaders:id==='prior'?['b']:[]});
      await uploadBytes(ref(c.storage(),'documents/'+id+'/'+id+'/1'),new Uint8Array([1,2,3]),{contentType:'image/jpeg'});
    }
  });
});
after(async()=>{await env?.cleanup();});
test('shared membership, secrets and personal notes are independently protected',async()=>{
  await assertSucceeds(getDoc(doc(A.firestore(),'enq_commun/data/documents/d')));
  await assertFails(getDoc(doc(old.firestore(),'enq_commun/data/documents/d')));
  await assertFails(getDoc(doc(A.firestore(),'enq_mj/data/documents/s')));
  await assertSucceeds(getDoc(doc(GM.firestore(),'enq_mj/data/documents/s')));
  await assertSucceeds(getDoc(doc(A.firestore(),'enq_users/a/notes/n')));
  await assertFails(getDoc(doc(B.firestore(),'enq_users/a/notes/n')));
  await assertFails(getDoc(doc(GM.firestore(),'enq_users/a/notes/n')));
  await assertSucceeds(getDoc(doc(old.firestore(),'enq_users/old/notes/n')));
});
test('shared direct writes are forbidden including the GM',async()=>{
  await assertFails(setDoc(doc(GM.firestore(),'enq_commun/data/documents/forged'),{titre:'Interdit'}));
  await assertFails(setDoc(doc(A.firestore(),'enq_mj/data/liens/forged'),{a:'d',b:'secret'}));
  await assertFails(updateDoc(doc(A.firestore(),'enq_registry/d'),{type:'notes',zone:'user:a'}));
});
test('private creation validates schema and author and cannot take over a shared identity',async()=>{
  const db=A.firestore();
  const note={id:'new',type:'notes',authorUid:'a',operationId:'op',titre:'Test',texte:'Mon texte',etiquettes:[],revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  await assertSucceeds(runTransaction(db,async tx=>{
    tx.set(doc(db,'enq_users/a/notes/new'),note);
    tx.set(doc(db,'enq_registry/new'),{id:'new',type:'notes',zone:'user:a',authorUid:'a',state:'active',revision:1,refs:[],createdAt:serverTimestamp()});
    tx.set(doc(db,'enq_users/a/receipts/op'),{id:'new',revision:1,hash:'a'.repeat(64),createdAt:serverTimestamp()});
  }));
  await assertFails(setDoc(doc(db,'enq_users/a/notes/foreign'),{...note,id:'foreign',authorUid:'b'}));
  await assertFails(setDoc(doc(db,'enq_users/a/notes/polluted'),{...note,id:'polluted',secret:'extra'}));
  await assertFails(runTransaction(db,async tx=>{
    tx.set(doc(db,'enq_users/a/notes/d'),{...note,id:'d'});
    tx.set(doc(db,'enq_registry/d'),{id:'d',type:'notes',zone:'user:a',authorUid:'a',state:'active',revision:1,refs:[],createdAt:serverTimestamp()});
  }));
  const reference=doc(db,'enq_users/a/notes/new');
  await assertFails(updateDoc(reference,{revision:2,texte:'Suite',updatedAt:serverTimestamp()}));
  await assertSucceeds(runTransaction(db,async tx=>{
    const previous=await tx.get(reference);
    tx.update(reference,{revision:2,operationId:'op2',texte:'Suite',updatedAt:serverTimestamp()});
    tx.update(doc(db,'enq_registry/new'),{revision:2});
    tx.set(doc(db,'enq_users/a/receipts/op2'),{id:'new',revision:2,hash:'b'.repeat(64),createdAt:serverTimestamp()});
    assert.equal(previous.data().revision,1);
  }));
  await assertFails(updateDoc(reference,{revision:2,texte:'Écrasement',updatedAt:serverTimestamp()}));
});
test('file reads follow audience and permit the version carrying a private annotation',async()=>{
  await assertSucceeds(getBytes(ref(A.storage(),'documents/f/f/1')));
  await assertFails(getBytes(ref(old.storage(),'documents/f/f/1')));
  await assertFails(getBytes(ref(A.storage(),'documents/secret/secret/1')));
  await assertSucceeds(getBytes(ref(GM.storage(),'documents/secret/secret/1')));
  await assertFails(getBytes(ref(GM.storage(),'documents/personal/personal/1')));
  await assertSucceeds(getBytes(ref(A.storage(),'documents/personal/personal/1')));
  await assertSucceeds(getBytes(ref(B.storage(),'documents/prior/prior/1')));
  await assertFails(uploadBytes(ref(A.storage(),'documents/f/f/2'),new Uint8Array([1]),{contentType:'image/jpeg'}));
});
test('staging is owned and rejects unapproved content',async()=>{
  await assertSucceeds(uploadBytes(ref(A.storage(),'staging/a/upload'),new Uint8Array([1]),{contentType:'image/jpeg'}));
  await assertFails(uploadBytes(ref(B.storage(),'staging/a/foreign'),new Uint8Array([1]),{contentType:'image/jpeg'}));
  await assertFails(uploadBytes(ref(A.storage(),'staging/a/script'),new Uint8Array([1]),{contentType:'text/html'}));
  await assertFails(getBytes(ref(B.storage(),'staging/a/upload')));
});
test('maintenance revokes shared Firestore and Storage while keeping the private notebook',async()=>{
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'campagne/acces'),{enqMaintenance:'job'}));
  await assertFails(getDoc(doc(A.firestore(),'enq_commun/data/documents/d')));
  await assertFails(getBytes(ref(A.storage(),'documents/f/f/1')));
  await assertSucceeds(getDoc(doc(A.firestore(),'enq_users/a/notes/n')));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'campagne/acces'),{enqMaintenance:null,bhelgi:['a@example.test']}));
  await assertFails(getBytes(ref(B.storage(),'documents/prior/prior/1')));
});




test('an unknown verified Google account cannot enroll itself or use private storage',async()=>{
  const outsider=env.authenticatedContext('stranger',{email:'stranger@example.test',email_verified:true});
  await assertFails(setDoc(doc(outsider.firestore(),'enq_accounts/stranger'),{uid:'stranger',enrolled:true}));
  await assertFails(setDoc(doc(outsider.firestore(),'enq_users/stranger/notes/n'),{texte:'Interdit'}));
  await assertFails(uploadBytes(ref(outsider.storage(),'staging/stranger/file'),new Uint8Array([255,216,255]),{contentType:'image/jpeg'}));
});
