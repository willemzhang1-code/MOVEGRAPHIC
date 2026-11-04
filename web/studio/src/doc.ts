// Studio document model and compilation to Spine 4.2 JSON + atlas.

import type { Mesh } from './autorig/mesh';
import type { BoneGeom, Weights } from './autorig/rig';
export type { Weights };
import type { Pt, TemplateId } from './autorig/templates';

export type Ease = 'linear' | 'smooth' | 'stepped';

export interface Key {
  t: number;
  /** rotate: [deg]; translate: [x, y] (fraction of skeleton height); scale: [x, y]; color: [r, g, b, a]. */
  v: number[];
  ease?: Ease;
}

export type ChannelProp = 'rotate' | 'translate' | 'scale' | 'color';

export interface Channel {
  target: string;
  prop: ChannelProp;
  keys: Key[];
}

export interface AnimDoc {
  name: string;
  duration: number;
  loop: boolean;
  channels: Channel[];
}

/** One drawable piece of the character (the whole cutout, or a PSD layer). */
export interface Part {
  name: string;
  /** Top-left of the part image in document space (pixels, y down). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Mesh with points in document space. */
  mesh: Mesh;
  weights: Weights;
  page: number;
  /** Where the part image sits in its texture page. */
  region: { x: number; y: number; width: number; height: number };
}

export interface RigDoc {
  name: string;
  template: TemplateId;
  /** Document (composite) size. */
  image: { width: number; height: number };
  joints: Record<string, Pt>;
  /** Enabled optional bone groups (e.g. tail). */
  groups: Record<string, boolean>;
  /** Back to front. */
  parts: Part[];
  pages: { width: number; height: number }[];
  bones: BoneGeom[];
  animations: AnimDoc[];
}

export const vertexCount = (doc: RigDoc) => doc.parts.reduce((s, p) => s + p.mesh.points.length / 2, 0);
export const triangleCount = (doc: RigDoc) => doc.parts.reduce((s, p) => s + p.mesh.triangles.length / 3, 0);

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');

/** Character height in skeleton units (used to scale translations). */
export function skeletonHeight(doc: RigDoc): number {
  return Math.max(...Object.values(doc.joints).map((p) => doc.joints.ground.y - p.y), 1);
}

/** Value of a channel at time t (UI-side sampling, mirrors the core's curves). */
export function sampleChannel(ch: Channel, t: number, fallback: number[]): number[] {
  const k = ch.keys;
  if (!k.length) return fallback;
  if (t <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (t < b.t) {
      if (a.ease === 'stepped') return a.v;
      let p = (t - a.t) / (b.t - a.t);
      if (a.ease === 'smooth') p = p * p * (3 - 2 * p);
      return a.v.map((x, j) => x + (b.v[j] - x) * p);
    }
  }
  return k[k.length - 1].v;
}

function curve(a: Key, b: Key, dims: number): number[] | string | undefined {
  if (a.ease === 'stepped') return 'stepped';
  if (a.ease !== 'smooth') return undefined;
  const out: number[] = [];
  const dt = b.t - a.t;
  for (let j = 0; j < dims; j++) out.push(r3(a.t + dt * 0.4), r3(a.v[j]), r3(a.t + dt * 0.6), r3(b.v[j]));
  return out;
}

function compileAnimation(doc: RigDoc, a: AnimDoc, H: number): object {
  const bones: Record<string, Record<string, object[]>> = {};
  const slots: Record<string, Record<string, object[]>> = {};
  const boneNames = new Set(doc.bones.map((b) => b.name));
  for (const ch of a.channels) {
    if (!ch.keys.length) continue;
    if (ch.prop !== 'color' && !boneNames.has(ch.target)) continue;
    const keys = [...ch.keys].sort((p, q) => p.t - q.t);
    const frames = keys.map((k, i) => {
      const next = keys[i + 1];
      const f: Record<string, unknown> = { time: r3(k.t) };
      let dims = 1;
      let values = k.v;
      if (ch.prop === 'rotate') f.value = r3(k.v[0]);
      else if (ch.prop === 'translate') {
        values = [k.v[0] * H, k.v[1] * H];
        f.x = r3(values[0]);
        f.y = r3(values[1]);
        dims = 2;
      } else if (ch.prop === 'scale') {
        f.x = r3(k.v[0]);
        f.y = r3(k.v[1]);
        dims = 2;
      } else {
        f.color = k.v.map(hex2).join('');
        dims = 4;
      }
      if (next) {
        const scaled = (key: Key) => (ch.prop === 'translate' ? { ...key, v: [key.v[0] * H, key.v[1] * H] } : key);
        const c = curve(scaled(k), scaled(next), dims);
        if (c) f.curve = c;
      }
      return f;
    });
    if (ch.prop === 'color') {
      const targets = doc.parts.some((p) => p.name === ch.target) ? [ch.target] : doc.parts.map((p) => p.name);
      for (const t of targets) (slots[t] ??= {}).rgba = frames;
    } else (bones[ch.target] ??= {})[ch.prop] = frames;
  }
  const out: Record<string, unknown> = {};
  if (Object.keys(bones).length) out.bones = bones;
  if (Object.keys(slots).length) out.slots = slots;
  // Pad to the requested duration with a no-op channel (root shear stays 0).
  const maxKey = Math.max(0, ...a.channels.flatMap((c) => c.keys.map((k) => k.t)));
  if (maxKey < a.duration - 1e-4) {
    const b = (out.bones ??= {}) as Record<string, Record<string, object[]>>;
    (b.root ??= {}).shear = [{ time: 0, x: 0, y: 0 }, { time: r3(a.duration), x: 0, y: 0 }];
  }
  return out;
}

