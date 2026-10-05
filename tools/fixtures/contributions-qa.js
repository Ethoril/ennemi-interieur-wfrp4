import { mountContentTrashPanel, mountContributionButton } from '../../js/contributions/editor.js';

const output = document.getElementById('qa-status');
const opsOutput = document.getElementById('qa-ops-output');
const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!allowedHosts.has(window.location.hostname)) {
    document.body.replaceChildren(Object.assign(document.createElement('p'), {
        textContent: 'Cette fixture ne fonctionne que sur localhost. Aucune donnée n’a été chargée.',
    }));
    throw new Error('Contribution QA fixture is localhost-only');
}

const docs = new Map([
    ['pnj:public', { nom: 'Mara Vif-Argent', statut: 'Neutre', vivant: 'Vivant', lieu: 'Altdorf', groupes: ['Veilleurs'], description: 'Ancienne pisteuse, prudente et directe.', visibleJoueurs: true, imagePath: null }],
    ['pnj:public-2', { nom: 'Jorik Lanterne', statut: 'Allié', vivant: 'Vivant', lieu: 'Altdorf', groupes: ['Veilleurs'], description: 'Messager fictif de démonstration.', visibleJoueurs: true, imagePath: null }],
    ['pnj:secret', { nom: 'Le Messager voilé', statut: 'Inconnu', vivant: 'Vivant', lieu: 'Les docks', groupes: [], description: 'Dossier secret de démonstration.', visibleJoueurs: false, imagePath: null }],
    ['indice:clue-1', { titre: 'Lettre cachetée', description: 'La cire porte un sceau brisé.', source: 'Cave de la Schaffenfest', type: 'Document', dateDecouverte: '2026-10-01', pnjsLies: ['public'], decouvert: true, imagePath: null }],
    ['relation:edge-1', { source: 'public', cible: 'public-2', type: 'contact', label: 'connaît', color: '#a47734', style: 'solid', visibleJoueurs: true, reciprocalId: 'edge-2', reciprocalRevision: 3 }],
]);
const revisions = new Map([...docs.keys()].map(key => [key, 3]));
const listeners = new Set();
let currentRole = 'joueur';
let failNext = null;
let imageNumber = 0;
let trash = null;
let history = [];

function userForRole(role) {
    return role === 'public' ? null : {
        uid: role === 'mj' ? 'qa-mj' : 'qa-player',
        displayName: role === 'mj' ? 'MJ de test' : 'Joueur de test',
        emailVerified: true,
    };
}

function announce(message) { output.textContent = message; }
function printOp(name, value) { opsOutput.textContent = `${name}\n${JSON.stringify(value, null, 2)}`; }

const client = Object.freeze({
    watch(listener) {
        listeners.add(listener);
        listener({ user: userForRole(currentRole), capabilities: { role: currentRole, contribution: currentRole !== 'public', characterIds: ['bhelgi'] } });
        return () => listeners.delete(listener);
    },
    currentUser: () => userForRole(currentRole),
    async getCampaignCapabilities() {
        return { role: currentRole, contribution: currentRole !== 'public', characterIds: ['bhelgi'] };
    },
    async getContentEditContext({ kind, id }) {
        const key = `${kind}:${id}`;
        const data = structuredClone(docs.get(key) || {});
        return {
            kind, id, data, revision: revisions.get(key) || 1, managed: true,
            canEdit: currentRole === 'mj' || data.visibleJoueurs === true || data.decouvert === true,
            canDelete: currentRole === 'mj' || (currentRole === 'joueur' && key === 'pnj:public'),
            reciprocalRevision: 3,
        };
    },
    async getContentPnjChoices({ limit = 500, cursor = null } = {}) {
        requireRole('joueur');
        const source = [...docs.entries()]
            .filter(([key, data]) => key.startsWith('pnj:') && (currentRole === 'mj' || data.visibleJoueurs === true))
            .map(([key, data]) => ({ id: key.slice(4), nom: data.nom }))
            .filter(item => typeof item.nom === 'string' && item.nom)
            .sort((left, right) => left.nom.localeCompare(right.nom));
        const cursorIndex = cursor ? source.findIndex(item => item.id === cursor) : -1;
        const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
        const size = Number.isInteger(limit) ? Math.min(500, Math.max(1, limit)) : 500;
        const page = source.slice(start, start + size);
        return { pnjs: structuredClone(page), nextCursor: start + page.length < source.length ? page.at(-1)?.id ?? null : null };
    },
    async getContentHistory({ kind, id }) {
        if (failNext === 'offline') { failNext = null; throw Object.assign(new Error('Offline'), { code: 'unavailable' }); }
        const events = history.filter(event => event.kind === kind && event.id === id);
        printOp('getContentHistory', events);
        return { items: events, nextCursor: null };
    },
    async mutatePublicContent(command) { return mutate(command, 'joueur'); },
    async mutateMjContent(command) { return mutate(command, 'mj'); },
    async uploadContributionImage(command) {
        if (currentRole === 'public') throw Object.assign(new Error('forbidden'), { code: 'permission-denied' });
        imageNumber += 1;
        const receipt = { imagePath: `${command.kind === 'portrait' ? 'portraits' : 'indices'}/${command.ownerId}/qa-${imageNumber}.png`, digest: 'fictitious-sha256' };
        printOp('uploadContributionImage (simulation)', { ...command, base64: '[bytes fictives omises]', receipt });
        return receipt;
    },
    async trashPublicContent(command) {
        requireRole('joueur');
        trash = { ...command, id: command.id, revision: command.baseRevision, canRestore: true,
            ownerUid: currentRole === 'joueur' ? 'qa-player' : 'qa-mj', ownerCanRestore: true, state: 'trashed', summary: 'Mara Vif-Argent' };
        printOp('trashPublicContent (simulation)', trash);
        return trash;
    },
    async restorePublicContent(command) {
        if (currentRole !== 'mj' && trash?.ownerUid !== 'qa-player') throw Object.assign(new Error('forbidden'), { code: 'permission-denied' });
        if (trash) { trash.state = 'restored'; trash.revision = command.baseRevision ?? trash.revision; }
        printOp('restorePublicContent (simulation)', trash);
        return trash;
    },
    async setTrashVisibility(command) {
        requireRole('mj');
        if (trash) trash.ownerCanRestore = command.ownerCanRestore;
        printOp('setTrashVisibility (simulation)', trash);
        return trash;
    },
    async listContentTrash() {
        const visible = currentRole === 'mj' || (trash?.ownerUid === 'qa-player' && trash?.ownerCanRestore);
        const result = visible && trash?.state === 'trashed' ? [structuredClone(trash)] : [];
        printOp('listContentTrash (simulation)', result);
        return { entries: result, nextCursor: null };
    },
    async purgePublicContent(command) {
        requireRole('mj');
        const purged = trash;
        trash = null;
        printOp('purgePublicContent (simulation)', { command, purged });
        return { purged: true };
    },
});

