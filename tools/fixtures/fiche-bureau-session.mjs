import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

// Module de session remplacé par Playwright ; aucun accès Firebase.
export async function buildBureauQaSession() {
    const original = await readFile(new URL('../../js/fiche-bureau/session.js', import.meta.url), 'utf8');
    const loader = original.slice(original.indexOf('export async function loadBureauCatalogues'), original.indexOf('export function connectBureau'));
    return `import { createPublishedCatalogueEngine } from '../fiche/published-catalogue-engine.js';
import { createFicheController } from '../fiche-controller.js';
import { createFicheDraftStore } from '../fiche-draft-store.js';
${loader}
let equipmentRepository;
export function getEquipmentRepository() { return equipmentRepository; }
export function connectBureau({charId,onState}) {
 const keys=['cc','ct','f','e','i','ag','dex','int','fm','soc'];
 const role=new URLSearchParams(location.search).get('qa-role')||'joueur';
 let envelope={schemaVersion:2,revision:1,data:{nom:'Hanna Vogt',race:'humain',carriere:'Agitateur',rang:new URLSearchParams(location.search).get('qa-rank')||'1',destin:'2',chance:'2',resilience:'1',determination:'1',blessuresAct:'10',corruption:'0',possessions:'Une plume, un carnet et quelques pièces.',basicSpecs:{},chosenVariants:{},careerOverrides:{},carac:Object.fromEntries(keys.map(k=>[k,{base:30,adv:3}])),skillsBasic:{Charme:3,Esquive:0},skillsAdvanced:[],talentsAcq:[],talentsAvail:[],sorts:[],prieres:[],careers:[],xpLog:[{id:'g',kind:'gain',raison:'Expérience de test',montant:5000}]}};
 if(new URLSearchParams(location.search).has('qa-talent-duplicate')) envelope.data.talentsAcq=[{id:'vision-old',nom:'Vision sacrée',note:'Première prise'},{id:'vision-new',nom:'Visions sacrées',note:'Doublon'}];
 let notify; let engine; const receipts=new Map(); const models=new Map(); const modelListeners=new Set();
 const repository={
 subscribeEquipmentModels(next){modelListeners.add(next);next([...models.values()]);return ()=>modelListeners.delete(next);},
 async saveEquipmentModel(id,item){models.set(id,{id,item:structuredClone(item)});for(const next of modelListeners)next([...models.values()]);},
 subscribe(id,callback){notify=callback;queueMicrotask(()=>callback({exists:true,envelope}));return ()=>{};},
 async execute(command){
 if(receipts.has(command.operationId))return receipts.get(command.operationId);
 if(globalThis.qaReject){globalThis.qaReject=false;throw Object.assign(new Error('Test'),{code:'failed-precondition',details:{kind:'price-changed'}});}
 let applied;
 if(command.type==='patch') {
  const next=structuredClone(envelope.data);
  for(const [path,value] of Object.entries(command.payload.changes)) {
   const parts=path.split('.').map(decodeURIComponent);let row=next;
   for(const key of parts.slice(0,-1))row=row[key]||=( {} );
   row[parts.at(-1)]=value;
  }
  applied={data:next,result:{}};
 } else applied=engine.applyCommand(envelope.data,command,{uid:'qa-user',role});
 envelope={...envelope,data:applied.data,revision:envelope.revision+1};
 const receipt={revision:envelope.revision,...applied.result};receipts.set(command.operationId,receipt);
 setTimeout(()=>notify({exists:true,envelope}),10);
 if(globalThis.qaEquipmentUncertain){globalThis.qaEquipmentUncertain=false;throw Object.assign(new Error('Réponse réseau perdue'),{code:'unavailable'});}
 return receipt;
 }};
 equipmentRepository=repository;
 const controller=createFicheController({repository,draftStore:createFicheDraftStore(),onChange:state=>onState(new URLSearchParams(location.search).has('qa-readonly')?{...state,phase:state.data?'legacy-readonly':state.phase}:state),receiptTimeoutMs:100});
 globalThis.qaController=controller;
 globalThis.qaSetEquipment=equipment=>{envelope={...envelope,revision:envelope.revision+1,data:{...envelope.data,equipment}};notify({exists:true,envelope});};
 loadBureauCatalogues().then(c=>{engine=c.engine;controller.setSession({charId,uid:'qa-user',role});});
 return controller;
}`;
}
