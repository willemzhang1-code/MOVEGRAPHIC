// Generates the demo character as Spine 4.2 JSON (our own content) plus a
// parts manifest the demo uses to draw textures procedurally.
//
//   node tools/gen-demo.mjs
//
// Covers: hierarchy, inherit modes, 2-bone IK, weighted mesh, skins,
// attachment/color/deform/draw-order timelines, bezier curves, events.

import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../web/public/assets');
const r3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ parts

const LIMB = { fill: '#f0b878', stroke: '#8a5a2b' };
const parts = {
  body_green: { w: 100, h: 140, shape: 'body', fill: '#7cc576', stroke: '#2f5d2c' },
  body_purple: { w: 100, h: 140, shape: 'body', fill: '#a98ad8', stroke: '#4b3570' },
  head_green: { w: 112, h: 100, shape: 'head', fill: '#8fd488', stroke: '#2f5d2c' },
  head_purple: { w: 112, h: 100, shape: 'head', fill: '#bba0e6', stroke: '#4b3570' },
  eye_open: { w: 20, h: 24, shape: 'eye_open' },
  eye_closed: { w: 20, h: 24, shape: 'eye_closed' },
  upper_arm: { w: 56, h: 24, shape: 'capsule', ...LIMB },
  forearm: { w: 50, h: 20, shape: 'capsule', ...LIMB },
  hand: { w: 26, h: 26, shape: 'circle', ...LIMB },
  thigh: { w: 70, h: 30, shape: 'capsule', ...LIMB },
  shin: { w: 66, h: 26, shape: 'capsule', ...LIMB },
  foot: { w: 48, h: 22, shape: 'foot', fill: '#6b4a2f', stroke: '#3a2614' },
  tail: { w: 40, h: 160, shape: 'tail', fill: '#e39a4f', stroke: '#8a5a2b' },
};

// ------------------------------------------------------------------ bones

const bones = [
  { name: 'root' },
  { name: 'hip', parent: 'root', y: 120 },
  { name: 'torso', parent: 'hip', rotation: 90, length: 100 },
  { name: 'head', parent: 'torso', x: 100, rotation: -8, length: 80, inherit: 'noScale' },
  { name: 'arm_far_upper', parent: 'torso', x: 84, y: 6, rotation: 182, length: 45 },
  { name: 'arm_far_lower', parent: 'arm_far_upper', x: 45, rotation: 12, length: 40 },
  { name: 'arm_far_hand', parent: 'arm_far_lower', x: 40 },
  { name: 'arm_near_upper', parent: 'torso', x: 84, y: -6, rotation: 182, length: 45 },
  { name: 'arm_near_lower', parent: 'arm_near_upper', x: 45, rotation: 12, length: 40 },
  { name: 'arm_near_hand', parent: 'arm_near_lower', x: 40 },
  { name: 'leg_far_thigh', parent: 'hip', x: -6, rotation: -90, length: 58 },
  { name: 'leg_far_shin', parent: 'leg_far_thigh', x: 58, length: 56 },
  { name: 'leg_far_foot', parent: 'root', x: -2, y: 10, length: 20 },
  { name: 'leg_near_thigh', parent: 'hip', x: 6, rotation: -90, length: 58 },
  { name: 'leg_near_shin', parent: 'leg_near_thigh', x: 58, length: 56 },
  { name: 'leg_near_foot', parent: 'root', x: 10, y: 10, length: 20 },
  { name: 'tail1', parent: 'hip', x: -30, rotation: 160, length: 45 },
  { name: 'tail2', parent: 'tail1', x: 45, rotation: -18, length: 45 },
  { name: 'tail3', parent: 'tail2', x: 45, rotation: -20, length: 45 },
];
const boneIndex = Object.fromEntries(bones.map((b, i) => [b.name, i]));

// Setup-pose world transforms (all bones on the tail chain use normal inheritance).
function worldOf() {
  const w = [];
  for (const b of bones) {
    const rot = ((b.rotation ?? 0) * Math.PI) / 180;
    const l = { a: Math.cos(rot), b: -Math.sin(rot), c: Math.sin(rot), d: Math.cos(rot), x: b.x ?? 0, y: b.y ?? 0 };
    const p = b.parent ? w[boneIndex[b.parent]] : { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };
    w.push({
      a: p.a * l.a + p.b * l.c,
      b: p.a * l.b + p.b * l.d,
      c: p.c * l.a + p.d * l.c,
      d: p.c * l.b + p.d * l.d,
      x: p.a * l.x + p.b * l.y + p.x,
      y: p.c * l.x + p.d * l.y + p.y,
    });
  }
  return w;
}
const world = worldOf();
const toLocal = (m, px, py) => {
  const det = m.a * m.d - m.b * m.c;
  const dx = px - m.x;
  const dy = py - m.y;
  return [(m.d * dx - m.b * dy) / det, (-m.c * dx + m.a * dy) / det];
};
const apply = (m, x, y) => [m.a * x + m.b * y + m.x, m.c * x + m.d * y + m.y];

