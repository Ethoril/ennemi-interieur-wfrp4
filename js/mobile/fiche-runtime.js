// Chargé à la demande par app.js : garde les SDK Firebase hors de la coque mobile.
import { db, functions } from '../firebase-init.js';
import {
    collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { createFicheRepository } from '../fiche-repository.js';

export const repository = createFicheRepository({
    db,
    doc,
    onSnapshot,
    collection,
    query,
    orderBy,
    limit,
    setDoc,
    deleteDoc,
    serverTimestamp,
    callCommand: httpsCallable(functions, 'executeFicheCommand'),
    callMigration: httpsCallable(functions, 'migrateFiche'),
});
