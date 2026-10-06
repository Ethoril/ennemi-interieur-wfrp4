import { resolve,isAbsolute } from 'node:path';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEnqueteProductionClient } from './lib/enquetes-production.mjs';
import { captureEnqueteRecovery,verifyEnqueteRecovery } from './lib/enquetes-recovery.mjs';
import { encryptArchive,decryptArchive,isOutsideRepository } from './fiche-prod-backup.mjs';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
if(option('--project')!=='campagne-wrpg'||!args.includes('--confirm-production'))throw new Error('Projet de production et confirmation obligatoires');
const directory=option('--out-dir');
if(!args.includes('--out-dir')||!isAbsolute(directory)||!isOutsideRepository(directory))throw new Error('Dossier absolu hors dépôt obligatoire');
await mkdir(directory,{recursive:true});
const client=await createEnqueteProductionClient();
try{
  const snapshot=await captureEnqueteRecovery(client);
  verifyEnqueteRecovery(snapshot);
  const payload={project:'campagne-wrpg',capturedAt:new Date().toISOString(),snapshot};
  const bytes=encryptArchive(payload);
  const destination=resolve(directory,'enquetes-'+Date.now()+'.dpapi.json');
  await writeFile(destination,bytes,{flag:'wx'});
  const verified=decryptArchive(await readFile(destination));
  verifyEnqueteRecovery(verified.snapshot);
  if(JSON.stringify(payload)!==JSON.stringify(verified))throw new Error('Sauvegarde relue différente');
  console.log(JSON.stringify({backup:destination,documents:snapshot.documents.length,files:snapshot.files.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),verified:true}));
}finally{await client.app.delete();}

