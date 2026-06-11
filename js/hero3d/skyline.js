import * as THREE from 'three';
import { createGlowTexture } from './textures.js';

export class Skyline extends THREE.Group {
  constructor(isMidTier = false) {
    super();

    // Plan de fond (légèrement plus clair : voile atmosphérique)
    if (!isMidTier) {
      const bg = this.createCityLayer(320, 26, 0x10101e);
      bg.mesh.position.set(0, -22, -60);
      this.add(bg.mesh);
    }

    // Premier plan : silhouette noire + fenêtres éclairées
    const fg = this.createCityLayer(260, 32, 0x04040a);
    fg.mesh.position.set(0, -35, -40);
    this.add(fg.mesh);

    this.windows = this.createWindows(fg.windowSpots);
    this.windows.position.copy(fg.mesh.position);
    this.windows.position.z += 0.5; // juste devant la façade
    this.add(this.windows);
  }

  // Profil continu de toits : chaque bâtiment enchaîne sur le suivant par
  // un mur vertical, sans redescendre au sol entre deux (pas de crevasses)
  createCityLayer(width, heightVar, color) {
    const shape = new THREE.Shape();
    const windowSpots = [];

    let x = -width / 2;
    shape.moveTo(x, -60);

    while (x < width / 2) {
      const w = 3 + Math.random() * 5;
      const h = 5 + Math.random() * heightVar;

      // Mur vertical depuis le niveau du toit précédent
      shape.lineTo(x, h);

      const type = Math.random();
      if (type < 0.3) {
        // Toit plat (entrepôt, tour carrée)
        shape.lineTo(x + w, h);
      } else if (type < 0.85) {
        // Pignon pointu (maison impériale classique)
        shape.lineTo(x + w / 2, h + 2 + Math.random() * 4);
        shape.lineTo(x + w, h);
      } else {
        // Flèche (clocher, cathédrale de Sigmar)
        shape.lineTo(x + w * 0.35, h);
        shape.lineTo(x + w * 0.5, h + 9 + Math.random() * 12);
        shape.lineTo(x + w * 0.65, h);
        shape.lineTo(x + w, h);
      }

      // Fenêtres alignées sur la façade de ce bâtiment (1 sur 2 éclairé)
      if (Math.random() < 0.5) {
        const count = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          windowSpots.push({
            x: x + 0.8 + Math.random() * (w - 1.6),
            y: 1 + Math.random() * (h - 2)
          });
        }
      }

      x += w;
    }

    shape.lineTo(width / 2, -60);

    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({ color });
    return { mesh: new THREE.Mesh(geometry, material), windowSpots };
  }

  createWindows(spots) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(spots.length * 3);
    const colors = new Float32Array(spots.length * 3);
    const gold = new THREE.Color(0xc9a84c);

    spots.forEach((spot, i) => {
      positions[i * 3] = spot.x;
      positions[i * 3 + 1] = spot.y;
      positions[i * 3 + 2] = 0;
      // Luminosité statique variable : diversité spatiale sans coût par frame
      const brightness = 0.6 + Math.random() * 0.4;
      colors[i * 3] = gold.r * brightness;
      colors[i * 3 + 1] = gold.g * brightness;
      colors[i * 3 + 2] = gold.b * brightness;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2.2,
      map: createGlowTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.95
    });

    return new THREE.Points(geometry, material);
  }

  update(time, progress, deltaTime) {
    // Respiration lente et discrète des lumières de la ville
    this.windows.material.opacity = 0.7 + Math.sin(time * 0.6) * 0.15;
  }
}
