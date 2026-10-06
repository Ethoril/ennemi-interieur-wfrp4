import { createHash,randomUUID } from 'node:crypto';
import { mutateMjContent as legacyPnjMutation, trashPublicContent, restorePublicContent } from '../contributions/service.mjs';
import { ENQUETE_PROTOCOL, TYPES, MAX_FILE_BYTES, EnqueteError, requireValue, validId, identity, member, canRead, zonePath, normalizeRecord, references, restrictiveZone } from './domain.mjs';
const snapData = s => s?.exists ? s.data() : null;
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const registry = (db,id) => db.doc(`enq_registry/${id}`);
const operation = (db,user,id) => db.doc(`enq_operations/${user.uid}_${id}`);
const history = (db,id,op) => db.doc(`enq_history/${id}/events/${op}`);
function command(raw) {
  requireValue(raw && validId(raw.id) && validId(raw.operationId) && TYPES.includes(raw.type),'Commande invalide');
  requireValue(raw.protocol===ENQUETE_PROTOCOL,'Mettre à jour l’application','failed-precondition');
  requireValue(['save','visibility','trash','restore','purge'].includes(raw.action),'Action invalide');
  requireValue(Number.isSafeInteger(raw.baseRevision)&&raw.baseRevision>=0,'Révision invalide');
  return raw;
}
async function accessFor(db,user) {
  const access=snapData(await db.doc('campagne/acces').get())||{};
  const isMember=member(user,access),account=snapData(await db.doc(`enq_accounts/${user.uid}`).get());
  requireValue(isMember||account,'Ce compte n’a pas accès à cette campagne','permission-denied');
  return { access, isMember };
}
function available(access) {
  requireValue(access.enqEnabled===true,'Le nouvel espace n’est pas encore activé','failed-precondition');
  requireValue(!access.enqMaintenance,'Réorganisation des accès en cours','failed-precondition');
}
async function endpoint(transaction,db,id,user,access) {
  const located=snapData(await transaction.get(registry(db,id)));
  if (located) {
    requireValue(located.state==='active'&&canRead(user,located.zone,access),'Pièce indisponible','permission-denied');
    return located;
  }
  const pnj=snapData(await transaction.get(db.doc(`pnjs/${id}`)));
  requireValue(pnj && pnj.suppressionEnCours!==true && member(user,access) && (pnj.visibleJoueurs===true || user.gm),'Personnage indisponible','permission-denied');
  return { id,type:'pnjs',zone:pnj.visibleJoueurs===true?'commun':'mj',state:'active' };
}
export async function getEnqueteSession(request,{db}) {
  const user=identity(request.auth);
  const {access,isMember}=await accessFor(db,user);
  if(isMember&&!(await db.doc(`enq_accounts/${user.uid}`).get()).exists)await db.doc(`enq_accounts/${user.uid}`).set({uid:user.uid,enrolled:true,createdAt:Date.now()});
  return {uid:user.uid,role:isMember?(user.gm?'mj':'joueur'):'ancien',active:access.enqEnabled===true,maintenance:!!access.enqMaintenance,protocol:ENQUETE_PROTOCOL};
}
export async function saveEnqueteCommand(raw,request,deps) {
  const c=command(raw),user=identity(request.auth),{db}=deps;
  await accessFor(db,user);
  if (c.action==='visibility' || c.action==='trash' || c.action==='restore') return startCascade(c,user,deps);
  if (c.action==='purge') return purgeEnquete(c,user,deps);
  const hash=digest(c);
  return db.runTransaction(async tx=>{
    const [acc,receipt,current]=await Promise.all([tx.get(db.doc('campagne/acces')),tx.get(operation(db,user,c.operationId)),tx.get(registry(db,c.id))]);
    const access=snapData(acc)||{}, old=snapData(current), replay=snapData(receipt);
    if(replay) {requireValue(replay.hash===hash,'Opération réutilisée','already-exists'); return replay.response;}
    available(access);
    const zone=old?.zone||c.zone||`user:${user.uid}`;
    requireValue(canRead(user,zone,access),'Accès refusé','permission-denied');
    requireValue(zone.startsWith('user:') || member(user,access),'Accès campagne requis','permission-denied');
    requireValue(!old || old.state==='active','Objet indisponible','not-found');
    requireValue((old?.revision||0)===c.baseRevision,'La version a changé','aborted',{});
    requireValue(!old || old.type===c.type,'Type incompatible');
    requireValue(!old || old.authorUid===user.uid || (user.gm&&!zone.startsWith('user:')),'Modification interdite','permission-denied');
    requireValue(c.type!=='enquetes'||user.gm,'Enquête réservée au MJ','permission-denied');
    requireValue(!['notes','dispositions'].includes(c.type)||zone===`user:${user.uid}`,'Objet personnel requis');
    if(!old)requireValue(!snapData(await tx.get(db.doc(`pnjs/${c.id}`))),'Identifiant déjà utilisé','already-exists');
    const body=normalizeRecord(c.type,c.body);
    if (c.type==='documents') {
      body.origine=old ? (snapData(await tx.get(db.doc(zonePath(zone,c.type,c.id))))?.origine||'contribution') : user.gm?(body.origine||'piece'):'contribution';
      body.categorie||='Autre';
    }
    const refs=references(c.type,body);
    const ends=await Promise.all(refs.map(id=>endpoint(tx,db,id,user,access)));
    if(c.type==='evenements')requireValue(ends[0]?.type==='enquetes'&&ends.slice(1,1+(body.documents||[]).length).every(e=>e.type==='documents')&&ends.slice(1+(body.documents||[]).length).every(e=>e.type==='pnjs'),'Références de chronologie invalides');
    if(c.type==='annotations')requireValue(ends[0]?.type==='documents','Document requis');
    if(c.type==='enquetes')requireValue(ends.every(e=>e.type==='documents'),'Ordre de documents requis');
    if(c.type==='dispositions')requireValue(ends[0]?.type==='enquetes','Enquête requise');
    if(ends.length) requireValue(restrictiveZone([zone,...ends.map(e=>e.zone)],user)===zone,'Audience incompatible avec les liens','permission-denied');
    if(c.type==='relations') requireValue(ends.every(e=>e.type==='documents'),'Relations entre documents uniquement');
    let uniqueKey=null;
    if(c.type==='liens') {
      const pair=ends.map(e=>e.type).sort().join(':');
      requireValue(['documents:enquetes','documents:pnjs','enquetes:pnjs','enquetes:notes','documents:notes','notes:pnjs'].includes(pair),'Association incompatible');
      const key=digest([zone,...[body.a,body.b].sort()]);
      const unique=snapData(await tx.get(db.doc(`enq_unique/${key}`)));
      requireValue(!unique||unique.id===c.id,'Ce lien existe déjà','already-exists');
      uniqueKey=key;
    }
    const files=[];
    for(const fileId of body.files||[]) {
      const f=snapData(await tx.get(db.doc(`enq_files/${fileId}`)));
      requireValue(f&&f.docId===c.id&&f.status==='ready','Fichier non vérifié','failed-precondition'); files.push(f);
    }
    if(c.type==='annotations') {
      const f=snapData(await tx.get(db.doc(`enq_files/${body.fileId}`)));
      requireValue(f&&f.docId===body.document&&f.version===body.version&&f.contentType.startsWith('image/'),'Image annotable indisponible');
    }
    const previousDocument=c.type==='documents'&&old?snapData(await tx.get(db.doc(zonePath(zone,c.type,c.id)))):null;
    const oldFiles=[];
    if(c.type==='documents')for(const fileId of new Set([...(previousDocument?.files||[]),...(body.files||[])])){const file=await tx.get(db.doc(`enq_files/${fileId}`));if(file.exists)oldFiles.push(file);}
    const annotationGrants=new Map();
    if(c.type==='annotations'){
      const previous=old?snapData(await tx.get(db.doc(zonePath(old.zone,old.type,old.id)))):null;
      const annotations=(await tx.get(db.collection('enq_registry').where('type','==','annotations'))).docs.map(d=>d.data()).filter(r=>r.state==='active'&&r.id!==c.id);
      const entries=[];
      for(const r of annotations){const value=snapData(await tx.get(db.doc(zonePath(r.zone,r.type,r.id))));if(value)entries.push({zone:r.zone,fileId:value.fileId});}
      entries.push({zone,fileId:body.fileId});
      for(const fileId of new Set([body.fileId,previous?.fileId].filter(Boolean))){const relevant=entries.filter(a=>a.fileId===fileId);annotationGrants.set(fileId,{sharedAnnotation:relevant.some(a=>a.zone==='commun'),annotationReaders:[...new Set(relevant.filter(a=>a.zone.startsWith('user:')).map(a=>a.zone.slice(5)))]});}
    }
    const now=deps.timestamp(), revision=(old?.revision||0)+1;
    if(uniqueKey)tx.set(db.doc(`enq_unique/${uniqueKey}`),{id:c.id});
    const value={...body,id:c.id,type:c.type,authorUid:old?.authorUid||user.uid,revision,createdAt:old?.createdAt||now,updatedAt:now};
    const descriptor={id:c.id,type:c.type,zone,desiredZone:old?.desiredZone||zone,authorUid:value.authorUid,state:'active',revision,refs,createdAt:value.createdAt};
    tx.set(db.doc(zonePath(zone,c.type,c.id)),value);
    tx.set(registry(db,c.id),descriptor);
    for(const f of oldFiles) tx.set(db.doc(`enq_file_access/${f.id}`),{docId:c.id,zone,ownerUid:value.authorUid,active:true,version:f.data().version,current:files.some(v=>v.id===f.id)}, {merge:true});
    for(const [fileId,grants]of annotationGrants)tx.set(db.doc(`enq_file_access/${fileId}`),grants,{merge:true});
    for(const f of files)tx.set(db.doc(`enq_files/${f.id}`),{attachedAt:now},{merge:true});
    if(!zone.startsWith('user:'))tx.set(history(db,c.id,c.operationId),{action:'save',revision,actorUid:user.uid,createdAt:now});
    const response={id:c.id,zone,revision}; tx.set(operation(db,user,c.operationId),{hash,response,createdAt:now});
    return response;
  });
}
async function startCascade(c,user,deps) {
  const {db}=deps;
  const hash=digest(c);
  const result=await db.runTransaction(async tx=>{
    const [acc,oldSnap,receipt]=await Promise.all([tx.get(db.doc('campagne/acces')),tx.get(registry(db,c.id)),tx.get(operation(db,user,c.operationId))]);
    const access=snapData(acc)||{},old=snapData(oldSnap),replay=snapData(receipt);
    if(replay){requireValue(replay.hash===hash,'Opération réutilisée','already-exists');return replay.response;}
    available(access);
    requireValue(old&&old.type===c.type&&canRead(user,old.zone,access),'Objet indisponible','permission-denied');
    requireValue(old.revision===c.baseRevision,'La version a changé','aborted');
    requireValue(user.gm&&!old.zone.startsWith('user:') || old.authorUid===user.uid,'Action interdite','permission-denied');
    requireValue(c.action!=='restore'||user.gm||old.zone===`user:${user.uid}`,'Restauration réservée au MJ','permission-denied');
    let destination=c.zone||old.zone;
    if(c.action==='restore')destination=old.authorUid===user.uid?`user:${user.uid}`:'mj';
    if(c.action==='visibility') {
      requireValue(!['notes','dispositions'].includes(old.type),'Ce contenu reste personnel ; partager une copie de document','permission-denied');
      requireValue(!(old.type==='annotations'&&old.zone.startsWith('user:')),'Partager une copie de l’annotation','permission-denied');
      requireValue(['commun','mj',`user:${old.authorUid}`].includes(destination),'Audience invalide');
      requireValue(user.gm || destination==='commun'&&old.zone===`user:${user.uid}`,'Publication interdite','permission-denied');
      requireValue(member(user,access),'Accès campagne requis','permission-denied');
    }
    let body=c.action==='restore'?snapData(await tx.get(db.doc(`enq_trash/${c.id}`)))?.body:snapData(await tx.get(db.doc(zonePath(old.zone,old.type,old.id))));
    requireValue(body,'Objet absent','not-found');
    let hiddenOrder=null;
    if(c.action==='visibility'&&destination==='commun'){
      const ends=await Promise.all((old.refs||[]).map(id=>endpoint(tx,db,id,user,access)));
      if(old.type==='enquetes'){hiddenOrder=body.ordre||[];body={...body,ordre:hiddenOrder.filter(id=>ends.some(e=>e.id===id&&e.zone==='commun'))};}
      else requireValue(ends.every(e=>e.zone==='commun'),'Les références doivent être visibles dans le groupe','permission-denied');
    }
    const jobId=`${user.uid}_${c.operationId}`;
    const job={id:jobId,command:c,hash,root:{...old,refs:references(old.type,body)},body,destination,actorUid:user.uid,status:'pending',createdAt:deps.timestamp()};
    if(hiddenOrder)tx.set(db.doc(`enq_mj/data/ordres/${old.id}`),{ordre:hiddenOrder});
    tx.set(db.doc(`enq_jobs/${jobId}`),job);
    tx.update(registry(db,c.id),{state:'moving'});
    tx.update(db.doc('campagne/acces'),{enqMaintenance:jobId});
    tx.set(db.doc('enq_control/public'),{active:true,maintenance:true,protocol:ENQUETE_PROTOCOL});
    const response={id:c.id,jobId,status:'pending'}; tx.set(operation(db,user,c.operationId),{hash,response,createdAt:deps.timestamp()});
    return response;
  });
  const resumed=result.jobId?await resumeEnqueteCascade(result.jobId,deps):{status:'completed'};
  return {...result,status:resumed.status};
}
async function runEnqueteCascade(jobId,deps) {
  const {db}=deps,jobRef=db.doc(`enq_jobs/${jobId}`),job=snapData(await jobRef.get());
  if(!job||job.status==='completed')return;
  const access=snapData(await db.doc('campagne/acces').get());
  requireValue(access?.enqMaintenance===jobId,'Verrou de cascade absent','failed-precondition');
  if(job.command.action==='purge'){await finishPurgeJob(job,deps);return;}
  // The maintenance lock blocks every shared command, including old PNJ mutations.
  if(job.legacyCommand&&!job.legacyDone){
    const action=deps.legacyMutation||({trash:trashPublicContent,restore:restorePublicContent}[job.legacyAction]||legacyPnjMutation);
    try{await action(job.legacyCommand,job.legacyRequest,{...deps,enqueteJobId:jobId});await jobRef.update({legacyDone:true});}
    catch(error){
      const receipt=snapData(await db.doc(`content_operations/${job.legacyCommand.operationId}`).get());
      if(!receipt&&['aborted','invalid-argument','permission-denied','not-found','failed-precondition','already-exists'].includes(error.code)){
        await db.runTransaction(async tx=>{const acc=snapData(await tx.get(db.doc('campagne/acces')));if(acc.enqMaintenance===jobId){tx.update(db.doc('campagne/acces'),{enqMaintenance:null});tx.set(db.doc('enq_control/public'),{active:true,maintenance:false,protocol:ENQUETE_PROTOCOL});tx.update(jobRef,{status:'failed',payloadCleaned:false,errorCode:error.code});}});
      }
      throw error;
    }
  }
  if(job.status==='pending') {
    const all=(await db.collection('enq_registry').get()).docs.map(d=>d.data());
    const referencedIds=[...new Set(all.flatMap(r=>r.refs||[]))].filter(id=>!all.some(r=>r.id===id));
    const pnjZones=new Map();for(const id of referencedIds){const pnj=snapData(await db.doc(`pnjs/${id}`).get());if(pnj)pnjZones.set(id,pnj.visibleJoueurs?'commun':'mj');}
    const targets=new Map([[job.root.id,{...job.root,zone:job.destination,desiredZone:job.destination,state:job.command.action==='trash'?'trash':'active',revision:job.root.revision+1}]]);
    let changed=true;
    while(changed) {
      changed=false;
      for(const r of all.filter(r=>!r.zone.startsWith('user:')&&!targets.has(r.id)&&r.state==='active')) {
        if(!r.refs?.some(id=>targets.has(id)))continue;
        const zones=r.refs.map(id=>targets.get(id)?.zone||all.find(a=>a.id===id)?.zone||pnjZones.get(id)||'mj');
        const removed=r.refs.some(id=>targets.get(id)?.state==='trash');
        const dest=removed?'mj':zones.some(z=>z.startsWith('user:'))?'mj':zones.includes('mj')?'mj':r.desiredZone||r.zone;
        if(r.type==='enquetes')continue; // Editorial order is projected separately below.
        if(dest!==r.zone||removed){targets.set(r.id,{...r,zone:dest,state:removed?'trash':'active',revision:r.revision+1});changed=true;}
      }
    }
    const plan=[];
    for(const next of targets.values()) {
      if(next.type==='pnjs')continue;
      const old=all.find(r=>r.id===next.id)||job.root;
      const body=next.id===job.root.id?job.body:snapData(await db.doc(zonePath(old.zone,old.type,old.id)).get());
      if(!body)continue;
      plan.push({old,next,body:{...body,revision:next.revision,updatedAt:Date.now()}});
    }
    for(const r of all.filter(r=>r.type==='enquetes'&&r.zone==='commun'&&r.state==='active')) {
      const ref=db.doc(zonePath(r.zone,r.type,r.id)),body=snapData(await ref.get());
      const order=body?.ordre||[], filtered=order.filter(id=>!targets.has(id)||targets.get(id).zone==='commun'&&targets.get(id).state==='active');
      if(order.length!==filtered.length) {
        await db.doc(`enq_mj/data/ordres/${r.id}`).set({ordre:order});
        plan.push({old:r,next:{...r,revision:r.revision+1,refs:filtered},body:{...body,ordre:filtered,revision:r.revision+1}});
      }
    }
    for(let start=0;start<plan.length;start+=100){const b=db.batch();for(const [offset,item] of plan.slice(start,start+100).entries())b.set(jobRef.collection('items').doc(String(start+offset).padStart(8,'0')),item);await b.commit();}
    await jobRef.update({count:plan.length,cursor:0,status:'moving'});job.cursor=0;
  }
  const plan=(await jobRef.collection('items').orderBy('__name__').get()).docs.map(d=>d.data());
  for(let cursor=job.cursor||0;cursor<plan.length;cursor+=1) {
    const batch=db.batch();
    for(const item of plan.slice(cursor,cursor+1)) {
      const {old,next,body}=item;
      if(old.zone!==next.zone)batch.delete(db.doc(zonePath(old.zone,old.type,old.id)));
      if(next.state==='trash') {
        batch.delete(db.doc(zonePath(old.zone,old.type,old.id)));
        batch.set(db.doc(`enq_trash/${old.id}`),{...next,body,originalZone:old.zone,expiresAt:Date.now()+30*86400000});
      } else {batch.set(db.doc(zonePath(next.zone,next.type,next.id)),body);batch.delete(db.doc(`enq_trash/${old.id}`));}
      batch.set(registry(db,next.id),next);
      const files=(await db.collection('enq_files').where('docId','==',next.id).get()).docs;
      for(let offset=0;offset<files.length;offset+=200){const fileBatch=db.batch();for(const f of files.slice(offset,offset+200))fileBatch.set(db.doc(`enq_file_access/${f.id}`),{docId:next.id,zone:next.zone,ownerUid:next.authorUid,active:next.state==='active',version:f.data().version},{merge:true});await fileBatch.commit();}
      if(!next.zone.startsWith('user:'))batch.set(history(db,next.id,jobId),{action:job.command.action,revision:next.revision,actorUid:job.actorUid,createdAt:deps.timestamp()});
    }
    batch.update(jobRef,{cursor:Math.min(cursor+1,plan.length)});await batch.commit();
  }
  await refreshAnnotationGrants(deps);
  await db.runTransaction(async tx=>{
    const lock=snapData(await tx.get(db.doc('campagne/acces')));
    requireValue(lock.enqMaintenance===jobId,'Verrou modifié','failed-precondition');
    tx.update(db.doc('campagne/acces'),{enqMaintenance:null});
    tx.set(db.doc('enq_control/public'),{active:true,maintenance:false,protocol:ENQUETE_PROTOCOL});
    tx.update(jobRef,{status:'completed',payloadCleaned:false,completedAt:deps.timestamp()});
  });
}

