import { createEnqueteWorkspaceView } from '../../js/enquetes-workspace.js';
const clone=v=>structuredClone(v);
let records=[
  {id:'affaire',type:'enquetes',zone:'commun',titre:'Qui finance la secte ?',question:'Suivre la piste du marchand et de son correspondant.',etat:'Ouverte',ordre:['lettre'],revision:1,authorUid:'gm'},
  {id:'lettre',type:'documents',zone:'commun',titre:'Lettre retrouvée chez le marchand',texte:'Le conseiller attend votre réponse.\n\n# Observation\n- Le sceau porte un soleil noir.',origine:'piece',categorie:'Lettre',files:['qa_image'],revision:1,authorUid:'gm'},
  {id:'hypothese',type:'notes',zone:'user:a',texte:'Le sceau ressemble à celui aperçu chez le conseiller.',etiquettes:['sceau'],revision:1,authorUid:'a'},
  {id:'l1',type:'liens',zone:'commun',a:'affaire',b:'lettre',role:'',revision:1,authorUid:'gm'},
  {id:'l2',type:'liens',zone:'user:a',a:'affaire',b:'hypothese',role:'',revision:1,authorUid:'a'},
  {id:'l3',type:'liens',zone:'commun',a:'affaire',b:'marchand',role:'Suspect',revision:1,authorUid:'gm'},
  {id:'evenement',type:'evenements',zone:'commun',enquete:'affaire',titre:'Découverte de la lettre',repere:'Avant le carnaval',ordre:1,texte:'La pièce a été remise au groupe.',revision:1,authorUid:'gm'}
];
const pnjs=[{id:'marchand',type:'pnjs',zone:'commun',nom:'Friedrich le marchand'}];
const fileMetadata=new Map([['qa_image',{id:'qa_image',docId:'lettre',name:'Illustration de recette.png',version:1,contentType:'image/png',path:'../../icons/icon-192.png'}]]),fileBlobs=new Map();
const drafts=new Map();let callback;let count=0;
const runtime={
  newEnqueteId:()=> 'qa_'+(++count),
  saveEnqueteDraft:(uid,id,value)=>{drafts.set(id,clone(value));return true;},
  readEnqueteDraft:(uid,id)=>clone(drafts.get(id)||null),removeEnqueteDraft:(uid,id)=>drafts.delete(id),listEnqueteDrafts:()=>[...drafts].map(([id,value])=>({id,...value})),
  createEnqueteClient({onChange}){
    callback=onChange;const emit=()=>callback({session:{uid:'a',role:'mj',active:true,maintenance:false},records:clone(records),pnjs:clone(pnjs)});
    queueMicrotask(emit);
    return {
      signIn:async()=>{},signOut:async()=>{},
      getState:()=>({records:clone(records)}),
      async save(c){
        if(!c.id)c.id=runtime.newEnqueteId();
        const old=records.find(r=>r.id===c.id);if((old?.revision||0)!==(c.baseRevision||0)){const e=new Error('Conflit');e.code='aborted';throw e;}
        const zone=c.zone||'user:a',value={...c.body,id:c.id,type:c.type,zone,authorUid:old?.authorUid||'a',revision:(old?.revision||0)+1};
        records=records.filter(r=>r.id!==c.id);records.push(value);emit();return {id:c.id,zone,revision:value.revision};
      },
      async action(r,action,zone){const existing=records.find(v=>v.id===r.id);if(action==='visibility')existing.zone=zone;else records=records.filter(v=>v.id!==r.id);emit();return {id:r.id};},
      async read(action,id){return {items:action==='files'?[...fileMetadata.values()].filter(f=>f.docId===id):[],id:null};},
      async blob(f){return fileBlobs.get(f.id)||fetch(f.path).then(r=>r.blob());},
      async upload(docId,file,{version=1,onProgress=()=>{}}={}){const id=runtime.newEnqueteId(),value={id,docId,name:file.name,version,contentType:file.type,path:''};fileMetadata.set(id,value);fileBlobs.set(id,file);onProgress(1);return value;},
      close(){},async objectUrl(f){const blob=await this.blob(f),url=URL.createObjectURL(blob);return {url,release:()=>URL.revokeObjectURL(url)};}
    };
  }
};
const view=createEnqueteWorkspaceView({container:document.getElementById('qa'),id:'affaire',loadRuntime:async()=>runtime});
view.mount();
window.addEventListener('pagehide',()=>view.unmount());


