import { createEnqueteProductionClient } from './lib/enquetes-production.mjs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore,FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { detectFile } from '../functions/src/enquetes/service.mjs';
import { normalizeRecord } from '../functions/src/enquetes/domain.mjs';
import { convertLegacyIndice,legacyStoragePath } from './lib/enquetes-import-model.mjs';
const args=process.argv.slice(2),project=args[args.indexOf('--project')+1];
if(!args.includes('--project')||!project||project.startsWith('--'))throw new Error('--project est obligatoire');
const applying=args.includes('--apply'),production=project==='campagne-wrpg';
if(production&&!args.includes('--confirm-production'))throw new Error('La production nécessite une autorisation humaine et --confirm-production');
if(process.env.FIRESTORE_EMULATOR_HOST&&!project.startsWith('demo-'))throw new Error('Émulateur : projet demo requis');
if(!production&&!project.startsWith('demo-')&&!project.includes('recette'))throw new Error('Projet de recette ou demo requis');
const bucketName=args.includes('--bucket')?args[args.indexOf('--bucket')+1]:project+'.firebasestorage.app';
const client=production?await createEnqueteProductionClient():null;
if(!client)initializeApp({projectId:project,storageBucket:bucketName});
const db=client?.db||getFirestore(),bucket=client?.bucket||getStorage().bucket();
const report={project,mode:applying?'apply':'dry-run',converted:[],existing:[],anomalies:[]};
const indices=(await db.collection('indices').get()).docs;
for(const source of indices){
  const raw=source.data(),converted=convertLegacyIndice(source.id,raw),id=converted.id;
  if((await db.doc('enq_registry/'+id).get()).exists){report.existing.push(source.id);continue;}
  const files=[];
  for(const pnjId of converted.pnjsLies)if(!(await db.doc('pnjs/'+pnjId).get()).exists)report.anomalies.push({legacyId:source.id,kind:'missing-pnj',pnjId});
  try{normalizeRecord('documents',{titre:converted.titre,texte:converted.texte,description:converted.description,categorie:converted.categorie,provenance:converted.provenance});}catch{report.anomalies.push({legacyId:source.id,kind:'invalid-content'});continue;}
  if(converted.pnjsLies.length>100){report.anomalies.push({legacyId:source.id,kind:'too-many-pnjs'});continue;}
  const path=legacyStoragePath(raw,bucketName,source.id);
  if(path){
    const fileId='f_'+createHash('sha256').update(source.id+'|'+path).digest('hex').slice(0,24),destination=`documents/${id}/${fileId}/1`;
    const [exists]=await bucket.file(path).exists();
    if(!exists)report.anomalies.push({legacyId:source.id,kind:'missing-image'});
    else{
      const [metadata]=await bucket.file(path).getMetadata();
      if(Number(metadata.size)>10*1024*1024)report.anomalies.push({legacyId:source.id,kind:'image-over-limit'});
      else{
        const [bytes]=await bucket.file(path).download();let contentType;
        try{contentType=detectFile(bytes,path);}catch{report.anomalies.push({legacyId:source.id,kind:'invalid-image-format'});continue;}
        if(!applying){report.converted.push(source.id);continue;}
        await bucket.file(path).copy(bucket.file(destination));
        await bucket.file(destination).setMetadata({cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}});
        files.push({id:fileId,docId:id,path:destination,thumbnailPath:null,name:'illustration',version:1,contentType,size:Number(metadata.size),status:'ready',createdAt:Date.now(),attachedAt:Date.now()});
      }
    }
  }else if(raw.imagePath||raw.imageUrl)report.anomalies.push({legacyId:source.id,kind:'invalid-image-reference'});
  if(applying){
    const now=FieldValue.serverTimestamp(),zone=converted.zone,body={id,type:'documents',titre:converted.titre,texte:converted.texte,description:converted.description,categorie:converted.categorie,origine:'piece',provenance:converted.provenance,etiquettes:[],files:files.map(f=>f.id),authorUid:'migration_mj',revision:1,createdAt:now,updatedAt:now};
    const batch=db.batch();batch.set(db.doc(`enq_${zone}/data/documents/${id}`),body);
    batch.set(db.doc('enq_registry/'+id),{id,type:'documents',zone,desiredZone:zone,state:'active',authorUid:'migration_mj',revision:1,refs:[],createdAt:now});
    batch.set(db.doc('enq_legacy_routes/'+source.id),{id});
    for(const f of files){batch.set(db.doc('enq_files/'+f.id),f);batch.set(db.doc('enq_file_access/'+f.id),{docId:id,zone,ownerUid:'migration_mj',active:true,current:true,version:1});}
    for(const pnjId of converted.pnjsLies){
      const pnj=await db.doc('pnjs/'+pnjId).get();if(!pnj.exists)continue;
      const linkZone=zone==='mj'||pnj.data().visibleJoueurs!==true?'mj':'commun',linkId='link_'+createHash('sha256').update(JSON.stringify([id,pnjId].sort())).digest('hex').slice(0,24);
      const link={id:linkId,type:'liens',a:id,b:pnjId,role:'',authorUid:'migration_mj',revision:1,createdAt:now,updatedAt:now};
      batch.set(db.doc(`enq_${linkZone}/data/liens/${linkId}`),link);
      batch.set(db.doc('enq_registry/'+linkId),{id:linkId,type:'liens',zone:linkZone,desiredZone:zone,authorUid:'migration_mj',revision:1,state:'active',refs:[id,pnjId],createdAt:now});
      const unique=createHash('sha256').update(JSON.stringify([linkZone,...[id,pnjId].sort()])).digest('hex');
      batch.set(db.doc('enq_unique/'+unique),{id:linkId});
    }
    await batch.commit();
  }
  report.converted.push(source.id);
}
const output=args.includes('--report')?args[args.indexOf('--report')+1]:'enquetes-import-report.json';
await writeFile(output,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({converted:report.converted.length,existing:report.existing.length,anomalies:report.anomalies.length,report:output}));
if(report.anomalies.length)process.exitCode=2;
if(client)await client.app.delete();




