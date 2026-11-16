import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { createBureauData } from './bureau-data.js';
import { esc } from './utils.js';
import { campaignPlaces, initialCampaign, effectiveEvents, eventPresences, isAt, findNextPresence, findOverlaps, suggestPnjMatches, validateSource, validateCampaign, CAMPS, ATTITUDES, holderTally, holderOfCharacter, introductionsFor } from './carnaval-model.js';
import { MIDDENHEIM_MAP } from './middenheim-map.js';

const $ = (selector, root = document) => root.querySelector(selector);
const minuteText = value => { if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'Horaire non précisé'; const minute = Number(value); return `${String(Math.floor(minute / 60) % 24).padStart(2, '0')} h${String(minute % 60).padStart(2, '0')}${minute >= 1440 ? ' (nuit suivante)' : ''}`; };
const absoluteTime = value => { const day = Math.floor(value / 1440) + 1; return day > 8 ? `Nuit suivant ${dayLabel(8)}, ${minuteText(value % 1440)}` : `${dayLabel(day)}, ${minuteText(value % 1440)}`; };
const state = { admin: false, onlineReady: false, streamsReady: {}, clockSeeded: false, drawerReturnTarget: null, bureau: null, source: null, campaign: null, pnjs: [], relations: [], pnjPrivate: new Map(), view: 'day', selectedCharacter: '', selectedPlace: '', selectedDay: 1, placeDay: 'all', selectedMinute: 480, showSecrets: true, showRendezvous: true, metFilter: 'all', campFilter: 'all', eventId: null, linkCharacterId: null, generation: 0, unsubs: [], privateUnsub: null, map: null, markerById: new Map(), imageReleases: new Map(), focusedCharacter: '' };
let authUnsubscribe = null;

// Pendant un dialogue modal, la zone principale est inerte : le message est aussi écrit dans la zone du dialogue ouvert.
function setStatus(message = '', kind = '') { for (const target of [$('#carnaval-status'), document.querySelector('dialog[open] [data-dialog-status]')]) { if (!target) continue; target.textContent = message; if (kind) target.dataset.kind = kind; else delete target.dataset.kind; } }
function clearDialogStatus(dialog) { dialog.querySelectorAll('[data-dialog-status]').forEach(target => { target.textContent = ''; delete target.dataset.kind; }); }
function setGate(text, allowLogin = true) { const gate = $('#carnaval-gate'); gate.hidden = false; gate.innerHTML = `<h2>Accès MJ</h2><p>${esc(text)}</p>${allowLogin ? '<button class="btn-primary" id="gate-login">Connexion MJ</button>' : ''}`; $('#gate-login')?.addEventListener('click', () => void doLogin()); }
function showOfflineLock(message) { $('#carnaval-offline-message').textContent = message; $('#carnaval-offline').hidden = false; $('#carnaval-app').hidden = true; }
async function doLogin() { try { await loginWithGoogle(); } catch (error) { if (error?.code !== 'auth/popup-closed-by-user') setStatus('Connexion impossible. Réessayez lorsque le réseau est disponible.', 'error'); } }
function clearPrivateState() {
  state.generation += 1; state.unsubs.forEach(unsub => unsub?.()); state.unsubs = []; state.privateUnsub?.(); state.privateUnsub = null;
  state.imageReleases.forEach(release => release?.()); state.imageReleases.clear();
  const previous = state.bureau; state.bureau = null; void previous?.close?.();
  state.source = null; state.campaign = null; state.pnjs = []; state.relations = []; state.pnjPrivate.clear(); state.onlineReady = false; state.clockSeeded = false; state.streamsReady = {}; state.selectedCharacter = ''; state.selectedPlace = ''; state.selectedDay = 1; state.placeDay = 'all'; state.selectedMinute = 480; state.view = 'day'; state.showSecrets = true; state.showRendezvous = true; $('#show-rendezvous').checked = true; state.metFilter = 'all'; state.campFilter = 'all'; $('#met-filter').value = 'all'; $('#camp-filter').value = 'all'; state.eventId = null; state.linkCharacterId = null;
  $('#carnaval-app').hidden = true; $('#carnaval-import').hidden = true; closeDrawer(); if ($('#event-dialog').open) $('#event-dialog').close(); if ($('#link-dialog').open) $('#link-dialog').close(); if ($('#holders-dialog').open) $('#holders-dialog').close();
  $('#carnaval-offline').hidden = true; $('#court-tally-text').textContent = ''; $('#holders-list').replaceChildren(); $('#holder-form').hidden = true; $('#holder-form').reset();
  $('#event-list').replaceChildren(); $('#overlap-list').replaceChildren(); $('#next-encounter').replaceChildren();
  $('#source-file').value = ''; $('#source-import').disabled = true; $('#event-form').reset(); $('#link-form').reset(); $('#presence-editor').replaceChildren();
  $('#event-form').elements.day.replaceChildren(); $('#event-form').elements.placeId.replaceChildren(); $('#link-pnj-select').replaceChildren(); $('#link-character-name').textContent = ''; $('#link-suggestions').replaceChildren();
  $('#day-select').replaceChildren(); $('#clock-day').replaceChildren(); $('#time-select').replaceChildren(); $('#clock-time').replaceChildren();
  $('#place-filter').innerHTML = '<option value="">Tous les lieux</option>'; $('#character-filter').innerHTML = '<option value="">Tous les PNJ</option>'; $('#place-day-filter').innerHTML = '<option value="all">Tous les jours</option>';
  $('#program-heading').textContent = 'Programme du jour'; $('#clock-label').textContent = ''; $('#campaign-warnings').replaceChildren(); $('#campaign-warnings').hidden = true; $('#time-unknown-hint').hidden = true; setStatus(); document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-selected',String(button.dataset.view === 'day')));
  if (state.map) { state.map.remove(); state.map = null; } state.markerById.clear(); state.mapMarkers = null; state.mapCircles = [];
}
function handleAuth(_user, isAdmin) {
  const changed = state.admin !== isAdmin; state.admin = isAdmin; $('#carnaval-auth').textContent = isAdmin ? '🔓 Déconnexion MJ' : '🔑 Connexion MJ';
  if (!isAdmin) {
    if (changed || state.bureau) clearPrivateState();
    setGate('Le Carnaval, les présences, les fiches et les notes sont réservés au compte MJ.'); return;
  }
  $('#carnaval-gate').hidden = true;
  if (changed || !state.bureau) connectBureau();
}
async function connectBureau() {
  clearPrivateState(); const generation = state.generation; state.admin = true; $('#carnaval-gate').hidden = true; showOfflineLock('Connexion sécurisée aux données du MJ en cours…');
  if (navigator.onLine === false) { showOfflineLock('Connexion indisponible. Le Carnaval nécessite une connexion au serveur.'); return; }
  try { state.bureau = createBureauData({ isAdmin: true }); }
  catch { setStatus('Initialisation des dépôts impossible. Vérifiez la connexion puis actualisez.', 'error'); return; }
  const repo = state.bureau.carnaval;
  if (!repo) { setStatus('Le dépôt Carnaval n’est pas disponible sur cette version du site.', 'error'); showOfflineLock('Le dépôt Carnaval est indisponible sur cette version.'); return; }
  const ready = (name, metadata) => { if (metadata?.fromCache === true || metadata?.hasPendingWrites === true) { readError(name,{ code:'cache-only' }); return false; } state.streamsReady[name] = true; if (['source','campaign','pnjs','relations'].every(key => state.streamsReady[key])) { state.onlineReady = true; $('#carnaval-offline').hidden = true; $('#carnaval-app').hidden = false; render(); ensureMap(); } return true; };
  const readError = (stream,error) => { if (generation !== state.generation || !state.admin) return; if (error?.code === 'permission-denied') state.streamsReady = {}; else delete state.streamsReady[stream]; state.onlineReady = false; $('#carnaval-app').hidden = true; closeDrawer(); if ($('#event-dialog').open) $('#event-dialog').close(); if ($('#link-dialog').open) $('#link-dialog').close(); if ($('#holders-dialog').open) $('#holders-dialog').close(); showOfflineLock(error?.code === 'permission-denied' ? 'Le serveur a refusé la lecture des données MJ.' : 'Connexion aux données privées indisponible. Le contenu n’est pas consultable hors ligne.'); setStatus('Lecture indisponible. Vérifiez la connexion ; les changements non confirmés ne sont pas sauvegardés.', 'error'); };
  const streamError = stream => error => readError(stream,error);
  state.unsubs.push(repo.subscribeSource((source, metadata) => { if (!state.admin || generation !== state.generation || !ready('source',metadata)) return; if (source) { const validation = validateSource(source); if (!validation.valid) { setStatus(`Source invalide : ${validation.errors.map(item => item.message).join(' · ')}`, 'error'); return; } } state.source = source; if (!source) { $('#carnaval-import').hidden = false; setStatus('Source du calendrier absente. Initialisez-la à partir du fichier local fourni au MJ.'); } else { const campaignValidation = state.campaign && validateCampaign(state.campaign,source); if (campaignValidation && !campaignValidation.valid) setStatus(`Suivi invalide : ${campaignValidation.errors.map(item => item.message).join(' · ')}`, 'error'); $('#carnaval-import').hidden = true; } refreshControls(); render(); }, streamError('source')));
  state.unsubs.push(repo.subscribeCampaign((campaign, metadata) => { if (!state.admin || generation !== state.generation || !ready('campaign',metadata)) return; state.campaign = campaign || initialCampaign(); if (!state.clockSeeded) { state.selectedDay = state.campaign.clock.day; state.selectedMinute = state.campaign.clock.minute; state.clockSeeded = true; } const validation = validateCampaign(state.campaign,state.source); if (!validation.valid) setStatus(`Suivi invalide : ${validation.errors.map(item => item.message).join(' · ')}`, 'error'); else setStatus('Données synchronisées.', 'success'); refreshControls(); render(); }, streamError('campaign')));
  state.unsubs.push(state.bureau.pnjs.subscribeAll((pnjs,metadata) => { if (!state.admin || generation !== state.generation || !ready('pnjs',metadata)) return; state.pnjs = pnjs || []; refreshControls(); render(); renderDrawerIfOpen(); }, streamError('pnjs')));
  state.unsubs.push(state.bureau.relations.subscribeAll((relations,metadata) => { if (!state.admin || generation !== state.generation || !ready('relations',metadata)) return; state.relations = relations || []; renderDrawerIfOpen(); }, streamError('relations')));
}

