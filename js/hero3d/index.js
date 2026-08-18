// js/hero3d/index.js
// Gating et initialisation de l'expérience 3D

function checkSupport() {
  // 1. WebGL
  const canvas = document.createElement('canvas');
  const webgl = !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  if (!webgl) return false;

  // 2. Reduced motion
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return false;

  // 3. Mobile
  if (window.innerWidth < 768) return false;

  // 4. Thème actuel (pas de 3D sur le thème parchemin)
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'parchment') return false;

  // 5. Import Map support
  if (HTMLScriptElement.supports && !HTMLScriptElement.supports('importmap')) return false;

  return true;
}

let sceneModule = null;

async function initHero3D() {
  if (!checkSupport()) {
    // En debug : le diagnostic « pourquoi la scène ne s'affiche pas » reste
    // utile, mais il n'a rien à faire dans la console par défaut.
    console.debug("Hero3D: Conditions non réunies (ou fallback actif), scène ignorée.");
    return;
  }

  try {
    document.documentElement.classList.add('hero3d-active');
    sceneModule = await import('./scene.js');
    sceneModule.init();
  } catch (err) {
    console.error("Hero3D: Erreur lors de l'import de la scène", err);
    document.documentElement.classList.remove('hero3d-active');
  }
}

// Gestion des changements de thème
document.addEventListener('themechange', (e) => {
  const isParchment = e.detail === 'parchment';
  
  if (isParchment) {
    // Désactiver la scène si on passe en parchemin
    document.documentElement.classList.remove('hero3d-active');
    if (sceneModule) sceneModule.pause();
  } else {
    // Réactiver si on revient en dark
    if (window.innerWidth >= 768 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.classList.add('hero3d-active');
      if (sceneModule) {
        sceneModule.resume();
      } else {
        // Premier chargement différé
        initHero3D();
      }
    }
  }
});

// Boot initial
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHero3D);
} else {
  initHero3D();
}
