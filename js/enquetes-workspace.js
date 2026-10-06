import { createActionMenu } from './enquetes-menu.js';
import { buildLinksIndex, countSpaces, countStates, dossierSummary, dossierPieces, dossierPnjs, dossierTimeline, pieceContext, linkedNotes, isUnclassified } from './enquetes-view-model.js';
import { selectEnqueteExport } from './data/enquetes-export.js';
import { recordTitle, buildSearch, fold } from './data/enquetes-domain.js';
let mobileSpace={uid:null,section:'enquetes',filter:'',category:'',search:'',scope:''};
const mobileTabs=new Map(),mobileContexts=new Map();
export function createEnqueteWorkspaceView({container,id=null,initialAction=null,loadRuntime=()=>import('./enquetes-runtime.js'),onOpen=()=>{},onOpenPnj=()=>{},layout='desktop'}={}) {
  const d=container.ownerDocument;
  let initialOpened=false,legacyResolved=false,detailSignature='',linksIndex=new Map();
  let client=null,state={session:null,records:[],pnjs:[]},mounted=false,token=0,section='enquetes',selected=id,search='',scope='',filter='',category='',editor=null,timer=null,graph=null,handles=[],busy=false;
  const node=(tag,text='',className='')=>{const e=d.createElement(tag);e.textContent=text;e.className=className;return e;};
  const button=(label,action,variant='')=>{const b=node('button',label,'enq-button'+(variant?' enq-button--'+variant:''));b.type='button';b.addEventListener('click',()=>Promise.resolve(action()).catch(showError));return b;};
  let root,toolbar,list,detail,status,searchInput,notebook,panes,fab;
  let mobileSearchOpen=false;
  let dossierTab='dossier',menus=[],contextDossier=layout==='mobile'?mobileContexts.get(id)||null:null,activeFileId=null,annotationMode=false,notebookOpen=false;
  let annotationRows=new Map(),annotationMarkers=new Map();
  const current=()=>state.records.find(r=>r.id===selected)||state.pnjs.find(r=>r.id===selected);
  const all=()=>[...state.records,...state.pnjs];
  const isGm=()=>state.session?.role==='mj';
  const canEdit=r=>r.authorUid===state.session?.uid||isGm()&&!r.zone?.startsWith('user:');
  const showError=error=>{if(mounted)status.textContent=error?.message||'Opération impossible';};
  const release=()=>{menus.splice(0).forEach(menu=>menu.close(false));handles.splice(0).forEach(h=>h.release());graph?.stop?.();graph=null;};
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
    if(layout!=='mobile'&&globalThis.matchMedia?.('(max-width:850px)')?.matches)detail.scrollIntoView?.({behavior:'smooth',block:'start'});
  }
  const searchShortcut=event=>{if(event.key==='/'&&!['input','textarea','select'].includes(d.activeElement?.tagName?.toLowerCase())){event.preventDefault();searchInput?.focus();}};
  function build(){
    root=node('section','','enq-workspace enq-workspace--'+layout);toolbar=node('div','','enq-toolbar');status=node('p','','enq-status');status.setAttribute('role','status');
    root.append(toolbar,status);
    panes=node('div','','enq-panes');list=node('div','','enq-list');detail=node('article','','enq-detail');notebook=node('aside','','enq-notebook');notebook.setAttribute('aria-labelledby','enq-notebook-title');if(layout==='desktop')panes.append(list,detail,notebook);root.append(panes);fab=button('✎ Note rapide',()=>openQuickSheet());fab.className='enq-quick-fab';fab.setAttribute('aria-label','Note rapide');fab.hidden=true;root.append(fab);container.replaceChildren(root);
    render();
  }
  function syncMobileScreen(){
    if(layout!=='mobile')return;
    fab.hidden=!state.session||!!editor;
    if((selected||editor)&&section!=='trash'){if(panes.firstChild!==detail)panes.replaceChildren(detail);}else if(panes.firstChild!==list)panes.replaceChildren(list);
    container.scrollTop=0;
  }
  function rememberMobile(){if(layout==='mobile'&&!selected&&state.session)mobileSpace={uid:state.session?.uid,section,filter,category,search,scope};}
  function render(){
    if(!mounted)return;
    syncMobileScreen();rememberMobile();fab.hidden=layout!=='mobile'||!state.session||!!editor;
    toolbar.replaceChildren();
    if(!state.session){
      toolbar.append(node('h2','Documents et enquêtes'),button('Se connecter avec Google',()=>client?.signIn()));
      list.replaceChildren(node('p','Connecte-toi pour retrouver les pièces du groupe et ton carnet personnel.'));if(!editor)detail.replaceChildren();return;
    }
    if(!state.session.active){status.textContent='Le nouvel espace sera disponible après sa mise en service.';list.replaceChildren();return;}
    if(state.session.maintenance){status.textContent='Réorganisation des accès en cours. Ton carnet personnel reste accessible.';}
    else if(state.session.role==='ancien'){status.textContent='Accès au groupe retiré. Ton carnet personnel reste consultable et exportable.';section='notes';}
    else if(state.session.offline){status.textContent='Hors connexion : textes en cache et brouillons locaux.';}
    else if(!editor&&!busy)status.textContent='';
    renderList();renderNotebook();
    if(!editor){const signature=JSON.stringify([selected,section,state.session?.uid,state.session?.maintenance,state.records.map(({fromCache,...r})=>r),state.pnjs]);if(signature!==detailSignature){detailSignature=signature;renderDetail();}}
  }
  function switchSpace(value){
    if(editor&&!globalThis.confirm('Conserver le brouillon et quitter l’éditeur ?'))return;
    section=value;filter='';category='';scope='';selected=null;contextDossier=null;if(layout==='mobile')mobileContexts.clear();detailSignature='';closeEditor();
  }
  function tabs(choices,value,change,label){
    const bar=node('div','','enq-tabs');bar.setAttribute('role','tablist');bar.setAttribute('aria-label',label);
    const buttons=choices.map(([key,text])=>{const b=button(text,()=>change(key),'quiet');b.setAttribute('role','tab');b.setAttribute('aria-selected',String(key===value));b.setAttribute('aria-current',String(key===value));b.tabIndex=key===value?0:-1;return b;});
    buttons.forEach((b,i)=>b.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const n=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;change(choices[n][0]);const bars=root.querySelectorAll('.enq-tabs');const fresh=bars.find?.(v=>v.getAttribute('aria-label')===label)||Array.from(bars).find(v=>v.getAttribute('aria-label')===label);fresh?.querySelectorAll('button')[n]?.focus();}}));
    bar.append(...buttons);return bar;
  }
  function quickTargets(){
    const ids=[];if(current())ids.push(current().id);if(current()?.type==='documents'&&contextDossier)ids.push(contextDossier);return ids;
  }
  async function saveNote({id,uid,body,baseRevision,operationId}){
    return client.save({type:'notes',id,zone:'user:'+uid,body,baseRevision,operationId});
  }
  function quickForm(targetIds,onSuccess=()=>{},sheet=false){
    const uid=state.session.uid,contextKey=current()?.id||'unclassified';
    const resumed=client.listDrafts(uid).find(v=>v.quick&&v.quickContext===contextKey),id=resumed?.id||client.newId();
    let revision=resumed?.baseRevision||0,operationId=resumed?.operationId||client.newId(),pending=resumed?.pending||null;
    const targets=new Set(resumed?.links||targetIds),form=node('form','','enq-quick-form'),text=node('textarea');text.rows=3;text.value=resumed?.body?.texte||'';text.placeholder='Une idée, un nom entendu…';text.setAttribute('aria-label','Note rapide sur '+(current()?.type==='documents'?'cette pièce':'ce dossier'));
    const message=node('p','Brouillon gardé sur cet appareil','enq-save-status');message.setAttribute('role','status');
    const persist=()=>client.saveDraft(uid,id,{type:'notes',body:{titre:'',texte:text.value,etiquettes:[]},zone:'user:'+uid,baseRevision:revision,operationId,pending,quick:true,quickContext:contextKey,links:[...targets],context:targets.size?{id:[...targets][0],type:all().find(r=>r.id===[...targets][0])?.type}:null});
    text.addEventListener('input',()=>{message.textContent=persist()?'Brouillon gardé sur cet appareil':'Brouillon local indisponible ; garde cette saisie ouverte';});
    form.append(text);
    if(sheet){
      const choices=node('div','','enq-quick-targets');choices.append(node('h4','Relier à'));
      const candidates=all().filter(r=>targetIds.includes(r.id)||targets.has(r.id)||r.type==='pnjs'&&dossierPnjs(state.records.find(v=>v.id===contextDossier)||current()||{},state.records,state.pnjs).some(v=>v.pnj.id===r.id));
      const drawTarget=r=>{const chip=button(r.nom||recordTitle(r),()=>{if(targets.has(r.id))targets.delete(r.id);else targets.add(r.id);chip.setAttribute('aria-pressed',String(targets.has(r.id)));persist();},'quiet');chip.setAttribute('aria-pressed',String(targets.has(r.id)));choices.append(chip);};candidates.forEach(drawTarget);
      choices.append(button('Autre…',()=>selectLinkedTarget(target=>{if(!candidates.some(v=>v.id===target.id)){candidates.push(target);targets.add(target.id);drawTarget(target);}persist();}),'quiet'));form.append(choices);
    }else form.append(node('small',targets.size?'Reliée à '+(current()?.type==='documents'?'cette pièce':'ce dossier'):'Note non classée'));
    const submit=node('button','Noter','enq-button'+(sheet?' enq-button--primary':''));submit.type='submit';form.append(message,submit);
    const save=async()=>{
      if(busy||!text.value.trim()||state.session?.uid!==uid)return;
      if(!persist()){message.textContent='Brouillon local indisponible ; garde cette saisie ouverte';return;}
      if(state.session.offline||globalThis.navigator.onLine===false){message.textContent='Hors connexion : note gardée sur cet appareil, envoi à la reconnexion via Reprendre le brouillon.';return;}
      pending||={body:{titre:'',texte:text.value,etiquettes:[]},baseRevision:revision,operationId,zone:'user:'+uid};persist();busy=true;
      try{
        const sentText=pending.body.texte,result=await saveNote({id,uid,...pending}),latest=client.readDraft(uid,id),newer=latest?.body?.texte!==sentText;revision=result.revision;pending=null;operationId=client.newId();
        if(newer)client.saveDraft(uid,id,{...latest,baseRevision:revision,operationId,pending:null});else persist();
        for(const target of targets){if(state.session?.uid!==uid)break;await addLink(id,target,'user:'+uid);}
        if(newer){message.textContent='Notée ; brouillon plus récent conservé.';}else{client.removeDraft(uid,id);text.value='';message.textContent='Notée';}
        busy=false;if(mounted&&state.session?.uid===uid){render();status.textContent=newer?'Notée ; brouillon plus récent conservé.':'Notée';onSuccess();}
      }catch(error){busy=false;persist();message.textContent='Échec : '+error.message+' — ton brouillon est conservé.';if(mounted)status.textContent=message.textContent;}
    };
    form.addEventListener('submit',event=>{event.preventDefault();save();});text.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();save();}});
    return {form,text};
  }
  function renderNotebook(){
    notebook.replaceChildren(node('h3','Mon carnet','enq-section-title'));notebook.firstChild.id='enq-notebook-title';if(!state.session||!client)return;
    const lock=node('span','⚿');lock.setAttribute('aria-hidden','true');notebook.append(lock,node('small','Privé'),quickForm(quickTargets()).form,button('Nouvelle note',()=>openEditor(null,'notes',current()),'quiet'));
    for(const note of [...linkedNotes(current(),state.records,linksIndex)].reverse()){
      const row=node('article','','enq-notebook-note');row.append(button(recordTitle(note),()=>openObject(note),'quiet'));
      const excerpt=textView(note.texte);excerpt.className+=' enq-note-excerpt';row.append(excerpt,button('Lire la suite',()=>openObject(note),'quiet'));
      const date=note.updatedAt?.seconds?new Date(note.updatedAt.seconds*1000).toLocaleDateString('fr'):'';if(date)row.append(node('small',date));
      const lien=state.records.find(l=>l.type==='liens'&&(l.a===note.id&&l.b===current()?.id||l.b===note.id&&l.a===current()?.id));if(lien&&canEdit(lien))row.append(actionMenu('Actions du lien de cette note',[{label:'Retirer le lien',variant:'danger',action:()=>performAction(lien,'trash')}]).element);notebook.append(row);
    }
    const suggestions=state.records.filter(r=>r.type==='notes'&&isUnclassified(r,state.records)).slice(0,3);
    if(suggestions.length){notebook.append(node('h4','Non classées'));for(const note of suggestions){const row=node('article','','enq-notebook-note');row.append(button(recordTitle(note),()=>openObject(note),'quiet'));if(current())row.append(button('Relier à '+(current().type==='documents'?'cette pièce':'ce dossier'),()=>addLink(note.id,current().id,'user:'+state.session.uid),'quiet'));notebook.append(row);}}
    notebook.append(node('p','Carnet privé dans l’application. L’administrateur de l’infrastructure Firebase conserve un accès technique.','enq-privacy'));
  }
  function openQuickSheet(){
    if(!state.session||editor)return;
    const anchor=d.activeElement||fab,dialog=node('dialog','','enq-quick-sheet');dialog.setAttribute('aria-label','Note rapide · mon carnet');
    const quick=quickForm(quickTargets(),()=>dialog.close(),true);dialog.append(node('h3','Note rapide · mon carnet'),button('Fermer',()=>dialog.close()),quick.form);
    dialog.addEventListener('close',()=>{dialog.remove();anchor?.focus();},{once:true});root.append(dialog);dialog.showModal();quick.text.focus();
  }
  function selectLinkedTarget(onSelect){
    const anchor=d.activeElement,dialog=node('dialog'),select=node('select');dialog.setAttribute('aria-label','Objet à relier');select.setAttribute('aria-label','Objet à relier');
    for(const target of all().filter(r=>['enquetes','documents','pnjs'].includes(r.type))){const option=node('option',target.nom||recordTitle(target));option.value=target.id;select.append(option);}
    dialog.append(select,button('Relier',()=>{const target=all().find(r=>r.id===select.value);if(target)onSelect(target);dialog.close();}),button('Annuler',()=>dialog.close()));dialog.addEventListener('close',()=>{dialog.remove();anchor?.focus();},{once:true});root.append(dialog);dialog.showModal();
  }
  function renderList(){
    rememberMobile();
    const focused=searchInput&&d.activeElement===searchInput,selection=focused?[searchInput.selectionStart,searchInput.selectionEnd]:null;
    list.replaceChildren();
    const counts=countSpaces(state.records);
    list.append(tabs([['enquetes','Dossiers '+counts.enquetes],['documents','Pièces '+counts.documents],['notes','Carnet '+counts.notes]],section,switchSpace,'Espace de recherche'));
    if(section==='trash'){list.append(button('Retour aux dossiers',()=>switchSpace('enquetes'),'quiet'));renderTrash();return;}
    const heading=node('div','','enq-list-heading');heading.append(node('h3',section==='notes'?'Mon carnet':section==='documents'?'Bibliothèque':'Dossiers d’enquête'));
    if(section!=='enquetes'||isGm())heading.append(button(section==='notes'?'Nouvelle note':section==='documents'?'Nouveau document':'Nouvelle enquête',()=>openEditor(null,section),'primary'));
    if(layout==='mobile'){const toggle=button(mobileSearchOpen?'×':'⌕',()=>{mobileSearchOpen=!mobileSearchOpen;if(!mobileSearchOpen)search='';renderList();if(mobileSearchOpen)searchInput.focus();});toggle.className='enq-icon-button';toggle.setAttribute('aria-label',mobileSearchOpen?'Fermer la recherche':'Ouvrir la recherche');heading.append(toggle);}
    list.append(heading);
    const controls=node('div','','enq-filters');
    const searchLabel=node('label','Rechercher dans cet espace','visually-hidden');searchLabel.htmlFor='enq-search';controls.append(searchLabel);
    searchInput=node('input');searchInput.id='enq-search';searchInput.type='search';searchInput.placeholder='Pièce, PNJ, note…';searchInput.value=search;searchInput.setAttribute('aria-label','Rechercher dans cet espace');
    searchInput.addEventListener('input',e=>{search=e.target.value;rememberMobile();renderResults();});if(layout==='mobile')searchInput.hidden=!mobileSearchOpen;controls.append(searchInput);
    const states=countStates(state.records),chips=node('div','','enq-chips');
    const choices=section==='documents'?[['piece','Pièces reçues'],['contribution','Contributions'],['personnel','Personnel'],...isGm()?[['mj','Secret MJ']]:[]]:section==='enquetes'?[['Ouverte','Ouvertes '+states.Ouverte],['En pause','En pause '+states['En pause']],['Résolue','Résolues '+states.Résolue],['archive','Archivées '+states.archive]]:[['','Toutes'],['non-classees','Non classées']];
    for(const [value,label]of choices){const b=button(label,()=>{filter=filter===value?'':value;renderList();},'quiet');b.setAttribute('aria-pressed',String(value===filter));if(section==='enquetes'&&value!=='archive')b.append(node('span','','enq-state-dot enq-state-dot--'+({'Ouverte':'open','En pause':'paused','Résolue':'solved'}[value])));chips.append(b);}
    controls.append(chips);
    if(section==='documents'){const categories=node('select');categories.setAttribute('aria-label','Catégorie');for(const value of ['','Lettre','Témoignage','Carte','Illustration','Rapport','Autre']){const option=node('option',value||'Toutes les catégories');option.value=value;categories.append(option);}categories.value=category;categories.addEventListener('change',()=>{category=categories.value;renderResults();});controls.append(categories);}
    const scopeSelect=node('select');scopeSelect.setAttribute('aria-label',section==='notes'?'Limiter à une enquête, un document ou un personnage':'Limiter à une enquête');scopeSelect.append(node('option',section==='notes'?'Tous les objets liés':'Toutes les enquêtes'));scopeSelect.firstChild.value='';
    for(const r of all().filter(r=>section==='notes'?['enquetes','documents','pnjs'].includes(r.type):r.type==='enquetes')){const o=node('option',r.nom||r.titre);o.value=r.id;scopeSelect.append(o);}scopeSelect.value=scope;scopeSelect.addEventListener('change',()=>{scope=scopeSelect.value;rememberMobile();renderResults();});
    controls.append(scopeSelect);list.append(controls,node('ul','','enq-results'));renderResults();
    const footer=node('footer','','enq-rail-footer');
    const drafts=client?.listDrafts?.(state.session.uid)||[];
    for(const draft of drafts.filter(v=>v.type===section))footer.append(button('Reprendre le brouillon : '+(draft.body?.titre||'Sans titre'),()=>openEditor(state.records.find(r=>r.id===draft.id)||null,draft.type,null,{},draft.id),'quiet'));
    footer.append(button('Corbeille',()=>switchSpace('trash'),'quiet'),button('Exporter cet espace',()=>exportSpace(),'quiet'),button('Déconnexion',()=>client.signOut(),'quiet'));list.append(footer);
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
    if(category&&section==='documents')source=source.filter(r=>r.categorie===category);
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
      const card=node('li','','enq-card');const open=button(recordTitle(r),()=>{if(editor&&!globalThis.confirm('Conserver le brouillon et quitter l’éditeur ?'))return;openObject(r,true);});open.setAttribute('aria-current',String(selected===r.id));
      card.append(open,node('small',r.type==='documents'?(r.origine==='piece'?'Pièce':'Contribution')+' · '+r.categorie:r.type==='enquetes'?r.etat:'Note privée'));
      if(r.type==='enquetes'){const summary=dossierSummary(r,state.records,state.pnjs,linksIndex);card.append(node('small',summary.pieces+' pièces · '+summary.pnjs+' PNJ'+(summary.lastSession?' · màj session '+summary.lastSession:'')));open.append(node('span','','enq-state-dot enq-state-dot--'+({'Ouverte':'open','En pause':'paused','Résolue':'solved'}[r.etat]||'open')));}
      if(r.zone==='mj')card.append(node('span','Secret MJ','enq-badge'));else if(r.zone.startsWith('user:')&&r.type!=='notes')card.append(node('span','Personnel','enq-badge'));
      if(layout==='mobile'&&r.type==='enquetes'){if(r.question)card.append(node('p','« '+r.question+' »','enq-card-question'));const pile=node('span','','enq-mini-slips');pile.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)pile.append(node('span'));card.append(pile,node('small',dossierSummary(r,state.records,state.pnjs,linksIndex).notes+' note(s)'));}
      if(search)card.append(node('p',(r.texte||r.description||'').slice(0,180)));
      results.append(card);
    }
  }
  function openObject(r,fromRail=false){
    if(r.type==='pnjs'){onOpenPnj(r.id);return;}
    if(fromRail){contextDossier=null;mobileContexts.delete(r.id);}else if(current()?.type==='enquetes'&&r.type==='documents')contextDossier=current().id;
    if(layout==='mobile'){if(contextDossier&&r.type==='documents')mobileContexts.set(r.id,contextDossier);container.scrollTop=0;onOpen(r.id);return;}
    activeFileId=null;annotationMode=false;notebookOpen=false;dossierTab='dossier';
    closeEditor();selected=r.id;section=['documents','enquetes','notes'].includes(r.type)?r.type:section;render();revealDetail();onOpen(r.id);
  }
  async function renderDetail(){
    if(section==='trash'){release();detail.replaceChildren();return;}
    const viewToken=++token;release();detail.replaceChildren();annotationRows=new Map();annotationMarkers=new Map();
    root.className='enq-workspace enq-workspace--'+layout+(current()?.type==='documents'?' enq-workspace--piece':'')+(notebookOpen?' enq-workspace--notebook-open':'');
    const r=current();
    if(section==='trash'){return;}
    if(!r){detail.append(node('h3','Choisis un dossier ou une pièce'),node('p','Les documents peuvent appartenir à plusieurs enquêtes. Les notes restent dans ton carnet.'));return;}
    if(r.type==='pnjs'){detail.append(node('h3',r.nom),button('Ajouter une note',()=>openEditor(null,'notes',r)),button('Ajouter un document lié',()=>openEditor(null,'documents',r)));renderLinks(r);return;}
    if(r.type==='enquetes'){renderDossier(r,viewToken);return;}
    if(r.type==='documents'){await renderPiece(r,viewToken);return;}
    detail.append(node('h3',recordTitle(r)),textView(r.texte||''));
    renderLinks(r);detail.append(actionMenu('Actions de la note',objectActions(r,viewToken)).element);
  }
  async function renderPiece(r,viewToken){
    const dossier=state.records.find(v=>v.id===contextDossier&&v.type==='enquetes'),context=pieceContext(r.id,dossier,state.records,linksIndex);
    const breadcrumb=node('nav','','enq-breadcrumb');breadcrumb.setAttribute('aria-label','Contexte de la pièce');
    if(context){breadcrumb.append(button('‹ '+recordTitle(dossier),()=>openObject(dossier),'quiet'),node('span','Pièce n° '+context.numero+' sur '+context.total));for(const [id,label]of [[context.precedent,'Pièce précédente'],[context.suivant,'Pièce suivante']])if(id){const b=button(label,()=>openObject(state.records.find(v=>v.id===id)),'quiet');b.setAttribute('aria-label',label);breadcrumb.append(b);}}
    else if(layout!=='mobile')breadcrumb.append(button('Retour aux pièces',()=>switchSpace('documents'),'quiet'));
    if(layout==='desktop')breadcrumb.append(button('Mon carnet',()=>{notebookOpen=!notebookOpen;renderDetail();},'quiet'));if(layout==='mobile'){breadcrumb.replaceChildren();if(context)breadcrumb.append(node('span','PIÈCE '+context.numero+' / '+context.total));}detail.append(breadcrumb);
    const panes=node('div','','enq-piece-panes'),viewer=node('section','','enq-viewer'),sheet=node('section','','enq-piece-sheet');panes.append(viewer,sheet);detail.append(panes);
    sheet.append(node('p',(context?'PIÈCE N° '+context.numero+' · ':'')+(r.categorie||'Document'),'enq-piece-eyebrow'),node('span',(r.origine==='piece'?'Pièce reçue':'Contribution')+' · '+audienceLabel(r),'enq-badge'),node('h3',recordTitle(r)));
    if(r.description)sheet.append(node('p',r.description,'enq-piece-description'));if(r.provenance)sheet.append(node('p','Provenance : '+r.provenance,'enq-piece-description'));if(r.texte)sheet.append(textView(r.texte));
    const annotations=node('section','','enq-annotations');annotations.append(node('h4','Annotations'));sheet.append(annotations);
    const linked=node('section','','enq-piece-links');linked.append(node('h4','Liée à'));sheet.append(linked);renderPieceLinks(r,linked,context);
    const actions=node('div','','enq-piece-actions');actions.append(button(layout==='mobile'?'Noter':'Noter dans mon carnet',()=>{if(layout==='mobile')openQuickSheet();else{notebookOpen=true;renderDetail();renderNotebook();notebook.querySelector('textarea')?.focus();}},'primary'));if(canEdit(r))actions.append(button('Modifier',()=>openEditor(r,r.type)));if(layout==='mobile')actions.append(button('Annoter',()=>{annotationMode=true;renderDetail();detail.querySelector('.enq-viewer')?.scrollIntoView?.({block:'start'});}));else actions.append(actionMenu('Actions de la pièce',objectActions(r,viewToken).filter(item=>item.label!=='Modifier')).element);sheet.append(actions);
    try{
      const response=await client.read('files',r.id);if(!mounted||viewToken!==token||editor)return;
      const files=response.items.filter(f=>(r.files||[]).includes(f.id)),file=files.find(f=>f.id===activeFileId)||files[0];activeFileId=file?.id||null;
      for(const annotation of state.records.filter(a=>a.type==='annotations'&&a.document===r.id)){
        const row=node('article','','enq-annotation-row'),siblings=state.records.filter(a=>a.type==='annotations'&&a.document===r.id&&a.fileId===annotation.fileId),numero=siblings.findIndex(a=>a.id===annotation.id)+1;
        row.tabIndex=0;row.setAttribute('aria-label','Annotation '+numero+' : '+annotation.texte);row.append(node('span',String(numero),'enq-annotation-number'),textView(annotation.texte),node('small',annotation.zone.startsWith('user:')?'Privée':'Commune'));
        const items=[];if(canEdit(annotation))items.push({label:'Modifier',action:()=>openEditor(annotation,'annotations')},{label:'Supprimer',variant:'danger',action:()=>performAction(annotation,'trash')});if(annotation.zone.startsWith('user:'))items.push({label:'Partager une copie',action:()=>openEditor(null,'annotations',null,{...editableBody(annotation),zone:'commun'})});if(items.length)row.append(actionMenu('Actions de l’annotation '+numero,items).element);
        const original=response.items.find(f=>f.id===annotation.fileId);if(original&&original.id!==file?.id)row.append(button('Voir la version annotée',async()=>{viewer.replaceChildren();await showFile(original,r,viewer,viewToken);},'quiet'));
        for(const event of ['focus','mouseenter'])row.addEventListener(event,()=>highlightAnnotation(annotation.id));annotationRows.set(annotation.id,row);annotations.append(row);
      }
      if(file)await showFile(file,r,viewer,viewToken);else viewer.append(node('p','Aucun fichier. Le texte de la pièce reste consultable.'));
      if(viewToken!==token)return;
      const strip=node('div','','enq-file-strip');strip.setAttribute('aria-label','Fichiers de la pièce');
      for(const f of files){const choose=button(f.name,()=>{activeFileId=f.id;renderDetail();},'quiet');choose.setAttribute('aria-current',String(f.id===file?.id));if(f.contentType.startsWith('image/')){const h=await client.objectUrl(f);if(viewToken!==token||!mounted){h.release();return;}handles.push(h);const thumbnail=node('img');thumbnail.src=h.url;thumbnail.alt='';choose.append(thumbnail);}strip.append(choose);}
      if(canEdit(r)){const input=node('input');input.type='file';input.multiple=true;input.accept='.jpg,.jpeg,.png,.webp,.pdf,.txt,.md';input.hidden=true;input.setAttribute('aria-label','Ajouter des fichiers');input.addEventListener('change',()=>uploadFiles(r,input.files).catch(showError));const add=button('+',()=>input.click());add.setAttribute('aria-label','Ajouter des fichiers');strip.append(add,input);if(file)strip.append(button('Remplacer ce fichier',()=>replaceFile(r,file),'quiet'));}
      viewer.append(strip,node('small',(file?file.name+' · version '+file.version+' · ':'')+files.length+' fichiers sur 10'));
    }catch(error){if(viewToken===token)viewer.append(node('p',error.message));}
  }
  function renderPieceLinks(r,host,context){
    for(const lien of state.records.filter(l=>l.type==='liens'&&(l.a===r.id||l.b===r.id))){const target=all().find(v=>v.id===(lien.a===r.id?lien.b:lien.a));if(!target)continue;const chip=node('div','','enq-link-chip');chip.append(button((target.nom||recordTitle(target))+(lien.role?' · '+lien.role:''),()=>openObject(target),'quiet'));if(canEdit(lien))chip.append(actionMenu('Actions du lien '+(target.nom||recordTitle(target)),[{label:'Retirer le lien',variant:'danger',action:()=>performAction(lien,'trash')}]).element);host.append(chip);}
    for(const relation of state.records.filter(v=>v.type==='relations'&&(v.a===r.id||v.b===r.id))){const other=state.records.find(v=>v.id===(relation.a===r.id?relation.b:relation.a));if(!other)continue;const dossier=state.records.find(v=>v.id===contextDossier),otherContext=pieceContext(other.id,dossier,state.records,linksIndex),reverse=relation.b===r.id;
      const label=(reverse?{Appuie:'Appuyée par',Contredit:'Contredite par',Complète:'Complétée par','Renvoie à':'Référencée par'}[relation.nature]||relation.nature:relation.nature)+(context&&otherContext?' la pièce n° '+otherContext.numero:' '+recordTitle(other));const row=node('div',label,'enq-relation enq-relation--'+({'Appuie':'supports','Contredit':'opposes'}[relation.nature]||'neutral'));row.append(button('Ouvrir la pièce liée',()=>openObject(other),'quiet'));if(canEdit(relation))row.append(actionMenu('Actions de la relation',[{label:'Modifier la relation',action:()=>openEditor(relation,'relations')},{label:'Retirer la relation',variant:'danger',action:()=>performAction(relation,'trash')}]).element);host.append(row);}
    host.append(button('+ Relier',()=>openLinkEditor(r),'quiet'),button('Ajouter une relation',()=>openEditor(null,'relations',null,{a:r.id}),'quiet'));
  }
  async function uploadFiles(r,files){
    const next=[...(r.files||[])];if(next.length+files.length>10)throw new Error('Dix fichiers maximum');busy=true;
    try{for(const file of files){status.textContent='Envoi de '+file.name;const uploaded=await client.upload(r.id,file,{onProgress:p=>{status.textContent='Envoi : '+Math.round(p*100)+' %';}});next.push(uploaded.id);}await client.save({type:r.type,id:r.id,zone:r.zone,baseRevision:r.revision,body:editableBody({...r,files:next})});status.textContent='Fichiers ajoutés.';}finally{busy=false;render();}
  }
  function renderLinks(r){
    const box=node('section','','enq-links');box.append(node('h4','Liens'));
    const links=state.records.filter(l=>l.type==='liens'&&(l.a===r.id||l.b===r.id));
    for(const l of links){const target=all().find(a=>a.id===(l.a===r.id?l.b:l.a)),row=node('div');row.append(target?button(target.nom||recordTitle(target),()=>openObject(target)):node('span','Pièce indisponible'));if(l.role)row.append(node('small',l.role));if(canEdit(l))row.append(button('Retirer le lien',()=>performAction(l,'trash'),'danger'));box.append(row);}
    box.append(button('Ajouter un lien',()=>openLinkEditor(r)));
    detail.append(box);
  }
  function actionMenu(label,items){
    const menu=createActionMenu({documentRef:d,label,items:items.map(item=>({...item,action:()=>{try{return Promise.resolve(item.action()).catch(showError);}catch(error){showError(error);}}}))});menus.push(menu);return menu;
  }
  function audienceLabel(r){return r.zone==='mj'?'secret MJ':r.zone?.startsWith('user:')?'personnel':'visible du groupe';}
  function objectActions(r,viewToken){
    const items=[{label:'Modifier',hidden:!canEdit(r),action:()=>openEditor(r,r.type)},
      {label:'Relier un objet',action:()=>openLinkEditor(r)}, {label:'Exporter',action:()=>exportSpace(r)},
      {label:'Voir l’historique',hidden:!canEdit(r)||r.zone.startsWith('user:'),action:async()=>{const history=await client.read('history',r.id);if(viewToken!==token)return;const dialog=node('dialog');dialog.setAttribute('aria-label','Historique');for(const event of history.items)dialog.append(node('p',event.action+' · révision '+event.revision));dialog.append(button('Fermer',()=>{dialog.close();dialog.remove();}));root.append(dialog);dialog.showModal();}},
      {label:'Mettre en corbeille',hidden:!canEdit(r),variant:'danger',action:()=>performAction(r,'trash')}];
    if(canEdit(r)&&r.type==='documents'){
      if(r.zone.startsWith('user:'))items.push({label:'Publier dans le groupe',action:()=>performAction(r,'visibility','commun')});
      if(isGm()&&!r.zone.startsWith('user:'))items.push({label:r.zone==='commun'?'Rendre secret':'Publier',action:()=>performAction(r,'visibility',r.zone==='commun'?'mj':'commun')});
      if(isGm()&&r.zone==='commun'&&r.authorUid!==state.session.uid)items.push({label:'Masquer chez son auteur',action:()=>performAction(r,'visibility','user:'+r.authorUid)});
    }
    if(r.type==='enquetes'){
      items.push({label:'Ajouter une relation',action:()=>openEditor(null,'relations',r)});
      if(isGm())items.push({label:'Ordonner les pièces',action:()=>orderDocuments(r)},{label:r.zone==='commun'?'Rendre secret':'Publier',action:()=>performAction(r,'visibility',r.zone==='commun'?'mj':'commun')});
    }
    if(layout==='mobile'&&r.type==='enquetes')items.push({label:'Tableau des liens',action:()=>graphDialog(r)});
    if(r.type==='notes')items.push({label:'Partager une copie',action:()=>openEditor(null,'documents',r,{titre:recordTitle(r),texte:r.texte,origine:'contribution',shareNote:r,zone:'commun'})});return items;
  }
  function renderDossier(r,viewToken){
    const header=node('header','','enq-dossier-header'),seal=node('div','','enq-seal enq-seal--'+({'En pause':'paused','Résolue':'solved'}[r.etat]||'open'));
    seal.setAttribute('role','img');seal.setAttribute('aria-label','État : '+(r.etat||'Ouverte'));seal.append(node('span',(r.etat||'Ouverte').toUpperCase()));
    const title=node('div');title.append(node('p','Dossier d’enquête · '+audienceLabel(r)+(r.archive?' · Archivée':''),'enq-eyebrow'),node('h3',recordTitle(r)));
    if(r.question)title.append(node('p','« '+r.question+' »','enq-question'));if(r.description)title.append(node('p',r.description));const tags=node('div');for(const tag of r.etiquettes||[])tags.append(node('span','#'+tag,'enq-badge'));title.append(tags);header.append(seal,title);detail.append(header);
    if(layout==='mobile'){renderMobileDossier(r,viewToken);return;}
    const actions=node('div','','enq-actions');actions.append(tabs([['dossier','Dossier'],['graph','Tableau des liens']],dossierTab,value=>{dossierTab=value;renderDetail();},'Vue du dossier'),button('Ajouter une pièce',()=>openEditor(null,'documents',r),'primary'),actionMenu('Actions du dossier',objectActions(r,viewToken)).element);detail.append(actions);
    if(dossierTab==='graph'){const host=node('div','','enq-graph');detail.append(host);showGraph(r,host).catch(showError);return;}
    if(r.etat==='Résolue'&&r.conclusion){const conclusion=node('section','','enq-conclusion');conclusion.append(node('h4','Conclusion'),textView(r.conclusion));detail.append(conclusion);}
    detail.append(renderPieces(r,viewToken));const lower=node('div','','enq-dossier-lower');lower.append(renderCast(r),renderTimeline(r));detail.append(lower);
    const others=state.records.filter(v=>v.type==='enquetes'&&v.id!==r.id&&linkedIds(r.id).has(v.id));if(others.length){const box=node('div','Dossiers liés : ');for(const other of others)box.append(button(recordTitle(other),()=>openObject(other),'quiet'));detail.append(box);}
  }
  function renderMobileDossier(r,viewToken){
    const pieces=dossierPieces(r,state.records,linksIndex),cast=dossierPnjs(r,state.records,state.pnjs),notes=linkedNotes(r,state.records,linksIndex),active=mobileTabs.get(r.id)||'pieces';
    detail.append(tabs([['pieces','Pièces '+pieces.length],['pnjs','PNJ '+cast.length],['timeline','Chronologie'],['notes','Mes notes '+notes.length]],active,value=>{mobileTabs.set(r.id,value);renderDetail();},'Contenu du dossier'));
    const panel=node('div','','enq-tab-panel');panel.setAttribute('role','tabpanel');panel.setAttribute('aria-label',{pieces:'Pièces',pnjs:'Personnages',timeline:'Chronologie',notes:'Mes notes'}[active]);
    if(active==='pieces')panel.append(renderPieces(r,viewToken));else if(active==='pnjs')panel.append(renderCast(r));else if(active==='timeline')panel.append(renderTimeline(r));else{renderNotebook();panel.append(notebook);}detail.append(panel);
  }
  function graphDialog(r){
    const anchor=d.activeElement,dialog=node('dialog','','enq-graph-dialog');dialog.setAttribute('aria-label','Tableau des liens');const host=node('div','','enq-graph');dialog.append(button('Fermer',()=>dialog.close()),host);dialog.addEventListener('close',()=>{graph?.stop();graph=null;dialog.remove();anchor?.focus();},{once:true});root.append(dialog);dialog.showModal();showGraph(r,host).catch(showError);
  }
  function renderPieces(r,viewToken){
    const box=node('section','','enq-pieces');box.append(node('h4','Pièces du dossier','enq-section-title'));if(r.ordre?.length)box.append(node('small','Ordre fixé par le MJ'));const grid=node('div','','enq-slips');
    for(const {record:doc,numero,relations} of dossierPieces(r,state.records,linksIndex)){
      const slip=button('',()=>openObject(doc));slip.className='enq-slip enq-slip--'+(numero%3);const top=node('span','','enq-slip-top');top.append(node('span','PIÈCE N° '+numero,'enq-slip-number'),node('span',doc.categorie||''));slip.append(top,node('strong',recordTitle(doc),'enq-slip-title'),node('span',doc.description||doc.texte||'','enq-slip-excerpt'));
      const annotations=state.records.filter(a=>a.type==='annotations'&&a.document===doc.id).length;slip.append(node('small',(doc.files?.length||0)+' fichier(s) · '+annotations+' annotation(s)'));if(doc.origine==='contribution')slip.append(node('small','Contribution'+(doc.authorName?' · '+doc.authorName:'')));
      for(const relation of relations)slip.append(node('span',relation.nature+' la pièce n° '+relation.autreNumero,'enq-relation enq-relation--'+({'Appuie':'supports','Contredit':'opposes'}[relation.nature]||'neutral')));if(doc.zone!==r.zone)slip.append(node('span',audienceLabel(doc),'enq-badge'));grid.append(slip);if(doc.files?.length)loadSlipImage(doc,slip,viewToken).catch(showError);
    }
    const add=button(layout==='mobile'?'Verser une pièce ou une photo':'Verser une pièce',()=>openEditor(null,'documents',r));add.className='enq-slip-add';grid.append(add);box.append(grid);return box;
  }
  async function loadSlipImage(doc,slip,viewToken){
    const files=await client.read('files',doc.id);if(viewToken!==token||!mounted)return;const first=files.items.find(f=>f.id===doc.files[0]);if(!first?.contentType.startsWith('image/'))return;
    const h=await client.objectUrl(first);if(viewToken!==token||!mounted){h.release();return;}handles.push(h);const image=node('img');image.src=h.url;image.alt='';image.loading='lazy';image.className='enq-slip-thumbnail';slip.append(image);
  }
  function renderCast(r){
    const box=node('section','','enq-cast');box.append(node('h4','Personnages','enq-section-title'));
    for(const {pnj,role,lien}of dossierPnjs(r,state.records,state.pnjs)){
      const row=node('div','','enq-cast-card'),open=button('',()=>onOpenPnj(pnj.id),'quiet'),portrait=node('span',pnj.nom.split(/\s+/u).map(v=>v[0]).slice(0,2).join(''),'enq-medallion');
      if(pnj.imageUrl?.startsWith('https://')){const image=node('img');image.src=pnj.imageUrl;image.alt='';portrait.replaceChildren(image);}const text=node('span');text.append(node('strong',pnj.nom),node('span',role,role==='Suspect'?'enq-suspect':'enq-secondary'));open.append(portrait,text);row.append(open);
      if(canEdit(lien))row.append(actionMenu('Actions du lien avec '+pnj.nom,[{label:'Retirer le lien',variant:'danger',action:()=>performAction(lien,'trash')}]).element);box.append(row);
    }
    box.append(button('Relier un personnage',()=>openLinkEditor(r,'pnjs'),'quiet'));return box;
  }
  function renderTimeline(r){
    const box=node('section','','enq-timeline');box.append(node('h4','Chronologie','enq-section-title'));const list=node('ol');for(const e of dossierTimeline(r,state.records)){
      const row=node('li');row.append(node('p',[e.repere,e.dateSession?'Session '+e.dateSession:'',e.dateUnivers].filter(Boolean).join(' · '),'enq-eyebrow'),node('h5',e.titre||e.repere),textView(e.texte));if(e.zone.startsWith('user:'))row.append(node('small','Événement privé'));
      if(canEdit(e))row.append(actionMenu('Actions de l’événement '+(e.titre||e.repere),[{label:'Modifier',action:()=>openEditor(e,'evenements')},{label:'Retirer',variant:'danger',action:()=>performAction(e,'trash')}]).element);list.append(row);
    }box.append(list,button('Ajouter un événement',()=>openEditor(null,'evenements',r),'quiet'));return box;
  }
  function highlightAnnotation(id){
    for(const [key,row]of annotationRows)row.setAttribute('data-highlight',String(key===id));
    for(const [key,markers]of annotationMarkers)for(const marker of markers)marker.setAttribute('data-highlight',String(key===id));
  }
  function imagePins(f,r,imageBox){
    const overlay=node('div','','enq-image-overlay');imageBox.append(overlay);
    state.records.filter(a=>a.type==='annotations'&&a.document===r.id&&a.fileId===f.id).forEach((a,i)=>{
      const marker=button(String(i+1),()=>{highlightAnnotation(a.id);annotationRows.get(a.id)?.focus();annotationRows.get(a.id)?.scrollIntoView?.({block:'nearest'});});marker.className='enq-marker'+(a.zone.startsWith('user:')?' enq-marker--private':'');marker.setAttribute('aria-label','Annotation '+(i+1)+' : '+(a.texte||'Sans texte'));
      const anchor=node('div','','enq-pin-anchor');anchor.style.left=(a.x*100)+'%';anchor.style.top=(a.y*100)+'%';if(a.width&&a.height){anchor.style.width=(a.width*100)+'%';anchor.style.height=(a.height*100)+'%';anchor.classList.add('enq-marker-zone');}anchor.append(marker);overlay.append(anchor);
      if(!annotationMarkers.has(a.id))annotationMarkers.set(a.id,[]);annotationMarkers.get(a.id).push(marker);marker.addEventListener('focus',()=>highlightAnnotation(a.id));
    });
  }
  async function zoomFile(f,r,trigger){
    const viewToken=token,h=await client.objectUrl(f);if(viewToken!==token||!mounted){h.release();return;}
    const dialog=node('dialog','','enq-zoom');dialog.setAttribute('aria-label','Agrandissement : '+f.name);const image=node('img');image.src=h.url;image.alt=f.name;const box=node('div','','enq-image-box');box.append(image);imagePins(f,r,box);
    let released=false;const close=()=>{if(released)return;released=true;h.release();dialog.remove();trigger?.focus();};dialog.addEventListener('close',close,{once:true});handles.push({release:()=>{dialog.close();close();}});
    dialog.append(button('Fermer',()=>dialog.close()),box);root.append(dialog);dialog.showModal();
  }
  async function showFile(f,r,host,viewToken){
    const h=await client.objectUrl(f);if(!mounted||viewToken!==token){h.release();return;}handles.push(h);
    const wrap=node('figure','','enq-file'),bar=node('div','','enq-viewer-toolbar');wrap.append(bar);
    const download=node('a','Télécharger','enq-button enq-button--quiet');download.href=h.url;download.download=f.name;
    if(f.contentType.startsWith('image/')){
      const image=node('img');image.src=h.url;image.alt=f.name;const imageBox=node('div','','enq-image-box');imageBox.append(image);wrap.append(imageBox);imagePins(f,r,imageBox);
      const mode=button('Mode annotation',()=>{annotationMode=!annotationMode;mode.setAttribute('aria-pressed',String(annotationMode));help.hidden=!annotationMode;});mode.setAttribute('aria-pressed',String(annotationMode));const help=node('small','Clique sur l’image pour placer une annotation.');help.hidden=!annotationMode;
      const enlarge=button('Agrandir',()=>zoomFile(f,r,enlarge));bar.append(mode,help,enlarge,download);
      image.addEventListener('click',event=>{if(!annotationMode){zoomFile(f,r,enlarge).catch(showError);return;}const rect=image.getBoundingClientRect();openEditor(null,'annotations',null,{document:r.id,fileId:f.id,version:f.version,x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height)),width:0,height:0});});
    }else if(f.contentType==='application/pdf'){bar.append(download);const frame=node('iframe');frame.title=f.name;frame.src=h.url;frame.className='enq-pdf';wrap.append(frame);}
    else {bar.append(download);const blob=await client.blob(f);if(viewToken===token)wrap.append(textView(await blob.text()));}
    if(viewToken===token)host.append(wrap);
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
        const result=type==='notes'?await saveNote({id:recordId,uid,body:next,baseRevision:pending.baseRevision,operationId:pending.operationId}):await client.save({type,id:recordId,zone,body:next,baseRevision:pending.baseRevision,operationId:pending.operationId});
        captured.revision=result.revision;captured.operationId=client.newId();captured.pending=null;persist();
        if(publish)await client.action({id:recordId,type,revision:result.revision},'visibility','commun');
        if(linkedContext&&!captured.linked){await addLink(recordId,linkedContext.id,type==='notes'?`user:${uid}`:publish?'commun':zone);captured.linked=true;}
        if(type==='notes')for(const target of resumed?.links||[])if(all().some(r=>r.id===target))await addLink(recordId,target,'user:'+uid);
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
    const submit=node('button','Enregistrer','enq-button enq-button--primary');submit.type='submit';const footer=node('div','','enq-editor-footer');footer.append(submit,button('Fermer en conservant le brouillon',()=>{persist();closeEditor();}));form.append(footer);
    form.addEventListener('submit',e=>{e.preventDefault();save();});syncMobileScreen();detail.append(form);form.querySelector('input,textarea,select')?.focus();
  }
  async function addLink(a,b,zone,role=''){
    const existing=state.records.find(r=>r.type==='liens'&&r.zone===zone&&((r.a===a&&r.b===b)||(r.a===b&&r.b===a)));
    if(existing)return existing;
    try{return await client.save({type:'liens',body:{a,b,role},zone});}catch(error){if(error.code?.includes('already-exists'))return {exists:true};throw error;}
  }
  function openLinkEditor(r,onlyType=null){
    const dialog=node('dialog'),form=node('form'),select=node('select');select.setAttribute('aria-label','Objet à relier');
    const compatible={documents:['enquetes','pnjs','notes'],enquetes:['documents','pnjs','notes'],notes:['documents','enquetes','pnjs'],pnjs:['documents','enquetes','notes']}[r.type]||[];
    for(const target of all().filter(t=>t.id!==r.id&&compatible.includes(t.type)&&(!onlyType||t.type===onlyType))){const o=node('option',target.nom||recordTitle(target));o.value=target.id;select.append(o);}
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
    graph?.stop();host.replaceChildren();const ids=linkedIds(r.id),nodes=all().filter(v=>ids.has(v.id)&&['documents','pnjs','notes','enquetes'].includes(v.type)).map(v=>({id:v.id,label:v.nom||recordTitle(v),type:v.type}));
    const links=state.records.filter(v=>['liens','relations'].includes(v.type)&&ids.has(v.a)&&ids.has(v.b)).map(v=>({source:v.a,target:v.b}));
    const layout=state.records.find(v=>v.type==='dispositions'&&v.enquete===r.id);for(const n of nodes){const pos=layout?.positions?.[n.id];if(pos){n.x=pos[0];n.y=pos[1];}}
    const svg=select(host).append('svg').attr('viewBox','0 0 800 500').attr('role','img').attr('aria-label','Graphe personnel des pièces et personnages');const lines=svg.append('g').selectAll('line').data(links).join('line').attr('stroke','currentColor');
    const dots=svg.append('g').selectAll('g').data(nodes).join('g');dots.append('circle').attr('r',12).attr('fill',n=>'var('+({documents:'--enq-paper',pnjs:'--enq-accent',notes:'--enq-state-paused',enquetes:'--enq-wax'}[n.type]||'--enq-accent')+')');dots.append('text').attr('x',16).attr('fill','currentColor').text(n=>n.label.slice(0,30));
    graph=forceSimulation(nodes).force('link',forceLink(links).id(n=>n.id).distance(140)).force('charge',forceManyBody().strength(-500)).force('center',forceCenter(400,250));
    dots.call(drag().on('start',(event,n)=>{n.fx=n.x;n.fy=n.y;}).on('drag',(event,n)=>{n.fx=event.x;n.fy=event.y;graph.alpha(.3).restart();}).on('end',()=>{})).on('click',(_,n)=>openObject(all().find(v=>v.id===n.id)));
    graph.on('tick',()=>{lines.attr('x1',l=>l.source.x).attr('y1',l=>l.source.y).attr('x2',l=>l.target.x).attr('y2',l=>l.target.y);dots.attr('transform',n=>`translate(${n.x},${n.y})`);});
    host.prepend(button('Enregistrer ma disposition',async()=>{const positions=Object.fromEntries(nodes.map(n=>[n.id,[n.x,n.y]]));await client.save({type:'dispositions',id:layout?.id,zone:`user:${state.session.uid}`,baseRevision:layout?.revision||0,body:{enquete:r.id,positions}});status.textContent='Disposition personnelle enregistrée.';}));
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
      if(mounted||signal?.aborted)return;mounted=true;build();d.addEventListener('keydown',searchShortcut);
      const runtime=await loadRuntime();if(!mounted||signal?.aborted)return;
      client=runtime.createEnqueteClient({onChange:next=>{if(editor&&(!next.session||next.session.uid!==editor.uid||!editor.zone.startsWith('user:')&&(!next.session.active||next.session.maintenance&&!busy||next.session.role==='ancien'))){editor=null;if(timer)globalThis.clearTimeout(timer);timer=null;detailSignature='';}if(!next.session||next.session.uid!==state.session?.uid||next.session.maintenance)for(const dialog of root.querySelectorAll('dialog'))if(dialog.open&&(!next.session||next.session.uid!==state.session?.uid||!dialog.className.includes('enq-quick-sheet'))){dialog.close();dialog.remove();}if(layout==='mobile'&&next.session?.uid!==state.session?.uid){if(mobileSpace.uid===next.session?.uid){({section,filter,category,search,scope}=mobileSpace);}else{mobileSpace={uid:next.session?.uid,section:'enquetes',filter:'',category:'',search:'',scope:''};mobileTabs.clear();mobileContexts.clear();contextDossier=null;}}state=next;linksIndex=buildLinksIndex(next.records);if(selected&&!legacyResolved&&next.session?.active&&client){legacyResolved=true;client.read('resolveLegacy',selected).then(result=>{if(mounted&&result.id){selected=result.id;render();}}).catch(()=>{});}if(selected&&!editor){const found=next.records.find(r=>r.id===selected);if(found&&['documents','enquetes','notes'].includes(found.type))section=found.type;}render();if(!initialOpened&&initialAction&&next.session?.active&&(initialAction==='new'||current())){initialOpened=true;openEditor(initialAction==='edit'?current():null,current()?.type||'enquetes');}},onError:showError});
      Object.assign(client,{newId:runtime.newEnqueteId,saveDraft:runtime.saveEnqueteDraft,readDraft:runtime.readEnqueteDraft,removeDraft:runtime.removeEnqueteDraft,listDrafts:runtime.listEnqueteDrafts});
      signal?.addEventListener('abort',()=>this.unmount(),{once:true});
    },
    openMenu(anchor){const r=current();if(!r||editor)return;const menu=actionMenu(r.type==='enquetes'?'Actions du dossier':'Actions de la pièce',objectActions(r,token));menu.element.className+=' enq-header-menu';menu.element.firstChild.hidden=true;root.append(menu.element);menu.open(anchor);},
    menuLabel(){return current()?.type==='enquetes'?'Actions du dossier':'Actions de la pièce';},
    beforeLeave(){return !busy&&(!editor||globalThis.confirm('Quitter en conservant le brouillon local ?'));},
    unmount(){for(const dialog of root?.querySelectorAll('dialog')||[])if(dialog.open)dialog.close();mounted=false;d.removeEventListener('keydown',searchShortcut);++token;if(timer)globalThis.clearTimeout(timer);release();client?.close();editor=null;container.replaceChildren();}
  };
}
















