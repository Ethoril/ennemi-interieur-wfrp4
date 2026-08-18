const navigateur = {
    window: 'readonly', document: 'readonly', navigator: 'readonly',
    localStorage: 'readonly', location: 'readonly', history: 'readonly',
    fetch: 'readonly', console: 'readonly', performance: 'readonly',
    alert: 'readonly', confirm: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly',
    requestAnimationFrame: 'readonly',
    URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
    FileReader: 'readonly', CustomEvent: 'readonly', Response: 'readonly',
    IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
    MutationObserver: 'readonly', CSS: 'readonly',
    HTMLScriptElement: 'readonly', WebGLRenderingContext: 'readonly',
    // Globales du projet, posées hors module
    L: 'readonly',                    // Leaflet, chargé en script classique
    WFRP_CAREERS: 'readonly',         // js/fiche.js, via window
    WFRP_SKILLS: 'readonly',
    WFRP_SKILL_GROUPS_WITH_SPECS: 'readonly',
};

const travailleur = {
    self: 'readonly', caches: 'readonly', clients: 'readonly',
    Request: 'readonly', Response: 'readonly', URL: 'readonly',
    fetch: 'readonly', console: 'readonly',
};

const regles = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none' }],
    'no-unsafe-optional-chaining': 'error',
    'no-constant-condition': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-self-assign': 'error',
    'no-unreachable': 'error',
    'no-fallthrough': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
};

export default [
    { ignores: ['node_modules/**', 'tiles/**', 'docs/**'] },
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'module', globals: navigateur,
        },
        rules: regles,
    },
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'script', globals: travailleur,
        },
        rules: { ...regles, 'no-unused-vars': 'warn' },
    },
    {
        files: ['tools/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'module',
            globals: { process: 'readonly', console: 'readonly', require: 'readonly', fetch: 'readonly' },
        },
        rules: regles,
    },
];
