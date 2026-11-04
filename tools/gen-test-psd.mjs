// Generates a small layered PSD (our own art) for testing PSD import.
//   node tools/gen-test-psd.mjs  →  web/public/samples/layered.psd
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(path.resolve(import.meta.dirname, '../web/package.json'));
const { writePsdBuffer } = require('ag-psd');

const W = 600;
const H = 900;

function layer(name, draw) {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  draw(put);
  // Trim to bounds.
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x0 + w) * 4), y * w * 4);
  return { name, left: x0, top: y0, right: x0 + w, bottom: y0 + h, imageData: { width: w, height: h, data: out }, full: data };
}

const dark = (c, k = 0.55) => c.map((v) => Math.round(v * k));
function ellipse(put, cx, cy, rx, ry, color, outline = 4) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 1) put(x, y, d > (1 - outline / Math.min(rx, ry)) ** 2 ? dark(color) : color);
  }
}
function capsule(put, ax, ay, bx, by, r, color) {
  const minX = Math.floor(Math.min(ax, bx) - r), maxX = Math.ceil(Math.max(ax, bx) + r);
  const minY = Math.floor(Math.min(ay, by) - r), maxY = Math.ceil(Math.max(ay, by) + r);
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d <= r) put(x, y, d > r - 4 ? dark(color) : color);
  }
}

const GREEN = [124, 197, 118], SKIN = [240, 184, 120], FAR = [190, 150, 105], ORANGE = [227, 154, 79];
const RED = [200, 60, 70], HAIR = [120, 80, 50];
const layers = [
  layer('cape', (p) => { for (let y = 300; y <= 640; y++) { const t = (y - 300) / 340; const half = 40 + 70 * t; for (let x = Math.round(250 - half); x <= 250 + half * 0.6; x++) p(x, y, Math.abs(x - (250 - half)) < 4 ? [120, 30, 40] : RED); } }),
  layer('hair ponytail', (p) => capsule(p, 235, 175, 175, 330, 20, HAIR)),
  layer('tail', (p) => capsule(p, 225, 520, 95, 455, 16, ORANGE)),
  layer('arm far', (p) => { capsule(p, 255, 330, 195, 560, 18, FAR); ellipse(p, 192, 572, 22, 22, FAR); }),
  layer('leg far', (p) => { capsule(p, 275, 540, 255, 815, 24, FAR); ellipse(p, 275, 838, 46, 20, dark(FAR, 0.7)); }),
  layer('torso', (p) => { ellipse(p, 300, 430, 88, 145, GREEN); ellipse(p, 320, 470, 40, 70, [190, 230, 180], 0); }),
  layer('leg near', (p) => { capsule(p, 322, 540, 332, 815, 24, SKIN); ellipse(p, 360, 838, 46, 20, [107, 74, 47]); }),
  layer('head', (p) => { ellipse(p, 312, 205, 92, 88, [143, 212, 136]); ellipse(p, 355, 190, 14, 16, [255, 255, 255], 2); ellipse(p, 360, 192, 6, 8, [20, 20, 25], 0); }),
  layer('arm near', (p) => { capsule(p, 345, 330, 420, 560, 18, SKIN); ellipse(p, 424, 572, 22, 22, SKIN); }),
];

// Composite (bottom → top).
const composite = new Uint8ClampedArray(W * H * 4);
for (const l of layers) for (let i = 0; i < W * H; i++) if (l.full[i * 4 + 3]) composite.set(l.full.subarray(i * 4, i * 4 + 4), i * 4);
const psd = {
  width: W,
  height: H,
  imageData: { width: W, height: H, data: composite },
  children: layers.map(({ full, ...l }) => l),
};
const out = path.resolve(import.meta.dirname, '../web/public/samples/layered.psd');
fs.writeFileSync(out, Buffer.from(writePsdBuffer(psd, { generateThumbnail: false })));
if (process.env.RAW_OUT) fs.writeFileSync(process.env.RAW_OUT, Buffer.from(composite.buffer));
console.log('wrote', path.relative(process.cwd(), out), fs.statSync(out).size, 'bytes');