async function purgeEnquete(c,user,deps){
  const {db}=deps;
  await accessFor(db,user);
  c={...c,operationId:c.operationId||'automatic_'+digest([c.id,c.baseRevision]).slice(0,32),action:'purge'};
  const hash=digest(c),jobId=`${user.uid}_purge_${c.operationId}`;
  const response=await db.runTransaction(async tx=>{
    const [acc,receipt,old]=await Promise.all([tx.get(db.doc('campagne/acces')),tx.get(operation(db,user,c.operationId)),tx.get(db.doc(`enq_trash/${c.id}`))]);
    const replay=snapData(receipt),access=snapData(acc)||{},trash=snapData(old);
    if(replay){requireValue(replay.hash===hash,'Opération réutilisée','already-exists');return replay.response;}
    available(access);
    requireValue(trash&&trash.type===c.type&&canRead(user,trash.zone,access)&&(trash.zone.startsWith('user:')?trash.authorUid===user.uid:user.gm),'Corbeille indisponible','permission-denied');
    requireValue(trash.revision===c.baseRevision,'La version a changé','aborted');
    tx.set(db.doc(`enq_jobs/${jobId}`),{id:jobId,command:c,root:{id:c.id,type:c.type,zone:trash.zone,revision:trash.revision,authorUid:trash.authorUid},actorUid:user.uid,status:'pending',createdAt:deps.timestamp()});
    tx.update(registry(db,c.id),{state:'purging'});
    tx.update(db.doc('campagne/acces'),{enqMaintenance:jobId});
    tx.set(db.doc('enq_control/public'),{active:true,maintenance:true,protocol:ENQUETE_PROTOCOL});
    const result={id:c.id,jobId,status:'pending'};tx.set(operation(db,user,c.operationId),{hash,response:result,createdAt:deps.timestamp()});return result;
  });
  const result=await resumeEnqueteCascade(response.jobId,deps);
  return {...response,status:result.status==='completed'?'purged':result.status};
}
async function finishPurgeJob(job,deps){
  const {db,bucket}=deps,id=job.root.id;
  for(const f of (await db.collection('enq_files').where('docId','==',id).get()).docs){
    await bucket.file(f.data().path).delete({ignoreNotFound:true});
    if(f.data().thumbnailPath)await bucket.file(f.data().thumbnailPath).delete({ignoreNotFound:true});
    await db.doc(`enq_file_access/${f.id}`).delete();await f.ref.delete();
  }
  await db.runTransaction(async tx=>{
    const lock=snapData(await tx.get(db.doc('campagne/acces')));
    requireValue(lock.enqMaintenance===job.id,'Verrou de purge modifié','failed-precondition');
    tx.delete(registry(db,id));tx.delete(db.doc(`enq_trash/${id}`));
    tx.update(db.doc('campagne/acces'),{enqMaintenance:null});
    tx.set(db.doc('enq_control/public'),{active:true,maintenance:false,protocol:ENQUETE_PROTOCOL});
    tx.update(db.doc(`enq_jobs/${job.id}`),{status:'completed',payloadCleaned:false,completedAt:deps.timestamp()});
  });
}

