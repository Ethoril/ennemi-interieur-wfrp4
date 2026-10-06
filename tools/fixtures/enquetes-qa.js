import { records as seedRecords, pnjs as seedPnjs } from './enquetes-qa-data.js';
import { createEnqueteWorkspaceView } from '../../js/enquetes-workspace.js';
const clone=v=>structuredClone(v);
let records=clone(seedRecords);
const pnjs=clone(seedPnjs);
const params=new URLSearchParams(location.search),role=params.get('role')==='joueur'?'joueur':'mj';
const fileMetadata=new Map([['qa_image',{id:'qa_image',docId:'lettre',name:'lettre-scellee.svg',version:1,contentType:'image/svg+xml',path:'enquetes-qa-letter.svg'}]]),fileBlobs=new Map();
const drafts=new Map(),trash=new Map(),historyEvents=new Map();let callback;let count=0;
const runtime={
  newEnqueteId:()=> 'qa_'+(++count),
  saveEnqueteDraft:(uid,id,value)=>{drafts.set(id,clone(value));return true;},
  readEnqueteDraft:(uid,id)=>clone(drafts.get(id)||null),removeEnqueteDraft:(uid,id)=>drafts.delete(id),listEnqueteDrafts:()=>[...drafts].map(([id,value])=>({id,...value})),
  createEnqueteClient({onChange}){
    callback=onChange;const emit=()=>callback({session:{uid:'a',role,active:true,maintenance:false,offline:params.has('offline')},records:clone(records.filter(r=>role==='mj'||r.zone!=='mj')),pnjs:clone(pnjs)});
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
      async action(r,action,zone){
        const existing=records.find(v=>v.id===r.id);
        if(action==='visibility')existing.zone=zone;
        else if(action==='restore'){const restored=trash.get(r.id);records.push({...restored,zone:restored.zone==='commun'?'mj':restored.zone,revision:restored.revision+1});trash.delete(r.id);}
        else if(action==='purge')trash.delete(r.id);
        else{trash.set(r.id,{...existing,revision:existing.revision+1});records=records.filter(v=>v.id!==r.id);}
        const history=historyEvents.get(r.id)||[];history.push({action,revision:existing?.revision||r.revision});historyEvents.set(r.id,history);emit();return {id:r.id};
      },
      async read(action,id){return {items:action==='files'?[...fileMetadata.values()].filter(f=>f.docId===id):action==='trash'?[...trash.values()]:action==='history'?historyEvents.get(id)||[]:[],id:null};},
      async blob(f){return fileBlobs.get(f.id)||fetch(f.path).then(r=>r.blob());},
      async upload(docId,file,{version=1,onProgress=()=>{}}={}){const id=runtime.newEnqueteId(),value={id,docId,name:file.name,version,contentType:file.type,path:''};fileMetadata.set(id,value);fileBlobs.set(id,file);onProgress(1);return value;},
      close(){},async objectUrl(f){const blob=await this.blob(f),url=URL.createObjectURL(blob);return {url,release:()=>URL.revokeObjectURL(url)};}
    };
  }
};
let view;
document.documentElement.dataset.theme=params.get('theme')||'dark';
document.body.className=params.get('layout')==='mobile'?'qa--mobile':'';
const action=document.getElementById('m-header-action');
function mount(id){
  view?.unmount();
  view=createEnqueteWorkspaceView({container:document.getElementById('qa'),id,onMenuLabelChange:label=>action.setAttribute('aria-label',label),layout:params.get('layout')||'desktop',loadRuntime:async()=>runtime,
    onOpen:next=>{params.set('id',next);if(params.get('layout')==='mobile'){history.pushState({},'',location.pathname+'?'+params);mount(next);}else history.replaceState({},'',location.pathname+'?'+params);}});
  action.hidden=params.get('layout')!=='mobile'||!id;
  view.mount();
}
action.addEventListener('click',()=>view.openMenu(action));
window.addEventListener('popstate',()=>{const next=new URLSearchParams(location.search);params.set('id',next.get('id')||'');mount(next.get('id')||null);});
mount(params.has('id')?(params.get('id')||null):'affaire');
window.addEventListener('pagehide',()=>view.unmount());
