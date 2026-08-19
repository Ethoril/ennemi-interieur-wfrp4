export const FIRESTORE_BATCH_LIMIT = 500;

export function publicRelationsForPnj(relations, pnjId) {
    return relations.filter(relation => relation.visibleJoueurs === true
        && (relation.source === pnjId || relation.cible === pnjId));
}

export function cascadeWriteCount({ relationCount, privateWrite }) {
    return 1 + relationCount + (privateWrite ? 1 : 0);
}
