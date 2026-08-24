import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where,
    writeBatch,
} from 'firebase/firestore';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.M1_TEST_PROJECT ?? 'demo-m1-02';
const emulatorReady = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
let env;

before(async () => {
    if (!emulatorReady) return;
    env = await initializeTestEnvironment({
        projectId: project,
        firestore: { rules: await readFile(resolve(root, 'firestore.rules'), 'utf8') },
    });
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        for (const collectionName of ['pnjs', 'pnjs_prives', 'relations', 'indices', 'integrity_locks']) {
            const snapshot = await getDocs(collection(db, collectionName));
            await Promise.all(snapshot.docs.map(item => deleteDoc(item.ref)));
        }
        await setDoc(doc(db, 'pnjs', 'public'), {
            nom: 'PNJ public', visibleJoueurs: true, description: 'visible',
        });
        await setDoc(doc(db, 'pnjs', 'hidden'), {
            nom: 'PNJ masqué', visibleJoueurs: false, description: 'secret',
        });
        for (let index = 1; index <= 7; index += 1) {
            await setDoc(doc(db, 'pnjs', `public-${index}`), {
                nom: `PNJ public ${index}`, visibleJoueurs: true, description: 'visible',
            });
        }
        await setDoc(doc(db, 'pnjs_prives', 'public'), { notes: 'notes MJ' });
        await setDoc(doc(db, 'relations', 'public'), {
            source: 'public', cible: 'public', type: 'alliance', label: 'allie', visibleJoueurs: true,
        });
        await setDoc(doc(db, 'relations', 'hidden'), {
            source: 'public', cible: 'hidden', type: 'secret', label: 'cache', visibleJoueurs: false,
        });
        for (let index = 1; index <= 6; index += 1) {
            await setDoc(doc(db, 'relations', `page-${index}`), {
                source: `public-${index}`, cible: `public-${index + 1}`,
                type: 'page', label: 'page', visibleJoueurs: true,
            });
        }
        await setDoc(doc(db, 'indices', 'discovered'), {
            titre: 'Indice découvert', description: 'visible', decouvert: true, pnjsLies: ['public'],
        });
        await setDoc(doc(db, 'indices', 'secret'), {
            titre: 'Indice secret', description: 'secret', decouvert: false, pnjsLies: ['hidden'],
        });
    });
});

after(async () => { if (env) await env.cleanup(); });

function dbFor(uid, email, verified = true) {
    if (!env) return null;
    if (!uid) return env.unauthenticatedContext().firestore();
    return env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
}

async function denied(operation) {
    await assert.rejects(operation, error => error?.code === 'permission-denied');
}

function secured(name, fn) {
    return test(name, { skip: !emulatorReady }, fn);
}

secured('visibilité directe : visiteur et compte non-MJ', async () => {
    for (const db of [dbFor(), dbFor('player', 'player@example.com')]) {
        assert.equal((await getDoc(doc(db, 'pnjs', 'public'))).exists(), true);
        await denied(getDoc(doc(db, 'pnjs', 'hidden')));
        assert.equal((await getDoc(doc(db, 'relations', 'public'))).exists(), true);
        await denied(getDoc(doc(db, 'relations', 'hidden')));
        await denied(getDoc(doc(db, 'pnjs_prives', 'public')));
        assert.equal((await getDoc(doc(db, 'indices', 'discovered'))).exists(), true);
        await denied(getDoc(doc(db, 'indices', 'secret')));
    }
});

secured('MJ vérifié lit tout, MJ non vérifié reste visiteur', async () => {
    const gm = dbFor('gm', 'ethoril@gmail.com');
    for (const path of [['pnjs', 'hidden'], ['relations', 'hidden'], ['pnjs_prives', 'public'], ['indices', 'secret']]) {
        assert.equal((await getDoc(doc(gm, ...path))).exists(), true);
    }
    const unverified = dbFor('gm-unverified', 'ethoril@gmail.com', false);
    await denied(getDoc(doc(unverified, 'pnjs', 'hidden')));
    await denied(getDoc(doc(unverified, 'pnjs_prives', 'public')));
    await denied(getDoc(doc(unverified, 'indices', 'secret')));
});

secured('les listes non filtrées sont refusées et les requêtes publiques sont autorisées', async () => {
    const visitor = dbFor();
    await denied(getDocs(collection(visitor, 'pnjs')));
    await denied(getDocs(collection(visitor, 'relations')));
    await denied(getDocs(collection(visitor, 'indices')));
    assert.equal((await getDocs(query(collection(visitor, 'pnjs'), where('visibleJoueurs', '==', true)))).size, 8);
    assert.equal((await getDocs(query(collection(visitor, 'relations'), where('visibleJoueurs', '==', true)))).size, 7);
    assert.equal((await getDocs(query(collection(visitor, 'indices'), where('decouvert', '==', true)))).size, 1);
    assert.equal((await getDocs(query(collection(visitor, 'indices'), where('pnjsLies', 'array-contains', 'public'), where('decouvert', '==', true)))).size, 1);
});

