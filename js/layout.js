const APP_VERSION = 'v1.2.0';

const NAV_ITEMS = [
    { href: 'index.html',   label: 'Accueil' },
    { href: 'groupe.html',  label: 'Le Groupe' },
    { href: 'videos.html',  label: 'Vidéos' },
    { href: 'tableau.html', label: 'Aides de Jeux' },
    { href: 'regles.html',  label: 'Règles' },
];

function injectNav() {
    const nav = document.getElementById('navbar');
    if (!nav) return;

    const linksHtml = NAV_ITEMS
        .map(item => `<li><a href="${item.href}">${item.label}</a></li>`)
        .join('');

    nav.innerHTML = `
        <div class="nav-container">
            <a href="index.html" class="nav-brand">
                <span>⚔️</span> L'Ennemi Intérieur <span class="nav-version">${APP_VERSION}</span>
            </a>
            <button class="nav-burger" id="nav-burger" aria-label="Menu">
                <span></span><span></span><span></span>
            </button>
            <ul class="nav-links" id="nav-links">${linksHtml}</ul>
        </div>`;
}

function injectFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;

    const note = footer.dataset.note
        ? `<br>${footer.dataset.note}`
        : '';

    footer.innerHTML = `
        <div class="container">
            <p>Warhammer Fantasy Roleplay — Campagne de l'Ennemi Intérieur</p>
            <p style="margin-top: 0.5rem; font-size: 0.8rem;">
                Warhammer Fantasy Roleplay © Games Workshop. Ce site est un outil non officiel à usage personnel.${note}
            </p>
        </div>`;
}

injectNav();
injectFooter();