function timeOptions(selected = 480, withNight = true, allowUnknown = false, unknownLabel = 'Horaire non précisé') { const max = withNight ? 1800 : 1439; const values = allowUnknown ? [`<option value=""${selected === null || selected === '' ? ' selected' : ''}>${unknownLabel}</option>`] : []; for (let minute = 0; minute <= max; minute += 1) values.push(`<option value="${minute}"${selected !== '' && selected !== null && minute === Number(selected) ? ' selected' : ''}>${minuteText(minute)}</option>`); return values.join(''); }
function dayLabel(day) { return state.source?.days?.find(item => Number(item.id) === Number(day))?.name || `Jour ${day}`; }
function refreshControls() {
  if (!state.source) return;
  const days = state.source.days || [];
  const dayOptions = days.map(day => `<option value="${esc(day.id)}">${esc(day.id)} — ${esc(day.name)}</option>`).join('');
  $('#day-select').innerHTML = dayOptions; $('#day-select').value = String(state.selectedDay);
  $('#clock-day').innerHTML = dayOptions; $('#clock-day').value = String(state.campaign?.clock?.day || 1);
  $('#time-select').innerHTML = timeOptions(state.selectedMinute); $('#clock-time').innerHTML = timeOptions(state.campaign?.clock?.minute ?? 480);
  $('#place-filter').innerHTML = '<option value="">Tous les lieux</option>' + places().map(place => `<option value="${esc(place.id)}">${esc(place.name)}</option>`).join(''); if (state.selectedPlace && !places().some(place => place.id === state.selectedPlace)) state.selectedPlace = ''; $('#place-filter').value = state.selectedPlace;
  $('#place-day-filter').innerHTML = '<option value="all">Tous les jours</option>' + days.map(day => `<option value="${esc(day.id)}">${esc(day.id)} — ${esc(day.name)}</option>`).join(''); $('#place-day-filter').value = state.placeDay;
  $('#camp-filter').innerHTML = '<option value="all">Tous les camps</option>' + CAMPS.map(camp => `<option value="${esc(camp.id)}">${esc(camp.label)}</option>`).join('') + '<option value="none">Sans détenteur</option>'; $('#camp-filter').value = state.campFilter;
  const shown = state.source.characters.filter(characterShown); if (state.selectedCharacter && !shown.some(character => character.id === state.selectedCharacter)) state.selectedCharacter = '';
  $('#character-filter').innerHTML = '<option value="">Tous les PNJ</option>' + shown.map(character => `<option value="${esc(character.id)}">${esc(character.name)}${state.campaign?.tracking?.[character.id]?.met ? ' (rencontré)' : ''}</option>`).join(''); $('#character-filter').value = state.selectedCharacter;
}
// Les filtres de suivi ne jouent que dans la vue PNJ : hors de cette vue ils sont masqués et ne doivent pas réduire la liste en silence.
function characterShown(character) {
  if (state.view !== 'character') return true;
  const met = Boolean(state.campaign?.tracking?.[character.id]?.met);
  if (state.metFilter === 'met' && !met) return false; if (state.metFilter === 'unmet' && met) return false;
  const holder = holderOfCharacter(state.campaign,character.id);
  if (state.campFilter === 'none') return !holder; return state.campFilter === 'all' || holder?.camp === state.campFilter;
}
const events = () => !state.source || !state.campaign ? [] : effectiveEvents(state.source, state.campaign);
const characterById = id => state.source?.characters.find(character => character.id === id);
// Lieux du programme source et lieux libres du suivi : un seul point de résolution pour tous les noms affichés.
const places = () => campaignPlaces(state.source, state.campaign);
const placeById = id => places().find(place => place.id === id);
const pnjById = id => state.pnjs.find(pnj => pnj.id === id);
function linkedPnj(characterId) { const id = state.campaign?.links?.[characterId]; return id ? pnjById(id) : null; }
function render() { if (!state.admin || !state.onlineReady || !state.source || !state.campaign) return; renderEvents(); renderNext(); renderOverlaps(); renderWarnings(); updatePins(); renderTally(); if ($('#holders-dialog').open) renderHolders(); }
function currentAbsolute() { return (Number(state.selectedDay) - 1) * 1440 + Number(state.selectedMinute); }
function eventAbsolute(event, minute) { return (Number(event.day) - 1) * 1440 + minute; }
function eventVisible(event) {
  if (event.kind === 'secret' && !state.showSecrets) return false;
  if (event.kind === 'rendezvous' && !state.showRendezvous) return false;
  const presenceIds = eventPresences(event).map(item => item.characterId);
  if (state.selectedPlace && event.placeId !== state.selectedPlace) return false;
  if (state.selectedCharacter && !presenceIds.includes(state.selectedCharacter)) return false;
  if (state.view === 'day' && Number(event.day) !== Number(state.selectedDay)) return false;
  if (state.view === 'place' && state.placeDay !== 'all' && Number(event.day) !== Number(state.placeDay)) return false;
  if (state.view === 'place' && state.selectedPlace && event.placeId !== state.selectedPlace) return false;
  if (state.view === 'character' && state.selectedCharacter && !presenceIds.includes(state.selectedCharacter)) return false;
  if ($('#filter-current-time').checked) {
    const eventNow = atSelectedMinute(event,event.start,event.end);
    const presenceNow = eventPresences(event).some(presence => atSelectedMinute(event,presence.start,presence.end));
    if (!eventNow && !presenceNow) return false;
  }
  return true;
}
function atSelectedMinute(event,start,end) {
  if (!Number.isInteger(start)) return false;
  if (!Number.isInteger(end)) return end === null && state.selectedMinute === start;
  return state.selectedMinute >= start && state.selectedMinute < end;
}
function scheduleLabel(event) {
  if (event.start === null && event.end === null) return 'Horaire non précisé';
  if (Number.isInteger(event.start) && event.end === null) return `Vers ${minuteText(event.start)}, durée non précisée`;
  if (event.start === null && Number.isInteger(event.end)) return `Horaire non précisé · fin vers ${minuteText(event.end)}`;
  return `${minuteText(event.start)} – ${minuteText(event.end)}`;
}
function presenceTimeLabel(presence) {
  if (Number.isInteger(presence.start) && presence.end === null) return `vers ${minuteText(presence.start)}, durée non précisée`;
  if (presence.start === null && presence.end === null) return 'horaire non précisé';
  if (presence.start === null) return `horaire non précisé · fin vers ${minuteText(presence.end)}`;
  return `${minuteText(presence.start)}–${minuteText(presence.end)}`;
}
function renderEvents() {
  const list = $('#event-list'); let shown = events().filter(eventVisible);
  shown.sort((a,b) => (Number(a.day)-Number(b.day)) || ((Number.isInteger(a.start) ? a.start : Infinity)-(Number.isInteger(b.start) ? b.start : Infinity)) || String(a.title).localeCompare(String(b.title),'fr'));
  $('#program-heading').textContent = state.view === 'day' ? `Programme — ${dayLabel(state.selectedDay)}` : state.view === 'place' ? 'Programme par lieu' : 'Programme par PNJ';
  $('#place-day-filter-wrap').hidden = state.view !== 'place'; $('#character-tracking-filters').hidden = state.view !== 'character';
  const cancelled = (state.source.events || []).filter(event => state.campaign.overrides?.[event.id]?.cancelled && (state.view !== 'day' || Number(event.day) === Number(state.selectedDay)) && (state.view !== 'place' || state.placeDay === 'all' || Number(event.day) === Number(state.placeDay)) && (!state.selectedPlace || event.placeId === state.selectedPlace));
  const unknownTime = $('#filter-current-time').checked && events().some(event => (event.start === null || event.end === null || eventPresences(event).some(presence => presence.start === null || presence.end === null)) && !eventVisible(event));
  $('#time-unknown-hint').hidden = !unknownTime;
  if (!shown.length && !cancelled.length) { list.innerHTML = '<p class="carnaval-no-results">Aucun événement annoncé pour ces filtres.</p>'; return; }
  const sourceById = new Map((state.source.events || []).map(event => [event.id,event]));
  list.innerHTML = shown.map(event => {
    const allPresences = eventPresences(event); const presences = $('#filter-current-time').checked ? allPresences.filter(presence => atSelectedMinute(event,presence.start,presence.end)) : allPresences; const current = Number.isInteger(event.start) && isAt(event, { day: state.selectedDay, minute: state.selectedMinute }); const override = event.adapted;
    const source = sourceById.get(event.sourceEventId || event.id);
    return `<article class="carnaval-event${current ? ' is-current' : ''}${event.kind === 'secret' ? ' is-secret' : ''}${event.kind === 'rendezvous' ? ' is-rendezvous' : ''}" data-event-id="${esc(event.id)}"><header><span class="carnaval-event-time">${esc(scheduleLabel(event))}</span><h3>${esc(event.title)}</h3></header><p class="carnaval-event-meta"><button type="button" data-place="${esc(event.placeId)}">${esc(placeById(event.placeId)?.name || 'Lieu non renseigné')}</button> · ${esc(dayLabel(event.day))}</p><div class="carnaval-event-badges">${event.kind === 'secret' ? '<span class="carnaval-badge secret">Chronologie secrète</span>' : ''}${event.kind === 'rendezvous' ? '<span class="carnaval-badge rendezvous">Rendez-vous</span>' : ''}${override ? '<span class="carnaval-badge">Adapté MJ</span>' : '<span class="carnaval-badge">Programme source</span>'}${source?.source?.bookPage ? `<span class="carnaval-badge">Livre p. ${esc(source.source.bookPage)}</span>` : ''}${source?.source?.pdfPage ? `<span class="carnaval-badge">PDF p. ${esc(source.source.pdfPage)}</span>` : ''}</div><ul class="carnaval-presences">${presences.length ? presences.map(presence => { const character = characterById(presence.characterId); const pnj = linkedPnj(presence.characterId); return `<li><button type="button" data-character="${esc(presence.characterId)}">${esc(character?.name || 'Personnage inconnu')}</button>${presence.role === 'participant' ? ' · participant' : ''}<span class="carnaval-inferred">${presence.inferred ? ` — horaires du spectacle (${esc(presenceTimeLabel(presence))})` : ` — ${esc(presenceTimeLabel(presence))}`}</span>${pnj ? '<span aria-label="Fiche associée"> •</span>' : ''}${presence.characterId && !pnj ? '<span class="carnaval-muted"> (sans fiche)</span>' : ''}</li>`; }).join('') : `<li class="carnaval-muted">${$('#filter-current-time').checked ? 'Aucun PNJ annoncé à cette heure' : 'Aucun PNJ principal listé'}</li>`}</ul><div class="carnaval-event-actions"><button type="button" class="btn-ghost-sm" data-edit-event="${esc(event.id)}">Modifier</button>${!event.custom ? `<button type="button" class="btn-ghost-sm" data-cancel-event="${esc(event.id)}">Annuler</button>` : ''}${event.custom ? `<button type="button" class="btn-ghost-sm" data-delete-event="${esc(event.id)}">Supprimer</button>` : ''}</div></article>`;
  }).join('') + cancelled.map(event => `<article class="carnaval-event" data-event-id="${esc(event.id)}"><header><span class="carnaval-event-time">${esc(scheduleLabel(event))}</span><h3>${esc(event.title)} <span class="carnaval-badge">Annulée</span></h3></header><p class="carnaval-event-meta">${esc(placeById(event.placeId)?.name || 'Lieu non renseigné')} · ${esc(dayLabel(event.day))}</p><div class="carnaval-event-actions"><button type="button" class="btn-ghost-sm" data-restore-event="${esc(event.id)}">Réactiver</button><button type="button" class="btn-ghost-sm" data-reset-cancelled="${esc(event.id)}">Réinitialiser vers la source</button></div></article>`).join('');
  list.querySelectorAll('[data-place]').forEach(button => button.addEventListener('click', () => { state.selectedPlace = button.dataset.place; $('#place-filter').value = state.selectedPlace; focusPlace(state.selectedPlace); render(); }));
  list.querySelectorAll('[data-character]').forEach(button => button.addEventListener('click', () => openCharacter(button.dataset.character)));
  list.querySelectorAll('[data-edit-event]').forEach(button => button.addEventListener('click', () => openEvent(button.dataset.editEvent)));
  list.querySelectorAll('[data-cancel-event]').forEach(button => button.addEventListener('click', () => void cancelEvent(button.dataset.cancelEvent)));
  list.querySelectorAll('[data-delete-event]').forEach(button => button.addEventListener('click', () => void deleteEvent(button.dataset.deleteEvent)));
  list.querySelectorAll('[data-restore-event]').forEach(button => button.addEventListener('click', () => void cancelEvent(button.dataset.restoreEvent)));
  list.querySelectorAll('[data-reset-cancelled]').forEach(button => button.addEventListener('click', () => void resetEvent({ id:button.dataset.resetCancelled,sourceEventId:button.dataset.resetCancelled })));
}
function renderNext() {
  const target = $('#next-encounter'), id = state.selectedCharacter || '';
  if (!id) { target.textContent = 'Choisissez un PNJ pour afficher sa prochaine rencontre.'; return; }
  const holder = state.view === 'character' ? holderOfCharacter(state.campaign,id) : null, holderNote = holder ? `<br><span class="carnaval-muted">${esc(holderLine(holder))}</span>` : '';
  const result = findNextPresence(events().filter(event => event.kind === 'public' || (event.kind === 'secret' && state.showSecrets) || (event.kind === 'rendezvous' && state.showRendezvous)), id, { day: state.selectedDay, minute: state.selectedMinute });
  const character = characterById(id); if (!result) { target.innerHTML = `${esc(character?.name || 'Ce personnage')} : aucune autre présence annoncée pour la suite du Carnaval.${holderNote}`; return; }
  const { event, presence } = result; const absoluteNow = currentAbsolute(); const start = Number.isInteger(presence.start) ? eventAbsolute(event,presence.start) : null; const end = Number.isInteger(presence.end) ? eventAbsolute(event,presence.end) : null; const active = start !== null && (presence.milestone ? absoluteNow === start : end !== null && absoluteNow >= start && absoluteNow < end);
  target.innerHTML = `<strong>${active ? 'Présence en cours' : 'Prochaine occasion de rencontre'} — ${esc(character?.name || '')}</strong><br>${esc(event.title)} · ${esc(placeById(event.placeId)?.name || 'Lieu non renseigné')} · ${esc(dayLabel(event.day))}, ${esc(presenceTimeLabel(presence))}${holderNote}`;
}
function renderOverlaps() {
  const overlaps = findOverlaps(events()); const target = $('#overlap-list');
  if (!overlaps.length) { target.replaceChildren(); return; }
  target.innerHTML = `<strong>Chevauchements à vérifier (${overlaps.length})</strong><ul>${overlaps.map(item => { const character = characterById(item.characterId); const a = item.first.event || item.first; const b = item.second.event || item.second; return `<li>${esc(character?.name || 'Personnage')} : ${esc(a.title)} (${esc(placeById(a.placeId)?.name || 'lieu inconnu')}) et ${esc(b.title)} (${esc(placeById(b.placeId)?.name || 'lieu inconnu')}), ${esc(absoluteTime(item.overlapStart))}–${esc(absoluteTime(item.overlapEnd))}</li>`; }).join('')}</ul>`;
}
function renderWarnings() {
  const target = $('#campaign-warnings'); const checked = validateCampaign(state.campaign,state.source); const warnings = checked.warnings || [];
  target.hidden = warnings.length === 0;
  target.innerHTML = warnings.length ? `<strong>Présences à vérifier</strong><ul>${warnings.map(item => { const eventId = item.path?.match(/^events\.([^.]+)\./u)?.[1]; const event = events().find(row => row.id === eventId); return `<li>${event ? `${esc(event.title)} — ` : ''}${esc(item.message)}</li>`; }).join('')}</ul>` : '';
}
function ensureMap() {
  if (!window.L || !MIDDENHEIM_MAP) { setStatus('La bibliothèque de carte ou sa configuration est indisponible.', 'error'); return; }
  const created = !state.map;
  if (created) {
    const bounds = [[0,0],[MIDDENHEIM_MAP.height,MIDDENHEIM_MAP.width]];
    const imageCrs = L.extend({},L.CRS.Simple,{ transformation:new L.Transformation(1,0,1,0) });
    state.map = L.map('carnaval-map', { crs:imageCrs, minZoom:-3, maxZoom:3, zoomSnap:.25, zoomDelta:.5, attributionControl:false, maxBounds:bounds, maxBoundsViscosity:.75, zoomAnimation:false });
    L.imageOverlay(MIDDENHEIM_MAP.image, bounds).addTo(state.map); state.map.fitBounds(bounds);
    state.mapMarkers = L.layerGroup().addTo(state.map);
    MIDDENHEIM_MAP.places.forEach((place,index) => {
      if (place.radius) {
        const colors = mapColors(); const circle = L.circle([place.y,place.x], { radius:place.radius, color:colors.goldBright, weight:2, fillColor:colors.gold, fillOpacity:.18, interactive:true }).addTo(state.mapMarkers);
        circle.on('click', () => { state.selectedPlace = place.id; $('#place-filter').value = place.id; render(); });
        state.mapCircles = [...(state.mapCircles || []),circle];
      }
      const icon = L.divIcon({ className:'', html:`<span class="carnaval-map-pin" tabindex="0" role="button" aria-label="${esc(place.name)}"><span>${index+1}</span></span>`, iconSize:[30,30], iconAnchor:[15,30] });
      const marker = L.marker([place.y,place.x], { icon, keyboard:true, title:place.name, alt:place.name }).addTo(state.mapMarkers);
      marker.on('click keypress', event => { if (event.type === 'keypress' && event.originalEvent?.key !== 'Enter' && event.originalEvent?.key !== ' ') return; state.selectedPlace = place.id; $('#place-filter').value = place.id; render(); });
      marker.bindTooltip(place.name,{direction:'top'}); state.markerById.set(place.id, marker);
    });
  }
  if (created) requestAnimationFrame(() => { state.map?.invalidateSize(); if (state.map) state.map.fitBounds([[0,0],[MIDDENHEIM_MAP.height,MIDDENHEIM_MAP.width]]); });
}
function mapColors() { const style = window.getComputedStyle(document.documentElement); return { gold:style.getPropertyValue('--gold').trim(), goldBright:style.getPropertyValue('--gold-bright').trim() }; }
function updatePins() { if (!state.map) return; MIDDENHEIM_MAP.places.forEach(place => { const marker = state.markerById.get(place.id); const element = marker?.getElement()?.querySelector('.carnaval-map-pin'); element?.classList.toggle('active', place.id === state.selectedPlace); }); $('#map-place-legend')?.querySelectorAll('[data-map-place]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.mapPlace === state.selectedPlace))); }
function focusPlace(id) { const place = MIDDENHEIM_MAP?.places.find(item => item.id === id); if (place) state.map?.panTo([place.y,place.x], { animate:true }); }

function openEvent(id = '') {
  state.eventId = id; const form = $('#event-form'); form.reset(); const event = id ? events().find(item => item.id === id) : null;
  $('#event-dialog-title').textContent = event ? 'Adapter la scène' : 'Ajouter une scène';
  form.elements.eventId.value = id; form.elements.title.value = event?.title || ''; form.elements.day.innerHTML = state.source.days.map(day => `<option value="${esc(day.id)}">${esc(day.id)} — ${esc(day.name)}</option>`).join(''); form.elements.placeId.innerHTML = places().map(place => `<option value="${esc(place.id)}">${esc(place.name)}</option>`).join('') + '<option value="__other__">Autre lieu…</option>'; form.elements.placeName.value = ''; $('#place-name-wrap').hidden = true;
  // Le rendez-vous n’existe que pour une scène ajoutée : le programme source ne le connaît pas.
  const isCustom = !event || String(id).startsWith('custom-'); form.elements.kind.querySelector('option[value="rendezvous"]').disabled = !isCustom;
  form.elements.kind.value = event?.kind || 'public'; form.elements.start.innerHTML = timeOptions(event ? event.start : state.selectedMinute,true,event?.kind === 'secret' || isCustom); form.elements.end.innerHTML = timeOptions(event ? event.end : state.selectedMinute + 60,true,event?.kind === 'secret' || isCustom); form.elements.bookPage.value = event?.source?.bookPage || ''; form.elements.pdfPage.value = event?.source?.pdfPage || ''; form.elements.bookPage.readOnly = Boolean(event?.sourceEventId); form.elements.pdfPage.readOnly = Boolean(event?.sourceEventId); form.elements.notes.value = state.campaign.notes?.[id] || '';
  form.elements.day.value = String(event?.day ?? state.selectedDay); if (event?.placeId) form.elements.placeId.value = event.placeId;
  const reset = $('#reset-event'); reset.hidden = !event?.sourceEventId; reset.onclick = () => void resetEvent(event);
  renderPresenceEditor(event?.presences || []); clearDialogStatus($('#event-dialog')); $('#event-dialog').showModal();
}
function renderPresenceEditor(presences) {
  const container = $('#presence-editor'); container.innerHTML = presences.map((presence,index) => presenceRow(presence,index)).join('');
  container.querySelectorAll('[data-remove-presence]').forEach(button => button.addEventListener('click', () => { button.closest('.carnaval-presence-row').remove(); }));
}
function presenceRow(presence = {}, index = Date.now()) {
  const options = state.source.characters.map(character => `<option value="${esc(character.id)}"${presence.characterId === character.id ? ' selected' : ''}>${esc(character.name)}</option>`).join('');
  const start = presence.start ?? null, end = presence.end ?? null;
  return `<div class="carnaval-presence-row" data-presence-index="${esc(index)}"><select aria-label="Personnage" data-field="characterId"><option value="">Choisir un PNJ</option>${options}</select><select aria-label="Arrivée" data-field="start">${timeOptions(start,true,true,'Créneau scène')}</select><select aria-label="Départ" data-field="end">${timeOptions(end,true,true,'Créneau scène')}</select><select aria-label="Rôle" data-field="role"><option value="present"${presence.role !== 'participant' ? ' selected' : ''}>Présent</option><option value="participant"${presence.role === 'participant' ? ' selected' : ''}>Participant</option></select><button type="button" data-remove-presence aria-label="Retirer cette présence">×</button></div>`;
}
function readPresenceEditor() { return [...$('#presence-editor').children].map(row => { const value = key => row.querySelector(`[data-field="${key}"]`).value; return { characterId:value('characterId'), start:value('start') === '' ? null : Number(value('start')), end:value('end') === '' ? null : Number(value('end')), role:value('role') }; }).filter(item => item.characterId); }
function patchEvent(campaign,eventId,patch) { const previous = campaign.overrides?.[eventId] || {}; return { ...campaign, overrides:{ ...campaign.overrides, [eventId]:{ ...previous, ...patch } } }; }
async function commit(next, message = 'Enregistrement en cours…') {
  if (!state.admin || !state.onlineReady || !state.bureau?.carnaval || !state.campaign) return;
  const validation = validateCampaign(next,state.source); if (!validation.valid) { setStatus(validation.errors.map(item => item.message).join(' · '), 'error'); return; }
  const captured = state.generation; setStatus(message);
  try { const result = await state.bureau.carnaval.saveCampaign(next,{ expectedRevision:state.campaign.revision }); if (!state.admin || captured !== state.generation) return; state.campaign = result?.campaign || { ...next, revision:result?.revision ?? next.revision }; setStatus('Modifications enregistrées.', 'success'); refreshControls(); render(); }
  catch (error) { if (!state.admin || captured !== state.generation) return; if (error?.code === 'revision-conflict' && error.latest) { state.campaign = error.latest; refreshControls(); render(); setStatus('Conflit : une autre session MJ a modifié ces données. Les dernières données ont été rechargées ; réappliquez votre changement.', 'error'); } else setStatus('Enregistrement non confirmé. Vérifiez la connexion avant de réessayer.', 'error'); }
}
$('#event-form').addEventListener('submit', event => {
  event.preventDefault(); const form = event.currentTarget; if (!state.admin || !state.onlineReady) return; const id = form.elements.eventId.value || `custom-${globalThis.crypto.randomUUID()}`; const previous = events().find(item => item.id === id); const start = form.elements.start.value === '' ? null : Number(form.elements.start.value); const end = form.elements.end.value === '' ? null : Number(form.elements.end.value); const kind = form.elements.kind.value;
  if (kind === 'rendezvous' && !Number.isInteger(start)) { setStatus('Un rendez-vous exige une heure de début.', 'error'); return; }
  if (kind === 'public' && (!Number.isInteger(start) || !Number.isInteger(end))) { setStatus('Une attraction publique doit avoir un début et une fin.', 'error'); return; }
  if (Number.isInteger(start) && Number.isInteger(end) && end <= start) { setStatus('La fin doit être après le début dans le temps de jeu.', 'error'); return; }
  const bookPage = form.elements.bookPage.value === '' ? null : Number(form.elements.bookPage.value); const pdfPage = form.elements.pdfPage.value === '' ? null : Number(form.elements.pdfPage.value);
  const sourceReference = previous?.source || (bookPage === null && pdfPage === null ? null : { bookPage,pdfPage });
  let placeId = form.elements.placeId.value, newPlace = null;
  if (placeId === '__other__') {
    const name = form.elements.placeName.value.trim(); if (!name) { setStatus('Le nom du lieu est obligatoire.', 'error'); return; }
    const known = places().find(place => place.name.toLowerCase() === name.toLowerCase());
    if (known) placeId = known.id; else { newPlace = { id:'place-' + globalThis.crypto.randomUUID(), name }; placeId = newPlace.id; }
  }
  const value = { id, day:Number(form.elements.day.value), start, end, title:form.elements.title.value.trim(), placeId, kind, source:sourceReference, presences:readPresenceEditor() };
  let next = { ...state.campaign, notes:{ ...state.campaign.notes, [id]:form.elements.notes.value } };
  if (previous?.sourceEventId) next = patchEvent(next,id,value); else next = { ...next, customEvents:[...(next.customEvents||[]).filter(item => item.id !== id),value] };
  if (newPlace) next = { ...next, customPlaces:[...(next.customPlaces||[]),newPlace] };
  $('#event-dialog').close(); void commit(pruneCustomPlaces(next));
});
// Un lieu libre n’existe que tant qu’une scène ajoutée ou une adaptation s’y réfère ; sans lieu, la clé disparaît pour garder la forme d’origine.
function pruneCustomPlaces(campaign) {
  if (!campaign.customPlaces) return campaign;
  const used = new Set([...(campaign.customEvents||[]).map(item => item.placeId),...Object.values(campaign.overrides||{}).map(item => item?.placeId)]);
  const kept = campaign.customPlaces.filter(place => used.has(place.id)); const rest = { ...campaign };
  if (kept.length) rest.customPlaces = kept; else delete rest.customPlaces;
  return rest;
}
async function cancelEvent(id) { const event = events().find(item => item.id === id) || state.source?.events?.find(item => item.id === id); if (!event) return; const isCancelled = state.campaign.overrides?.[id]?.cancelled === true; const next = patchEvent(state.campaign,id,{ cancelled:!isCancelled }); await commit(next,isCancelled ? 'Rétablissement en cours…' : 'Annulation en cours…'); }
async function deleteEvent(id) { if (!confirm('Supprimer cette scène ajoutée et ses notes MJ ?')) return; const notes = { ...state.campaign.notes }; delete notes[id]; await commit(pruneCustomPlaces({ ...state.campaign, customEvents:state.campaign.customEvents.filter(item => item.id !== id), notes }),'Suppression en cours…'); }
async function resetEvent(event) { if (!event?.sourceEventId) return; const overrides = { ...state.campaign.overrides }; delete overrides[event.id]; const next = { ...state.campaign, overrides }; $('#event-dialog').close(); await commit(next,'Réinitialisation en cours…'); }
$('#add-presence').addEventListener('click', () => { const container = $('#presence-editor'); container.insertAdjacentHTML('beforeend',presenceRow()); container.lastElementChild.querySelector('[data-remove-presence]').addEventListener('click', event => event.currentTarget.closest('.carnaval-presence-row').remove()); });

// Moment proposé d’après l’horloge de campagne (jour et heure consultés seulement si l’horloge manque).
const clockMoment = () => ({ day:state.campaign?.clock?.day ?? state.selectedDay, minute:state.campaign?.clock?.minute ?? state.selectedMinute });
function holderLine(holder) { return holder ? `${holder.label} — ${holder.weight} voix — ${CAMPS.find(camp => camp.id === holder.camp)?.label || holder.camp}` : ''; }
// Met à jour la seule ligne du détenteur dans le panneau ouvert, sans toucher une saisie de suivi en cours.
function refreshTrackingHolder() {
  const line = $('#tracking-holder'); if (!line || !state.focusedCharacter) return;
  const holder = holderOfCharacter(state.campaign,state.focusedCharacter); line.textContent = holderLine(holder); line.hidden = !holder;
}
function trackingHtml(id) {
  const entry = state.campaign?.tracking?.[id] || { met:null, attitude:null, note:'' }, holder = holderOfCharacter(state.campaign,id);
  const now = clockMoment(), day = entry.met?.day ?? now.day, minute = entry.met?.minute ?? now.minute;
  const dayOptions = (state.source?.days || []).map(item => `<option value="${esc(item.id)}"${Number(item.id) === Number(day) ? ' selected' : ''}>${esc(item.id)} — ${esc(item.name)}</option>`).join('');
  const attitudes = [{ id:'', label:'Non renseignée' }, ...ATTITUDES].map(item => `<label class="carnaval-tracking-choice"><input type="radio" name="tracking-attitude" value="${esc(item.id)}"${(entry.attitude || '') === item.id ? ' checked' : ''}> ${esc(item.label)}</label>`).join('');
  return `<div class="carnaval-drawer-section" id="character-tracking"><h3>Suivi</h3><p class="carnaval-muted" id="tracking-holder"${holder ? '' : ' hidden'}>${esc(holderLine(holder))}</p><label class="carnaval-tracking-choice"><input type="checkbox" id="tracking-met"${entry.met ? ' checked' : ''}> Rencontré</label><div class="carnaval-form-row" id="tracking-moment"${entry.met ? '' : ' hidden'}><label>Jour de la rencontre<select id="tracking-day">${dayOptions}</select></label><label>Heure de la rencontre<select id="tracking-time">${timeOptions(minute)}</select></label></div><fieldset class="carnaval-tracking-fieldset"><legend>Attitude envers les PJ</legend>${attitudes}</fieldset><label class="carnaval-tracking-note">Note de suivi<textarea id="tracking-note" maxlength="500" rows="3">${esc(entry.note)}</textarea></label><button type="button" class="btn-primary" id="tracking-save">Enregistrer le suivi</button></div>`;
}
function bindTracking(id) {
  $('#tracking-met').addEventListener('change', event => { $('#tracking-moment').hidden = !event.target.checked; if (event.target.checked) { const now = clockMoment(); $('#tracking-day').value = String(now.day); $('#tracking-time').value = String(now.minute); } });
  $('#tracking-save').addEventListener('click', async () => {
    if (!state.onlineReady || !state.campaign || state.focusedCharacter !== id) return;
    const met = $('#tracking-met').checked ? { day:Number($('#tracking-day').value), minute:Number($('#tracking-time').value) } : null, attitude = document.querySelector('input[name="tracking-attitude"]:checked')?.value || null, note = $('#tracking-note').value;
    const entry = { met, attitude, note }, empty = !met && !attitude && !note, tracking = { ...state.campaign.tracking };
    if (empty) delete tracking[id]; else tracking[id] = entry;
    const next = { ...state.campaign, tracking }; if (!Object.keys(tracking).length) delete next.tracking;
    const before = state.campaign; await commit(next,'Enregistrement en cours…');
    // commit ne signale pas son échec : on ne confirme que si la campagne a changé et porte bien ce suivi.
    if (state.campaign !== before && JSON.stringify(state.campaign.tracking?.[id] ?? null) === JSON.stringify(empty ? null : entry)) { setStatus('Suivi enregistré.','success'); if (state.focusedCharacter === id && $('#character-tracking')) { $('#character-tracking').outerHTML = trackingHtml(id); bindTracking(id); $('#tracking-save').focus(); } }
  });
}
// Les présentations vivent dans la campagne, jamais dans les relations des fiches PNJ : elles décrivent la cour, pas la fiche.
function introductionsHtml(id) {
  const { outgoing, incoming } = introductionsFor(state.campaign,id), name = other => characterById(other)?.name || 'Personnage inconnu';
  const person = other => `<button type="button" class="btn-ghost-sm" data-open-character="${esc(other)}">${esc(name(other))}</button>`, condition = text => text ? ` <span class="carnaval-muted">— ${esc(text)}</span>` : '';
  const listed = new Set(outgoing.map(item => item.to)), full = outgoing.length >= 30;
  const candidates = state.source.characters.filter(character => character.id !== id && !listed.has(character.id)).sort((a,b) => String(a.name).localeCompare(String(b.name),'fr')).map(character => `<option value="${esc(character.id)}">${esc(character.name)}</option>`).join('');
  const outgoingList = outgoing.length ? `<ul>${outgoing.map(item => `<li>${person(item.to)}${condition(item.condition)} <button type="button" class="btn-ghost-sm" data-remove-introduction="${esc(item.to)}" aria-label="Retirer la présentation à ${esc(name(item.to))}">Retirer</button></li>`).join('')}</ul>` : '<p class="carnaval-muted">Aucune présentation.</p>';
  const incomingList = incoming.length ? `<ul>${incoming.map(item => `<li>${person(item.from)}${condition(item.condition)}</li>`).join('')}</ul>` : '<p class="carnaval-muted">Aucune présentation.</p>';
  return `<div class="carnaval-drawer-section" id="character-introductions"><h3 tabindex="-1">Présentations</h3><h4>Peut présenter à</h4>${outgoingList}<div class="carnaval-form-row"><label>Présenter à<select id="introduction-target"${full ? ' disabled' : ''}>${candidates}</select></label><label>Condition<input type="text" id="introduction-condition" maxlength="200"${full ? ' disabled' : ''}></label><button type="button" class="btn-primary" id="introduction-add"${full || !candidates ? ' disabled' : ''}>Ajouter</button></div><h4>Présenté par</h4>${incomingList}</div>`;
}
function bindIntroductions(id) {
  const section = $('#character-introductions'); if (!section) return;
  section.querySelectorAll('[data-open-character]').forEach(button => button.addEventListener('click', () => { void openCharacter(button.dataset.openCharacter, { focusHeading:true }); }));
  const save = async (list, message) => {
    if (!state.onlineReady || !state.campaign || state.focusedCharacter !== id) return;
    const introductions = { ...state.campaign.introductions }; if (list.length) introductions[id] = list; else delete introductions[id];
    const next = { ...state.campaign, introductions }; if (!Object.keys(introductions).length) delete next.introductions;
    const before = state.campaign; await commit(next,'Enregistrement en cours…');
    // Même garde que le suivi : on ne confirme que si la campagne a changé et porte bien cette liste.
    if (state.campaign !== before && JSON.stringify(introductionsFor(state.campaign,id).outgoing) === JSON.stringify(list)) { setStatus(message,'success'); if (state.focusedCharacter === id && $('#character-introductions')) { $('#character-introductions').outerHTML = introductionsHtml(id); bindIntroductions(id); ($('#introduction-add')?.disabled ? $('#character-introductions h3') : $('#introduction-target'))?.focus(); } }
  };
  section.querySelectorAll('[data-remove-introduction]').forEach(button => button.addEventListener('click', () => { void save(introductionsFor(state.campaign,id).outgoing.filter(item => item.to !== button.dataset.removeIntroduction),'Présentation retirée.'); }));
  $('#introduction-add').addEventListener('click', () => { const to = $('#introduction-target').value; if (!to) return; void save([...introductionsFor(state.campaign,id).outgoing,{ to, condition:$('#introduction-condition').value }],'Présentation ajoutée.'); });
}
async function openCharacter(id, { focusHeading = false } = {}) {
  if (!state.onlineReady) return; state.privateUnsub?.(); state.privateUnsub = null; const previousCharacter = state.focusedCharacter; if (previousCharacter) { state.imageReleases.get(previousCharacter)?.(); state.imageReleases.delete(previousCharacter); } state.focusedCharacter = id; const character = characterById(id); if (!character) return; const pnj = linkedPnj(id); const drawer = $('#character-drawer'); const opening = !drawer.classList.contains('open'); if (opening) { state.drawerReturnTarget = document.activeElement; drawer.inert = false; drawer.classList.add('open'); drawer.setAttribute('aria-hidden','false'); drawer.setAttribute('aria-modal','false'); } const linked = Boolean(state.campaign.links?.[id]), focusH2 = opening || focusHeading; $('#character-drawer-content').innerHTML = `<h2 tabindex="-1">${esc(character.name)}</h2>${pnj ? '<p class="carnaval-muted">Chargement de la fiche…</p>' : `<p class="carnaval-muted">${linked ? 'La fiche associée est indisponible ou a été supprimée.' : 'Aucune fiche PNJ associée.'}</p><button type="button" class="btn-primary" id="associate-pnj">${linked ? 'Réassocier une fiche' : 'Associer une fiche'}</button>${trackingHtml(id)}${introductionsHtml(id)}`}`; if (focusH2) $('#character-drawer-content h2')?.focus();
  if (!pnj) { bindTracking(id); bindIntroductions(id); $('#associate-pnj').addEventListener('click', () => openLinkDialog(id)); return; }
  const generation = state.generation;
  let image = pnj.imageUrl || ''; if (pnj.imagePath && state.bureau?.images?.loadObjectUrl) { try { const loaded = await state.bureau.images.loadObjectUrl(pnj.imagePath); if (!state.admin || generation !== state.generation || state.focusedCharacter !== id) { loaded.release?.(); return; } image = loaded.url; state.imageReleases.set(id,loaded.release); } catch { image = ''; } }
  if (!state.admin || generation !== state.generation || state.focusedCharacter !== id) return;
  const privateNote = state.pnjPrivate.get(pnj.id) || '';
  $('#character-drawer-content').innerHTML = `<h2>${esc(pnj.nom || character.name)}</h2><img src="${esc(image || 'img/pnj-default.webp')}" alt="${image ? `Portrait de ${esc(pnj.nom || character.name)}` : 'Portrait non renseigné'}"><div class="carnaval-drawer-section"><h3>Description</h3>${esc(pnj.description || 'Aucune description renseignée.')}</div><div class="carnaval-drawer-section"><h3>Relations</h3>${renderRelations(pnj.id)}</div>${trackingHtml(id)}${introductionsHtml(id)}<div class="carnaval-drawer-section" id="character-private-notes"><h3>Notes MJ</h3>${esc(privateNote || 'Aucune note privée.')}</div><button type="button" class="btn-ghost-sm" id="reassociate-pnj">Réassocier</button>`; bindTracking(id); bindIntroductions(id);
  $('#character-drawer-content h2')?.setAttribute('tabindex','-1'); if (focusH2) $('#character-drawer-content h2')?.focus();
  $('#reassociate-pnj').addEventListener('click', () => openLinkDialog(id));
  state.privateUnsub?.(); state.privateUnsub = state.bureau.pnjs.subscribePrivate(pnj.id,snapshot => { if (!state.admin || generation !== state.generation || state.focusedCharacter !== id) return; state.pnjPrivate.set(pnj.id,snapshot?.notes || ''); const target = $('#character-private-notes'); if (target) target.innerHTML = `<h3>Notes MJ</h3>${esc(snapshot?.notes || 'Aucune note privée.')}`; });
}
function renderRelations(id) { const byId = new Map(state.pnjs.map(pnj => [pnj.id,pnj])); const links = state.relations.filter(relation => relation.source === id || relation.cible === id); return links.length ? `<ul>${links.map(relation => { const otherId = relation.source === id ? relation.cible : relation.source; return `<li>${esc(byId.get(otherId)?.nom || 'Fiche indisponible')} — ${esc(relation.label || relation.type || 'Relation')}</li>`; }).join('')}</ul>` : '<span class="carnaval-muted">Aucune relation renseignée.</span>'; }
// Le rafraîchissement remplace tout le panneau : on relève la saisie de suivi et de présentation et le focus, puis on les restaure.
async function renderDrawerIfOpen() {
  if (!$('#character-drawer').classList.contains('open') || !state.focusedCharacter) return;
  const id = state.focusedCharacter, content = $('#character-drawer-content'), active = document.activeElement, saved = $('#tracking-met') ? { met:$('#tracking-met').checked, day:$('#tracking-day')?.value, time:$('#tracking-time')?.value, attitude:document.querySelector('input[name="tracking-attitude"]:checked')?.value, note:$('#tracking-note')?.value, target:$('#introduction-target')?.value, condition:$('#introduction-condition')?.value } : null;
  const focusId = content.contains(active) ? active.id : '';
  await openCharacter(id); if (state.focusedCharacter !== id || !saved) return;
  if ($('#tracking-met')) { $('#tracking-met').checked = saved.met; $('#tracking-moment').hidden = !saved.met; if (saved.day !== undefined && $('#tracking-day')) $('#tracking-day').value = saved.day; if (saved.time !== undefined && $('#tracking-time')) $('#tracking-time').value = saved.time; }
  if (saved.attitude) { const radio = [...document.querySelectorAll('input[name="tracking-attitude"]')].find(input => input.value === saved.attitude); if (radio) radio.checked = true; }
  if (saved.note !== undefined && $('#tracking-note')) $('#tracking-note').value = saved.note;
  if (saved.target && $('#introduction-target')) $('#introduction-target').value = saved.target;
  if (saved.condition !== undefined && $('#introduction-condition')) $('#introduction-condition').value = saved.condition;
  if (focusId) document.getElementById(focusId)?.focus();
}
function closeDrawer() { state.privateUnsub?.(); state.privateUnsub = null; state.imageReleases.forEach(release => release?.()); state.imageReleases.clear(); state.focusedCharacter = ''; const drawer = $('#character-drawer'); const focusWasInDrawer = drawer.contains(document.activeElement); drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); drawer.setAttribute('aria-modal','false'); drawer.inert = true; $('#character-drawer-content').replaceChildren(); if (focusWasInDrawer && !$('#carnaval-app').hidden && state.drawerReturnTarget?.isConnected) state.drawerReturnTarget.focus(); state.drawerReturnTarget = null; }
function openLinkDialog(id) {
  const character = characterById(id); if (!character) return; state.linkCharacterId = id; $('#link-character-name').textContent = `Calendrier : ${character.name}`;
  const matches = suggestPnjMatches(character,state.pnjs); const sorted = [...state.pnjs].sort((a,b) => String(a.nom).localeCompare(String(b.nom),'fr'));
  $('#link-pnj-select').innerHTML = '<option value="">Choisir une fiche existante</option>' + sorted.map(pnj => `<option value="${esc(pnj.id)}">${esc(pnj.nom)}</option>`).join('');
  $('#link-suggestions').innerHTML = matches.length ? `<p>Suggestions de rapprochement, à valider :</p>${matches.map(match => `<button type="button" class="btn-ghost-sm" data-suggest-pnj="${esc(match.pnj.id)}">${esc(match.pnj.nom)} — ${Math.round(match.score*100)} %${match.matchedAlias ? ` · ${esc(match.matchedAlias)}` : ''}</button>`).join('')}` : '<p class="carnaval-muted">Aucune suggestion.</p>';
  $('#link-suggestions').querySelectorAll('[data-suggest-pnj]').forEach(button => button.addEventListener('click', () => { $('#link-pnj-select').value = button.dataset.suggestPnj; })); $('#link-dialog').showModal();
}
$('#link-form').addEventListener('submit', event => { event.preventDefault(); const id = state.linkCharacterId, pnjId = $('#link-pnj-select').value; if (!id || !pnjById(pnjId)) return; const links = { ...state.campaign.links, [id]:pnjId }; $('#link-dialog').close(); void commit({ ...state.campaign, links },'Association en cours…'); });
$('#link-dialog').querySelectorAll('#link-cancel, #link-dialog-close').forEach(button => button.addEventListener('click', () => $('#link-dialog').close()));

// Le bandeau porte le libellé de chaque camp en toutes lettres : le total se lit sans la couleur.
function renderTally() {
  const holders = state.campaign?.holders || [], tally = holderTally(state.campaign);
  const text = holders.length ? `${CAMPS.map(camp => `${camp.label} ${tally[camp.id]}`).join(' · ')} · Total ${tally.total}` : 'Aucun détenteur de voix';
  if ($('#court-tally-text').textContent !== text) $('#court-tally-text').textContent = text;
}
const holderChangeText = holder => holder.changedAt ? `Camp changé : ${dayLabel(holder.changedAt.day)}, ${minuteText(holder.changedAt.minute)}` : '';
const campOptions = selected => CAMPS.map(camp => `<option value="${esc(camp.id)}"${camp.id === selected ? ' selected' : ''}>${esc(camp.label)}</option>`).join('');
function renderHolders() {
  const holders = state.campaign?.holders || [], list = $('#holders-list');
  list.innerHTML = holders.length ? holders.map(holder => { const names = (holder.characterIds || []).map(id => characterById(id)?.name || 'Personnage inconnu'); const change = holderChangeText(holder); return `<article class="carnaval-holder" data-holder-id="${esc(holder.id)}"><div class="carnaval-holder-info"><strong>${esc(holder.label)}</strong> · poids ${esc(holder.weight)}<br><span class="carnaval-muted">${names.length ? esc(names.join(', ')) : 'Aucun personnage rattaché'}</span>${change ? `<br><span class="carnaval-muted">${esc(change)}</span>` : ''}</div><div class="carnaval-holder-actions"><select data-holder-camp="${esc(holder.id)}" aria-label="Camp de ${esc(holder.label)}">${campOptions(holder.camp)}</select><button type="button" class="btn-ghost-sm" data-edit-holder="${esc(holder.id)}" aria-label="Modifier le détenteur ${esc(holder.label)}">Modifier</button><button type="button" class="btn-ghost-sm" data-delete-holder="${esc(holder.id)}" aria-label="Supprimer le détenteur ${esc(holder.label)}">Supprimer</button></div></article>`; }).join('') : '<p class="carnaval-no-results">Aucun détenteur de voix</p>';
}
// Un personnage ne figure que dans un seul détenteur : les cases déjà prises ailleurs sont désactivées et nomment leur détenteur.
function openHolderForm(id = '') {
  const form = $('#holder-form'), holder = id ? (state.campaign.holders || []).find(item => item.id === id) : null; form.reset();
  $('#holder-form-title').textContent = holder ? 'Modifier le détenteur' : 'Nouveau détenteur';
  form.elements.holderId.value = holder?.id || ''; form.elements.label.value = holder?.label || ''; form.elements.weight.value = holder ? String(holder.weight) : ''; form.elements.camp.innerHTML = campOptions(holder?.camp || CAMPS[0].id);
  const characters = [...state.source.characters].sort((a,b) => String(a.name).localeCompare(String(b.name),'fr'));
  $('#holder-characters').innerHTML = characters.map((character,index) => { const owner = holderOfCharacter(state.campaign,character.id); const other = owner && owner.id !== holder?.id ? owner : null; const checked = Boolean(owner) && !other; return `<label class="carnaval-holder-character"><input type="checkbox" name="characterIds" value="${esc(character.id)}" id="holder-character-${index}"${checked ? ' checked' : ''}${other ? ' disabled' : ''}> ${esc(character.name)}${other ? `<span class="carnaval-muted"> — déjà rattaché à ${esc(other.label)}</span>` : ''}</label>`; }).join('');
  form.hidden = false; form.elements.label.focus();
}
function closeHolderForm() { $('#holder-form').hidden = true; $('#holder-form').reset(); $('#add-holder').focus(); }
// La clé holders disparaît avec le dernier détenteur pour garder la forme d’origine de la campagne.
function withHolders(holders) { const next = { ...state.campaign, holders }; if (!holders.length) delete next.holders; return next; }
async function commitHolders(next, message) { await commit(next,message); refreshTrackingHolder(); }
$('#open-holders').addEventListener('click', () => { if (!state.onlineReady || !state.campaign) return; $('#holder-form').hidden = true; renderHolders(); clearDialogStatus($('#holders-dialog')); $('#holders-dialog').showModal(); });
$('#holders-dialog').querySelectorAll('#holders-close, #holders-close-bottom').forEach(button => button.addEventListener('click', () => $('#holders-dialog').close()));
$('#holders-dialog').addEventListener('close', () => { $('#holder-form').hidden = true; if (!$('#carnaval-app').hidden) $('#open-holders').focus(); });
$('#add-holder').addEventListener('click', () => { if (state.onlineReady) openHolderForm(); });
$('#holder-cancel').addEventListener('click', closeHolderForm);
$('#holders-list').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit-holder]'), remove = event.target.closest('[data-delete-holder]');
  if (edit) openHolderForm(edit.dataset.editHolder);
  else if (remove) { const holder = (state.campaign.holders || []).find(item => item.id === remove.dataset.deleteHolder); if (holder && window.confirm(`Supprimer le détenteur « ${holder.label} » ?`)) { const before = state.campaign; void commitHolders(withHolders(state.campaign.holders.filter(item => item.id !== holder.id)),'Suppression en cours…').then(() => { if (state.campaign !== before && !state.campaign.holders?.some(item => item.id === holder.id)) setStatus('Détenteur supprimé.','success'); }); } }
});
$('#holders-list').addEventListener('change', async event => {
  const select = event.target.closest('[data-holder-camp]'); if (!select || !state.onlineReady) return; const id = select.dataset.holderCamp;
  const holders = (state.campaign.holders || []).map(holder => holder.id === id ? { ...holder, camp:select.value, changedAt:clockMoment() } : holder);
  const before = state.campaign; await commitHolders({ ...state.campaign, holders },'Changement de camp en cours…'); if (state.campaign !== before && state.campaign.holders?.find(item => item.id === id)?.camp === select.value) setStatus('Camp modifié.','success'); renderHolders(); [...$('#holders-list').querySelectorAll('[data-holder-camp]')].find(item => item.dataset.holderCamp === id)?.focus();
});
$('#holder-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; if (!state.admin || !state.onlineReady) return;
  const id = form.elements.holderId.value, previous = (state.campaign.holders || []).find(item => item.id === id), camp = form.elements.camp.value, weight = Number(form.elements.weight.value), label = form.elements.label.value.trim();
  if (!label) { setStatus('Le libellé est obligatoire.', 'error'); return; }
  if (!Number.isInteger(weight) || weight < 0 || weight > 99) { setStatus('Le poids doit être un entier de 0 à 99.', 'error'); return; }
  const characterIds = [...form.querySelectorAll('input[name="characterIds"]:checked')].map(input => input.value);
  const value = { id:previous?.id || 'holder-' + globalThis.crypto.randomUUID(), label, weight, camp, characterIds, changedAt:previous ? (previous.camp !== camp ? clockMoment() : previous.changedAt) : null };
  const holders = previous ? state.campaign.holders.map(item => item.id === id ? value : item) : [...(state.campaign.holders || []),value];
  const before = state.campaign; await commitHolders(withHolders(holders),'Enregistrement en cours…');
  if (state.campaign !== before && state.campaign.holders?.some(item => item.id === value.id)) { setStatus('Détenteur enregistré.','success'); closeHolderForm(); }
});

