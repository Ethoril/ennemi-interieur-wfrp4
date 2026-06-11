import * as THREE from 'three';
import { createGlowTexture } from './textures.js';

// Directions des deux queues en repère local (divergence ~25°).
// La caméra regarde la comète depuis +Z : les queues balaient le ciel
// latéralement (+X) et vers le haut, jamais dans l'axe de visée.
const DUST_DIR = new THREE.Vector3(0.87, 0.42, 0.12).normalize(); // poussière dorée, relevée
const ION_DIR = new THREE.Vector3(0.99, 0.02, 0.12).normalize();  // ions bleu-blanc, rectiligne

const DUST_COLOR = new THREE.Color(0xffbb55);
const ION_COLOR = new THREE.Color(0x99ccff);

export class Comet extends THREE.Group {
  constructor(particleCount = 1000) {
    super();

    // Tête de la comète
    const headMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      color: 0xffe9a8,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.head = new THREE.Sprite(headMaterial);
    this.head.scale.set(30, 30, 1);
    this.add(this.head);

    // Cœur brillant plus petit au centre du halo
    const coreMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.core = new THREE.Sprite(coreMaterial);
    this.core.scale.set(9, 9, 1);
    this.add(this.core);

    // Deux queues dans un seul système de particules
    this.particleCount = particleCount;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    this.velocities = new Float32Array(particleCount * 3); // unités/seconde
    this.lifespans = new Float32Array(particleCount);      // secondes restantes
    this.maxLife = 3.0;
    this.baseColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      this.spawnParticle(i, positions, Math.random() * this.maxLife);
      // Pré-chauffage : avance chaque particule de son âge déjà écoulé,
      // pour que les queues soient déployées dès la première frame
      const age = this.maxLife - this.lifespans[i];
      positions[i * 3] += this.velocities[i * 3] * age;
      positions[i * 3 + 1] += this.velocities[i * 3 + 1] * age;
      positions[i * 3 + 2] += this.velocities[i * 3 + 2] * age;

      const isDust = i % 2 === 0;
      const c = isDust ? DUST_COLOR : ION_COLOR;
      this.baseColors[i * 3] = c.r;
      this.baseColors[i * 3 + 1] = c.g;
      this.baseColors[i * 3 + 2] = c.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 6,
      vertexColors: true,
      map: createGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });

    this.tails = new THREE.Points(geometry, material);
    this.add(this.tails);

    // En haut à droite du ciel : hors du titre au chapitre 1,
    // plein cadre quand la caméra avance au chapitre 2
    this.position.set(60, 120, -100);
  }

  spawnParticle(i, positions, initialLife) {
    // Naissance à la tête, léger jitter
    positions[i * 3] = (Math.random() - 0.5) * 2.5;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 2.5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 2.5;

    const isDust = i % 2 === 0;
    const dir = isDust ? DUST_DIR : ION_DIR;
    // La queue ionique est plus rapide et plus rectiligne que la poussière
    const speed = isDust ? 20 + Math.random() * 15 : 35 + Math.random() * 20;
    const spread = isDust ? 6 : 2;

    this.velocities[i * 3] = dir.x * speed + (Math.random() - 0.5) * spread;
    this.velocities[i * 3 + 1] = dir.y * speed + (Math.random() - 0.5) * spread;
    this.velocities[i * 3 + 2] = dir.z * speed + (Math.random() - 0.5) * spread;

    this.lifespans[i] = initialLife !== undefined ? initialLife : this.maxLife;
  }

  update(time, progress, deltaTime) {
    const positions = this.tails.geometry.attributes.position.array;
    const colors = this.tails.geometry.attributes.color.array;

    for (let i = 0; i < this.particleCount; i++) {
      this.lifespans[i] -= deltaTime;

      if (this.lifespans[i] <= 0) {
        this.spawnParticle(i, positions);
      } else {
        positions[i * 3] += this.velocities[i * 3] * deltaTime;
        positions[i * 3 + 1] += this.velocities[i * 3 + 1] * deltaTime;
        positions[i * 3 + 2] += this.velocities[i * 3 + 2] * deltaTime;
      }

      // Fondu : en blending additif, assombrir la couleur = rendre transparent
      // (courbe douce pour que la traînée reste visible loin de la tête)
      const life = Math.max(this.lifespans[i] / this.maxLife, 0);
      const fade = Math.pow(life, 0.6);
      colors[i * 3] = this.baseColors[i * 3] * fade;
      colors[i * 3 + 1] = this.baseColors[i * 3 + 1] * fade;
      colors[i * 3 + 2] = this.baseColors[i * 3 + 2] * fade;
    }
    this.tails.geometry.attributes.position.needsUpdate = true;
    this.tails.geometry.attributes.color.needsUpdate = true;

    // Mouvement propre lent à travers le ciel + respiration du halo
    this.position.x = 60 + Math.sin(time * 0.03) * 10;
    this.position.y = 120 + Math.sin(time * 0.045) * 4;
    const breath = 1 + Math.sin(time * 1.7) * 0.06;
    this.head.scale.set(30 * breath, 30 * breath, 1);
  }
}
