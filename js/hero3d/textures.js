import * as THREE from 'three';

// Texture pour une étoile (rond flou ou simple éclat)
export function createStarTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

// Surface de Morrslieb : vert maladif moucheté de cratères sombres.
// IMPORTANT : la texture doit être raccordable horizontalement (le bord
// gauche = le bord droit), sinon une couture verticale apparaît sur la
// sphère là où les UV se replient. Tout motif est donc dessiné 3 fois
// (x-512, x, x+512) et la base ne varie que verticalement.
export function createMoonTexture() {
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // Base : dégradé strictement vertical (assombri aux pôles), seamless en X
  const base = ctx.createLinearGradient(0, 0, 0, SIZE);
  base.addColorStop(0, '#2e5e36');
  base.addColorStop(0.35, '#478a4d');
  base.addColorStop(0.65, '#478a4d');
  base.addColorStop(1, '#2a5532');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Dessine un motif radial répété aux trois positions pour le raccord
  const wrapped = (x, y, r, paint) => {
    for (const ox of [-SIZE, 0, SIZE]) {
      paint(x + ox, y, r);
    }
  };

  // Grandes "mers" sombres et diffuses (donnent les masses) — discrètes
  // pour ne pas concurrencer le visage démoniaque
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * SIZE;
    const y = SIZE * 0.12 + Math.random() * SIZE * 0.76;
    const r = 35 + Math.random() * 70;
    wrapped(x, y, r, (px, py, pr) => {
      const g = ctx.createRadialGradient(px, py, pr * 0.2, px, py, pr);
      g.addColorStop(0, 'rgba(22, 58, 30, 0.22)');
      g.addColorStop(1, 'rgba(22, 58, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Cratères : présents mais en retrait, le visage reste la vedette
  for (let i = 0; i < 38; i++) {
    const x = Math.random() * SIZE;
    const y = SIZE * 0.08 + Math.random() * SIZE * 0.84;
    const r = 4 + Math.random() * 13;
    wrapped(x, y, r, (px, py, pr) => {
      // Rebord éclairé (léger décalage haut-gauche)
      const rim = ctx.createRadialGradient(px - pr * 0.25, py - pr * 0.25, pr * 0.5, px, py, pr * 1.25);
      rim.addColorStop(0, 'rgba(150, 225, 150, 0)');
      rim.addColorStop(0.75, 'rgba(150, 225, 150, 0.14)');
      rim.addColorStop(1, 'rgba(150, 225, 150, 0)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(px, py, pr * 1.25, 0, Math.PI * 2);
      ctx.fill();

      // Cuvette sombre adoucie
      const pit = ctx.createRadialGradient(px, py, 0, px, py, pr);
      pit.addColorStop(0, 'rgba(16, 44, 22, 0.38)');
      pit.addColorStop(0.7, 'rgba(16, 44, 22, 0.26)');
      pit.addColorStop(1, 'rgba(16, 44, 22, 0)');
      ctx.fillStyle = pit;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Grain fin : bruit pixel léger pour donner de la matière
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Bruit identique sur la colonne 0 et la colonne SIZE-1 ? Inutile :
      // un bruit par pixel reste invisible à la couture car non corrélé
      const n = (Math.random() - 0.5) * 12;
      const idx = (y * SIZE + x) * 4;
      d[idx] += n;
      d[idx + 1] += n;
      d[idx + 2] += n;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// Visage démoniaque de Morrslieb : yeux obliques et rictus denté, sur fond
// transparent. Porté par un Sprite (toujours face caméra) et révélé en fin
// de scroll — cf. le sourire de la lune du Chaos les nuits de Geheimnisnacht.
export function createMoonFaceTexture() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');

  ctx.shadowColor = 'rgba(190, 255, 160, 0.9)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = 'rgba(225, 255, 200, 0.95)';

  // Yeux : fentes obliques en lame, pointe externe relevée très haut,
  // coin interne bas et effilé (sourcils froncés, regard de prédateur)
  ctx.beginPath();
  ctx.moveTo(36, 58);                          // pointe externe haute
  ctx.quadraticCurveTo(82, 64, 112, 94);       // bord supérieur plongeant
  ctx.quadraticCurveTo(74, 96, 36, 58);        // bord inférieur (lame)
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(220, 58);
  ctx.quadraticCurveTo(174, 64, 144, 94);
  ctx.quadraticCurveTo(182, 96, 220, 58);
  ctx.fill();

  // Rictus : étiré d'un bord à l'autre, commissures qui remontent
  ctx.beginPath();
  ctx.moveTo(20, 116);
  ctx.quadraticCurveTo(128, 232, 236, 116);   // lèvre inférieure, très profonde
  ctx.quadraticCurveTo(128, 150, 20, 116);    // lèvre supérieure (creuse le croissant)
  ctx.fill();

  // Crocs : double rangée découpée dans la lueur
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-out';
  // Rangée supérieure : encoches profondes pointant vers le bas
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 20;
    const depth = 34 + ((i * 7919) % 14);      // longueurs irrégulières
    ctx.beginPath();
    ctx.moveTo(x, 132);
    ctx.lineTo(x + 11, 132);
    ctx.lineTo(x + 5.5, 132 + depth);
    ctx.closePath();
    ctx.fill();
  }
  // Rangée inférieure : encoches remontant de la lèvre du bas, décalées
  for (let i = 0; i < 8; i++) {
    const x = 52 + i * 20;
    const depth = 20 + ((i * 104729) % 10);
    ctx.beginPath();
    ctx.moveTo(x, 212);
    ctx.lineTo(x + 9, 212);
    ctx.lineTo(x + 4.5, 212 - depth);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Glow radial pour halos (lune, comète)
export function createGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
