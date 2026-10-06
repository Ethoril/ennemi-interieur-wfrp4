import { createEnqueteWorkspaceView } from './enquetes-workspace.js';
const container=document.getElementById('enquete-workspace');
const id=new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('clue');
const view=createEnqueteWorkspaceView({container,id,onOpen:id=>history.replaceState({},'',`enquetes.html?id=${encodeURIComponent(id)}`),onOpenPnj:id=>{location.href=`pnjs.html?id=${encodeURIComponent(id)}`;}});
view.mount();window.addEventListener('pagehide',()=>view.unmount());window.addEventListener('pageshow',e=>{if(e.persisted)view.mount();});