export async function enquiryRead(request,deps) {
  const user=identity(request.auth),{access}=await accessFor(deps.db,user),{action,id}=request.data||{};
  if(action==='trash') {
    const docs=(await deps.db.collection('enq_trash').get()).docs.map(d=>d.data());
    return {items:docs.filter(r=>canRead(user,r.zone,access)&&(user.gm&&!r.zone.startsWith('user:') || r.authorUid===user.uid)).map(r=>({id:r.id,type:r.type,zone:r.zone,revision:r.revision,authorUid:r.authorUid,titre:r.body.titre||'Sans titre',expiresAt:r.expiresAt}))};
  }
  if(action==='resolveLegacy'){
    requireValue(typeof id==='string'&&/^[A-Za-z0-9_-]{1,150}$/u.test(id),'Identifiant invalide');
    const mapping=snapData(await deps.db.doc(`enq_legacy_routes/${id}`).get());
    if(!mapping)return {id:null};const target=snapData(await registry(deps.db,mapping.id).get());
    return {id:target&&target.state==='active'&&canRead(user,target.zone,access)?mapping.id:null};
  }
  requireValue(validId(id),'Identifiant invalide');
  const r=snapData(await registry(deps.db,id).get());
  requireValue(r&&canRead(user,r.zone,access)&&r.state==='active','Pièce indisponible','permission-denied');
  if(action==='history')return {items:(await deps.db.collection(`enq_history/${id}/events`).get()).docs.map(d=>d.data())};
  if(action==='files'){
    const result=[];
    for(const f of (await deps.db.collection('enq_files').where('docId','==',id).get()).docs){const a=snapData(await deps.db.doc(`enq_file_access/${f.id}`).get());if(a?.current||a?.sharedAnnotation||r.authorUid===user.uid||user.gm&&!r.zone.startsWith('user:')||a?.annotationReaders?.includes(user.uid))result.push(f.data());}
    return {items:result};
  }
  throw new EnqueteError('Lecture inconnue');
}
export async function finalizeEnqueteFile(request,deps) {
  const user=identity(request.auth),{db,bucket}=deps,{docId,uploadId,name,version=1,thumbnailUploadId}=request.data||{};
  requireValue(validId(docId)&&validId(uploadId)&&Number.isSafeInteger(version)&&version>0&&typeof name==='string'&&name.length<=200,'Fichier invalide');
  const {access}=await accessFor(db,user);available(access);
  const r=snapData(await registry(db,docId).get());
  requireValue(r&&r.type==='documents'&&canRead(user,r.zone,access)&&(r.authorUid===user.uid||user.gm&&!r.zone.startsWith('user:')),'Document interdit','permission-denied');
  const existing=snapData(await db.doc(`enq_files/${uploadId}`).get());
  if(existing){requireValue(existing.docId===docId,'Fichier déjà affecté');return existing;}
  const source=bucket.file(`staging/${user.uid}/${uploadId}`),[metadata]=await source.getMetadata();
  requireValue(Number(metadata.size)<=MAX_FILE_BYTES&&Number(metadata.size)>0,'Fichier trop volumineux');
  const [bytes]=await source.download();
  const mime=detectFile(bytes,name);
  const path=`documents/${docId}/${uploadId}/${version}`;
  const target=bucket.file(path);
  await target.save(bytes,{metadata:{contentType:mime,cacheControl:'private, no-store',metadata:{}}});
  const [targetMeta]=await target.getMetadata();
  if(targetMeta.metadata?.firebaseStorageDownloadTokens)await target.setMetadata({metadata:{firebaseStorageDownloadTokens:null}});
  let thumbnailPath=null;
  if(thumbnailUploadId){
    requireValue(validId(thumbnailUploadId)&&mime.startsWith('image/'),'Miniature invalide');
    const thumb=bucket.file(`staging/${user.uid}/${thumbnailUploadId}`),[thumbBytes]=await thumb.download();
    requireValue(thumbBytes.length<=500000&&detectFile(thumbBytes,'thumbnail.jpg')==='image/jpeg','Miniature invalide');
    thumbnailPath=`documents/${docId}/${uploadId}/thumb`;
    await bucket.file(thumbnailPath).save(thumbBytes,{metadata:{contentType:'image/jpeg',cacheControl:'private, no-store',metadata:{}}});
    await thumb.delete({ignoreNotFound:true});
  }
  const value={id:uploadId,docId,path,thumbnailPath,name,version,contentType:mime,size:bytes.length,status:'ready',createdAt:Date.now()};
  await db.runTransaction(async tx=>{
    const [acc,current,file]=await Promise.all([tx.get(db.doc('campagne/acces')),tx.get(registry(db,docId)),tx.get(db.doc(`enq_files/${uploadId}`))]);
    available(snapData(acc)||{});const owner=snapData(current);
    requireValue(owner&&owner.state==='active'&&owner.revision===r.revision,'Le document a changé','aborted');
    requireValue(!snapData(file),'Fichier déjà finalisé','already-exists');
    tx.set(db.doc(`enq_files/${uploadId}`),value);
    tx.set(db.doc(`enq_file_access/${uploadId}`),{docId,zone:owner.zone,ownerUid:owner.authorUid,active:true,current:false,version});
  });
  await source.delete({ignoreNotFound:true});return value;
}
export function detectFile(bytes,name) {
  if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  requireValue(/\.(txt|md)$/iu.test(name)&&!bytes.includes(0),'Format non autorisé');
  try {new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new EnqueteError('Texte UTF-8 requis');}
  return 'text/plain';
}
export async function maintainEnquetes(deps) {
  const jobs=(await deps.db.collection('enq_jobs').where('status','in',['pending','moving']).get()).docs;
  for(const j of jobs)await resumeEnqueteCascade(j.id,deps);
  for(const job of (await deps.db.collection('enq_jobs').where('status','in',['completed','failed']).where('payloadCleaned','==',false).get()).docs)await cleanCompletedJob(job.id,deps);
  const stale=(await deps.db.collection('enq_trash').where('expiresAt','<=',Date.now()).get()).docs;
  for(const t of stale) {
    const r=t.data();
    await purgeEnquete({id:t.id,type:r.type,baseRevision:r.revision,zone:r.zone},{uid:r.authorUid,gm:true},deps);
  }
  const unused=(await deps.db.collection('enq_files').get()).docs;
  for(const f of unused){const value=f.data();if(value.attachedAt||value.createdAt>Date.now()-86400000)continue;const root=snapData(await registry(deps.db,value.docId).get());if(root?.state==='moving')continue;const record=root?.state==='active'?snapData(await deps.db.doc(zonePath(root.zone,root.type,root.id)).get()):null;if(record?.files?.includes(f.id)){await f.ref.set({attachedAt:value.createdAt},{merge:true});continue;}const acl=snapData(await deps.db.doc(`enq_file_access/${f.id}`).get());if(acl?.sharedAnnotation||acl?.annotationReaders?.length)continue;await deps.bucket.file(value.path).delete({ignoreNotFound:true});if(value.thumbnailPath)await deps.bucket.file(value.thumbnailPath).delete({ignoreNotFound:true});await deps.db.doc(`enq_file_access/${f.id}`).delete();await f.ref.delete();}
  const known=new Set((await deps.db.collection('enq_files').get()).docs.flatMap(f=>[f.data().path,f.data().thumbnailPath].filter(Boolean)));
  for(const f of (await deps.bucket.getFiles({prefix:'documents/'}))[0]){if(known.has(f.name)||!/^documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/(?:[0-9]+|thumb)$/u.test(f.name))continue;const [metadata]=await f.getMetadata();if(Date.parse(metadata.timeCreated)<Date.now()-86400000)await f.delete({ignoreNotFound:true});}
  const [files]=await deps.bucket.getFiles({prefix:'staging/'});
  for(const f of files) {const [m]=await f.getMetadata();if(Date.parse(m.timeCreated)<Date.now()-86400000)await f.delete({ignoreNotFound:true});}
}