// ------------------------------------------------------------------ tail mesh

const TAIL = ['tail1', 'tail2', 'tail3'];
const SEG = 45;
const N = 9;
const TOTAL = SEG * 3;
function tailPoint(s) {
  const k = Math.min(2, Math.floor(s / SEG));
  return apply(world[boneIndex[TAIL[k]]], s - k * SEG, 0);
}
const tailVerts = []; // { s, side, wx, wy }
for (let i = 0; i <= N; i++) {
  const s = (TOTAL * i) / N;
  const [x0, y0] = tailPoint(Math.max(0, s - 2));
  const [x1, y1] = tailPoint(Math.min(TOTAL - 0.001, s + 2));
  const len = Math.hypot(x1 - x0, y1 - y0);
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const [cx, cy] = tailPoint(Math.min(TOTAL - 0.001, s));
  const half = 15 + (3 - 15) * (s / TOTAL);
  for (const side of [1, -1]) tailVerts.push({ s, side, half, wx: cx + nx * half * side, wy: cy + ny * half * side, nx: nx * side, ny: ny * side });
}
const tailUvs = [];
for (const v of tailVerts) {
  tailUvs.push(r3(0.5 + (v.side * v.half) / 40), r3((155 - (v.s * 145) / TOTAL) / 160));
}
const tailTris = [];
for (let i = 0; i < N; i++) {
  const a = i * 2;
  tailTris.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
}
const smooth = (t) => t * t * (3 - 2 * t);
function tailWeights(s) {
  const centers = [SEG / 2, SEG * 1.5, SEG * 2.5];
  if (s <= centers[0]) return [[0, 1]];
  if (s >= centers[2]) return [[2, 1]];
  const k = s < centers[1] ? 0 : 1;
  const t = smooth((s - centers[k]) / SEG);
  return [[k, 1 - t], [k + 1, t]];
}
const tailVertices = [];
const tailInfluences = []; // per vertex: list of { bone, nx, ny } for deform
for (const v of tailVerts) {
  const ws = tailWeights(v.s);
  tailVertices.push(ws.length);
  const inf = [];
  for (const [k, w] of ws) {
    const bi = boneIndex[TAIL[k]];
    const m = world[bi];
    const [lx, ly] = toLocal(m, v.wx, v.wy);
    tailVertices.push(bi, r3(lx), r3(ly), r3(w));
    const [ln0x, ln0y] = toLocal(m, m.x + v.nx, m.y + v.ny);
    inf.push([ln0x, ln0y]);
  }
  tailInfluences.push(inf);
}

// ------------------------------------------------------------------ slots / skins

const DARK = 'a8a8b0ff';
const slots = [
  { name: 'arm_far_upper', bone: 'arm_far_upper', attachment: 'upper_arm', color: DARK },
  { name: 'arm_far_lower', bone: 'arm_far_lower', attachment: 'forearm', color: DARK },
  { name: 'arm_far_hand', bone: 'arm_far_hand', attachment: 'hand', color: DARK },
  { name: 'leg_far_thigh', bone: 'leg_far_thigh', attachment: 'thigh', color: DARK },
  { name: 'leg_far_shin', bone: 'leg_far_shin', attachment: 'shin', color: DARK },
  { name: 'leg_far_foot', bone: 'leg_far_foot', attachment: 'foot', color: DARK },
  { name: 'tail', bone: 'hip', attachment: 'tail' },
  { name: 'body', bone: 'torso', attachment: 'body' },
  { name: 'leg_near_thigh', bone: 'leg_near_thigh', attachment: 'thigh' },
  { name: 'leg_near_shin', bone: 'leg_near_shin', attachment: 'shin' },
  { name: 'leg_near_foot', bone: 'leg_near_foot', attachment: 'foot' },
  { name: 'head', bone: 'head', attachment: 'head' },
  { name: 'eye', bone: 'head', attachment: 'eye_open' },
  { name: 'arm_near_upper', bone: 'arm_near_upper', attachment: 'upper_arm' },
  { name: 'arm_near_lower', bone: 'arm_near_lower', attachment: 'forearm' },
  { name: 'arm_near_hand', bone: 'arm_near_hand', attachment: 'hand' },
];
const slotIndex = Object.fromEntries(slots.map((s, i) => [s.name, i]));

