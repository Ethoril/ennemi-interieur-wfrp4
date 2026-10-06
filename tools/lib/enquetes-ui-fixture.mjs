import { createEnqueteWorkspaceView } from '../../js/enquetes-workspace.js';
import { records as seed, pnjs } from '../fixtures/enquetes-qa-data.js';
import { createDocument, Element, flush } from './enquetes-test-dom.mjs';
export async function fixture({role='mj',id='affaire',layout='desktop',drafts=new Map(),localDrafts=true}={}) {
    const d=createDocument(),container=new Element(d,'main');d.append(container);
    const records=globalThis.structuredClone(seed).filter(r=>role==='mj'||r.zone!=='mj');
    const session={uid:'a',role,active:true},calls=[],opened=[],released=[],reads=[],objectUrls=[];
    let onChange,counter=0,saveHook;
    const emit=()=>onChange({session,records:[...records],pnjs});
    const runtime={newEnqueteId:()=> 'new'+(++counter),
        saveEnqueteDraft:(uid,id,value)=>{if(!localDrafts)return false;drafts.set(id,globalThis.structuredClone({...value,uid}));return true;},
        readEnqueteDraft:(uid,id)=>drafts.get(id),removeEnqueteDraft:(uid,id)=>drafts.delete(id),
        listEnqueteDrafts:uid=>[...drafts].filter(([,v])=>v.uid===uid).map(([id,v])=>({id,...v})),
        createEnqueteClient(options){onChange=options.onChange;globalThis.queueMicrotask(emit);return {
            signIn(){},signOut(){},close(){},
            async save(c){calls.push(c);if(saveHook)await saveHook(c);const old=records.find(r=>r.id===c.id);const r={...c.body,id:c.id||runtime.newEnqueteId(),type:c.type,zone:c.zone,revision:(old?.revision||0)+1,authorUid:'a'};if(old)records.splice(records.indexOf(old),1);records.push(r);emit();return r;},
            async read(action,id){reads.push({action,id});return {items:action==='files'&&id==='lettre'?[{id:'qa_image',docId:id,contentType:'image/png',name:'Lettre.png',version:1}]:[],id:null};},
            async action(r){records.splice(records.findIndex(v=>v.id===r.id),1);emit();},
            async objectUrl(f,options){objectUrls.push({id:f.id,options});return {url:'blob:qa',release:()=>released.push(f.id)};},
        };},
    };
    const view=createEnqueteWorkspaceView({container,id,layout,loadRuntime:async()=>runtime,onOpen:id=>opened.push(id)});
    await view.mount();await flush();
    const button=label=>container.querySelectorAll('button').find(b=>b.textContent===label);
    return {d,container,view,records,session,emit,calls,drafts,opened,released,reads,objectUrls,button,hook:fn=>saveHook=fn};
}
