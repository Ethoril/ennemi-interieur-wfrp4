import { Buffer } from 'node:buffer';

import { createHash } from 'node:crypto';
import { serializeFirestoreValue,deserializeFirestoreValue } from '../mobile-backup.mjs';
export const ENQUETE_BACKUP_COLLECTIONS=['campagne','enq_accounts','enq_control','enq_commun','enq_mj','enq_users','enq_registry','enq_unique','enq_history','enq_operations','enq_jobs','enq_files','enq_file_access','enq_trash','enq_legacy_routes','pnjs','pnjs_prives','relations','indices','content_metadata','content_operations','content_history','content_trash','content_trash_archive','content_purge_audits'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function captureEnqueteRecovery({db,bucket}){
  const documents=[];
  const walk=async collection=>{
    for(const ref of await collection.listDocuments()){
      const snapshot=await ref.get();if(snapshot.exists)documents.push({path:ref.path,data:serializeFirestoreValue(snapshot.data())});
      for(const child of await ref.listCollections())await walk(child);
    }
  };
  for(const name of ENQUETE_BACKUP_COLLECTIONS)await walk(db.collection(name));
  const files=[];
  for(const prefix of ['documents/','indices/','portraits/'])for(const file of (await bucket.getFiles({prefix}))[0]){
    const [bytes]=await file.download(),[metadata]=await file.getMetadata();
    files.push({path:file.name,contentType:metadata.contentType,sha256:hash(bytes),bytes:bytes.toString('base64')});
  }
  return {version:1,documents,files};
}
export function verifyEnqueteRecovery(snapshot){
  if(snapshot.version!==1||!Array.isArray(snapshot.documents)||!Array.isArray(snapshot.files))throw new Error('Sauvegarde invalide');
  const paths=new Set();
  for(const d of snapshot.documents){if(!ENQUETE_BACKUP_COLLECTIONS.includes(d.path.split('/')[0])||d.path.split('/').length%2!==0||d.path.includes('..')||paths.has(d.path))throw new Error('Document hors périmètre');paths.add(d.path);}
  paths.clear();
  for(const f of snapshot.files){if(!/^(documents|indices|portraits)\/[A-Za-z0-9_./-]+$/u.test(f.path)||f.path.includes('..')||paths.has(f.path)||hash(Buffer.from(f.bytes,'base64'))!==f.sha256)throw new Error('Fichier invalide');paths.add(f.path);}
}
export async function restoreEnqueteRecovery(snapshot,{db,bucket,Timestamp,GeoPoint,Bytes,project}){
  if(!project?.startsWith('demo-')||!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw new Error('Restauration de recette limitée aux émulateurs demo');
  verifyEnqueteRecovery(snapshot);
  for(const d of snapshot.documents){if((await db.doc(d.path).get()).exists)throw new Error('Destination non vide ; restauration refusée');}
  for(const f of snapshot.files){if((await bucket.file(f.path).exists())[0])throw new Error('Fichier existant ; restauration refusée');}
  for(const f of snapshot.files)await bucket.file(f.path).save(Buffer.from(f.bytes,'base64'),{metadata:{contentType:f.contentType,cacheControl:'private, no-store',metadata:{}}});
  for(const d of snapshot.documents)await db.doc(d.path).set(deserializeFirestoreValue(d.data,{Timestamp,GeoPoint,Bytes,firestore:db}));
  return {documents:snapshot.documents.length,files:snapshot.files.length};
}