export const pageFile = (base: string, i: number) => (i === 0 ? `${base}.png` : `${base}-${i + 1}.png`);

/** Compiles the document to Spine 4.2 JSON (object) and an atlas string. */
export function compile(doc: RigDoc, base = 'character'): { json: Record<string, unknown>; atlas: string } {
  const H = skeletonHeight(doc);
  const ground = doc.joints.ground;
  const spineBones = doc.bones.map((b) => {
    const out: Record<string, unknown> = { name: b.name };
    if (b.parent >= 0) {
      const p = doc.bones[b.parent];
      const pr = (p.rotation * Math.PI) / 180;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      out.parent = p.name;
      out.x = r3(dx * Math.cos(pr) + dy * Math.sin(pr));
      out.y = r3(-dx * Math.sin(pr) + dy * Math.cos(pr));
      out.rotation = r3(b.rotation - p.rotation);
    } else {
      out.x = r3(b.x);
      out.y = r3(b.y);
      out.rotation = r3(b.rotation);
    }
    if (b.length > 0) out.length = r3(b.length);
    return out;
  });

  const attachments: Record<string, Record<string, object>> = {};
  for (const part of doc.parts) {
    const { points, triangles, hull, edges } = part.mesh;
    const n = points.length / 2;
    const uvs: number[] = [];
    const vertices: number[] = [];
    for (let v = 0; v < n; v++) {
      const ix = points[v * 2];
      const iy = points[v * 2 + 1];
      uvs.push(r3((ix - part.x) / part.width), r3((iy - part.y) / part.height));
      const wx = ix - ground.x;
      const wy = ground.y - iy;
      const infl = part.weights[v]?.length ? part.weights[v] : [[1, 1] as [number, number]];
      vertices.push(infl.length);
      for (const [bi, w] of infl) {
        const b = doc.bones[bi];
        const r = (b.rotation * Math.PI) / 180;
        const dx = wx - b.x;
        const dy = wy - b.y;
        vertices.push(bi, r3(dx * Math.cos(r) + dy * Math.sin(r)), r3(-dx * Math.sin(r) + dy * Math.cos(r)), r3(w));
      }
    }
    attachments[part.name] = {
      [part.name]: {
        type: 'mesh',
        uvs,
        triangles: Array.from(triangles),
        vertices,
        hull,
        edges: Array.from(edges).map((e) => e * 2),
        width: part.width,
        height: part.height,
      },
    };
  }

  const animations: Record<string, object> = {};
  for (const a of doc.animations) animations[a.name] = compileAnimation(doc, a, H);

  const json = {
    skeleton: {
      hash: 'rabbit',
      spine: '4.2.43',
      x: r3(-ground.x),
      y: r3(ground.y - doc.image.height),
      width: doc.image.width,
      height: doc.image.height,
      images: './',
      audio: '',
    },
    bones: spineBones,
    slots: doc.parts.map((p) => ({ name: p.name, bone: 'root', attachment: p.name })),
    skins: [{ name: 'default', attachments }],
    animations,
  };
  const atlas = doc.pages
    .map((pg, i) => {
      let t = `${pageFile(base, i)}\nsize: ${pg.width}, ${pg.height}\nfilter: Linear, Linear\npma: false\n`;
      for (const p of doc.parts.filter((q) => q.page === i)) {
        t += `${p.name}\n  bounds: ${p.region.x}, ${p.region.y}, ${p.region.width}, ${p.region.height}\n`;
      }
      return t;
    })
    .join('\n');
  return { json, atlas };
}
