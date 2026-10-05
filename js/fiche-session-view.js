import { confirmTextAction } from './ui-confirm.js';

const PHASE_LABELS = Object.freeze({
    ready: 'Fiche synchronisée', saving: 'Enregistrement du brouillon',
    'awaiting-snapshot': 'Confirmation serveur en attente',
    'command-pending': 'Commande en attente de confirmation',
    'legacy-readonly': 'Fiche historique en lecture seule', tombstone: 'Fiche réinitialisée',
    loading: 'Chargement de la fiche', error: 'Chargement indisponible',
    missing: 'Fiche à initialiser par le MJ', 'signed-out': 'Déconnecté',
});

function displayValue(value) {
    try { return JSON.stringify(value); } catch { return String(value); }
}

export function createFicheSessionView({ getContainer, controller, confirmMigration = confirmTextAction } = {}) {
    if (typeof getContainer !== 'function' || !controller) throw new TypeError('Dépendances de vue de session invalides');

    let presence = [];
    let currentSessionId = null;
    let history = [];
    let migrationInProgress = false;

    function render(state) {
        const container = getContainer();
        if (!container) return;
        let root = container.querySelector('#fiche-session-actions');
        if (!root) {
            root = document.createElement('div');
            root.id = 'fiche-session-actions';
            root.className = 'fiche-session-actions';
            root.setAttribute('aria-live', 'polite');
            container.append(root);
        }
        root.replaceChildren();
        const status = document.createElement('span');
        status.className = 'fiche-session-summary';
        status.textContent = state.draftPersistenceUnavailable && state.hasDraft
            ? 'Modification gardée en mémoire seulement — sauvegarde locale indisponible'
            : state.error ? `État : ${state.error}`
            : state.phase === 'ready' && state.hasDraft ? 'Brouillon local en attente d’enregistrement'
                : (PHASE_LABELS[state.phase] || 'État de session');
        root.append(status);

        if (state.pendingPatchOperationId) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fiche-auth-btn';
            button.textContent = 'Réessayer l’enregistrement';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { await controller.retryPendingPatch(); } catch { /* décrit par le contrôleur */ }
                finally { button.disabled = false; }
            });
            root.append(button);
        }
        if (state.pendingOperationId && state.pendingOperationId !== state.pendingPatchOperationId) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fiche-auth-btn';
            button.textContent = 'Réessayer la commande';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try { await controller.retryPendingCommand(); } catch { /* décrit par le contrôleur */ }
                finally { button.disabled = false; }
            });
            root.append(button);
        }
        if (state.role === 'mj' && ['missing', 'tombstone'].includes(state.phase)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fiche-auth-btn';
            button.textContent = state.phase === 'missing' ? 'Importer pour initialiser la fiche' : 'Importer une sauvegarde';
            button.addEventListener('click', () => document.getElementById('btn-import-fiche')?.click());
            root.append(button);
        }
        if (state.role === 'mj' && state.phase === 'legacy-readonly') {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fiche-auth-btn';
            button.textContent = 'Migrer cette fiche historique';
            button.addEventListener('click', async () => {
                if (migrationInProgress) return;
                migrationInProgress = true;
                button.disabled = true;
                try {
                    const confirmId = await confirmMigration({
                        titre: 'Confirmer la migration de fiche',
                        message: `Cette opération convertit la fiche historique. Saisissez exactement l’identifiant « ${state.charId} » pour continuer.`,
                        libelleAction: 'Migrer la fiche',
                        danger: true,
                        input: { label: 'Identifiant de la fiche', placeholder: state.charId, maxLength: 128 },
                    });
                    if (typeof confirmId !== 'string' || !confirmId.trim()) return;
                    const result = await controller.migrateLegacy(confirmId);
                    status.textContent = result?.status === 'blocked'
                        ? 'Migration bloquée : anomalies à examiner.' : 'Migration envoyée au serveur.';
                } catch (error) {
                    status.textContent = `Migration refusée : ${error?.code || error?.message || 'erreur'}`;
                } finally {
                    migrationInProgress = false;
                    button.disabled = false;
                }
            });
            root.append(button);
        }
        if (state.phase === 'ready' && state.hasDraft && !state.pendingPatchOperationId && !state.pendingOperationId
            && !state.conflicts?.length) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fiche-auth-btn';
            button.textContent = 'Enregistrer le brouillon';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    const result = await controller.submitPatch();
                    if (result?.status === 'blocked' && result.reason === 'offline') {
                        status.textContent = state.draftPersistenceUnavailable
                            ? 'Modification gardée en mémoire seulement — connexion requise, sauvegarde locale indisponible.'
                            : 'Brouillon conservé sur cet appareil — connexion requise pour l’enregistrer.';
                    }
                } catch { /* décrit par le contrôleur */ }
                finally { button.disabled = false; }
            });
            root.append(button);
        }
        if (state.phase === 'ready' && !state.hasDraft && !state.pendingOperationId
            && typeof controller.listOtherDraftSessions === 'function') {
            const sessions = controller.listOtherDraftSessions();
            if (sessions.length) {
                const recovery = document.createElement('div');
                recovery.className = 'fiche-draft-recovery';
                const label = document.createElement('span');
                label.textContent = 'Brouillon(s) d’une autre session disponible(s) :';
                recovery.append(label);
                for (const draft of sessions) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'fiche-auth-btn';
                    const date = draft.savedAt ? new Date(draft.savedAt).toLocaleString('fr-FR') : 'date inconnue';
                    button.textContent = `Récupérer ${draft.changeCount} modification(s) · ${date}`;
                    button.addEventListener('click', () => controller.restoreDraftSession(draft.sessionId));
                    recovery.append(button);
                }
                root.append(recovery);
            }
        }
        if (state.conflicts?.length) {
            const list = document.createElement('ul');
            list.className = 'fiche-conflict-list';
            for (const conflict of state.conflicts) {
                const item = document.createElement('li');
                const description = document.createElement('span');
                description.textContent = `${conflict.path} : local ${displayValue(conflict.local)} · serveur ${displayValue(conflict.server)}`;
                item.append(description);
                for (const [choice, label] of [['server', 'Garder serveur'], ['local', 'Garder ma saisie']]) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'fiche-auth-btn';
                    button.textContent = label;
                    button.addEventListener('click', async () => {
                        if (!controller.resolveConflict(conflict.path, choice)) return;
                        if (choice !== 'local') return;
                        const next = controller.getState();
                        if (next.phase !== 'ready' || next.conflicts?.length || !next.hasDraft) return;
                        try {
                            const result = await controller.submitPatch();
                            if (result?.status === 'blocked' && result.reason === 'offline') {
                                status.textContent = 'Votre choix est conservé en brouillon — connexion requise pour l’enregistrer.';
                            }
                        } catch { /* décrit par le contrôleur */ }
                    });
                    item.append(button);
                }
                list.append(item);
            }
            root.append(list);
        }
        const activePresence = presence.filter(item => item.id !== currentSessionId
            && Date.now() - timestampMillis(item.lastSeenAt) <= 60_000);
        if (activePresence.length) {
            const section = document.createElement('section');
            section.className = 'fiche-presence';
            const heading = document.createElement('strong');
            heading.textContent = 'Autres sessions actives';
            section.append(heading);
            const list = document.createElement('ul');
            for (const item of activePresence) {
                const row = document.createElement('li');
                const name = typeof item.displayName === 'string' && item.displayName.trim() ? item.displayName.trim() : 'Compte connecté';
                row.textContent = `${name} · ${item.role === 'mj' ? 'Maître du Jeu' : 'Joueur'}`;
                list.append(row);
            }
            section.append(list);
            root.append(section);
        }
        if (history.length) {
            const section = document.createElement('details');
            section.className = 'fiche-history';
            const heading = document.createElement('summary');
            heading.textContent = `Historique des commandes (${history.length})`;
            section.append(heading);
            const list = document.createElement('ol');
            for (const event of history) {
                const row = document.createElement('li');
                const title = document.createElement('strong');
                const date = timestampMillis(event.createdAt);
                const dateLabel = date ? new Date(date).toLocaleString('fr-FR') : 'date inconnue';
                const typeLabel = String(event.type || 'commande').replace(/[-_]/gu, ' ');
                title.textContent = `Révision ${event.revision ?? '?'} · ${typeLabel} · ${event.role === 'mj' ? 'MJ' : 'joueur'} · ${dateLabel}`;
                row.append(title);
                if (event.reason || event.summary?.target) {
                    const reason = document.createElement('p');
                    reason.textContent = String(event.reason || event.summary.target);
                    row.append(reason);
                }
                const changes = event.effects || event.changes;
                if (Array.isArray(changes)) {
                    for (const change of changes) {
                        const detail = document.createElement('div');
                        detail.textContent = `${String(change.path || 'champ')} : ${displayValue(change.before)} → ${displayValue(change.after)}`;
                        row.append(detail);
                    }
                } else if (changes && typeof changes === 'object') {
                    for (const [path, change] of Object.entries(changes)) {
                        const detail = document.createElement('div');
                        detail.textContent = `${path} : ${displayValue(change?.before)} → ${displayValue(change?.after)}`;
                        row.append(detail);
                    }
                }
                list.append(row);
            }
            section.append(list);
            root.append(section);
        }
    }

    function timestampMillis(value) {
        if (typeof value?.toMillis === 'function') return value.toMillis();
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number') return value;
        return 0;
    }

    return Object.freeze({
        render,
        setPresence(entries, sessionId) { presence = Array.isArray(entries) ? entries : []; currentSessionId = sessionId || null; render(controller.getState()); },
        setHistory(entries) { history = Array.isArray(entries) ? entries : []; render(controller.getState()); },
    });
}
