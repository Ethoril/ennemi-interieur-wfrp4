import { URL } from 'node:url';
import { createHash } from 'node:crypto';
export function legacyDocumentId(id){return 'piece_'+createHash('sha256').update(id).digest('hex').slice(0,24);}
export function convertLegacyIndice(id,value){
  const categories=['Lettre','Témoignage','Carte','Illustration','Rapport','Autre'];
  return {id:legacyDocumentId(id),legacyId:id,type:'documents',titre:value.titre||'Pièce sans titre',texte:value.description||'',description:'',categorie:categories.includes(value.type)?value.type:'Autre',
    origine:'piece',provenance:[value.source,value.dateDecouverte?.toDate?.().toISOString?.()||''].filter(Boolean).join(' · '),etiquettes:[],files:[],
    zone:value.decouvert===true?'commun':'mj',pnjsLies:Array.isArray(value.pnjsLies)?[...new Set(value.pnjsLies)]:[],imagePath:value.imagePath||null,imageUrl:value.imageUrl||null};
}
export function legacyStoragePath(value,bucket,ownerId=null){
  if(ownerId&&value.imagePath&&!value.imagePath.startsWith('indices/'+ownerId+'/'))return null;
  if(value.imagePath&&/^(indices|portraits)\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/u.test(value.imagePath))return value.imagePath;
  if(!value.imageUrl)return null;
  let url;try{url=new URL(value.imageUrl);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname!=='firebasestorage.googleapis.com')return null;
  const match=url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/u);if(!match||decodeURIComponent(match[1])!==bucket)return null;
  const path=decodeURIComponent(match[2]);if(ownerId&&!path.startsWith('indices/'+ownerId+'/'))return null;return /^(indices|portraits)\/[A-Za-z0-9_./-]+$/u.test(path)&&!path.includes('..')?path:null;
}



