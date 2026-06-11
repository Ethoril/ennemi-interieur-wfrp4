import * as THREE from 'three';
import { createStarfield } from './starfield.js';
import { initTimeline, updateCamera, isIdle } from './scroll-timeline.js';
import { Morrslieb } from './morrslieb.js';
import { Comet } from './comet.js';
import { Skyline } from './skyline.js';

let renderer, scene, camera;
let running = false;
let clock;
let morrslieb, comet, skyline;
let idleTime = 0;
let frameSkip = false;

export function init() {
  const canvas = document.getElementById('hero3d-canvas');
  if (!canvas) return;

  clock = new THREE.Clock();

  // Tier qualité : écrans 768-1200px → DPR plafonné et moins de particules
  const isMidTier = window.innerWidth < 1200;

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    powerPreference: 'high-performance',
    antialias: window.devicePixelRatio < 2
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMidTier ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070d); // --bg-darkest
  scene.fog = new THREE.FogExp2(0x07070d, 0.0015);

  // Étoiles (hors fog : un ciel étoilé ne subit pas le brouillard)
  const starfield = createStarfield(isMidTier ? 1200 : 2500);
  scene.add(starfield);

  // Acteurs
  morrslieb = new Morrslieb();
  scene.add(morrslieb);

  comet = new Comet(isMidTier ? 400 : 1000);
  scene.add(comet);

  skyline = new Skyline(isMidTier);
  scene.add(skyline);

  // Camera
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, -10, 150); // Sera écrasé par updateCamera

  // Lumière d'ambiance bleu nuit (silhouettes et lune restent quasi auto-éclairées)
  const ambientLight = new THREE.AmbientLight(0x223044, 0.6);
  scene.add(ambientLight);

  // Événements
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Initialisation de la timeline
  initTimeline();

  // Lancement
  resume();
}

function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const isMidTier = window.innerWidth < 1200;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMidTier ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onVisibilityChange() {
  if (document.hidden) {
    pause();
  } else if (document.documentElement.classList.contains('hero3d-active')) {
    resume();
  }
}

function animate() {
  // dt clampé à 50ms pour éviter les sauts au retour d'onglet
  const deltaTime = Math.min(clock.getDelta(), 0.05);
  const elapsedTime = clock.getElapsedTime();

  // Mode repos : scroll immobile > 5s → rendu une frame sur deux
  if (isIdle()) {
    idleTime += deltaTime;
  } else {
    idleTime = 0;
  }
  if (idleTime > 5) {
    frameSkip = !frameSkip;
    if (frameSkip) return;
  }

  const progress = updateCamera(camera, deltaTime);

  if (morrslieb) morrslieb.update(elapsedTime, progress, deltaTime);
  if (comet) comet.update(elapsedTime, progress, deltaTime);
  if (skyline) skyline.update(elapsedTime, progress, deltaTime);

  renderer.render(scene, camera);
}

export function pause() {
  running = false;
  if (renderer) renderer.setAnimationLoop(null);
}

export function resume() {
  if (!renderer || running) return;
  running = true;
  clock.getDelta(); // purge le temps écoulé pendant la pause
  renderer.setAnimationLoop(animate);
}
