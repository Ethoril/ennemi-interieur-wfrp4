export const ENQUETE_PROTOCOL = 1;
export const TYPES = Object.freeze(['documents','enquetes','notes','liens','relations','evenements','annotations','dispositions']);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const CHARACTERS = Object.freeze(['bhelgi','caelel','elysia','hellaya','wren']);
export class EnqueteError extends Error {
  constructor(message, code = 'invalid-argument', details = {}) { super(message); this.code = code; this.details = details; }
}
export function requireValue(condition, message, code) { if (!condition) throw new EnqueteError(message, code); }
export function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value); }
export function zonePath(zone, type, id) {
  requireValue(TYPES.includes(type) && validId(id), 'Identifiant invalide');
  requireValue(['commun','mj'].includes(zone) || /^user:[A-Za-z0-9_-]{1,128}$/u.test(zone), 'Espace invalide');
  return zone.startsWith('user:') ? `enq_users/${zone.slice(5)}/${type}/${id}` : `enq_${zone}/data/${type}/${id}`;
}
export function identity(auth) {
  requireValue(auth?.uid && auth.token?.email_verified === true && typeof auth.token.email === 'string', 'Connexion Google vérifiée requise', 'unauthenticated');
  return { uid: auth.uid, email: auth.token.email.toLowerCase(), gm: auth.token.email.toLowerCase() === 'ethoril@gmail.com' };
}
export function member(user, access) { return user.gm || CHARACTERS.some(id => (access?.[id] || []).includes(user.email)); }
export function canRead(user, zone, access) { return zone === `user:${user.uid}` || (member(user,access) && (zone === 'commun' || (zone === 'mj' && user.gm))); }
export function restrictiveZone(zones, user) {
  const owners = [...new Set(zones.filter(z => z.startsWith('user:')))];
  requireValue(owners.length <= 1 && (!owners.length || owners[0] === `user:${user.uid}`), 'Association personnelle interdite', 'permission-denied');
  if (owners.length) return owners[0];
  return zones.includes('mj') ? 'mj' : 'commun';
}
export function fold(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase(); }
function text(value, max, required = false) {
  requireValue(typeof value === 'string' && value.length <= max && (!required || value.trim()), 'Texte invalide');
  return value.trim();
}
function ids(value, max = 100) {
  requireValue(Array.isArray(value) && value.length <= max && value.every(validId), 'Références invalides');
  return [...new Set(value)];
}
export function normalizeRecord(type, input) {
  requireValue(TYPES.includes(type) && input && typeof input === 'object' && !Array.isArray(input), 'Contenu invalide');
  const common = ['titre','texte','description','etiquettes'];
  const extras = { documents:['categorie','origine','provenance','files'], enquetes:['question','etat','archive','conclusion','ordre'],
    notes:[], liens:['a','b','role','ordre'], relations:['a','b','nature'], evenements:['enquete','repere','dateSession','dateUnivers','ordre','documents','pnjs'],
    annotations:['document','fileId','version','x','y','width','height'], dispositions:['enquete','positions'] }[type];
  requireValue(Object.keys(input).every(key => [...common,...extras].includes(key)), 'Champ non autorisé');
  const result = {};
  for (const k of ['titre','description','texte']) if (k in input) result[k] = text(input[k], k === 'texte' ? 100000 : k === 'titre' ? 200 : 2000);
  if (['documents','enquetes'].includes(type)) result.titre = text(input.titre,200,true);
  if (type === 'notes') result.texte = text(input.texte,100000,true);
  if ('etiquettes' in input) {
    requireValue(Array.isArray(input.etiquettes) && input.etiquettes.length <= 30, 'Étiquettes invalides');
    result.etiquettes = [...new Set(input.etiquettes.map(v=>text(v,60,true)))];
  }
  for (const k of ['a','b','enquete','document','fileId']) if (k in input) { requireValue(validId(input[k]),'Référence invalide'); result[k]=input[k]; }
  for (const k of ['question','conclusion','provenance','repere','dateSession','dateUnivers','role']) if (k in input) result[k]=text(input[k],k==='conclusion'?100000:2000);
  const enums = { categorie:['Lettre','Témoignage','Carte','Illustration','Rapport','Autre'], origine:['piece','contribution'],
    etat:['Ouverte','En pause','Résolue'], nature:['Appuie','Contredit','Complète','Renvoie à'] };
  for (const [k,values] of Object.entries(enums)) if (k in input) { requireValue(values.includes(input[k]),'Choix invalide'); result[k]=input[k]; }
  if ('archive' in input) { requireValue(typeof input.archive === 'boolean','Archivage invalide'); result.archive=input.archive; }
  for (const k of ['ordre','x','y','width','height','version']) if (k in input && !Array.isArray(input[k])) {
    requireValue(typeof input[k] === 'number' && Number.isFinite(input[k]),'Position invalide');
    if (['x','y','width','height'].includes(k)) requireValue(input[k]>=0 && input[k]<=1,'Zone d’annotation invalide');
    if (k === 'version') requireValue(Number.isSafeInteger(input[k]) && input[k]>0,'Version invalide');
    result[k]=input[k];
  }
  if (type === 'enquetes' && 'ordre' in input) result.ordre=ids(input.ordre,1000);
  for (const k of ['documents','pnjs']) if (k in input) result[k]=ids(input[k]);
  if ('positions' in input) {
    requireValue(input.positions && typeof input.positions==='object' && Object.keys(input.positions).length<=1000,'Disposition invalide');
    result.positions=Object.fromEntries(Object.entries(input.positions).map(([key,pos])=>{
      requireValue(validId(key) && Array.isArray(pos) && pos.length===2 && pos.every(v=>Number.isFinite(v)&&Math.abs(v)<=100000),'Position invalide');
      return [key,pos];
    }));
  }
  if ('files' in input) {
    requireValue(Array.isArray(input.files)&&input.files.length<=10&&input.files.every(validId),'Fichiers invalides');
    result.files=[...input.files];
  }
  if (type === 'liens' || type === 'relations') requireValue(result.a && result.b && result.a!==result.b,'Deux extrémités distinctes requises');
  if (type === 'annotations') requireValue(result.document && result.fileId && result.version && result.x!==undefined && result.y!==undefined,'Annotation incomplète');
  if (type === 'evenements' || type === 'dispositions') requireValue(result.enquete,'Enquête requise');
  return result;
}
export function references(type, value) {
  if (type === 'liens' || type === 'relations') return [value.a,value.b];
  if (type === 'annotations') return [value.document];
  if (type === 'evenements') return [value.enquete,...(value.documents||[]),...(value.pnjs||[])];
  if (type === 'dispositions') return [value.enquete,...Object.keys(value.positions||{})];
  if (type === 'enquetes') return value.ordre||[];
  return [];
}
export function recordTitle(record) { return record.titre || record.texte?.split('\n')[0]?.slice(0,100) || record.repere || record.nature || 'Sans titre'; }
export function buildSearch(records, query, scopeIds = null) {
  const q=fold(query);
  return records.filter(r=>(!scopeIds || scopeIds.has(r.id)) && fold([recordTitle(r),r.texte,r.description,...(r.etiquettes||[])].join(' ')).includes(q));
}

