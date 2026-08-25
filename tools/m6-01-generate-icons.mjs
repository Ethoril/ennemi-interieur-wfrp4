/* global Buffer */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const gold = [201, 168, 76, 255];
const ink = [14, 14, 24, 255];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, body, checksum]);
}

function png(width, height, pixels) {
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = row + 1 + x * 4;
      rows[target] = pixels[source];
      rows[target + 1] = pixels[source + 1];
      rows[target + 2] = pixels[source + 2];
      rows[target + 3] = pixels[source + 3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(pixels, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const index = (y * size + x) * 4;
  pixels.set(color, index);
}

function inRoundedSquare(x, y, size, radius) {
  const left = radius;
  const right = size - radius - 1;
  const top = radius;
  const bottom = size - radius - 1;
  if (x >= left && x <= right) return y >= 0 && y < size;
  if (y >= top && y <= bottom) return x >= 0 && x < size;
  const cx = x < left ? left : right;
  const cy = y < top ? top : bottom;
  return ((x - cx) ** 2 + (y - cy) ** 2) <= radius ** 2;
}

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function drawFleur(pixels, size, motifScale = 1) {
  const center = size / 2;
  const scale = size / 32;
  const coordinate = (px, py) => ({
    x: center + px * scale * motifScale,
    y: center + (py * scale - center) * motifScale,
  });
  const fill = (x, y) => setPixel(pixels, size, Math.round(x), Math.round(y), gold);
  // A compact geometric fleur-de-lis matching favicon.svg's gold mark.
  const minY = coordinate(0, 3).y;
  const maxY = coordinate(0, 25).y;
  const minX = coordinate(-11, 0).x;
  const maxX = coordinate(11, 0).x;
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += 1) {
      const stemTop = coordinate(0, 13).y;
      const stemBottom = coordinate(0, 24).y;
      const stemHalfWidth = 1.1 * scale * motifScale;
      const stem = x >= center - stemHalfWidth && x <= center + stemHalfWidth
        && y >= stemTop && y <= stemBottom;
      const point = coordinate;
      const centerLobe = insidePolygon(x, y, [point(0, 3), point(-4, 8), point(-3, 14), point(0, 17), point(3, 14), point(4, 8)]);
      const leftLobe = insidePolygon(x, y, [point(-2, 9), point(-10, 6), point(-8, 12), point(-4, 17), point(-2, 14)]);
      const rightLobe = insidePolygon(x, y, [point(2, 9), point(10, 6), point(8, 12), point(4, 17), point(2, 14)]);
      const base = insidePolygon(x, y, [point(-8, 21), point(-3, 22), point(0, 20), point(3, 22), point(8, 21), point(6, 25), point(-6, 25)]);
      if (stem || centerLobe || leftLobe || rightLobe || base) fill(x, y);
    }
  }
}

function createIcon(size, { maskable = false, rounded = true } = {}) {
  const pixels = new Uint8Array(size * size * 4);
  const radius = Math.round(size * 5 / 32);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (maskable || !rounded || inRoundedSquare(x, y, size, radius)) setPixel(pixels, size, x, y, ink);
    }
  }
  drawFleur(pixels, size, maskable ? 0.88 : 1);
  return png(size, size, pixels);
}

mkdirSync(resolve(root, 'icons'), { recursive: true });
const outputs = [
  ['icon-192.png', createIcon(192)],
  ['icon-512.png', createIcon(512)],
  ['icon-maskable-512.png', createIcon(512, { maskable: true })],
  ['apple-touch-icon.png', createIcon(180, { rounded: false })],
];
for (const [name, bytes] of outputs) writeFileSync(resolve(root, 'icons', name), bytes);
