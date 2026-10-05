import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const project = 'demo-j2-contributions';
let env, gm, player, unverified, stranger;

before(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '').split(':');
    if (!host || !port) throw new Error('Ce test exige un émulateur Firestore local.');
    env = await initializeTestEnvironment({ projectId: project, firestore: {
        host, port: Number(port), rules: await readFile(resolve('firestore.rules'), 'utf8'),
    } });
    gm = env.authenticatedContext('gm', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
    player = env.authenticatedContext('player', { email: 'player@example.test', email_verified: true }).firestore();
    unverified = env.authenticatedContext('unverified', { email: 'player@example.test', email_verified: false }).firestore();
    stranger = env.authenticatedContext('stranger', { email: 'stranger@example.test', email_verified: true }).firestore();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'campagne/acces'), { bhelgi: ['player@example.test'] });
        await setDoc(doc(db, 'fiches/bhelgi'), { schemaVersion: 2, revision: 1 });
        await setDoc(doc(db, 'fiches/test'), { schemaVersion: 2, revision: 1 });
        await setDoc(doc(db, 'fiches/bhelgi/history/op-1'), { revision: 1 });
        await setDoc(doc(db, 'fiches/bhelgi/operations/op-1'), { revision: 1 });
        await setDoc(doc(db, 'fiches/bhelgi/migration_backups/backup-1'), { data: { secret: true } });
        await setDoc(doc(db, 'fiches/bhelgi/catalogue_backups/catalogue-op-1'), { inventory: ['private'] });
        await setDoc(doc(db, 'fiches/bhelgi/command_backups/op-1'), { data: { inventory: ['private'] } });
        await setDoc(doc(db, 'pnjs/a'), { nom: 'Ada', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await setDoc(doc(db, 'pnjs/b'), { nom: 'Bea', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await setDoc(doc(db, 'pnjs/hidden'), { nom: 'Secret', visibleJoueurs: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await setDoc(doc(db, 'pnjs/legacy'), { nom: 'Legacy', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await setDoc(doc(db, 'content_metadata/pnj_a'), { state: 'active', revision: 1 });
        await setDoc(doc(db, 'content_metadata/pnj_hidden'), { state: 'active', revision: 1 });
        await setDoc(doc(db, 'content_metadata/pnj_orphan'), { state: 'trashed', revision: 4 });
        await setDoc(doc(db, 'content_metadata/indice_orphan'), { state: 'trashed', revision: 4 });
        await setDoc(doc(db, 'relations/managed'), {
            source: 'a', cible: 'b', type: 'allié', label: 'allié', visibleJoueurs: true, curvature: null,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'relations/secret-edge'), { source: 'a', cible: 'hidden', type: 'secret', label: 'secret', visibleJoueurs: true });
        await setDoc(doc(db, 'content_metadata/relation_managed'), { state: 'active', revision: 1 });
        await setDoc(doc(db, 'content_metadata/relation_orphan'), { state: 'trashed', revision: 4 });
        await setDoc(doc(db, 'indices/clue'), { titre: 'Indice', decouvert: true, pnjsLies: ['a'] });
        await setDoc(doc(db, 'content_metadata/indice_clue'), { state: 'active', revision: 1 });
        await setDoc(doc(db, 'content_metadata/internal'), { secret: true });
        await setDoc(doc(db, 'content_history/pnj_a/events/op-1'), { changes: { nom: { before: 'Old', after: 'Ada' } } });
        await setDoc(doc(db, 'referentiels/public'), { revision: 2, catalogue: { skills: { entries: [{ id: 'basic', nom: 'Athlétisme' }] } } });
        await setDoc(doc(db, 'referentiel_drafts/mj'), { revision: 9, catalogue: { skills: { entries: [{ id: 'secret', nom: 'Brouillon MJ' }] } } });
        await setDoc(doc(db, 'referentiel_history/op-1'), { decisions: [{ secret: true }] });
    });
});

after(async () => { if (env) await env.cleanup(); });

test('lecture des fiches V2 et de leurs historiques exige un email vérifié autorisé; écritures directes interdites même au MJ', async () => {
    assert.equal((await getDoc(doc(player, 'fiches/bhelgi'))).exists(), true);
    assert.equal((await getDoc(doc(player, 'fiches/bhelgi/history/op-1'))).exists(), true);
    assert.equal((await getDoc(doc(player, 'fiches/bhelgi/operations/op-1'))).exists(), true);
    await assert.rejects(getDoc(doc(player, 'fiches/test')));
    await assert.rejects(getDoc(doc(unverified, 'fiches/bhelgi')));
    await assert.rejects(getDoc(doc(stranger, 'fiches/bhelgi')));
    assert.equal((await getDoc(doc(gm, 'fiches/test'))).exists(), true);
    await assert.rejects(updateDoc(doc(gm, 'fiches/bhelgi'), { revision: 2 }));
    await assert.rejects(setDoc(doc(player, 'fiches/bhelgi/history/fake'), { secret: true }));
    assert.equal((await getDoc(doc(gm, 'fiches/bhelgi/migration_backups/backup-1'))).exists(), true);
    await assert.rejects(getDoc(doc(player, 'fiches/bhelgi/migration_backups/backup-1')));
    assert.equal((await getDoc(doc(gm, 'fiches/bhelgi/catalogue_backups/catalogue-op-1'))).exists(), true);
    await assert.rejects(getDoc(doc(player, 'fiches/bhelgi/catalogue_backups/catalogue-op-1')));
    assert.equal((await getDoc(doc(gm, 'fiches/bhelgi/command_backups/op-1'))).exists(), true);
    await assert.rejects(getDoc(doc(player, 'fiches/bhelgi/command_backups/op-1')));
    await assert.rejects(setDoc(doc(gm, 'fiches/bhelgi/command_backups/client-write'), { data: {} }));
});

test('presence ne peut pas usurper le rôle MJ ni écrire la session d’un autre utilisateur', async () => {
    const own = doc(player, 'fiches/bhelgi/presence/1234567890abcdef');
    await setDoc(own, { uid: 'player', displayName: 'Joueur', role: 'joueur', lastSeenAt: serverTimestamp() });
    await updateDoc(own, { lastSeenAt: serverTimestamp() });
    await assert.rejects(setDoc(doc(player, 'fiches/bhelgi/presence/abcdefghijklmnop'), {
        uid: 'player', displayName: 'Joueur', role: 'mj', lastSeenAt: serverTimestamp(),
    }));
    await assert.rejects(setDoc(doc(stranger, 'fiches/bhelgi/presence/abcdefghijklmnop'), {
        uid: 'stranger', displayName: 'Autre', role: 'joueur', lastSeenAt: serverTimestamp(),
    }));
    await assert.rejects(updateDoc(doc(stranger, 'fiches/bhelgi/presence/1234567890abcdef'), { lastSeenAt: serverTimestamp() }));
    await deleteDoc(own);
});

test('métadonnées, reçus, corbeille et historique contribution restent réservés au serveur', async () => {
    for (const collection of ['content_metadata', 'content_operations', 'content_trash', 'content_trash_archive']) {
        await assert.rejects(getDoc(doc(player, collection, collection === 'content_metadata' ? 'pnj_a' : 'op-1')));
        await assert.rejects(setDoc(doc(gm, collection, 'new-entry'), { secret: true }));
    }
    await assert.rejects(getDoc(doc(player, 'content_history/pnj_a/events/op-1')));
    await assert.rejects(setDoc(doc(gm, 'content_history/pnj_a/events/fake'), { secret: true }));
});

test('seul le snapshot catalogue publié est lisible; draft et historique restent privés', async () => {
    assert.equal((await getDoc(doc(player, 'referentiels/public'))).data().catalogue.skills.entries[0].nom, 'Athlétisme');
    await assert.rejects(getDoc(doc(player, 'referentiel_drafts/mj')));
    await assert.rejects(getDoc(doc(gm, 'referentiel_drafts/mj')));
    await assert.rejects(getDoc(doc(gm, 'referentiel_history/op-1')));
    await assert.rejects(setDoc(doc(gm, 'referentiels/public'), { catalogue: { secret: true } }));
});

test('une fois géré, le contenu public ne peut plus être modifié directement, tandis que les relations conservent la courbure', async () => {
    await assert.rejects(updateDoc(doc(gm, 'pnjs/a'), { nom: 'Modifié MJ', updatedAt: serverTimestamp() }));
    await assert.rejects(updateDoc(doc(gm, 'pnjs/hidden'), { visibleJoueurs: true, updatedAt: serverTimestamp() }));
    await assert.rejects(updateDoc(doc(gm, 'indices/clue'), { titre: 'Modifié', updatedAt: serverTimestamp() }));
    await assert.rejects(updateDoc(doc(gm, 'relations/managed'), { label: 'Modifié', updatedAt: serverTimestamp() }));
    await assert.rejects(setDoc(doc(gm, 'content_metadata/pnj_a'), { state: 'active', revision: 2 }));
    await assert.rejects(setDoc(doc(gm, 'pnjs/orphan'), {
        nom: 'Recréation interdite', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assert.rejects(setDoc(doc(gm, 'indices/orphan'), {
        titre: 'Recréation interdite', decouvert: true, pnjsLies: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assert.rejects(setDoc(doc(gm, 'relations/orphan'), {
        source: 'a', cible: 'b', type: 'secret', visibleJoueurs: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await updateDoc(doc(gm, 'pnjs/legacy'), { nom: 'Legacy corrigé', updatedAt: serverTimestamp() });
    assert.equal((await getDoc(doc(gm, 'pnjs/legacy'))).data().nom, 'Legacy corrigé');
    await updateDoc(doc(player, 'relations/managed'), { curvature: 1.5, updatedAt: serverTimestamp() });
    assert.equal((await getDoc(doc(player, 'relations/managed'))).data().curvature, 1.5);
    await assert.rejects(getDoc(doc(player, 'relations/secret-edge')));
});