function requireRole(required) {
    if (currentRole !== required && currentRole !== 'mj') throw Object.assign(new Error('forbidden'), { code: 'permission-denied' });
}

async function mutate(command, role) {
    if (failNext) {
        const failure = failNext;
        failNext = null;
        throw Object.assign(new Error(failure), { code: failure === 'conflict' ? 'aborted' : 'unavailable' });
    }
    if (currentRole !== role && currentRole !== 'mj') throw Object.assign(new Error('forbidden'), { code: 'permission-denied' });
    const key = `${command.kind}:${command.id}`;
    const previousRevision = revisions.get(key) || 0;
    const nextRevision = previousRevision + 1;
    if (command.action === 'create') docs.set(key, structuredClone(command.changes));
    else docs.set(key, { ...(docs.get(key) || {}), ...structuredClone(command.changes) });
    revisions.set(key, nextRevision);
    history.unshift({ kind: command.kind, id: command.id, revision: nextRevision, actor: 'self', role, summary: Object.keys(command.changes).join(', ') });
    printOp(role === 'mj' ? 'mutateMjContent (simulation)' : 'mutatePublicContent (simulation)', command);
    return { ...command, revision: nextRevision };
}

const editors = [
    ['qa-pnj-public', { kind: 'pnj', id: 'public' }],
    ['qa-pnj-secret', { kind: 'pnj', id: 'secret' }],
    ['qa-indice', { kind: 'indice', id: 'clue-1' }],
    ['qa-relation', { kind: 'relation', id: 'edge-1' }],
    ['qa-create', { kind: 'indice', action: 'create' }],
];
for (const [elementId, options] of editors) {
    mountContributionButton({ container: document.getElementById(elementId), client, ...options, announce });
}
mountContentTrashPanel({ container: document.getElementById('qa-trash-panel'), client, announce });

function switchRole(role) {
    currentRole = role;
    for (const listener of listeners) listener({ user: userForRole(role), capabilities: { role, contribution: role !== 'public', characterIds: ['bhelgi'] } });
    announce(`Session fictive : ${role}.`);
}

document.getElementById('role-player').addEventListener('click', () => switchRole('joueur'));
document.getElementById('role-mj').addEventListener('click', () => switchRole('mj'));
document.getElementById('role-public').addEventListener('click', () => switchRole('public'));
document.getElementById('network-offline').addEventListener('click', () => { failNext = 'offline'; announce('La prochaine callable simulera une coupure réseau.'); });
document.getElementById('network-conflict').addEventListener('click', () => { failNext = 'conflict'; announce('La prochaine écriture simulera une révision obsolète.'); });
document.getElementById('viewport-mobile').addEventListener('click', () => document.body.classList.add('qa-mobile-preview'));
document.getElementById('viewport-desktop').addEventListener('click', () => document.body.classList.remove('qa-mobile-preview'));
document.getElementById('qa-history').addEventListener('click', async () => printOp('getContentHistory', await client.getContentHistory({ kind: 'pnj', id: 'public', limit: 20 })));
document.getElementById('qa-trash').addEventListener('click', async () => {
    if (currentRole === 'public') return announce('Action refusée à la session visiteur simulée.');
    await client.trashPublicContent({ kind: 'pnj', id: 'public', operationId: 'qa-trash-1', baseRevision: revisions.get('pnj:public') });
});
document.getElementById('qa-restore').addEventListener('click', async () => {
    try { await client.restorePublicContent({ kind: 'pnj', id: 'public', operationId: 'qa-restore-1' }); }
    catch { announce('Restauration refusée par le client fictif.'); }
});
document.getElementById('qa-hide-trash').addEventListener('click', async () => {
    try { await client.setTrashVisibility({ kind: 'pnj', id: 'public', ownerCanRestore: false }); }
    catch { announce('Action réservée au MJ fictif.'); }
});
document.getElementById('qa-purge').addEventListener('click', async () => {
    try { await client.purgePublicContent({ kind: 'pnj', id: 'public', operationId: 'qa-purge-1', confirm: true }); }
    catch { announce('Purge réservée au MJ fictif.'); }
});
document.getElementById('qa-upload').addEventListener('click', async () => {
    try { printOp('uploadContributionImage', await client.uploadContributionImage({ kind: 'portrait', ownerId: 'public', operationId: 'qa-upload-1', contentType: 'image/png', base64: 'iVBORw0KGgo=' })); }
    catch { announce('Téléversement réservé à une session autorisée.'); }
});
