import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDocs, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
let env, gm, player, visitor;
const catalogue = JSON.parse(await readFile('js/data/equipment-catalog.json', 'utf8'));
before(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
    if (!host || !['127.0.0.1', 'localhost'].includes(host)) throw new Error('Émulateur local requis');
    env = await initializeTestEnvironment({ projectId: 'demo-equipment', firestore: { host, port: Number(port), rules: await readFile('firestore.rules', 'utf8') } });
    gm = env.authenticatedContext('mj', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
    player = env.authenticatedContext('joueur', { email: 'player@example.test', email_verified: true }).firestore();
    visitor = env.unauthenticatedContext().firestore();
    await env.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'campagne/acces'), { test: ['player@example.test'] });
        await setDoc(doc(context.firestore(), 'fiches/test'), { schemaVersion: 2, revision: 1, data: { equipment: [] } });
    });
});
after(async () => { await env?.cleanup(); });
test('modèles réutilisables : création et lecture MJ, aucun accès joueur ou visiteur', async () => {
    const model = { item: catalogue.items[0], createdAt: serverTimestamp() };
    await assertFails(setDoc(doc(player, 'equipment_models/player_model'), model));
    await assertFails(setDoc(doc(visitor, 'equipment_models/visitor_model'), model));
    await assertSucceeds(setDoc(doc(gm, 'equipment_models/gm_model'), model));
    await assertSucceeds(getDoc(doc(gm, 'equipment_models/gm_model')));
    await assertSucceeds(getDocs(collection(gm, 'equipment_models')));
    await assertFails(getDoc(doc(player, 'equipment_models/gm_model')));
    await assertFails(getDocs(collection(player, 'equipment_models')));
    await assertFails(getDoc(doc(visitor, 'equipment_models/gm_model')));
    await assertFails(updateDoc(doc(gm, 'equipment_models/gm_model'), { 'item.name': 'Écrasement' }));
    await assertFails(deleteDoc(doc(player, 'equipment_models/gm_model')));
    await assertSucceeds(deleteDoc(doc(gm, 'equipment_models/gm_model')));
});
test('les modèles refusent les schémas ouverts et les PA ou zones invalides', async () => {
    for (const [i, item] of [
        { ...catalogue.items[0], secret: 'Champ supplémentaire' },
        { ...catalogue.items[0], ap: -1 },
        { ...catalogue.items[0], locations: ['unknown'] },
        { name: 'Schéma incomplet', keywords: [] },
    ].entries()) await assertFails(setDoc(doc(gm, `equipment_models/invalid_${i}`), { item, createdAt: serverTimestamp() }));
});
test('l’équipement de la fiche passe toujours par la commande serveur, même pour le MJ', async () => {
    await assertFails(updateDoc(doc(gm, 'fiches/test'), { 'data.equipment': [catalogue.items[0]], revision: 2 }));
    await assertFails(updateDoc(doc(player, 'fiches/test'), { 'data.equipment': [catalogue.items[0]], revision: 2 }));
});