export async function guardPnjVisibility(command,request,deps,legacyMutation,legacyAction='visibility') {
  const user=identity(request.auth),access=snapData(await deps.db.doc('campagne/acces').get())||{};
  if(!access.enqEnabled||command?.kind!=='pnj'||legacyAction==='visibility'&&typeof command.changes?.visibleJoueurs!=='boolean')return legacyMutation(command,request,deps);
  if(!user.gm){
    requireValue(member(user,access)&&['trash','restore'].includes(legacyAction),'Action MJ requise','permission-denied');
    const owner=snapData(await deps.db.doc(legacyAction==='trash'?`content_metadata/pnj_${command.id}`:`content_trash/pnj_${command.id}`).get());
    requireValue(owner?.ownerUid===user.uid&&(legacyAction==='trash'||owner.ownerCanRestore===true),'Action réservée au propriétaire','permission-denied');
  }
  requireValue(validId(command.id)&&validId(command.operationId),'Commande PNJ invalide');
  const pnj=snapData(await deps.db.doc(`pnjs/${command.id}`).get());
  const priorJob=snapData(await deps.db.doc(`enq_jobs/pnj_${command.operationId}`).get());
  if(!priorJob&&(!pnj&&legacyAction!=='restore'||legacyAction==='visibility'&&pnj?.visibleJoueurs===command.changes.visibleJoueurs))return legacyMutation(command,request,deps);
  const jobId=`pnj_${command.operationId}`,jobRef=deps.db.doc(`enq_jobs/${jobId}`);
  await deps.db.runTransaction(async tx=>{
    const [acc,prior]=await Promise.all([tx.get(deps.db.doc('campagne/acces')),tx.get(jobRef)]);
    const previous=snapData(prior);
    if(previous){requireValue(previous.hash===digest(command)&&previous.legacyAction===legacyAction,'Opération réutilisée','already-exists');requireValue(previous.status!=='failed','Cette opération PNJ a échoué ; utilise une nouvelle opération','failed-precondition');return;}
    available(snapData(acc)||{});
    tx.set(jobRef,{id:jobId,hash:digest(command),command:{action:legacyAction},legacyCommand:command,legacyAction,
      legacyRequest:{auth:{uid:request.auth.uid,token:{email:request.auth.token.email,email_verified:request.auth.token.email_verified}}},
      root:{id:command.id,type:'pnjs',zone:pnj?.visibleJoueurs?'commun':'mj',revision:0,state:'active',authorUid:user.uid},
      destination:legacyAction==='visibility'&&command.changes.visibleJoueurs?'commun':'mj',actorUid:user.uid,status:'pending',createdAt:deps.timestamp()});
    tx.update(deps.db.doc('campagne/acces'),{enqMaintenance:jobId});tx.set(deps.db.doc('enq_control/public'),{active:true,maintenance:true,protocol:ENQUETE_PROTOCOL});
  });
  const resumed=await resumeEnqueteCascade(jobId,{...deps,legacyMutation});
  requireValue(resumed.status==='completed','Opération déjà en cours ; réessayer dans quelques instants','failed-precondition');
  const result=snapData(await deps.db.doc(`content_operations/${command.operationId}`).get());
  return result.response;
}





