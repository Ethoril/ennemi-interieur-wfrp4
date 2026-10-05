import test from 'node:test';
import assert from 'node:assert/strict';
import { createFicheSessionView } from '../js/fiche-session-view.js';

class ElementFake {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.listeners = new Map();
        this.disabled = false;
        this.textContent = '';
    }
    setAttribute() {}
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    async click() { return this.listeners.get('click')?.(); }
}

function setupView({ controller, confirmMigration }) {
    const container = new ElementFake('section');
    container.querySelector = () => null;
    const priorDocument = globalThis.document;
    const priorPrompt = globalThis.prompt;
    globalThis.document = { createElement: tagName => new ElementFake(tagName) };
    globalThis.prompt = () => { throw new Error('prompt() ne doit jamais être appelé'); };
    const view = createFicheSessionView({ getContainer: () => container, controller, confirmMigration });
    view.render({ role: 'mj', phase: 'legacy-readonly', charId: 'caelel' });
    const root = container.children[0];
    const status = root.children[0];
    const button = root.children.find(element => element.tagName === 'button');
    return {
        status,
        button,
        restore() {
            if (priorDocument === undefined) delete globalThis.document;
            else globalThis.document = priorDocument;
            if (priorPrompt === undefined) delete globalThis.prompt;
            else globalThis.prompt = priorPrompt;
        },
    };
}

test('annuler la modale de migration ne lance aucune commande et n’appelle pas prompt', async () => {
    let migrationCalls = 0;
    let confirmCalls = 0;
    let resolveConfirmation;
    const ui = setupView({
        controller: { async migrateLegacy() { migrationCalls++; } },
        confirmMigration(options) {
            confirmCalls++;
            return new Promise(resolve => { resolveConfirmation = resolve; });
        },
    });
    try {
        const action = ui.button.click();
        assert.equal(ui.button.disabled, true);
        await ui.button.click(); // Une deuxième activation pendant l’attente est ignorée.
        assert.equal(confirmCalls, 1);
        assert.equal(migrationCalls, 0);
        resolveConfirmation(false);
        await action;
        assert.equal(migrationCalls, 0);
        assert.equal(ui.button.disabled, false);
        assert.equal(ui.status.textContent, 'Fiche historique en lecture seule');
    } finally {
        ui.restore();
    }
});

test('une saisie confirmée transmet une seule fois l’ID au contrôleur et restaure le bouton après réponse', async () => {
    const ids = [];
    let resolveMigration;
    let confirmCalls = 0;
    const ui = setupView({
        controller: {
            migrateLegacy(id) {
                ids.push(id);
                return new Promise(resolve => { resolveMigration = resolve; });
            },
        },
        async confirmMigration(options) {
            confirmCalls++;
            assert.equal(options.input.label, 'Identifiant de la fiche');
            assert.equal(options.input.placeholder, 'caelel');
            assert.match(options.message, /caelel/u);
            return 'caelel';
        },
    });
    try {
        const action = ui.button.click();
        await Promise.resolve();
        assert.equal(ui.button.disabled, true);
        await ui.button.click();
        assert.deepEqual(ids, ['caelel']);
        assert.equal(confirmCalls, 1);
        resolveMigration({ status: 'blocked' });
        await action;
        assert.equal(ui.status.textContent, 'Migration bloquée : anomalies à examiner.');
        assert.equal(ui.button.disabled, false);
    } finally {
        ui.restore();
    }
});
