import { buildLinksIndex, dossierPieces, linkedNotes } from './enquetes-view-model.js';
import { selectEnqueteExport } from './data/enquetes-export.js';
import { recordTitle, buildSearch, fold } from './data/enquetes-domain.js';
export function createEnqueteWorkspaceView({container,id=null,initialAction=null,loadRuntime=()=>import('./enquetes-runtime.js'),onOpen=()=>{},onOpenPnj=()=>{}}={}) {
  const d=container.ownerDocument;
  let initialOpened=false,legacyResolved=false,detailSignature='',linksIndex=new Map();
  let client=null,state={session:null,records:[],pnjs:[]},mounted=false,token=0,section='enquetes',selected=id,search='',scope='',filter='',editor=null,timer=null,graph=null,handles=[],busy=false;
  const node=(tag,text='',className='')=>{const e=d.createElement(tag);e.textContent=text;e.className=className;return e;};
  const button=(label,action,variant='')=>{const b=node('button',label,'enq-button'+(variant?' enq-button--'+variant:''));b.type='button';b.addEventListener('click',()=>Promise.resolve(action()).catch(showError));return b;};
  let root,toolbar,list,detail,status,searchInput;
  const current=()=>state.records.find(r=>r.id===selected)||state.pnjs.find(r=>r.id===selected);
  const all=()=>[...state.records,...state.pnjs];
  const isGm=()=>state.session?.role==='mj';
  const canEdit=r=>r.authorUid===state.session?.uid||isGm()&&!r.zone?.startsWith('user:');
  const showError=error=>{if(mounted)status.textContent=error?.message||'Opération impossible';};
  const release=()=>{handles.splice(0).forEach(h=>h.release());graph?.stop?.();graph=null;};
  const linkedIds=target=>new Set([target,...(linksIndex.get(target)||[])]);
  function textView(text){
    const box=node('div','','enq-text');let list=null;
    const inline=(host,value)=>{
      const tokens=value.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https:\/\/[^\s)]+\))/gu);
      for(const part of tokens){
        const link=part.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/u);
        if(link){const a=node('a',link[1]);a.href=link[2];a.rel='noopener noreferrer';a.target='_blank';host.append(a);}
        else if(part.startsWith('**')&&part.endsWith('**'))host.append(node('strong',part.slice(2,-2)));
        else if(part.startsWith('*')&&part.endsWith('*'))host.append(node('em',part.slice(1,-1)));
        else if(part.startsWith('`')&&part.endsWith('`'))host.append(node('code',part.slice(1,-1)));
        else host.append(d.createTextNode(part));
      }
    };
    for(const line of (text||'').split('\n')){
      const heading=line.match(/^(#{1,3})\s+(.*)$/u),bullet=line.match(/^[-*]\s+(.*)$/u),quote=line.match(/^>\s?(.*)$/u);
      const p=node(heading?'h'+(heading[1].length+2):bullet?'li':quote?'blockquote':'p');
      inline(p,heading?heading[2]:bullet?bullet[1]:quote?quote[1]:line);
      if(bullet){if(!list){list=node('ul');box.append(list);}list.append(p);}else{list=null;box.append(p);}
    }
    return box;
  }
  function revealDetail(){
    const heading=detail.querySelector('h3');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});
    if(globalThis.matchMedia?.('(max-width:850px)')?.matches)detail.scrollIntoView?.({behavior:'smooth',block:'start'});
  }
  function build(){
    root=node('section','','enq-workspace');toolbar=node('div','','enq-toolbar');status=node('p','','enq-status');status.setAttribute('role','status');
    root.append(toolbar,status);
    const panes=node('div','','enq-panes');list=node('div','','enq-list');detail=node('article','','enq-detail');panes.append(list,detail);root.append(panes);container.replaceChildren(root);
    render();
  }
  function render(){
    if(!mounted)return;
    toolbar.replaceChildren();
    if(!state.session){
      toolbar.append(node('h2','Documents et enquêtes'),button('Se connecter avec Google',()=>client?.signIn()));
      list.replaceChildren(node('p','Connecte-toi pour retrouver les pièces du groupe et ton carnet personnel.'));if(!editor)detail.replaceChildren();return;
    }
    toolbar.append(node('h2','Documents et enquêtes'));
    for(const [value,label] of [['enquetes','Enquêtes'],['documents','Documents'],['notes','Mon carnet'],['trash','Corbeille']]){
      const b=button(label,()=>{if(editor&&!globalThis.confirm('Conserver le brouillon et quitter l’éditeur ?'))return;closeEditor();section=value;filter='';scope='';selected=null;render();});b.setAttribute('aria-pressed',String(section===value));toolbar.append(b);
    }
    toolbar.append(button('Déconnexion',()=>client.signOut()));
    if(!state.session.active){status.textContent='Le nouvel espace sera disponible après sa mise en service.';list.replaceChildren();return;}
    if(state.session.maintenance){status.textContent='Réorganisation des accès en cours. Ton carnet personnel reste accessible.';}
    else if(state.session.role==='ancien'){status.textContent='Accès au groupe retiré. Ton carnet personnel reste consultable et exportable.';section='notes';}
    else if(state.session.offline){status.textContent='Hors connexion : textes en cache et brouillons locaux.';}
    else if(!editor&&!busy)status.textContent='';
    renderList();
    if(!editor){const signature=JSON.stringify([selected,section,state.session?.uid,state.session?.maintenance,state.records.map(({fromCache,...r})=>r),state.pnjs]);if(signature!==detailSignature){detailSignature=signature;renderDetail();}}
  }
  function renderList(){
    const focused=searchInput&&d.activeElement===searchInput,selection=focused?[searchInput.selectionStart,searchInput.selectionEnd]:null;
    list.replaceChildren();
    if(section==='trash'){renderTrash();return;}
    const heading=node('div','','enq-list-heading');heading.append(node('h3',section==='notes'?'Mon carnet':section==='documents'?'Bibliothèque':'Dossiers d’enquête'));
    if(section!=='enquetes'||isGm())heading.append(button(section==='notes'?'Nouvelle note':section==='documents'?'Nouveau document':'Nouvelle enquête',()=>openEditor(null,section),'primary'));
    list.append(heading);
    const controls=node('div','','enq-filters');
    searchInput=node('input');searchInput.type='search';searchInput.placeholder='Rechercher';searchInput.value=search;searchInput.setAttribute('aria-label','Rechercher dans cet espace');
    searchInput.addEventListener('input',e=>{search=e.target.value;renderResults();});
    controls.append(searchInput);
    const filters=node('select');filters.setAttribute('aria-label','Filtrer');
    const choices=section==='documents'?[['','Tout'],['piece','Pièces'],['contribution','Contributions'],['Lettre','Lettres'],['Carte','Cartes'],['personnel','Personnel'],['mj','Secret MJ']]:section==='enquetes'?[['','Actives'],['archive','Archivées'],['Ouverte','Ouvertes'],['En pause','En pause'],['Résolue','Résolues']]:[['','Toutes les notes'],['non-classees','Non classées']];
    for(const [value,label]of choices){const o=node('option',label);o.value=value;filters.append(o);}filters.value=filter;filters.addEventListener('change',()=>{filter=filters.value;renderResults();});
    controls.append(filters);
    const scopeSelect=node('select');scopeSelect.setAttribute('aria-label',section==='notes'?'Limiter à une enquête, un document ou un personnage':'Limiter à une enquête');scopeSelect.append(node('option',section==='notes'?'Tous les objets liés':'Toutes les enquêtes'));scopeSelect.firstChild.value='';
    for(const r of all().filter(r=>section==='notes'?['enquetes','documents','pnjs'].includes(r.type):r.type==='enquetes')){const o=node('option',r.nom||r.titre);o.value=r.id;scopeSelect.append(o);}scopeSelect.value=scope;scopeSelect.addEventListener('change',()=>{scope=scopeSelect.value;renderResults();});
    controls.append(scopeSelect);list.append(controls,node('div','','enq-results'));
    if(section==='notes')list.append(node('p','Carnet privé dans l’application. L’administrateur de l’infrastructure Firebase conserve un accès technique.','enq-privacy'));
    list.append(button('Exporter cet espace',()=>exportSpace()));
    renderResults();
    const drafts=client?.listDrafts?.(state.session.uid)||[];
    for(const draft of drafts.filter(v=>v.type===section)){list.append(button('Reprendre le brouillon : '+(draft.body?.titre||'Sans titre'),()=>openEditor(state.records.find(r=>r.id===draft.id)||null,draft.type,null,{},draft.id)));}
    if(focused&&searchInput){searchInput.focus();if(selection&&selection[0]!==null)searchInput.setSelectionRange(...selection);}
  }
  function renderResults(){
    const results=list.querySelector('.enq-results');if(!results)return;results.replaceChildren();
    let source=state.records.filter(r=>r.type===section);
    if(section==='enquetes')source=source.filter(r=>filter==='archive'?r.archive:!r.archive);
    if(filter&&filter!=='archive'){
      if(filter==='personnel')source=source.filter(r=>r.zone.startsWith('user:'));
      else if(filter==='mj')source=source.filter(r=>r.zone==='mj');
      else if(filter==='non-classees')source=source.filter(r=>!state.records.some(l=>l.type==='liens'&&(l.a===r.id||l.b===r.id)));
      else if(section!=='notes')source=source.filter(r=>[r.origine,r.categorie,r.etat].includes(filter));
    }
    const matched=buildSearch(source,search,scope?linkedIds(scope):null);
    // A visible linked PNJ is also a searchable entry point.
    for(const r of source){
      if(matched.includes(r)||scope&&!linkedIds(scope).has(r.id))continue;
      const pnjIds=linkedIds(r.id),names=state.pnjs.filter(p=>pnjIds.has(p.id)).map(p=>p.nom).join(' ');
      if(search&&fold(names).includes(fold(search)))matched.push(r);
    }
    matched.sort((a,b)=>recordTitle(a).localeCompare(recordTitle(b),'fr'));
    if(!matched.length)results.append(node('p','Aucun résultat. Ajoute une pièce, une note ou ajuste les filtres.'));
    for(const r of matched){
      const card=node('div','','enq-card');const open=button(recordTitle(r),()=>{if(editor&&!globalThis.confirm('Conserver le brouillon et quitter l’éditeur ?'))return;closeEditor();selected=r.id;renderDetail();revealDetail();onOpen(r.id);});
      card.append(open,node('small',r.type==='documents'?(r.origine==='piece'?'Pièce':'Contribution')+' · '+r.categorie:r.type==='enquetes'?r.etat:'Note privée'));
      if(r.zone==='mj')card.append(node('span','Secret MJ','enq-badge'));else if(r.zone.startsWith('user:')&&r.type!=='notes')card.append(node('span','Personnel','enq-badge'));
      if(search)card.append(node('p',(r.texte||r.description||'').slice(0,180)));
      results.append(card);
    }
  }
  function openObject(r){
    if(r.type==='pnjs'){onOpenPnj(r.id);return;}
    closeEditor();selected=r.id;section=['documents','enquetes','notes'].includes(r.type)?r.type:section;render();revealDetail();onOpen(r.id);
  }
  async function renderDetail(){
    if(section==='trash'){release();detail.replaceChildren();return;}
    const viewToken=++token;release();detail.replaceChildren();
    const r=current();
    if(section==='trash'){return;}
    if(!r){detail.append(node('h3','Choisis un dossier ou une pièce'),node('p','Les documents peuvent appartenir à plusieurs enquêtes. Les notes restent dans ton carnet.'));return;}
    if(r.type==='pnjs'){detail.append(node('h3',r.nom),button('Ajouter une note',()=>openEditor(null,'notes',r)),button('Ajouter un document lié',()=>openEditor(null,'documents',r)));renderLinks(r);return;}
    detail.append(node('h3',recordTitle(r)));
    const actions=node('div','','enq-actions');
    if(canEdit(r))actions.append(button('Modifier',()=>openEditor(r,r.type)),button('Mettre en corbeille',()=>performAction(r,'trash'),'danger'));
    actions.append(button('Ajouter une note',()=>openEditor(null,'notes',r)),button('Exporter',()=>exportSpace(r)));
    if(r.type==='notes')actions.append(button('Partager une copie',()=>openEditor(null,'documents',r,{titre:recordTitle(r),texte:r.texte,origine:'contribution',shareNote:r,zone:'commun'})));
    if(canEdit(r)&&r.type==='documents'){
      if(r.zone.startsWith('user:'))actions.append(button('Publier dans le groupe',()=>performAction(r,'visibility','commun')));
      if(isGm()&&!r.zone.startsWith('user:'))actions.append(button(r.zone==='commun'?'Rendre secret':'Publier',()=>performAction(r,'visibility',r.zone==='commun'?'mj':'commun')));
      if(isGm()&&r.zone==='commun'&&r.authorUid!==state.session.uid)actions.append(button('Masquer chez son auteur',()=>performAction(r,'visibility',`user:${r.authorUid}`)));
    }
    if(isGm()&&r.type==='enquetes')actions.append(button(r.zone==='commun'?'Rendre secret':'Publier',()=>performAction(r,'visibility',r.zone==='commun'?'mj':'commun')));
    detail.append(actions);
    if(r.description)detail.append(node('p',r.description));if(r.question)detail.append(node('p',r.question,'enq-question'));
    if(r.texte)detail.append(textView(r.texte));if(r.provenance)detail.append(node('p','Provenance : '+r.provenance));
    if(r.conclusion)detail.append(textView(r.conclusion));
    renderLinks(r);
    if(r.type==='documents'){
      const gallery=node('section','','enq-gallery');gallery.append(node('h4','Fichiers'));detail.append(gallery);
      try{
        const response=await client.read('files',r.id);if(!mounted||viewToken!==token||editor)return;
        const selectedFiles=response.items.filter(f=>(r.files||[]).includes(f.id));
        for(const f of selectedFiles)await showFile(f,r,gallery,viewToken);
        if(canEdit(r)){
          const input=node('input');input.type='file';input.multiple=true;input.accept='.jpg,.jpeg,.png,.webp,.pdf,.txt,.md';input.setAttribute('aria-label','Ajouter des fichiers');
          input.addEventListener('change',async()=>{
            try{
              const next=[...(r.files||[])];if(next.length+input.files.length>10)throw new Error('Dix fichiers maximum');
              busy=true;
              for(const file of input.files){status.textContent='Envoi de '+file.name;const uploaded=await client.upload(r.id,file,{onProgress:p=>{status.textContent='Envoi : '+Math.round(p*100)+' %';}});next.push(uploaded.id);}
              await client.save({type:r.type,id:r.id,zone:r.zone,baseRevision:r.revision,body:editableBody({...r,files:next})});
              status.textContent='Fichiers ajoutés.';busy=false;render();
            }catch(error){busy=false;showError(error);}
          });
          gallery.append(input);
          for(const f of selectedFiles)gallery.append(button('Remplacer '+f.name,()=>replaceFile(r,f)));
        }
        const annotations=state.records.filter(a=>a.type==='annotations'&&a.document===r.id);
        for(const a of annotations){
          const row=node('p',a.texte||a.description||'Annotation');row.append(node('small',' · '+(a.zone.startsWith('user:')?'Privée':'Commune')));
          const file=response.items.find(f=>f.id===a.fileId);
          if(file&&!selectedFiles.some(f=>f.id===file.id))row.append(button('Voir la version annotée',()=>showFile(file,r,gallery,viewToken)));
          if(canEdit(a))row.append(button('Modifier',()=>openEditor(a,'annotations')),button('Supprimer',()=>performAction(a,'trash')));
          if(a.zone.startsWith('user:'))row.append(button('Partager une copie',()=>openEditor(null,'annotations',null,{...editableBody(a),zone:'commun'})));
          gallery.append(row);
        }
      }catch(error){if(viewToken===token)gallery.append(node('p',error.message));}
    }
    if(r.type==='enquetes'){
      renderRelated(r);renderTimeline(r);
      const graphHost=node('div','','enq-graph');detail.append(button('Afficher le graphe personnel',()=>showGraph(r,graphHost)),graphHost);
      if(isGm())detail.append(button('Ordonner les documents',()=>orderDocuments(r)));
    }
    if(canEdit(r)&&!r.zone.startsWith('user:'))detail.append(button('Voir l’historique',async()=>{const history=await client.read('history',r.id);if(viewToken!==token)return;const h=node('div');for(const event of history.items)h.append(node('p',event.action+' · révision '+event.revision));detail.append(h);}));
  }
  function renderLinks(r){
    const box=node('section','','enq-links');box.append(node('h4','Liens'));
    const links=state.records.filter(l=>l.type==='liens'&&(l.a===r.id||l.b===r.id));
    for(const l of links){const target=all().find(a=>a.id===(l.a===r.id?l.b:l.a)),row=node('div');row.append(target?button(target.nom||recordTitle(target),()=>openObject(target)):node('span','Pièce indisponible'));if(l.role)row.append(node('small',l.role));if(canEdit(l))row.append(button('Retirer le lien',()=>performAction(l,'trash'),'danger'));box.append(row);}
    box.append(button('Ajouter un lien',()=>openLinkEditor(r)));
    detail.append(box);
  }
  function renderRelated(r){
    const ids=linkedIds(r.id),docs=dossierPieces(r,state.records,linksIndex).map(p=>p.record);
    const box=node('section');box.append(node('h4','Pièces du dossier'));
    for(const doc of docs)box.append(button(recordTitle(doc),()=>openObject(doc)));
    if(!docs.length)box.append(node('p','Aucune pièce liée.'));box.append(button('Ajouter un document au dossier',()=>openEditor(null,'documents',r)));detail.append(box);
    const notes=linkedNotes(r,state.records,linksIndex),privateBox=node('section');privateBox.append(node('h4','Mes notes'));
    for(const note of notes)privateBox.append(button(recordTitle(note),()=>openObject(note)));detail.append(privateBox);
    const relations=state.records.filter(v=>v.type==='relations'&&ids.has(v.a)&&ids.has(v.b));const relationBox=node('section');relationBox.append(node('h4','Relations entre pièces'));
    for(const relation of relations){const a=all().find(v=>v.id===relation.a),b=all().find(v=>v.id===relation.b);relationBox.append(node('p',`${a?recordTitle(a):'Pièce indisponible'} — ${relation.nature} — ${b?recordTitle(b):'Pièce indisponible'} : ${relation.texte||''}`));if(canEdit(relation))relationBox.append(button('Modifier la relation',()=>openEditor(relation,'relations')));}
    relationBox.append(button('Ajouter une relation',()=>openEditor(null,'relations',r)));detail.append(relationBox);
  }
  function renderTimeline(r){
    const box=node('section');box.append(node('h4','Chronologie'));
    const events=state.records.filter(e=>e.type==='evenements'&&e.enquete===r.id).sort((a,b)=>(a.ordre||0)-(b.ordre||0));
    for(const e of events){const row=node('article');row.append(node('h5',e.titre||e.repere),node('p',[e.repere,e.dateSession,e.dateUnivers].filter(Boolean).join(' · ')),textView(e.texte));
      if(e.zone.startsWith('user:'))row.append(node('small','Événement privé'));if(canEdit(e))row.append(button('Modifier',()=>openEditor(e,'evenements')),button('Retirer',()=>performAction(e,'trash')));box.append(row);}
    box.append(button('Ajouter un événement',()=>openEditor(null,'evenements',r)));detail.append(box);
  }
  async function showFile(f,r,host,viewToken){
    const h=await client.objectUrl(f);if(!mounted||viewToken!==token){h.release();return;}handles.push(h);
    const wrap=node('figure','','enq-file');wrap.append(node('figcaption',f.name+' · version '+f.version));
    const download=node('a','Télécharger');download.href=h.url;download.download=f.name;wrap.append(download);
    if(f.contentType.startsWith('image/')){
      const image=node('img');image.src=h.url;image.alt=f.name;image.loading='lazy';wrap.append(image);
      const imageBox=node('div','','enq-image-box');imageBox.append(image);wrap.append(imageBox);
      const overlay=node('div','','enq-image-overlay');imageBox.append(overlay);
      image.addEventListener('click',event=>{const rect=image.getBoundingClientRect();openEditor(null,'annotations',null,{document:r.id,fileId:f.id,version:f.version,x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height,width:0,height:0});});
      for(const a of state.records.filter(a=>a.type==='annotations'&&a.fileId===f.id)){const marker=button(a.texte||'Annotation',()=>{status.textContent=a.texte;});marker.className='enq-marker';marker.style.left=(a.x*100)+'%';marker.style.top=(a.y*100)+'%';if(a.width&&a.height){marker.style.width=(a.width*100)+'%';marker.style.height=(a.height*100)+'%';marker.classList.add('enq-marker-zone');}overlay.append(marker);}
      wrap.append(button('Agrandir',async()=>{const zoom=await client.objectUrl(f),copy=image.cloneNode(),dialog=node('dialog');copy.src=zoom.url;dialog.addEventListener('close',()=>zoom.release(),{once:true});dialog.append(button('Fermer',()=>{dialog.close();dialog.remove();}),copy);root.append(dialog);dialog.showModal();}));
      wrap.append(node('small','Clique sur l’image pour placer une annotation, ou utilise le bouton ci-dessous.'));
      wrap.append(button('Annoter cette image',()=>openEditor(null,'annotations',null,{document:r.id,fileId:f.id,version:f.version,x:.5,y:.5,width:0,height:0})));
    }else if(f.contentType==='application/pdf'){const frame=node('iframe');frame.title=f.name;frame.src=h.url;frame.className='enq-pdf';wrap.append(frame);}
    else {const blob=await client.blob(f);if(viewToken===token)wrap.append(textView(await blob.text()));}
    host.append(wrap);
  }
  async function replaceFile(r,f){
    const input=node('input');input.type='file';input.accept='.jpg,.jpeg,.png,.webp,.pdf,.txt,.md';
    input.addEventListener('change',async()=>{if(!input.files[0])return;try{busy=true;const next=await client.upload(r.id,input.files[0],{version:f.version+1,onProgress:p=>{status.textContent='Remplacement : '+Math.round(p*100)+' %';}});await client.save({type:r.type,id:r.id,zone:r.zone,baseRevision:r.revision,body:editableBody({...r,files:r.files.map(id=>id===f.id?next.id:id)})});busy=false;render();}catch(error){busy=false;showError(error);}});input.click();
  }
  function editableBody(r){
    const fields={documents:['titre','description','texte','etiquettes','categorie','origine','provenance','files'],enquetes:['titre','description','question','etat','archive','etiquettes','conclusion','ordre'],notes:['titre','texte','etiquettes'],
      liens:['a','b','role','ordre'],relations:['a','b','nature','texte'],evenements:['titre','texte','enquete','repere','dateSession','dateUnivers','ordre','documents','pnjs'],annotations:['document','fileId','version','x','y','width','height','texte'],dispositions:['enquete','positions']}[r.type];
    return Object.fromEntries(fields.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
  }
  function closeEditor(){
    detailSignature='';
    if(timer)globalThis.clearTimeout(timer);timer=null;editor=null;render();
  }
  function openEditor(record,type,context=null,preset={},draftId=null){
    if(editor&&!globalThis.confirm('Conserver le brouillon et changer de fiche ?'))return;
    ++token;release();detail.replaceChildren();
    const uid=state.session.uid,recordId=record?.id||draftId||client.newId();let baseRevision=record?.revision||0,resumed=null;
    const body={...(['notes','documents','enquetes','evenements'].includes(type)?{titre:'',etiquettes:[]}:{}),...(['notes','documents','relations','evenements','annotations'].includes(type)?{texte:''}:{}),...(record?editableBody(record):{}),...preset};
    let linkedContext=context&&!preset.shareNote?context:null;
    const draft=client.readDraft(uid,recordId);
    if(draft&&globalThis.confirm('Reprendre le brouillon local ?')){Object.assign(body,draft.body);baseRevision=draft.baseRevision;resumed=draft;if(!linkedContext&&draft.context)linkedContext=all().find(r=>r.id===draft.context.id)||null;}
    const form=node('form','','enq-editor');form.append(node('h3',record?'Modifier '+recordTitle(record):'Créer '+({notes:'une note',documents:'un document',enquetes:'une enquête',relations:'une relation',evenements:'un événement',annotations:'une annotation'}[type]||'un lien')));
    const controls={};
    const add=(key,label,kind='text',options=[])=>{
      const wrap=node('label',label),control=node(kind==='textarea'?'textarea':kind==='select'?'select':'input');
      if(kind==='select')for(const [value,title]of options){const o=node('option',title);o.value=value;control.append(o);}
      else if(kind!=='textarea')control.type=kind;
      if(kind==='checkbox')control.checked=!!body[key];else control.value=Array.isArray(body[key])?body[key].join(', '):body[key]??(kind==='select'?options[0]?.[0]:'')??'';
      if(kind==='number'){control.step='any';}
      wrap.append(control);form.append(wrap);controls[key]=control;return control;
    };
    if(['documents','notes','enquetes','evenements'].includes(type))add('titre','Titre');
    if(['documents','notes','relations','evenements','annotations'].includes(type)){
      const text=add('texte','Texte','textarea'),format=node('div','','enq-format');
      for(const [label,before,after]of [['Gras','**','**'],['Italique','*','*'],['Titre','## ',''],['Liste','- ',''],['Citation','> ','']])format.append(button(label,()=>{const start=text.selectionStart,end=text.selectionEnd;text.setRangeText(before+text.value.slice(start,end)+after,start,end,'select');text.focus();form.dispatchEvent(new globalThis.Event('input',{bubbles:true}));}));
      form.append(format,node('small','Mise en forme Markdown : titres, listes, citations, gras, italique et liens HTTPS.'));
    }
    if(['documents','notes','enquetes'].includes(type))add('etiquettes','Étiquettes séparées par des virgules');
    if(type==='documents'){body.categorie||='Autre';body.origine||=isGm()?'piece':'contribution';if(isGm()&&!record)add('origine','Origine','select',[['piece','Pièce reçue'],['contribution','Contribution']]);add('description','Description courte','textarea');add('categorie','Catégorie','select',['Lettre','Témoignage','Carte','Illustration','Rapport','Autre'].map(v=>[v,v]));add('provenance','Provenance');body.origine||='contribution';body.files||=[];}
    if(type==='enquetes'){add('question','Question centrale','textarea');add('etat','État','select',['Ouverte','En pause','Résolue'].map(v=>[v,v]));add('conclusion','Conclusion','textarea');add('archive','Archivée','checkbox');body.ordre||=[];}
    if(type==='relations'){
      const options=state.records.filter(r=>r.type==='documents').map(r=>[r.id,recordTitle(r)]);add('a','Première pièce','select',options);add('b','Deuxième pièce','select',options);add('nature','Relation','select',['Appuie','Contredit','Complète','Renvoie à'].map(v=>[v,v]));
    }
    if(type==='evenements'){body.enquete||=context?.id;add('repere','Repère temporel');add('dateSession','Date de session');add('dateUnivers','Date dans l’univers');add('ordre','Ordre dans la chronologie','number');body.documents||=[];body.pnjs||=[];
      for(const [key,label,typeName]of [['documents','Pièces justificatives','documents'],['pnjs','Personnages concernés','pnjs']]){const control=add(key,label,'select',all().filter(r=>r.type===typeName).map(r=>[r.id,r.nom||recordTitle(r)]));control.multiple=true;for(const option of control.options)option.selected=body[key].includes(option.value);}
    }
    if(type==='annotations'){for(const key of ['x','y','width','height']){const c=add(key,{x:'Position horizontale',y:'Position verticale',width:'Largeur de zone',height:'Hauteur de zone'}[key]+' entre 0 et 1','number');c.min='0';c.max='1';}}
    const audience=add('zone','Audience','select',[[`user:${uid}`,'Personnel'],...state.session.role!=='ancien'?[['commun','Groupe']]:[],...isGm()?[['mj','Secret MJ']]:[]]);
    audience.value=record?.zone||resumed?.zone||preset.zone||(type==='enquetes'?'mj':`user:${uid}`);
    if(record)audience.disabled=true;
    if(type==='notes'){audience.value=`user:${uid}`;audience.disabled=true;}
    const message=node('p','','enq-save-status');message.setAttribute('role','status');form.append(message);
    const collect=()=>{const next={...body};delete next.zone;delete next.shareNote;for(const [key,c]of Object.entries(controls)){if(key==='zone')continue;next[key]=c.multiple?[...c.selectedOptions].map(o=>o.value):key==='etiquettes'?c.value.split(',').map(v=>v.trim()).filter(Boolean):c.type==='checkbox'?c.checked:c.type==='number'?Number(c.value):c.value;}return next;};
    editor={id:recordId,type,baseRevision,operationId:resumed?.operationId||client.newId(),pending:resumed?.pending||null,body:collect(),zone:audience.value,form,uid,revision:baseRevision,context:linkedContext};
    const persist=()=>{if(!editor||editor.id!==recordId)return false;editor.body=collect();editor.zone=audience.value;const ok=client.saveDraft(uid,recordId,{type,body:editor.body,baseRevision:editor.revision,operationId:editor.operationId,pending:editor.pending,zone:editor.zone,context:editor.context?{id:editor.context.id,type:editor.context.type}:null});message.textContent=ok?'Brouillon local — non synchronisé':'Brouillon local indisponible ; garde cet éditeur ouvert';return ok;};
    const save=async({automatic=false}={})=>{
      if(!editor||busy||editor.id!==recordId)return;
      persist();const captured=editor;
      captured.pending||={body:collect(),baseRevision:captured.revision,operationId:captured.operationId,zone:captured.zone};
      const pending=captured.pending,next=pending.body;persist();busy=true;message.textContent='Synchronisation…';
      try{
        let zone=pending.zone;
        if(!automatic&&zone==='commun'&&(!record||record.zone!=='commun')&&!captured.publicationConfirmed){if(!globalThis.confirm('Publier ce contenu et ses pièces dans le groupe ?')){captured.pending=null;busy=false;return;}captured.publicationConfirmed=true;}
        // Documents are prepared privately; publication is a separate complete operation.
        const publish=zone==='commun'&&!record&&type==='documents';
        if(publish)zone=`user:${uid}`;
        const result=await client.save({type,id:recordId,zone,body:next,baseRevision:pending.baseRevision,operationId:pending.operationId});
        captured.revision=result.revision;captured.operationId=client.newId();captured.pending=null;persist();
        if(publish)await client.action({id:recordId,type,revision:result.revision},'visibility','commun');
        if(linkedContext&&!captured.linked){await addLink(recordId,linkedContext.id,type==='notes'?`user:${uid}`:publish?'commun':zone);captured.linked=true;}
        if(preset.shareNote&&!record&&publish){for(const l of state.records.filter(l=>l.type==='liens'&&(l.a===preset.shareNote.id||l.b===preset.shareNote.id))){const other=l.a===preset.shareNote.id?l.b:l.a;if(all().some(r=>r.id===other&&r.zone==='commun'))await addLink(recordId,other,'commun');}}
        const changed=editor===captured&&JSON.stringify(collect())!==JSON.stringify(next);
        if(changed)persist();else client.removeDraft(uid,recordId);if(mounted&&editor===captured)message.textContent=changed?'Brouillon plus récent — synchronisation à suivre':'Sauvegardée';
        busy=false;
        if(changed){if(type==='notes')timer=globalThis.setTimeout(()=>save({automatic:true}),700);return;}
        if(!automatic&&editor===captured){editor=null;detailSignature='';selected=recordId;section=['documents','notes','enquetes'].includes(type)?type:section;render();revealDetail();onOpen(recordId);}
      }catch(error){
        busy=false;message.textContent=(error.code?.includes('aborted')?'Conflit : ':'Échec : ')+error.message+' — ton brouillon est conservé.';
        if(error.code?.includes('aborted')){
          const currentRecord=state.records.find(r=>r.id===recordId)||error.current;
          const conflict=node('div','','enq-conflict');conflict.append(node('h4','Version actuelle'),textView(currentRecord?.texte||currentRecord?.question||'Recharge la fiche pour consulter la version actuelle.'));
          conflict.append(button('Garder mon texte après comparaison',()=>{captured.revision=currentRecord?.revision||captured.revision;captured.operationId=client.newId();captured.pending=null;conflict.remove();return save();}),button('Reprendre la version actuelle',()=>{client.removeDraft(uid,recordId);editor=null;if(currentRecord)openEditor(currentRecord,type);else render();}));form.append(conflict);
        }
      }
    };
    form.addEventListener('input',()=>{persist();if(timer)globalThis.clearTimeout(timer);if(type==='notes')timer=globalThis.setTimeout(()=>{if(globalThis.navigator.onLine!==false&&!busy)save({automatic:true});},700);});
    const submit=node('button','Enregistrer','enq-button enq-button--primary');submit.type='submit';form.append(submit,button('Fermer en conservant le brouillon',()=>{persist();closeEditor();}));
    form.addEventListener('submit',e=>{e.preventDefault();save();});detail.append(form);form.querySelector('input,textarea,select')?.focus();
  }
  async function addLink(a,b,zone,role=''){
    const existing=state.records.find(r=>r.type==='liens'&&r.zone===zone&&((r.a===a&&r.b===b)||(r.a===b&&r.b===a)));
    if(existing)return existing;
    try{return await client.save({type:'liens',body:{a,b,role},zone});}catch(error){if(error.code?.includes('already-exists'))return {exists:true};throw error;}
  }
  function openLinkEditor(r){
    const dialog=node('dialog'),form=node('form'),select=node('select');select.setAttribute('aria-label','Objet à relier');
    const compatible={documents:['enquetes','pnjs','notes'],enquetes:['documents','pnjs','notes'],notes:['documents','enquetes','pnjs'],pnjs:['documents','enquetes','notes']}[r.type]||[];
    for(const target of all().filter(t=>t.id!==r.id&&compatible.includes(t.type))){const o=node('option',target.nom||recordTitle(target));o.value=target.id;select.append(o);}
    const role=node('input');role.placeholder='Rôle dans l’affaire, si utile';role.setAttribute('aria-label','Rôle');form.append(node('h3','Ajouter un lien'),select,role);
    const submit=node('button','Relier');submit.type='submit';form.append(submit,button('Annuler',()=>{dialog.close();dialog.remove();}));
    form.addEventListener('submit',async e=>{e.preventDefault();try{const target=all().find(t=>t.id===select.value);if(!target)return;const zones=[r.zone,target.zone];
      const destination=zones.find(z=>z.startsWith('user:'))||(zones.includes('mj')?'mj':'commun');await addLink(r.id,target.id,destination,role.value);dialog.close();dialog.remove();render();}catch(error){showError(error);}});
    dialog.append(form);root.append(dialog);dialog.showModal();
  }
  async function performAction(r,action,zone){
    if(!globalThis.confirm(action==='visibility'?(zone==='commun'?'Publier dans le groupe ?':'Retirer de la vue du groupe ? Les copies déjà téléchargées restent chez leurs lecteurs.'):'Mettre cet objet en corbeille ? Ses autres pièces et tes notes seront conservées.'))return;
    busy=true;status.textContent='Opération en cours…';try{await client.action(r,action,zone);busy=false;if(action==='trash')selected=null;render();}catch(error){busy=false;showError(error);}
  }
  async function renderTrash(){
    const targetToken=token;list.append(node('h3','Corbeille'));
    try{const result=await client.read('trash');if(!mounted||section!=='trash'||targetToken!==token)return;
      for(const r of result.items){const row=node('article',r.titre);row.append(button('Restaurer sans publier',async()=>{await client.action(r,'restore');render();}));if(isGm()||r.zone===`user:${state.session.uid}`)row.append(button('Purger définitivement',async()=>{if(globalThis.confirm('Supprimer définitivement ce contenu ?')){await client.action(r,'purge',r.zone);render();}},'danger'));list.append(row);}if(!result.items.length)list.append(node('p','Corbeille vide.'));
    }catch(error){showError(error);}
  }
  async function orderDocuments(r){
    const linked=state.records.filter(v=>v.type==='documents'&&v.zone===r.zone&&linkedIds(r.id).has(v.id));
    const dialog=node('dialog'),box=node('ol'),order=[...(r.ordre||[]).filter(id=>linked.some(v=>v.id===id)),...linked.filter(v=>!r.ordre?.includes(v.id)).map(v=>v.id)];
    const draw=()=>{box.replaceChildren();order.forEach((id,index)=>{const item=node('li',recordTitle(linked.find(v=>v.id===id)));item.append(button('Monter',()=>{if(index){[order[index-1],order[index]]=[order[index],order[index-1]];draw();}}),button('Descendre',()=>{if(index<order.length-1){[order[index],order[index+1]]=[order[index+1],order[index]];draw();}}));box.append(item);});};
    draw();dialog.append(node('h3','Ordre éditorial'),box,button('Enregistrer',async()=>{await client.save({type:r.type,id:r.id,zone:r.zone,baseRevision:r.revision,body:editableBody({...r,ordre:order})});dialog.close();dialog.remove();render();}),button('Annuler',()=>{dialog.close();dialog.remove();}));root.append(dialog);dialog.showModal();
  }
  async function showGraph(r,host){
    const viewToken=token,{select,forceSimulation,forceLink,forceManyBody,forceCenter,drag}=await import('./vendor/enquetes-d3.js');if(viewToken!==token||!mounted)return;
    graph?.stop();host.replaceChildren();const ids=linkedIds(r.id),nodes=all().filter(v=>ids.has(v.id)&&['documents','pnjs','notes','enquetes'].includes(v.type)).map(v=>({id:v.id,label:v.nom||recordTitle(v)}));
    const links=state.records.filter(v=>['liens','relations'].includes(v.type)&&ids.has(v.a)&&ids.has(v.b)).map(v=>({source:v.a,target:v.b}));
    const layout=state.records.find(v=>v.type==='dispositions'&&v.enquete===r.id);for(const n of nodes){const pos=layout?.positions?.[n.id];if(pos){n.x=pos[0];n.y=pos[1];}}
    const svg=select(host).append('svg').attr('viewBox','0 0 800 500').attr('role','img').attr('aria-label','Graphe personnel des pièces et personnages');const lines=svg.append('g').selectAll('line').data(links).join('line').attr('stroke','currentColor');
    const dots=svg.append('g').selectAll('g').data(nodes).join('g');dots.append('circle').attr('r',12).attr('fill','var(--enq-accent)');dots.append('text').attr('x',16).attr('fill','currentColor').text(n=>n.label.slice(0,30));
    graph=forceSimulation(nodes).force('link',forceLink(links).id(n=>n.id).distance(140)).force('charge',forceManyBody().strength(-500)).force('center',forceCenter(400,250));
    dots.call(drag().on('start',(event,n)=>{n.fx=n.x;n.fy=n.y;}).on('drag',(event,n)=>{n.fx=event.x;n.fy=event.y;graph.alpha(.3).restart();}).on('end',()=>{})).on('click',(_,n)=>openObject(all().find(v=>v.id===n.id)));
    graph.on('tick',()=>{lines.attr('x1',l=>l.source.x).attr('y1',l=>l.source.y).attr('x2',l=>l.target.x).attr('y2',l=>l.target.y);dots.attr('transform',n=>`translate(${n.x},${n.y})`);});
    host.append(button('Enregistrer ma disposition',async()=>{const positions=Object.fromEntries(nodes.map(n=>[n.id,[n.x,n.y]]));await client.save({type:'dispositions',id:layout?.id,zone:`user:${state.session.uid}`,baseRevision:layout?.revision||0,body:{enquete:r.id,positions}});status.textContent='Disposition personnelle enregistrée.';}));
  }
  async function exportSpace(r=null){
    const {default:JSZip}=await import('./vendor/enquetes-zip.js');const zip=new JSZip();
    const hasPrivate=state.records.some(v=>v.zone.startsWith('user:'));
    const includePersonal=hasPrivate&&globalThis.confirm('Inclure les contenus de ton espace personnel dans cet export ?');
    const manifest=selectEnqueteExport(state.records,state.pnjs,{root:r,section,includePersonal}),records=manifest.objects;
    zip.file('synthese.md',records.map(v=>'# '+recordTitle(v)+'\n\n'+(v.question||'')+'\n\n'+(v.texte||v.conclusion||'')).join('\n\n'));
    zip.file('manifest.json',JSON.stringify({version:1,...manifest},null,2));
    for(const doc of records.filter(v=>v.type==='documents')){
      const response=await client.read('files',doc.id);for(const f of response.items.filter(f=>doc.files?.includes(f.id)))zip.file('documents/'+doc.id+'/'+f.id+'-'+f.name.replace(/[^a-zA-Z0-9._ -]/gu,'_'),await client.blob(f));
    }
    const blob=await zip.generateAsync({type:'blob'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=(r?.titre||'enquetes')+'.zip';a.click();globalThis.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return {
    async mount({signal}={}){
      if(mounted||signal?.aborted)return;mounted=true;build();
      const runtime=await loadRuntime();if(!mounted||signal?.aborted)return;
      client=runtime.createEnqueteClient({onChange:next=>{if(editor&&(!next.session||next.session.uid!==editor.uid||!editor.zone.startsWith('user:')&&(!next.session.active||next.session.maintenance&&!busy||next.session.role==='ancien'))){editor=null;if(timer)globalThis.clearTimeout(timer);timer=null;detailSignature='';}if(!next.session||next.session.maintenance)for(const dialog of root.querySelectorAll('dialog'))if(dialog.open){dialog.close();dialog.remove();}state=next;linksIndex=buildLinksIndex(next.records);if(selected&&!legacyResolved&&next.session?.active&&client){legacyResolved=true;client.read('resolveLegacy',selected).then(result=>{if(mounted&&result.id){selected=result.id;render();}}).catch(()=>{});}if(selected&&!editor){const found=next.records.find(r=>r.id===selected);if(found&&['documents','enquetes','notes'].includes(found.type))section=found.type;}render();if(!initialOpened&&initialAction&&next.session?.active&&(initialAction==='new'||current())){initialOpened=true;openEditor(initialAction==='edit'?current():null,current()?.type||'enquetes');}},onError:showError});
      Object.assign(client,{newId:runtime.newEnqueteId,saveDraft:runtime.saveEnqueteDraft,readDraft:runtime.readEnqueteDraft,removeDraft:runtime.removeEnqueteDraft,listDrafts:runtime.listEnqueteDrafts});
      signal?.addEventListener('abort',()=>this.unmount(),{once:true});
    },
    beforeLeave(){return !busy&&(!editor||globalThis.confirm('Quitter en conservant le brouillon local ?'));},
    unmount(){for(const dialog of root?.querySelectorAll('dialog')||[])if(dialog.open)dialog.close();mounted=false;++token;if(timer)globalThis.clearTimeout(timer);release();client?.close();editor=null;container.replaceChildren();}
  };
}
















