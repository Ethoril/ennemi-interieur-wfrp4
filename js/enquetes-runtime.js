import { auth, db, storage, functions, isDefaultFirestorePersisted, markDefaultFirestorePersisted } from './firebase-init.js';
import { loginWithGoogle, logout } from './auth.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, doc, query, where, onSnapshot, runTransaction, serverTimestamp, enableIndexedDbPersistence, terminate, clearIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { ref, uploadBytesResumable, getBlob, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { ENQUETE_PROTOCOL, TYPES, normalizeRecord, zonePath } from './data/enquetes-domain.js';
const invoke=name=>async data=>(await httpsCallable(functions,name)(data)).data;
const callCommand=invoke('executeEnqueteCommand'),callRead=invoke('readEnqueteContent'),callFile=invoke('finalizeEnqueteFile'),callSession=invoke('getEnqueteSession');
const SESSION_CACHE_TTL_MS=5*60*1000;
let cachedSession=null,inFlightSession=null;
export const newEnqueteId=()=>globalThis.crypto.randomUUID().replaceAll('-','_');
function localStorageSafe(){try{return globalThis.localStorage;}catch{return null;}}
const drafts=localStorageSafe();
export function draftKey(uid,id){return `wfrp-enq-draft:${uid}:${id}`;}
export function saveEnqueteDraft(uid,id,value){try{drafts?.setItem(draftKey(uid,id),JSON.stringify({...value,uid,savedAt:Date.now()}));return !!drafts;}catch{return false;}}
export function readEnqueteDraft(uid,id){try{const v=JSON.parse(drafts?.getItem(draftKey(uid,id))||'null');return v?.uid===uid?v:null;}catch{return null;}}
export function removeEnqueteDraft(uid,id){try{drafts?.removeItem(draftKey(uid,id));}catch{/* unavailable */}}
async function resolveEnqueteSession(user,{force=false}={}){
  const uid=user.uid;
  if(!force&&cachedSession&&cachedSession.uid===uid&&(Date.now()-cachedSession.fetchedAt)<SESSION_CACHE_TTL_MS)return cachedSession.session;
  if(!force&&inFlightSession&&inFlightSession.uid===uid)return inFlightSession.promise;
  const promise=(async()=>{
    try{
      const next=await callSession();
      cachedSession={uid,session:next,fetchedAt:Date.now()};
      try{drafts?.setItem(`wfrp-enq-session:${uid}`,JSON.stringify(next));}catch{/* no cache */}
      return next;
    }catch(error){
      const cached=JSON.parse(drafts?.getItem(`wfrp-enq-session:${uid}`)||'null');
      if(globalThis.navigator.onLine!==false||!cached)throw error;
      return {...cached,offline:true};
    }finally{
      if(inFlightSession?.promise===promise)inFlightSession=null;
    }
  })();
  inFlightSession={uid,promise};
  return promise;
}
export function createEnqueteClient({onChange,onError=()=>{}}={}) {
  let active=true,generation=0,authState='loading',authError=null,session=null,records=new Map(),pnjs=[],stops=[],urls=new Set(),started=false,persisted=isDefaultFirestorePersisted(),unsubscribeControl=()=>{},refreshing=false;
  const refreshSession=async()=>{if(refreshing||!auth.currentUser||!active)return;refreshing=true;try{const next=await resolveEnqueteSession(auth.currentUser,{force:true});if(active&&next.uid===auth.currentUser?.uid){session=next;authState='ready';authError=null;attach(generation);}}catch(error){onError(error);}finally{refreshing=false;}};
  const emit=()=>{if(active)onChange({authState,session,error:authError,records:[...records.values()],pnjs});};
  const stopData=()=>{stops.splice(0).forEach(s=>s());records.clear();pnjs=[];urls.forEach(u=>URL.revokeObjectURL(u));urls.clear();};
  const subscribe=(zone,type,token)=>{
    const path=zone.startsWith('user:')?`enq_users/${zone.slice(5)}/${type}`:`enq_${zone}/data/${type}`;
    let ids=new Set();
    const stop=onSnapshot(collection(db,path),{includeMetadataChanges:true},snapshot=>{
      if(!active||generation!==token)return;
      for(const id of ids)records.delete(`${zone}/${type}/${id}`);
      ids=new Set(snapshot.docs.map(d=>d.id));
      for(const d of snapshot.docs)records.set(`${zone}/${type}/${d.id}`,{...d.data(),id:d.id,type,zone,fromCache:snapshot.metadata.fromCache});
      emit();
    },error=>{if(!active||generation!==token)return;for(const id of ids)records.delete(`${zone}/${type}/${id}`);ids.clear();emit();onError(error);if(error.code?.includes('permission-denied'))refreshSession();});
    stops.push(stop);
  };
  const attach=token=>{
    stopData();
    if(!session)return;
    for(const type of TYPES)subscribe(`user:${session.uid}`,type,token);
    if(session.active&&!session.maintenance&&session.role!=='ancien'){
      for(const zone of session.role==='mj'?['commun','mj']:['commun'])for(const type of TYPES.filter(t=>!['notes','dispositions'].includes(t)))subscribe(zone,type,token);
      const target=session.role==='mj'?collection(db,'pnjs'):query(collection(db,'pnjs'),where('visibleJoueurs','==',true));
      stops.push(onSnapshot(target,s=>{if(active&&generation===token){pnjs=s.docs.map(d=>({...d.data(),id:d.id,type:'pnjs',zone:d.data().visibleJoueurs?'commun':'mj'}));emit();}},error=>{pnjs=[];emit();onError(error);}));
    }
    emit();
  };
  const activateUser=async(user,token,{force=false}={})=>{
    unsubscribeControl();unsubscribeControl=()=>{};stopData();session=null;authError=null;
    if(!user){cachedSession=null;authState='signed-out';emit();return;}
    const hasFreshCache=!force&&cachedSession&&cachedSession.uid===user.uid&&(Date.now()-cachedSession.fetchedAt)<SESSION_CACHE_TTL_MS;
    if(!hasFreshCache){authState='loading';emit();}
    try{
      const next=await resolveEnqueteSession(user,{force});
      if(!active||generation!==token)return;
      session=next;authState='ready';authError=null;
      persisted=persisted||isDefaultFirestorePersisted();
      if(!started){started=true;if(next.role!=='mj'&&!persisted){try{await enableIndexedDbPersistence(db);persisted=true;markDefaultFirestorePersisted(true);}catch{/* memory fallback */}}}
      if(!active||generation!==token)return;
      if(next.role==='mj'&&(persisted||isDefaultFirestorePersisted())){unsubscribeControl();markDefaultFirestorePersisted(false);await terminate(db);await clearIndexedDbPersistence(db);globalThis.location.reload();return;}
      attach(token);
      unsubscribeControl=onSnapshot(doc(db,'enq_control/public'),snapshot=>{
        if(!active||generation!==token||!session||!snapshot.exists())return;
        const control=snapshot.data();
        if(control.active===session.active&&control.maintenance===session.maintenance)return;
        session={...session,...control};
        if(cachedSession?.uid===session.uid)cachedSession={...cachedSession,session};
        attach(token);
      },error=>{if(error.code?.includes('permission-denied'))refreshSession();});
    }catch(error){if(active&&generation===token){authState='error';authError=error;emit();onError(error);}}
  };
  const unsubscribeAuth=onAuthStateChanged(auth,async user=>{
    const token=++generation;
    await activateUser(user,token);
  });

  const assertSession=()=>{if(!active||!session)throw new Error('Connexion requise');return session;};
  const api={
    getState:()=>({authState,session,error:authError,records:[...records.values()],pnjs}),
    signIn:loginWithGoogle,
    retry(){const token=++generation;return activateUser(auth.currentUser||null,token,{force:true});},
    async signOut(){
      if(!globalThis.confirm('Déconnexion : les brouillons locaux de ce compte seront effacés. Continuer ?'))return;
      const uid=session?.uid;cachedSession=null;stopData();
      if(uid&&drafts)for(let i=drafts.length-1;i>=0;i--){const key=drafts.key(i);if(key?.startsWith(`wfrp-enq-draft:${uid}:`)||key===`wfrp-enq-session:${uid}`)drafts.removeItem(key);}
      await logout();if(persisted||isDefaultFirestorePersisted()){markDefaultFirestorePersisted(false);await terminate(db);await clearIndexedDbPersistence(db);}globalThis.location.reload();
    },
    async save({type,id=newEnqueteId(),zone,body,baseRevision=0,operationId=newEnqueteId()}){
      const captured=assertSession(),token=generation;
      if(type==='notes'){
        const normalized=normalizeRecord(type,body),path=zonePath(`user:${captured.uid}`,'notes',id);
        const bytes=new globalThis.TextEncoder().encode(JSON.stringify({id,body:normalized,baseRevision}));
        const hash=[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
        const result=await runTransaction(db,async tx=>{
          const note=await tx.get(doc(db,path)),receiptRef=doc(db,`enq_users/${captured.uid}/receipts/${operationId}`),receipt=await tx.get(receiptRef);
          if(receipt.exists()){if(!note.exists())throw new Error('Cette note a été supprimée ; le brouillon reste disponible.');if(receipt.data().hash!==hash)throw new Error('Opération déjà utilisée');return {id,revision:receipt.data().revision,zone:`user:${captured.uid}`};}
          if((note.data()?.revision||0)!==baseRevision){const e=new Error('La note a changé sur un autre appareil');e.code='aborted';e.current=note.data();throw e;}
          const value={...normalized,etiquettes:normalized.etiquettes||[],id,type:'notes',operationId,authorUid:captured.uid,revision:baseRevision+1,createdAt:note.data()?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()};
          tx.set(doc(db,path),value);
          tx.set(doc(db,`enq_registry/${id}`),{id,type:'notes',zone:`user:${captured.uid}`,authorUid:captured.uid,state:'active',revision:value.revision,refs:[],createdAt:value.createdAt});
          tx.set(receiptRef,{id,revision:value.revision,hash,createdAt:serverTimestamp()});
          return {id,revision:value.revision,zone:`user:${captured.uid}`};
        });
        if(!active||generation!==token)throw new Error('Session changée');
        return result;
      }
      if(globalThis.navigator.onLine===false)throw new Error('Connexion nécessaire ; le brouillon reste disponible');
      const result=await callCommand({protocol:ENQUETE_PROTOCOL,action:'save',type,id,zone:zone||`user:${captured.uid}`,body:normalizeRecord(type,body),baseRevision,operationId});
      if(!active||generation!==token)throw new Error('Session changée');return result;
    },
    async action(record,action,zone,operationId=newEnqueteId()){
      assertSession();return callCommand({protocol:ENQUETE_PROTOCOL,type:record.type,id:record.id,baseRevision:record.revision,zone,action,operationId});
    },
    read:(action,id)=>{assertSession();return callRead({action,id});},
    async blob(file,{thumbnail=false}={}){
      const token=generation;assertSession();
      const blob=await getBlob(ref(storage,thumbnail&&file.thumbnailPath?file.thumbnailPath:file.path));
      if(!active||generation!==token)throw new Error('Session changée');
      return blob;
    },
    async objectUrl(file,options){const blob=await api.blob(file,options),url=URL.createObjectURL(blob);urls.add(url);return {url,release:()=>{urls.delete(url);URL.revokeObjectURL(url);}};},
    async upload(docId,file,{onProgress=()=>{},version=1}={}){
      const captured=assertSession(),uploadId=newEnqueteId();
      if(file.type.startsWith('image/')&&!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Images JPEG, PNG ou WebP requises');
      if(file.size>10*1024*1024)throw new Error('Fichier limité à 10 Mo');
      const send=(blob,id)=>new Promise((resolve,reject)=>{
        const task=uploadBytesResumable(ref(storage,`staging/${captured.uid}/${id}`),blob,{contentType:blob.type||'text/plain'});
        task.on('state_changed',s=>onProgress(s.bytesTransferred/s.totalBytes),reject,resolve);
      });
      let payload=file,thumbnailUploadId=null;
      if(file.type.startsWith('image/')){
        const image=await globalThis.createImageBitmap(file);
        const canvas=globalThis.document.createElement('canvas'),ratio=Math.min(1,2560/Math.max(image.width,image.height));
        canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        payload=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.88));
        const scale=Math.min(1,400/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);image.close();
        const thumb=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));thumbnailUploadId=newEnqueteId();await send(thumb,thumbnailUploadId);
      }
      await send(payload,uploadId);
      try{return await callFile({docId,uploadId,thumbnailUploadId,name:file.name,version});}
      catch(error){if(globalThis.navigator.onLine!==false){await deleteObject(ref(storage,`staging/${captured.uid}/${uploadId}`)).catch(()=>{});}throw error;}
    },
    close(){active=false;generation++;unsubscribeAuth();unsubscribeControl();stopData();}
  };
  return api;
}




export function listEnqueteDrafts(uid){
  if(!drafts)return [];
  const result=[];
  for(let i=0;i<drafts.length;i++){const key=drafts.key(i);if(key?.startsWith(`wfrp-enq-draft:${uid}:`)){try{const value=JSON.parse(drafts.getItem(key));if(value?.uid===uid)result.push({...value,id:key.slice(`wfrp-enq-draft:${uid}:`.length)});}catch{/* invalid draft */}}}
  return result.sort((a,b)=>b.savedAt-a.savedAt);
}