async function refreshAnnotationGrants({db}){
  const annotations=(await db.collection('enq_registry').where('type','==','annotations').get()).docs.map(d=>d.data()).filter(r=>r.state==='active');
  const entries=[];
  for(const r of annotations){const a=snapData(await db.doc(zonePath(r.zone,r.type,r.id)).get());if(a)entries.push({zone:r.zone,fileId:a.fileId});}
  for(const f of (await db.collection('enq_file_access').get()).docs){const relevant=entries.filter(a=>a.fileId===f.id);await f.ref.set({sharedAnnotation:relevant.some(a=>a.zone==='commun'),annotationReaders:[...new Set(relevant.filter(a=>a.zone.startsWith('user:')).map(a=>a.zone.slice(5)))]},{merge:true});}
}



export async function resumeEnqueteCascade(jobId,deps){
  const ref=deps.db.doc(`enq_jobs/${jobId}`),owner=randomUUID();
  const claim=await deps.db.runTransaction(async tx=>{
    const job=snapData(await tx.get(ref));
    if(!job||job.status==='completed')return 'completed';
    requireValue(job.status!=='failed','Opération déjà refusée','failed-precondition');
    if(job.leaseUntil>Date.now())return 'running';
    tx.update(ref,{leaseOwner:owner,leaseUntil:Date.now()+150000});return 'owned';
  });
  if(claim!=='owned'){if(claim==='completed')await cleanCompletedJob(jobId,deps);return {status:claim};}
  try{await runEnqueteCascade(jobId,deps);await cleanCompletedJob(jobId,deps);return {status:'completed'};}
  finally{
    try{await deps.db.runTransaction(async tx=>{const job=snapData(await tx.get(ref));if(job?.leaseOwner===owner)tx.update(ref,{leaseOwner:null,leaseUntil:0});});}
    catch{/* A killed worker's lease expires; the next scheduled run retries. */}
  }
}






async function cleanCompletedJob(jobId,{db}){
  const ref=db.doc(`enq_jobs/${jobId}`),job=snapData(await ref.get());
  if(!job||job.payloadCleaned||!['completed','failed'].includes(job.status))return;
  const items=(await ref.collection('items').get()).docs;
  for(let offset=0;offset<items.length;offset+=200){const batch=db.batch();for(const item of items.slice(offset,offset+200)){const value=item.data();batch.set(item.ref,{old:value.old,next:value.next});}await batch.commit();}
  const clean=Object.fromEntries(Object.entries(job).filter(([key])=>!['body','legacyCommand','legacyRequest'].includes(key)));
  clean.command=Object.fromEntries(Object.entries(job.command||{}).filter(([key])=>['action','id','type','baseRevision','zone','operationId','protocol'].includes(key)));
  await ref.set({...clean,payloadCleaned:true});
}


