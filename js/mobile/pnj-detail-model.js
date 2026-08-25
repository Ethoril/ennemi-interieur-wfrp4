import { foldSearchText } from './pnj-list-model.js';

const PUBLIC_ID = /^[A-Za-z0-9_-]{1,150}$/u;

function text(value, maximum = 20000) {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function validId(value) {
    return typeof value === 'string' && PUBLIC_ID.test(value);
}

function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === 'object'
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
    }
    return value;
}

function itemName(item) {
    return text(item?.nom, 200) || 'PNJ sans nom';
}

function publicImage(id, image) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
        return { path: null, legacy: false, invalid: false };
    }
    const parts = typeof image.path === 'string' ? image.path.split('/') : [];
    const owned = image.legacy !== true && image.invalid !== true
        && parts.length === 3 && parts[0] === 'portraits' && parts[1] === id
        && validId(parts[1]) && /^[A-Za-z0-9._-]{1,128}$/u.test(parts[2])
        && !['.', '..'].includes(parts[2]);
    return {
        path: owned ? image.path : null,
        legacy: image.legacy === true,
        invalid: image.invalid === true || (!owned && typeof image.path === 'string' && image.path !== ''),
    };
}

function publicItem(item) {
    return { id: item.id, nom: text(item.nom, 200), image: publicImage(item.id, item.image) };
}

function compareText(left, right) {
    const leftFolded = foldSearchText(left);
    const rightFolded = foldSearchText(right);
    if (leftFolded !== rightFolded) return leftFolded < rightFolded ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
}

function visiblePnjMap(items) {
    return new Map((Array.isArray(items) ? items : [])
        .filter(item => validId(item?.id) && item.visibleJoueurs === true && item.suppressionEnCours !== true)
        .map(item => [item.id, item]));
}

function exactReciprocal(relation, candidate) {
    return candidate && candidate.id === relation.reciprocalId
        && candidate.reciprocalId === relation.id
        && candidate.source === relation.cible && candidate.cible === relation.source
        && ['type', 'label', 'color', 'style', 'visibleJoueurs']
            .every(field => candidate[field] === relation[field]);
}

function selectRelations(id, items, pnjs) {
    const source = Array.isArray(items) ? items : [];
    const byId = new Map(source.filter(relation => validId(relation?.id))
        .map(relation => [relation.id, relation]));
    const seen = new Set();
    return source
        .filter(relation => relation?.visibleJoueurs === true
            && validId(relation.id) && (relation.source === id || relation.cible === id))
        .map(relation => {
            const otherId = relation.source === id ? relation.cible : relation.source;
            const other = pnjs.get(otherId);
            const label = text(relation.label, 300) || text(relation.type, 100);
            if (!other || !validId(otherId) || !label) return null;
            const reciprocal = byId.get(relation.reciprocalId);
            const key = exactReciprocal(relation, reciprocal)
                ? `pair:${[relation.id, reciprocal.id].sort().join(':')}` : `single:${relation.id}`;
            if (seen.has(key)) return null;
            seen.add(key);
            return {
                id: relation.id,
                otherId,
                otherName: itemName(other),
                label,
            };
        })
        .filter(Boolean)
        .sort((left, right) => compareText(left.otherName, right.otherName)
            || compareText(left.label, right.label) || compareText(left.id, right.id));
}

function selectIndices(id, items) {
    return (Array.isArray(items) ? items : [])
        .filter(indice => indice?.decouvert === true
            && Array.isArray(indice.pnjsLies) && indice.pnjsLies.includes(id))
        .map(indice => ({
            id: indice.id,
            title: text(indice.titre, 200) || 'Indice sans titre',
            description: text(indice.description, 30000),
            order: typeof indice.ordre === 'number' && Number.isFinite(indice.ordre) ? indice.ordre : null,
        }))
        .filter(indice => validId(indice.id))
        .sort((left, right) => {
            if (left.order === null && right.order !== null) return 1;
            if (left.order !== null && right.order === null) return -1;
            if (left.order !== null && right.order !== null && left.order !== right.order) return left.order - right.order;
            return compareText(left.title, right.title) || compareText(left.id, right.id);
        });
}

function publicResource(state, name) {
    return state?.resources?.[name] ?? { status: 'loading', items: [], error: null };
}

export function selectPnjDetailModel(state, id) {
    const pnjs = publicResource(state, 'pnjs');
    const relations = publicResource(state, 'relations');
    const indices = publicResource(state, 'indices');
    const connection = state?.connection ?? {};
    const item = visiblePnjMap(pnjs.items).get(id) ?? null;

    if (connection.phase === 'offline-empty') {
        return freeze({ kind: 'offline-empty', retry: true, item: null,
            message: 'Une première connexion est nécessaire pour charger cette fiche.' });
    }
    if (state?.error) {
        return freeze({ kind: 'error', retry: true, item: null,
            message: state.error.kind === 'permission'
                ? 'L’accès aux données publiques a été refusé.'
                : 'Les données publiques ne peuvent pas être initialisées.' });
    }
    if (pnjs.status === 'loading') {
        return freeze({ kind: 'loading', retry: false, item: null, message: 'Chargement de la fiche…' });
    }
    if (!item && pnjs.status === 'error') {
        return freeze({ kind: 'error', retry: true, item: null,
            message: pnjs.error?.kind === 'permission'
                ? 'L’accès aux données publiques a été refusé.' : 'Les données publiques ne peuvent pas être chargées.' });
    }
    if (!item) {
        return freeze({ kind: 'empty', retry: false, item: null,
            message: 'Ce PNJ est indisponible.' });
    }

    const visiblePnjs = visiblePnjMap(pnjs.items);
    const identity = [
        ['Statut', text(item.statut, 64)],
        ['Vie', text(item.vivant, 32)],
        ['Lieu', text(item.lieu, 200)],
        ['Groupe', text(item.groupe, 200)],
        ['Surnom', text(item.surnom, 200)],
        ['Rôle', text(item.role, 200) || text(item.rôle, 200) || text(item.profession, 200)],
    ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
    return freeze({
        kind: 'ready',
        item: publicItem(item),
        name: itemName(item),
        description: text(item.description),
        identity,
        relations: selectRelations(id, relations.items, visiblePnjs),
        indices: selectIndices(id, indices.items),
        relationsStatus: relations.status,
        indicesStatus: indices.status,
        warning: pnjs.status === 'error'
            ? 'Mise à jour impossible : la dernière fiche reçue reste consultable.' : '',
    });
}

export { itemName, validId };