const region = (extra) => ({ ...extra });
const defaultAttachments = {};
for (const side of ['far', 'near']) {
  defaultAttachments[`arm_${side}_upper`] = { upper_arm: region({ x: 22, width: 56, height: 24 }) };
  defaultAttachments[`arm_${side}_lower`] = { forearm: region({ x: 20, width: 50, height: 20 }) };
  defaultAttachments[`arm_${side}_hand`] = { hand: region({ x: 4, width: 26, height: 26 }) };
  defaultAttachments[`leg_${side}_thigh`] = { thigh: region({ x: 29, width: 70, height: 30 }) };
  defaultAttachments[`leg_${side}_shin`] = { shin: region({ x: 28, width: 66, height: 26 }) };
  defaultAttachments[`leg_${side}_foot`] = { foot: region({ x: 12, y: -3, width: 48, height: 22 }) };
}
defaultAttachments.eye = {
  eye_open: { x: 46, y: -24, rotation: -90, width: 20, height: 24 },
  eye_closed: { x: 46, y: -24, rotation: -90, width: 20, height: 24 },
};
defaultAttachments.tail = {
  tail: { type: 'mesh', uvs: tailUvs, triangles: tailTris, vertices: tailVertices, hull: tailVerts.length, width: 40, height: 160 },
};
const variantSkin = (name) => ({
  name,
  attachments: {
    body: { body: { path: `body_${name}`, x: 48, rotation: -90, width: 100, height: 140 } },
    head: { head: { path: `head_${name}`, x: 38, y: -6, rotation: -90, width: 112, height: 100 } },
  },
});

// ------------------------------------------------------------------ animation helpers

const ease = (t0, t1, v0, v1) => [r3(t0 + (t1 - t0) * 0.42), r3(v0), r3(t0 + (t1 - t0) * 0.58), r3(v1)];
/** keys: [[time, value], ...] → frames with ease-in-out curves. */
function eased(keys, field = 'value') {
  return keys.map(([t, v], i) => {
    const f = { time: r3(t), [field]: r3(v) };
    const next = keys[i + 1];
    if (next) f.curve = ease(t, next[0], v, next[1]);
    return f;
  });
}
/** Sampled translate timeline with linear interpolation. */
function sampled(duration, count, fn) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const t = (duration * i) / count;
    const [x, y] = fn(t / duration);
    out.push({ time: r3(t), x: r3(x), y: r3(y) });
  }
  return out;
}
function wave(duration, count, fn) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const t = (duration * i) / count;
    out.push({ time: r3(t), value: r3(fn(t / duration)) });
  }
  return out;
}
const TAU = Math.PI * 2;
const tailWave = (duration, count, amp) =>
  Object.fromEntries(TAIL.map((n, k) => [n, { rotate: wave(duration, count, (p) => amp * (1 + k * 0.4) * Math.sin(TAU * p - k * 0.9)) }]));

// idle
const idle = {
  bones: {
    hip: { translate: eased([[0, 0], [1, -2], [2, 0]], 'y').map((f) => ({ ...f, x: 0, curve: f.curve ? [f.curve[0], 0, f.curve[2], 0, ...f.curve] : undefined })) },
    torso: { scalex: eased([[0, 1], [1, 1.035], [2, 1]]) },
    head: { rotate: eased([[0, 0], [1, 4], [2, 0]]) },
    arm_near_upper: { rotate: eased([[0, 0], [1, -5], [2, 0]]) },
    arm_far_upper: { rotate: eased([[0, 0], [1, 5], [2, 0]]) },
    arm_near_lower: { rotate: eased([[0, 0], [1, -6], [2, 0]]) },
    arm_far_lower: { rotate: eased([[0, 0], [1, -6], [2, 0]]) },
    ...tailWave(2, 8, 5),
  },
  slots: { eye: { attachment: [{ time: 0, name: 'eye_open' }, { time: 1.3, name: 'eye_closed' }, { time: 1.42, name: 'eye_open' }] } },
};

// walk
const STEP = 30;
const footPath = (phase) => (p) => {
  const q = (p + phase) % 1;
  if (q < 0.5) return [STEP - (2 * STEP * q) / 0.5, 0];
  const s = (q - 0.5) / 0.5;
  return [-STEP + 2 * STEP * smooth(s), 22 * Math.sin(Math.PI * s)];
};
const walk = {
  bones: {
    hip: { translate: sampled(0.8, 16, (p) => [0, -3 - 3 * Math.cos(2 * TAU * p)]) },
    torso: { rotate: wave(0.8, 8, (p) => -7 + 1.5 * Math.sin(2 * TAU * p)) },
    head: { rotate: wave(0.8, 8, (p) => 4 + 2 * Math.sin(2 * TAU * p + 1)) },
    leg_near_foot: { translate: sampled(0.8, 16, footPath(0)) },
    leg_far_foot: { translate: sampled(0.8, 16, footPath(0.5)) },
    arm_near_upper: { rotate: wave(0.8, 8, (p) => -28 * Math.cos(TAU * p)) },
    arm_far_upper: { rotate: wave(0.8, 8, (p) => 28 * Math.cos(TAU * p)) },
    arm_near_lower: { rotate: wave(0.8, 8, (p) => 18 + 10 * Math.sin(TAU * p)) },
    arm_far_lower: { rotate: wave(0.8, 8, (p) => 18 - 10 * Math.sin(TAU * p)) },
    ...tailWave(0.8, 8, 7),
  },
  events: [{ time: 0, name: 'footstep' }, { time: 0.4, name: 'footstep', int: 1 }],
};