function collectClock() { return { day:Number($('#clock-day').value), minute:Number($('#clock-time').value) }; }
$('#save-clock').addEventListener('click', () => void commit({ ...state.campaign, clock:collectClock() },'Heure de campagne en cours…'));
$('#clock-day').addEventListener('change', () => { state.selectedDay = Number($('#clock-day').value); $('#day-select').value = String(state.selectedDay); render(); });
$('#clock-time').addEventListener('change', () => { state.selectedMinute = Number($('#clock-time').value); $('#time-select').value = String(state.selectedMinute); render(); });
$('#day-select').addEventListener('change', event => { state.selectedDay = Number(event.target.value); render(); });
$('#time-select').addEventListener('change', event => { state.selectedMinute = Number(event.target.value); render(); });
$('#filter-current-time').addEventListener('change', render);
$('#previous-day').addEventListener('click', () => { state.selectedDay = Math.max(1,state.selectedDay-1); $('#day-select').value = String(state.selectedDay); render(); });
$('#next-day').addEventListener('click', () => { state.selectedDay = Math.min(state.source?.days.length || 8,state.selectedDay+1); $('#day-select').value = String(state.selectedDay); render(); });
$('#place-filter').addEventListener('change', event => { state.selectedPlace = event.target.value; if (state.selectedPlace) focusPlace(state.selectedPlace); render(); });
$('#place-day-filter').addEventListener('change', event => { state.placeDay = event.target.value; render(); });
$('#character-filter').addEventListener('change', event => { state.selectedCharacter = event.target.value; render(); });
$('#met-filter').addEventListener('change', event => { state.metFilter = event.target.value; refreshControls(); render(); });
$('#camp-filter').addEventListener('change', event => { state.campFilter = event.target.value; refreshControls(); render(); });
$('#show-secrets').addEventListener('change', event => { state.showSecrets = event.target.checked; render(); });
$('#show-rendezvous').addEventListener('change', event => { state.showRendezvous = event.target.checked; render(); });
$('#event-form').elements.placeId.addEventListener('change', event => { $('#place-name-wrap').hidden = event.target.value !== '__other__'; });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; document.querySelectorAll('[data-view]').forEach(tab => tab.setAttribute('aria-selected',String(tab === button))); refreshControls(); render(); }));
$('#map-reset').addEventListener('click', () => { if (state.map) state.map.fitBounds([[0,0],[MIDDENHEIM_MAP.height,MIDDENHEIM_MAP.width]]); });
document.addEventListener('themechange', () => { const colors = mapColors(); state.mapCircles?.forEach(circle => circle.setStyle({ color:colors.goldBright, fillColor:colors.gold })); });
$('#refresh-data').addEventListener('click', () => { state.unsubs.forEach(unsub => unsub?.()); state.unsubs = []; connectBureau(); });
$('#add-event').addEventListener('click', () => openEvent()); $('#drawer-close').addEventListener('click', closeDrawer);
$('#event-dialog').querySelectorAll('#event-dialog-close, #cancel-event').forEach(button => button.addEventListener('click', () => $('#event-dialog').close()));
$('#carnaval-auth').addEventListener('click', () => state.admin ? void logout() : void doLogin());
$('#retry-private-data').addEventListener('click', () => { if (state.admin) void connectBureau(); else void doLogin(); });
window.addEventListener('keydown', event => {
  const drawer = $('#character-drawer'); if (!drawer.classList.contains('open')) return;
  if (event.key === 'Escape' && !$('#event-dialog').open && !$('#link-dialog').open && !$('#holders-dialog').open) { event.preventDefault(); closeDrawer(); return; }
});
$('#source-file').addEventListener('change', event => { $('#source-import').disabled = !event.target.files?.[0]; });
$('#source-import').addEventListener('click', async () => { const file = $('#source-file').files?.[0]; if (!file || !state.admin || !state.bureau?.carnaval) return; try { const source = JSON.parse(await file.text()); const validation = validateSource(source); if (!validation.valid) { setStatus(validation.errors.map(item => item.message).join(' · '),'error'); return; } await state.bureau.carnaval.importSource(source); $('#source-file').value = ''; $('#source-import').disabled = true; $('#carnaval-import').hidden = true; setStatus('Programme source importé.','success'); } catch (error) { setStatus(error?.code === 'source-exists' ? 'Une source existe déjà ; actualisez le programme.' : 'Import impossible. Vérifiez que le fichier est un JSON valide et connecté au dépôt privé.','error'); } });
window.addEventListener('pagehide', () => { clearPrivateState(); authUnsubscribe?.(); authUnsubscribe = null; });
window.addEventListener('pageshow', () => { if (!authUnsubscribe) authUnsubscribe = watchAuth(handleAuth); });
window.addEventListener('offline', () => { if (!state.admin) return; clearPrivateState(); showOfflineLock('Connexion perdue. Le contenu privé est retiré ; les écritures non confirmées ne sont pas considérées comme sauvegardées.'); });
window.addEventListener('online', () => { if (state.admin) void connectBureau(); });

// Les noms restent accessibles au toucher, même lorsque les repères se superposent.
const legend = document.createElement('div'); legend.id = 'map-place-legend'; legend.className = 'carnaval-map-legend'; legend.setAttribute('aria-label','Choisir un lieu sur la carte');
legend.innerHTML = MIDDENHEIM_MAP.places.map((place,index) => `<button type="button" data-map-place="${esc(place.id)}" aria-pressed="false">${index+1} · ${esc(place.name)}</button>`).join('');
$('#carnaval-map').after(legend);
legend.querySelectorAll('[data-map-place]').forEach(button => button.addEventListener('click', () => { if (!state.onlineReady) return; state.selectedPlace = button.dataset.mapPlace; $('#place-filter').value = state.selectedPlace; focusPlace(state.selectedPlace); render(); }));

authUnsubscribe = watchAuth(handleAuth);
