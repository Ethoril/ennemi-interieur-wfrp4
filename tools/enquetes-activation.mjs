import { createEnqueteProductionClient } from './lib/enquetes-production.mjs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const args=process.argv.slice(2),project=args[args.indexOf('--project')+1];
if(!args.includes('--project')||!project||project.startsWith('--'))throw new Error('--project obligatoire');
if(project==='campagne-wrpg'&&!args.includes('--confirm-production'))throw new Error('Autorisation humaine et --confirm-production requis');
if(project!=='campagne-wrpg'&&!project.startsWith('demo-')&&!project.includes('recette'))throw new Error('Projet non autorisé');
const enabled=!args.includes('--disable');
if(!args.includes('--apply')){console.log(JSON.stringify({project,enabled,mode:'dry-run'}));process.exit(0);}

const client=project==='campagne-wrpg'?await createEnqueteProductionClient():null;
if(!client)initializeApp({projectId:project});
const db=client?.db||getFirestore();
if(enabled){
  for(const source of (await db.collection('indices').get()).docs){
    const mapping=await db.doc('enq_legacy_routes/'+source.id).get();
    if(!mapping.exists)throw new Error('Import incomplet : '+source.id);
    const registry=await db.doc('enq_registry/'+mapping.data().id).get();
    if(!registry.exists||registry.data().type!=='documents'||registry.data().state!=='active')throw new Error('Document importé indisponible : '+source.id);
  }
}

await db.runTransaction(async tx=>{
  const access=await tx.get(db.doc('campagne/acces'));
  if(!access.exists||access.data().enqMaintenance)throw new Error('Accès absents ou cascade en cours');
  tx.update(db.doc('campagne/acces'),{enqEnabled:enabled});
  tx.set(db.doc('enq_control/public'),{active:enabled,maintenance:false,protocol:1});
});
console.log(JSON.stringify({project,enabled}));
if(client)await client.app.delete();



