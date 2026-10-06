
export function selectEnqueteExport(records,pnjs,{root=null,section='documents',includePersonal=false}={}){
  const allowed=records.filter(r=>includePersonal||!r.zone.startsWith('user:'));
  const adjacency=new Set(root?[root.id]:[]);
  if(root?.type==='enquetes')for(const l of allowed.filter(v=>v.type==='liens'&&(v.a===root.id||v.b===root.id))){adjacency.add(l.a);adjacency.add(l.b);}
  const selected=allowed.filter(v=>root?adjacency.has(v.id)||v.type==='evenements'&&v.enquete===root.id:v.type===section);
  const ids=new Set(selected.map(v=>v.id));
  const documents=new Set(selected.filter(v=>v.type==='documents').map(v=>v.id));
  for(const v of allowed)if(v.type==='annotations'&&documents.has(v.document)||v.type==='relations'&&ids.has(v.a)&&ids.has(v.b)){selected.push(v);ids.add(v.id);}
  const visible=new Set([...allowed,...pnjs].map(v=>v.id));
  const links=allowed.filter(v=>v.type==='liens'&&(ids.has(v.a)||ids.has(v.b))&&visible.has(v.a)&&visible.has(v.b));
  const referencedPnjs=pnjs.filter(p=>links.some(l=>l.a===p.id||l.b===p.id)||selected.some(v=>v.pnjs?.includes(p.id)));
  return {objects:[...new Map(selected.map(v=>[v.id,v])).values()],links,pnjs:referencedPnjs};
}

