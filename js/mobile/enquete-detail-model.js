import { foldEnqueteSearch, validId } from './enquete-list-model.js';

function text(value, maximum = 30000) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }

function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)])));
    }
    return value;
}

function publicPnjs(items) {
    return new Map((Array.isArray(items) ? items : []).filter(item => validId(item?.id)
        && item.visibleJoueurs === true && item.suppressionEnCours !== true)
        .filter(item => !Array.isArray(item.issues) || item.issues.length === 0)
        .map(item => [item.id, { id: item.id, nom: text(item.nom, 200) || 'PNJ sans nom' }]));
}

export function selectEnqueteDetailModel(state, id) {
    const resource = state?.resources?.indices ?? { status: 'loading', items: [] };
    if (state?.connection?.phase === 'offline-empty') return freeze({ kind: 'offline-empty', retry: true, message: 'Une première connexion est nécessaire pour charger cette enquête.' });
    if (state?.error) return freeze({ kind: 'error', retry: true, message: 'Les données publiques ne peuvent pas être chargées.' });
    if (resource.status === 'loading') return freeze({ kind: 'loading', retry: false, message: 'Chargement de l’enquête…' });
    const source = Array.isArray(resource.items) ? resource.items.find(item => item?.id === id
        && item.decouvert === true && (!Array.isArray(item.issues) || item.issues.length === 0)
        && typeof item.titre === 'string' && item.titre.trim()) : null;
    if (!source || !validId(id)) return freeze({ kind: 'empty', retry: false, message: 'Indice indisponible.' });
    const pnjs = publicPnjs(state?.resources?.pnjs?.items);
    const links = [...new Set(Array.isArray(source.pnjsLies) ? source.pnjsLies : [])]
        .filter(linkedId => validId(linkedId) && pnjs.has(linkedId)).map(linkedId => pnjs.get(linkedId));
    const image = source.image && typeof source.image === 'object' ? {
        path: typeof source.image.path === 'string' ? source.image.path : null,
        legacy: source.image.legacy === true,
        invalid: source.image.invalid === true,
    } : { path: null, legacy: false, invalid: false };
    return freeze({ kind: 'ready', item: { id, titre: text(source.titre, 200) || 'Indice sans titre', description: text(source.description), pnjs: links, image }, warning: resource.status === 'error' ? 'Mise à jour impossible : la dernière version reste consultable.' : '' });
}

export const selectEnqueteModel = selectEnqueteDetailModel;

export { foldEnqueteSearch };
