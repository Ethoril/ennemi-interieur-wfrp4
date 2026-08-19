import test from 'node:test';
import assert from 'node:assert/strict';
import {
    FIRESTORE_BATCH_LIMIT, cascadeWriteCount, publicRelationsForPnj,
} from '../../js/visibility-cascade.js';

test('le cascadeur ne révoque que les relations publiques incidentes', () => {
    const relations = [
        { id: 'incoming', source: 'other', cible: 'target', visibleJoueurs: true },
        { id: 'outgoing', source: 'target', cible: 'other', visibleJoueurs: true },
        { id: 'private', source: 'target', cible: 'other', visibleJoueurs: false },
        { id: 'unrelated', source: 'other', cible: 'else', visibleJoueurs: true },
    ];
    assert.deepEqual(publicRelationsForPnj(relations, 'target').map(relation => relation.id), ['incoming', 'outgoing']);
});

test('le cascadeur bloque avant commit au-delà de 500 écritures', () => {
    assert.equal(cascadeWriteCount({ relationCount: 498, privateWrite: true }), FIRESTORE_BATCH_LIMIT);
    assert.equal(cascadeWriteCount({ relationCount: 499, privateWrite: false }), FIRESTORE_BATCH_LIMIT);
    assert.ok(cascadeWriteCount({ relationCount: 499, privateWrite: true }) > FIRESTORE_BATCH_LIMIT);
});
