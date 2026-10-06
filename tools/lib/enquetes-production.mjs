import { createRequire } from 'node:module';
import { createCliAuthenticatedClient } from '../fiche-prod-backup.mjs';
const require=createRequire(import.meta.url);
export async function createEnqueteProductionClient(){
  if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw new Error('Production refusée avec un émulateur');
  const client=await createCliAuthenticatedClient();
  const auth=require('firebase-tools/lib/auth.js'),api=require('firebase-tools/lib/api.js');
  const account=auth.getProjectDefaultAccount(process.cwd());
  const {Storage}=require('@google-cloud/storage');
  const storage=new Storage({projectId:'campagne-wrpg',credentials:{type:'authorized_user',client_id:api.clientId(),client_secret:api.clientSecret(),refresh_token:account.tokens.refresh_token}});
  return {...client,bucket:storage.bucket('campagne-wrpg.firebasestorage.app')};
}

