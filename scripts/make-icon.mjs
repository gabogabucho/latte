// Draws the Latte mark into PNG files, with no image dependency: the shape is
// the same polygon the UI uses for `.logo-mark`, rasterised by hand and
// compressed with Node's own zlib.
//
// Usage: node scripts/make-icon.mjs
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The wordmark's L, as fractions of the box: same polygon as the CSS clip-path. */
const MARK = [[0, 0.28], [0.33, 0], [0.33, 0.72], [1, 0.72], [0.72, 1], [0, 1]];
const BACKGROUND = [40, 37, 31];      // --dark
const GRADIENT_TOP = [217, 134, 89];  // #d98659
const GRADIENT_BOTTOM = [174, 76, 45]; // #ae4c2d

function insidePolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 4x supersampling: the diagonals of the mark need it or they look ragged. */
function coverage(polygon, px, py, size, inset) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const x = ((px + (sx + 0.5) / 4) / size - inset) / (1 - 2 * inset);
      const y = ((py + (sy + 0.5) / 4) / size - inset) / (1 - 2 * inset);
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && insidePolygon(polygon, x, y)) hits += 1;
    }
  }
  return hits / 16;
}

function roundedCorner(px, py, size, radius) {
  const corners = [[radius, radius], [size - radius, radius], [radius, size - radius], [size - radius, size - radius]];
  const x = px + 0.5;
  const y = py + 0.5;
  const outside = (x < radius || x > size - radius) && (y < radius || y > size - radius);
  if (!outside) return 1;
  const [cx, cy] = corners.find(([ax, ay]) => Math.abs(x - ax) < radius && Math.abs(y - ay) < radius) ?? [];
  if (cx === undefined) return 1;
  const distance = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, radius - distance + 0.5));
}

function renderIcon(size, { transparent = false } = {}) {
  const radius = Math.round(size * 0.22);
  const inset = 0.22;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const mark = coverage(MARK, x, y, size, inset);
      const t = y / size;
      const markColor = GRADIENT_TOP.map((c, i) => Math.round(c + (GRADIENT_BOTTOM[i] - c) * t));
      const base = transparent ? markColor : BACKGROUND;
      const alphaBase = transparent ? 0 : 255;
      const rgb = base.map((c, i) => Math.round(c + (markColor[i] - c) * mark));
      const alpha = Math.round((alphaBase + (255 - alphaBase) * mark) * roundedCorner(x, y, size, radius));
      const at = 1 + x * 4;
      row[at] = rgb[0];
      row[at + 1] = rgb[1];
      row[at + 2] = rgb[2];
      row[at + 3] = alpha;
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

let crcTable = null;
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ -1;
}

function png(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['assets/icon-512.png', 512, {}],
  ['assets/icon-256.png', 256, {}],
  ['assets/icon-64.png', 64, {}],
  ['assets/favicon.png', 64, { transparent: true }],
];
for (const [file, size, options] of targets) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, renderIcon(size, options));
  console.log(`${file}  ${size}x${size}  ${fs.statSync(target).size} bytes`);
}
