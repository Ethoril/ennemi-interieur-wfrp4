import * as THREE from 'three';

let scrollProgress = 0;
let targetProgress = 0;
let anchors = [];
let ro = null;

// Points clés de la caméra (x, y, z)
// Chapitre 1: Base (0)
// Chapitre 2: Avancée vers la comète (1)
// Chapitre 3: Pivot Morrslieb (2)
// Chapitre 4: Plongée Skyline (3)
// Fin du scroll (4)
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, -10, 150),    // 0. Départ (bas, regarde haut)
  new THREE.Vector3(0, 10, 80),      // 1. Approche comète
  new THREE.Vector3(-50, 45, 0),     // 2. Pivot Morrslieb
  new THREE.Vector3(-20, 18, 28),    // 3. Descente vers la ville
  new THREE.Vector3(10, 5, 40)       // 4. Fin : au niveau des toits
]);

const lookAtCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 41, 0),       // 0. Regarde haut (étoiles) - Décalé pour éviter NaN
  new THREE.Vector3(45, 95, -40),    // 1. Regarde la comète (en haut à droite)
  new THREE.Vector3(-160, 110, -100),// 2. Regarde Morrslieb
  new THREE.Vector3(-15, 8, -40),    // 3. Bascule vers la skyline
  new THREE.Vector3(-30, 18, -40)    // 4. Fin : toits + Morrslieb au-dessus de la ville
]);

export function initTimeline() {
  calculateAnchors();
  
  // ResizeObserver pour gérer l'apparition du calendrier etc.
  ro = new ResizeObserver(() => {
    calculateAnchors();
  });
  ro.observe(document.body);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', calculateAnchors);
  
  // Init
  onScroll();
  scrollProgress = targetProgress; // Pas d'animation au chargement initial
}

function calculateAnchors() {
  anchors = [];
  
  // Chapitre 1
  const hero = document.getElementById('hero');
  anchors.push({ el: hero, chapter: 0 });
  
  // Chapitre 2
  const nextSession = document.getElementById('next-session');
  anchors.push({ el: nextSession, chapter: 1 });
  
  // Chapitre 3
  // Le bloc .section (cartes)
  const navCards = document.querySelector('.card-grid');
  anchors.push({ el: navCards, chapter: 2 });
  
  // Chapitre 4
  const ornament = document.querySelector('.ornament');
  anchors.push({ el: ornament, chapter: 3 });
  
  // Fin
  const footer = document.getElementById('site-footer');
  anchors.push({ el: footer, chapter: 4 });
}

function onScroll() {
  const st = window.scrollY;
  const wh = window.innerHeight;
  
  // Calcul du targetProgress basé sur les ancres
  if (anchors.length < 5) return;
  
  let p = 0;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a1 = anchors[i];
    const a2 = anchors[i+1];
    
    // Simplification: on map le scrollTop entre l'élément actuel et le suivant
    // En réalité, on veut mapper le centre de la fenêtre ou le haut de la fenêtre.
    // Utilisons la position du haut de l'élément dans le document
    const top1 = getOffsetTop(a1.el);
    const top2 = getOffsetTop(a2.el);
    
    if (st >= top1 && st < top2) {
      // ratio entre top1 et top2
      const range = top2 - top1;
      const progressInRange = range > 0 ? (st - top1) / range : 0;
      p = a1.chapter + progressInRange;
      break;
    } else if (st >= top2 && i === anchors.length - 2) {
      // Au-delà du dernier
      const maxScroll = document.body.scrollHeight - wh;
      const range = maxScroll - top2;
      const progressInRange = range > 0 ? Math.min((st - top2) / range, 1) : 1;
      p = a2.chapter + progressInRange; // va jusqu'à 4 ou + 
    }
  }
  
  targetProgress = Math.max(0, Math.min(p, 4));
}

function getOffsetTop(element) {
  if (!element) return 0;
  const rect = element.getBoundingClientRect();
  return rect.top + window.scrollY;
}

export function isIdle() {
  return Math.abs(targetProgress - scrollProgress) < 0.0005;
}

export function updateCamera(camera, deltaTime) {
  // Hook de test : force la progression (utilisé par les captures headless)
  if (window.__HERO3D_PROGRESS != null) {
    targetProgress = window.__HERO3D_PROGRESS;
    scrollProgress = targetProgress;
  }

  // Lerp exponentiel
  scrollProgress += (targetProgress - scrollProgress) * (1 - Math.exp(-4 * deltaTime));

  // Drift idle: petit mouvement aléatoire continu
  const t = performance.now() * 0.0005;
  const idleX = Math.sin(t) * 1.5;
  const idleY = Math.cos(t * 0.8) * 1.5;

  // Échantillonnage par segment : getPoint (paramétrage uniforme) garantit
  // que chaque frontière de chapitre tombe exactement sur un point clé de
  // la courbe, contrairement à getPointAt (longueur d'arc)
  const curveT = Math.max(0, Math.min(scrollProgress / 4, 1));

  const camPos = curve.getPoint(curveT);
  const lookAtPos = lookAtCurve.getPoint(curveT);

  camera.position.set(camPos.x + idleX, camPos.y + idleY, camPos.z);
  camera.lookAt(lookAtPos);

  return scrollProgress;
}

export function cleanup() {
  if (ro) ro.disconnect();
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', calculateAnchors);
}
