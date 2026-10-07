import { createPublishedCatalogueEngine } from '../fiche/published-catalogue-engine.js';

const DATA_FILES = Object.freeze({
    careers: '../data/careers.json',
    skills: '../data/skills.json',
    rules: '../data/fiche-catalog.json',
    catalogue: '../catalogue/referentiel-public.json',
    talents: '../catalogue/talents-sheet-snapshot.json',
    equipment: '../data/equipment-catalog.json',
});

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Données fiche indisponibles (${response.status})`);
    return response.json();
}

/**
 * Charge les données de règles (chemins relatifs à ce module, donc valides depuis /app/) et
 * expose le moteur courant. Le référentiel vivant le reconstruit ; le JSON statique sert de repli.
 */
export async function loadFicheCatalogue({ load = url => fetchJson(new URL(url, import.meta.url)) } = {}) {
    const [careers, skills, rules, staticCatalogue, talentSheetSnapshot, equipmentCatalogue] = await Promise.all(
        Object.values(DATA_FILES).map(load),
    );
    const listeners = new Set();
    // ruleCatalog : sorts et miracles publiés, pour lister ce qui peut s'apprendre (le moteur ne les expose pas).
    const build = catalogue => ({
        ...createPublishedCatalogueEngine({ catalogue, careers, skills, spells: rules, talentSheetSnapshot, equipmentCatalogue }),
        ruleCatalog: { spells: rules.spells, miracles: rules.miracles },
    });
    let engine = build(staticCatalogue);

    // Un catalogue vivant invalide ou absent laisse le moteur courant en place.
    const setLive = catalogue => {
        let next;
        try { next = build(catalogue || staticCatalogue); } catch { return false; }
        if (next.catalogVersion === engine.catalogVersion) return false;
        engine = next;
        listeners.forEach(listener => listener(engine));
        return true;
    };

    return Object.freeze({
        careers,
        equipmentCatalogue,
        getEngine: () => engine,
        setLive,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        watch(repository) {
            return repository.subscribePublicCatalogue(setLive, () => {});
        },
    });
}
