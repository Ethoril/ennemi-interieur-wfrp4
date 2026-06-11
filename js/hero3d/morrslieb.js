import * as THREE from 'three';
import { createGlowTexture, createMoonTexture, createMoonFaceTexture } from './textures.js';

export class Morrslieb extends THREE.Group {
  constructor() {
    super();

    // Sphère auto-lumineuse : la lune du Chaos émet sa propre lumière
    // maladive, pas besoin d'éclairage de scène
    const geometry = new THREE.SphereGeometry(22, 64, 64);
    const material = new THREE.MeshBasicMaterial({
      map: createMoonTexture()
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.add(this.mesh);

    // Halo
    const glowMaterial = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      color: 0x3dba4f,
      transparent: true,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
      depthWrite: false
    });
    this.glow = new THREE.Sprite(glowMaterial);
    this.glow.scale.set(88, 88, 1);
    this.add(this.glow);

    // Visage démoniaque : invisible jusqu'au gros plan, puis se dessine.
    // Sprite = toujours face caméra, donc le rictus regarde le spectateur.
    const faceMaterial = new THREE.SpriteMaterial({
      map: createMoonFaceTexture(),
      transparent: true,
      opacity: 0,
      depthTest: false,
      blending: THREE.AdditiveBlending
    });
    this.face = new THREE.Sprite(faceMaterial);
    this.face.scale.set(38, 38, 1);
    this.face.renderOrder = 5;
    this.add(this.face);

    // Loin sur la gauche : discrète au chapitre 1, plein cadre au pivot du
    // chapitre 3, suspendue au-dessus des toits au chapitre 4
    this.position.set(-160, 110, -100);
  }

  update(time, progress, deltaTime) {
    // Rotation lente, inquiétante
    this.mesh.rotation.y += deltaTime * 0.05;

    // Pulsation sinusoïdale, accentuée à partir du chapitre 3 (progress 2→4)
    const chaosFactor = Math.max(0, Math.min((progress - 2) / 2, 1));
    const basePulse = 1 + Math.sin(time * 0.7) * 0.08;
    const chaosPulse = chaosFactor * Math.sin(time * 3) * 0.07;
    const pulse = basePulse + chaosPulse;

    this.glow.scale.set(88 * pulse, 88 * pulse, 1);
    this.glow.material.opacity = 0.4 + chaosFactor * 0.25 + Math.sin(time * 0.7) * 0.08;

    // Le sourire se dessine en quittant le gros plan (progress 2.0 → 2.6)
    // et persiste jusqu'à la vue finale, avec un vacillement irrégulier
    const t = Math.max(0, Math.min((progress - 2.0) / 0.6, 1));
    const reveal = t * t * (3 - 2 * t); // smoothstep
    const flicker = 0.8 + 0.14 * Math.sin(time * 2.3) + 0.06 * Math.sin(time * 7.1);
    this.face.material.opacity = reveal * flicker;
  }
}
