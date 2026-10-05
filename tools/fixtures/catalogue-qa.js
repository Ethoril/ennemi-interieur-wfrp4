import { createReferentielsUi } from '../../js/catalogue/referentiels-ui.js';

const characterIds = ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren'];
const clone = value => globalThis.structuredClone(value);
const makeCatalogue = () => ({
    catalogVersion: 'fixture-v1',
    skills: { entries: [{ id: 'skill-athle', groupId: 'group-athle', group: 'Athlétisme',
        specializationId: null, specialization: null, nom: 'Athlétisme', carac: 'ag', basic: true, aliases: [] }], aliases: [] },
    talents: { entries: [{ id: 'talent-vigilance', key: 'vigilance', nom: 'Vigilance', sources: ['fixture'] }],
        aliases: [], templates: [], localDescriptions: [] },
});
const state = globalThis.catalogueQaState = {
    draft: makeCatalogue(), published: makeCatalogue(), draftRevision: 1, publishedRevision: 1,
    characters: characterIds.map((charId, index) => ({ charId, revision: index + 1,
        data: { nom: `Personnage QA ${index + 1}`, skillsBasic: { Athlétisme: index },
            skillsAdvanced: [{ id: `fixture-row-${index + 1}`, nom: 'Athlétisme ancien', adv: index + 2 }] } })),
    calls: [], lastDecisions: null,
};

const report = { skills: [{ name: 'Athlétisme ancien', occurrences: [{ kind: 'owned-advanced', scopeId: 'bhelgi' }] }],
    talents: [], counts: { skillLabels: 2, unresolvedSkills: 1, talentLabels: 1 } };
const callable = async envelope => {
    state.calls.push(clone(envelope));
    if (envelope.type === 'load') return { data: { report: clone(report), draft: clone(state.draft), published: clone(state.published),
        draftRevision: state.draftRevision, publishedRevision: state.publishedRevision, catalogVersion: state.published.catalogVersion } };
    if (envelope.type === 'saveDraft') {
        if (envelope.baseRevision !== state.draftRevision) throw new Error('Révision de brouillon périmée.');
        state.draft = clone(envelope.payload.catalogue);
        state.draftRevision += 1;
        return { data: { revision: state.draftRevision, catalogVersion: 'fixture-draft-v2' } };
    }
    if (envelope.type === 'previewMigration') {
        if (envelope.baseRevision !== state.draftRevision) throw new Error('Brouillon périmé pour la prévisualisation.');
        return { data: {
        catalogVersion: 'fixture-preview-v2',
        draftRevision: state.draftRevision,
        publishedRevision: state.publishedRevision,
        characters: state.characters.map(({ charId, revision }) => ({ charId, revision })),
        report: {
            counts: { skillLabels: 2, unresolvedSkills: 0, talentLabels: 2, talentMissingDescriptions: 1, talentSourceUnavailable: true },
            skills: report.skills,
            talents: [
                { name: 'Vigilance', occurrences: [{ resolved: { status: 'resolved', descriptionStatus: 'missing-reference' } }] },
                { name: 'Vision obscure', occurrences: [{ resolved: { status: 'resolved', descriptionStatus: 'source-unavailable' } }] },
            ],
        },
        migration: { collisions: state.characters.filter(({ data }) => data.skillsAdvanced.length > 0).map(({ charId, data }) => ({ key: `${charId}::skillsOwned::skill-athle`,
            scopeId: charId, scopeName: data.nom, targetId: 'skill-athle', targetName: 'Athlétisme', targetBasic: true,
            collection: 'skillsOwned', proposal: { status: 'insufficient-history',
                reason: 'Fixture : historique volontairement absent.' }, records: [
                { scopeId: charId, collection: 'skillsBasic', id: 'Athlétisme', nom: 'Athlétisme',
                    advances: data.skillsBasic.Athlétisme, history: [] },
                { scopeId: charId, collection: 'skillsAdvanced', id: data.skillsAdvanced[0].id,
                    nom: data.skillsAdvanced[0].nom, advances: data.skillsAdvanced[0].adv, history: [] },
            ],
        })), unresolved: [] },
    } };
    }
    if (envelope.type === 'publish') {
        if (envelope.baseRevision !== state.draftRevision || envelope.payload.publishedRevision !== state.publishedRevision
            || typeof envelope.payload.reason !== 'string' || envelope.payload.reason.trim().length < 3) {
            throw new Error('Révision ou motif de publication invalide.');
        }
        if (!state.characters.every(character => envelope.payload.characterRevisions?.[character.charId] === character.revision)) {
            throw new Error('Révision de fiche fictive périmée.');
        }
        state.lastDecisions = clone(envelope.payload.decisions);
        const collisions = state.characters.map(({ charId }) => `${charId}::skillsOwned::skill-athle`);
        if (state.lastDecisions.length !== collisions.length || new Set(state.lastDecisions.map(item => item.key)).size !== collisions.length) {
            throw new Error('Chaque fiche fictive doit recevoir exactement une décision de collision.');
        }
        const applied = [];
        for (const decision of state.lastDecisions) {
            const index = collisions.indexOf(decision.key);
            if (index < 0) throw new Error('La décision cible une collision inconnue.');
            const character = state.characters[index];
            const validWinner = [`${character.charId}\u0000skillsBasic\u0000Athlétisme`,
                `${character.charId}\u0000skillsAdvanced\u0000fixture-row-${index + 1}`].includes(decision.keepRecordKey);
            if (!character || !validWinner || decision.storageCollection !== 'skillsBasic'
                || !Number.isSafeInteger(decision.advances) || decision.advances < 0) {
                throw new Error(`Décision de fusion invalide pour ${decision.key}.`);
            }
            character.data.skillsBasic.Athlétisme = decision.advances;
            character.data.skillsAdvanced = character.data.skillsAdvanced.filter(row => row.id !== `fixture-row-${index + 1}`);
            character.revision += 1;
            applied.push({ personnage: character.data.nom, avances: decision.advances,
                stockage: 'Compétence de base', lignesAvanceesRetirees: 1 });
        }
        state.published = clone(state.draft);
        state.published.catalogVersion = 'fixture-published-v2';
        state.publishedRevision += 1;
        state.draftRevision += 1;
        const resultPanel = document.getElementById('qa-results');
        resultPanel.hidden = false;
        resultPanel.replaceChildren();
        const heading = document.createElement('h2');
        heading.textContent = 'Résultat appliqué aux cinq fiches fictives';
        const list = document.createElement('ul');
        for (const item of applied) {
            const row = document.createElement('li');
            row.textContent = `${item.personnage} · ${item.avances} avances · ${item.stockage} · ${item.lignesAvanceesRetirees} ligne avancée retirée`;
            list.append(row);
        }
        resultPanel.append(heading, list);
        return { data: { catalogVersion: state.published.catalogVersion, characters: applied } };
    }
    throw new Error(`Commande fixture inconnue : ${envelope.type}`);
};

const auth = {
    watchAuth(callback) {
        queueMicrotask(() => callback({ uid: 'mj-fixture', email: 'mj.fixture@example.invalid' }, true));
    },
    async loginWithGoogle() {},
    async logout() {},
};

createReferentielsUi({ callable, auth });