secured('les validations de schéma refusent les écritures invalides', async () => {
    const gm = dbFor('gm', 'ethoril@gmail.com');
    await denied(setDoc(doc(gm, 'pnjs', 'bad-visible'), { nom: 'x', visibleJoueurs: 'oui' }));
    await denied(setDoc(doc(gm, 'pnjs', 'bad-name'), { nom: '', visibleJoueurs: true }));
    await denied(setDoc(doc(gm, 'pnjs', 'bad-field'), { nom: 'x', visibleJoueurs: true, notes: 'fuite' }));
    await denied(setDoc(doc(gm, 'pnjs', 'bad-size'), { nom: 'x'.repeat(201), visibleJoueurs: true }));
    await denied(setDoc(doc(gm, 'pnjs', 'bad-timestamp'), {
        nom: 'x', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: 'demain',
    }));
    await denied(setDoc(doc(gm, 'relations', 'bad-id'), {
        source: '', cible: 'public', type: 'x', visibleJoueurs: true,
    }));
    await denied(setDoc(doc(gm, 'relations', 'bad-type'), {
        source: 'public', cible: 'hidden', type: '', visibleJoueurs: true,
    }));
    await denied(setDoc(doc(gm, 'relations', 'public-masked-endpoint'), {
        source: 'public', cible: 'hidden', type: 'fuite', visibleJoueurs: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await denied(setDoc(doc(gm, 'pnjs_prives', 'bad-notes'), { notes: 42 }));
    await denied(setDoc(doc(gm, 'pnjs_prives', 'missing-notes'), { updatedAt: serverTimestamp() }));
    await denied(setDoc(doc(gm, 'indices', 'bad-discovery'), {
        titre: 'x', description: '', decouvert: 'oui', pnjsLies: [],
    }));
    await denied(setDoc(doc(gm, 'indices', 'missing-title'), {
        description: '', decouvert: true, pnjsLies: [],
    }));
    await denied(setDoc(doc(gm, 'indices', 'bad-links'), {
        titre: 'x', description: '', decouvert: true, pnjsLies: 'public',
    }));
    await denied(setDoc(doc(gm, 'indices', 'too-many-links'), {
        titre: 'x', description: '', decouvert: true, pnjsLies: Array(101).fill('public'),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await setDoc(doc(gm, 'pnjs', 'timestamped'), {
        nom: 'Timestampé', visibleJoueurs: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await denied(updateDoc(doc(gm, 'pnjs', 'timestamped'), {
        createdAt: new Date(), updatedAt: serverTimestamp(),
    }));
});

secured('seul le MJ vérifié écrit et peut supprimer', async () => {
    const gm = dbFor('gm', 'ethoril@gmail.com');
    const visitor = dbFor('player', 'player@example.com');
    const unverified = dbFor('gm-unverified', 'ethoril@gmail.com', false);
    const timestamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const validPnj = { nom: 'Créé par MJ', visibleJoueurs: false, description: '', ...timestamps };
    const validRelation = {
        source: 'public', cible: 'hidden', type: 'test', label: 'test', visibleJoueurs: false,
        ...timestamps,
    };
    const validPrivate = { notes: 'note de test', updatedAt: serverTimestamp() };
    const validIndice = {
        titre: 'Indice créé', description: '', decouvert: false, pnjsLies: [], ...timestamps,
    };
    await denied(setDoc(doc(visitor, 'pnjs', 'write-visitor'), validPnj));
    await denied(setDoc(doc(unverified, 'pnjs', 'write-unverified'), validPnj));
    for (const [collectionName, id, data] of [
        ['relations', 'write-visitor-relation', validRelation],
        ['pnjs_prives', 'write-visitor-private', validPrivate],
        ['indices', 'write-visitor-indice', validIndice],
    ]) {
        await denied(setDoc(doc(visitor, collectionName, id), data));
        await denied(setDoc(doc(unverified, collectionName, `unverified-${id}`), data));
    }
    await setDoc(doc(gm, 'pnjs', 'write-gm'), validPnj);
    await setDoc(doc(gm, 'relations', 'write-gm-relation'), validRelation);
    await setDoc(doc(gm, 'relations', 'write-gm-public-relation'), {
        source: 'public', cible: 'public-1', type: 'public', label: 'public', visibleJoueurs: true,
        ...timestamps,
    });
    await setDoc(doc(gm, 'pnjs_prives', 'write-gm'), validPrivate);
    await setDoc(doc(gm, 'indices', 'write-gm-indice'), validIndice);
    await updateDoc(doc(gm, 'pnjs', 'write-gm'), { visibleJoueurs: true, updatedAt: serverTimestamp() });
    await updateDoc(doc(gm, 'relations', 'write-gm-relation'), {
        label: 'modifié', updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(gm, 'pnjs_prives', 'write-gm'), {
        notes: 'note modifiée', updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(gm, 'indices', 'write-gm-indice'), {
        description: 'modifié', updatedAt: serverTimestamp(),
    });
    await runTransaction(gm, async transaction => {
        const pnjRef = doc(gm, 'pnjs', 'write-gm');
        const lockRef = doc(gm, 'integrity_locks', 'pnj-deletion');
        assert.equal((await transaction.get(lockRef)).exists(), false);
        assert.equal((await transaction.get(pnjRef)).exists(), true);
        transaction.update(pnjRef, { suppressionEnCours: true, updatedAt: serverTimestamp() });
        transaction.set(lockRef, {
            pnjId: 'write-gm', imagePaths: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
    });
    const finalDeletion = writeBatch(gm);
    finalDeletion.delete(doc(gm, 'pnjs_prives', 'write-gm'));
    finalDeletion.delete(doc(gm, 'pnjs', 'write-gm'));
    finalDeletion.delete(doc(gm, 'integrity_locks', 'pnj-deletion'));
    await finalDeletion.commit();
    await deleteDoc(doc(gm, 'relations', 'write-gm-relation'));
    await deleteDoc(doc(gm, 'relations', 'write-gm-public-relation'));
    await deleteDoc(doc(gm, 'indices', 'write-gm-indice'));
});