// wave (layer on track 1)
const waveAnim = {
  bones: {
    arm_near_upper: { rotate: eased([[0, 150], [0.6, 140], [1.2, 150]]) },
    arm_near_lower: { rotate: eased([[0, 20], [0.3, 55], [0.6, 20], [0.9, 55], [1.2, 20]]) },
  },
};

// jump (non-looping)
const jumpY = [[0, 0], [0.15, -25], [0.35, 70], [0.6, 80], [0.8, 0], [0.9, -14], [1, 0]];
const footY = [[0, 0], [0.15, 0], [0.35, 52], [0.6, 62], [0.8, 0], [1, 0]];
const xy = (keys, x) => eased(keys, 'y').map((f) => ({ ...f, x, curve: f.curve ? [f.curve[0], x, f.curve[2], x, ...f.curve] : undefined }));
const jump = {
  bones: {
    hip: { translate: xy(jumpY, 0) },
    torso: { rotate: eased([[0, 0], [0.15, -15], [0.35, 0], [0.8, -8], [1, 0]]), scalex: eased([[0, 1], [0.15, 0.85], [0.35, 1.12], [0.6, 1], [0.8, 0.9], [1, 1]]) },
    leg_near_foot: { translate: xy(footY, 8) },
    leg_far_foot: { translate: xy(footY, -8) },
    arm_near_upper: { rotate: eased([[0, 0], [0.15, -30], [0.35, 120], [0.7, 100], [0.85, 0]]) },
    arm_far_upper: { rotate: eased([[0, 0], [0.15, -30], [0.35, 110], [0.7, 90], [0.85, 0]]) },
  },
  drawOrder: [{ time: 0.35, offsets: [{ slot: 'tail', offset: slots.length - 1 - slotIndex.tail }] }, { time: 0.8 }],
  events: [{ time: 0.8, name: 'land' }],
};

// hit: color flash, recoil, tail puff (weighted deform)
const puff = [];
for (const inf of tailInfluences) for (const [nx, ny] of inf) puff.push(r3(nx * 7), r3(ny * 7));
const flash = [
  { time: 0, color: 'ffffffff', curve: [0.04, 1, 0.06, 1, 0.04, 1, 0.06, 0.38, 0.04, 1, 0.06, 0.38, 0.04, 1, 0.06, 1] },
  { time: 0.08, color: 'ff6060ff' },
  { time: 0.4, color: 'ffffffff' },
];
const hit = {
  bones: {
    head: { rotate: eased([[0, 0], [0.08, 18], [0.4, 0]]) },
    torso: { rotate: eased([[0, 0], [0.08, 10], [0.4, 0]]) },
  },
  slots: { body: { rgba: flash }, head: { rgba: flash } },
  attachments: {
    default: {
      tail: {
        tail: {
          deform: [
            { time: 0, curve: [0.04, 0, 0.06, 1] },
            { time: 0.1, vertices: puff, curve: [0.2, 0, 0.3, 1] },
            { time: 0.4 },
          ],
        },
      },
    },
  },
};

// ------------------------------------------------------------------ write

const strip = (o) => JSON.parse(JSON.stringify(o));
const skeleton = {
  skeleton: { hash: 'sinew-demo', spine: '4.2.43', x: -170, y: -5, width: 260, height: 330, fps: 30, images: './images/' },
  bones,
  slots,
  ik: [
    { name: 'leg_far_ik', order: 0, bones: ['leg_far_thigh', 'leg_far_shin'], target: 'leg_far_foot', bendPositive: false },
    { name: 'leg_near_ik', order: 1, bones: ['leg_near_thigh', 'leg_near_shin'], target: 'leg_near_foot', bendPositive: false },
  ],
  skins: [{ name: 'default', attachments: defaultAttachments }, variantSkin('green'), variantSkin('purple')],
  events: { footstep: { int: 0 }, land: { float: 1 } },
  animations: { idle, walk, wave: waveAnim, jump, hit },
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'critter.json'), JSON.stringify(strip(skeleton), null, 1));
fs.writeFileSync(path.join(OUT, 'critter.parts.json'), JSON.stringify(parts, null, 1));
console.log(`wrote ${path.relative(process.cwd(), OUT)}/critter.json (${bones.length} bones, ${slots.length} slots, ${tailVerts.length} tail vertices)`);
