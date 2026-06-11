import * as THREE from 'three';
import { createStarTexture } from './textures.js';

export function createStarfield(particleCount = 2500) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);

  // Palettes de couleurs pour les étoiles: Blanc, Or léger, Bleu pâle
  const colorPalette = [
    new THREE.Color(0xffffff), // Blanc
    new THREE.Color(0xfff4d6), // Or léger
    new THREE.Color(0xd6e5ff)  // Bleu pâle
  ];

  for (let i = 0; i < particleCount; i++) {
    // Coque sphérique : assez loin pour rester derrière les acteurs,
    // assez près pour que les points gardent une taille visible
    const r = 400 + Math.random() * 300;
    const theta = 2 * Math.PI * Math.random();
    const phi = Math.acos(2 * Math.random() - 1);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Couleur aléatoire parmi la palette, luminosité variable
    const col = colorPalette[Math.floor(Math.random() * colorPalette.length)];
    const brightness = 0.5 + Math.random() * 0.5;
    colors[i * 3] = col.r * brightness;
    colors[i * 3 + 1] = col.g * brightness;
    colors[i * 3 + 2] = col.b * brightness;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 3.5,
    map: createStarTexture(),
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.9,
    fog: false // le brouillard de scène éteindrait les étoiles lointaines
  });

  return new THREE.Points(geometry, material);
}
