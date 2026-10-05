const CHAR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export function createFicheRepository({
    db, doc, onSnapshot, callCommand, callMigration, collection, query, orderBy, limit,
    setDoc, deleteDoc, serverTimestamp,
} = {}) {
    if (!db || typeof doc !== 'function' || typeof onSnapshot !== 'function'
        || typeof callCommand !== 'function') throw new TypeError('Dépendances Firestore fiche invalides');

    function ficheRef(charId) {
        if (typeof charId !== 'string' || !CHAR_ID_PATTERN.test(charId)) throw new TypeError('Personnage invalide');
        return doc(db, 'fiches', charId);
    }

    function childCollection(charId, name) {
        if (typeof collection !== 'function') throw new Error('Abonnement annexe indisponible');
        return collection(ficheRef(charId), name);
    }

    return Object.freeze({
        subscribe(charId, onValue, onError = () => {}) {
            if (typeof onValue !== 'function') throw new TypeError('Callback Firestore invalide');
            return onSnapshot(ficheRef(charId), snapshot => onValue({
                exists: snapshot.exists(),
                envelope: snapshot.exists() ? snapshot.data() : null,
            }), onError);
        },
        subscribePublicCatalogue(onValue, onError = () => {}) {
            if (typeof onValue !== 'function') throw new TypeError('Callback référentiel invalide');
            return onSnapshot(doc(db, 'referentiels', 'public'), snapshot => {
                const data = snapshot.exists() ? snapshot.data() : null;
                onValue(data && typeof data.catalogue === 'object' ? data.catalogue : null);
            }, onError);
        },
        async execute(command) {
            const { data } = await callCommand(command);
            return data;
        },
        async migrate(payload) {
            if (typeof callMigration !== 'function') throw new Error('Callable de migration indisponible');
            const { data } = await callMigration(payload);
            return data;
        },
        subscribeHistory(charId, onValue, onError = () => {}) {
            let target = childCollection(charId, 'history');
            if (typeof query === 'function' && typeof orderBy === 'function' && typeof limit === 'function') {
                target = query(target, orderBy('revision', 'desc'), limit(30));
            }
            return onSnapshot(target, snapshot => onValue(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), onError);
        },
        subscribePresence(charId, onValue, onError = () => {}) {
            return onSnapshot(childCollection(charId, 'presence'), snapshot => onValue(
                snapshot.docs.map(item => ({ id: item.id, ...item.data() })),
            ), onError);
        },
        async heartbeatPresence(charId, sessionId, { uid, displayName, role } = {}) {
            if (typeof setDoc !== 'function' || typeof serverTimestamp !== 'function') throw new Error('Écriture de présence indisponible');
            const reference = doc(childCollection(charId, 'presence'), sessionId);
            await setDoc(reference, { uid, displayName, role, lastSeenAt: serverTimestamp() });
        },
        async removePresence(charId, sessionId) {
            if (typeof deleteDoc !== 'function') return;
            await deleteDoc(doc(childCollection(charId, 'presence'), sessionId));
        },
    });
}
