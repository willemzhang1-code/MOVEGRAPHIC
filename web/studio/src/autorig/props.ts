// Held props (spear, staff, sword): long, thin, straight runs in the
// silhouette that are not a limb and pass by a hand. Their vertices are bound
// rigidly to that hand so they stay straight instead of bending with the arm
// and leg they overlap.

import type { BoneGeom } from './rig';
import type { Source, SourcePart } from './source';
import type { Pt } from './templates';

export interface Prop {
  a: Pt;
  b: Pt;
  /** Capture radius around the a–b segment (image px). */
  radius: number;
  bone: number;
}

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
};

/** Chamfer (3-4) distance to the background, in 1/3 px. */
function distance(m: Uint8Array, w: number, h: number): Uint16Array {
  const d = new Uint16Array(w * h);
  const INF = 60000;
  for (let i = 0; i < w * h; i++) d[i] = m[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  return d;
}

/** A long, thin, straight run of the silhouette (image px). */
export interface Line {
  a: Pt;
  b: Pt;
  /** Half width of the run. */
  half: number;
  /** Length relative to the silhouette height. */
  rel: number;
  /** Highest point relative to the silhouette (0 top, 1 bottom). */
  upper: number;
}

/** Thin straight runs (prop candidates), found without any skeleton. */
export function findLines(mask: Uint8Array, w: number, h: number): Line[] {
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { top = y; break; }
  for (let y = h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < w; x++) if (mask[y * w + x]) { bottom = y; break; }
  if (top < 0) return [];
  const H = Math.max(1, bottom - top);
  const s = Math.min(1, 512 / Math.max(w, h));
  const dw = Math.max(1, Math.round(w * s));
  const dh = Math.max(1, Math.round(h * s));
  const m = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) m[y * dw + x] = mask[Math.min(h - 1, Math.floor(y / s)) * w + Math.min(w - 1, Math.floor(x / s))];
  const d = distance(m, dw, dh);
  const Hs = H * s;
  const tMax = Math.max(1.5, 0.014 * Hs) * 3; // chamfer units
  // Thin pixels: inside the silhouette with no thick region nearby (a body
  // outline pixel has deep interior pixels next to it; a shaft does not).
  const R = Math.ceil(tMax / 3) + 1;
  const rowMax = new Uint16Array(dw * dh);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      let mval = 0;
      for (let k = Math.max(0, x - R); k <= Math.min(dw - 1, x + R); k++) mval = Math.max(mval, d[y * dw + k]);
      rowMax[y * dw + x] = mval;
    }
  const ridge = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      if (!d[y * dw + x]) continue;
      let mval = 0;
      for (let k = Math.max(0, y - R); k <= Math.min(dh - 1, y + R) && mval <= tMax; k++) mval = Math.max(mval, rowMax[k * dw + x]);
      if (mval <= tMax) ridge[y * dw + x] = 1;
    }
  const seen = new Uint8Array(dw * dh);
  const out: Line[] = [];
  for (let start = 0; start < dw * dh; start++) {
    if (!ridge[start] || seen[start]) continue;
    const comp: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % dw;
      const y = (i / dw) | 0;
      for (let k = -1; k <= 1; k++)
        for (let l = -1; l <= 1; l++) {
          const xx = x + l;
          const yy = y + k;
          if (xx < 0 || yy < 0 || xx >= dw || yy >= dh) continue;
          const j = yy * dw + xx;
          if (ridge[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    if (comp.length < 0.12 * Hs) continue;
    let mx = 0;
    let my = 0;
    let dsum = 0;
    for (const i of comp) {
      mx += i % dw;
      my += (i / dw) | 0;
      dsum = Math.max(dsum, d[i]);
    }
    mx /= comp.length;
    my /= comp.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const i of comp) {
      const x = (i % dw) - mx;
      const y = ((i / dw) | 0) - my;
      sxx += x * x;
      syy += y * y;
      sxy += x * y;
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    let t0 = Infinity;
    let t1 = -Infinity;
    let rms = 0;
    for (const i of comp) {
      const x = (i % dw) - mx;
      const y = ((i / dw) | 0) - my;
      const t = x * ux + y * uy;
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
      const e = -x * uy + y * ux;
      rms += e * e;
    }
    rms = Math.sqrt(rms / comp.length);
    if (t1 - t0 < 0.18 * Hs || rms > 0.012 * Hs + 1) continue;
    out.push({
      a: { x: (mx + ux * t0) / s, y: (my + uy * t0) / s },
      b: { x: (mx + ux * t1) / s, y: (my + uy * t1) / s },
      half: dsum / 3 / s,
      rel: (t1 - t0) / Hs,
      upper: (Math.min(my + uy * t0, my + uy * t1) / s - top) / H,
    });
  }
  return out;
}

/** Longer than any limb and reaching the upper body: certainly a prop (spear, staff). */
export const isLongProp = (l: Line) => l.rel >= 0.45 && l.upper < 0.45;

/** Copy of the mask with the given lines erased. */
export function eraseLines(mask: Uint8Array, w: number, h: number, lines: Line[]): Uint8Array {
  const out = mask.slice();
  for (const line of lines) {
    // Past both ends too: spear heads and butts are wider than the shaft.
    const dx = line.b.x - line.a.x;
    const dy = line.b.y - line.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const e = Math.min(0.08, (line.half * 10) / len);
    const l = { a: { x: line.a.x - dx * e, y: line.a.y - dy * e }, b: { x: line.b.x + dx * e, y: line.b.y + dy * e } };
    const r = line.half * 2.5 + 1;
    const x0 = Math.max(0, Math.floor(Math.min(l.a.x, l.b.x) - r));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(l.a.x, l.b.x) + r));
    const y0 = Math.max(0, Math.floor(Math.min(l.a.y, l.b.y) - r));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(l.a.y, l.b.y) + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (segDist({ x, y }, l.a, l.b) <= r) out[y * w + x] = 0;
  }
  return out;
}

/** Props among the lines: not a limb, held by a hand (segment extended to the wrist). */
export function findProps(lines: Line[], joints: Record<string, Pt>, bones: BoneGeom[]): Prop[] {
  const top = joints.head_top;
  const ground = joints.ground;
  if (!top || !ground || !lines.length) return [];
  const H = Math.max(1, ground.y - top.y);
  const limbs = bones
    .filter((b) => /^(thigh|shin|foot|upper_arm|forearm)_/.test(b.name))
    .map((b) => {
      const r = (b.rotation * Math.PI) / 180;
      const a = { x: b.x + ground.x, y: ground.y - b.y };
      return { a, b: { x: a.x + Math.cos(r) * b.length, y: a.y - Math.sin(r) * b.length }, angle: r };
    });
  const hands = (['l', 'r'] as const)
    .map((side) => ({ wrist: joints[`wrist_${side}`], bone: bones.findIndex((b) => b.name === `hand_${side}`) }))
    .filter((x) => x.wrist && x.bone >= 0);
  const out: Prop[] = [];
  for (const l of lines) {
    const lineAng = Math.atan2(-(l.b.y - l.a.y), l.b.x - l.a.x);
    if (!isLongProp(l)) {
      let onLimb = 0;
      for (let k = 0; k <= 10; k++) {
        const p = { x: l.a.x + ((l.b.x - l.a.x) * k) / 10, y: l.a.y + ((l.b.y - l.a.y) * k) / 10 };
        if (limbs.some((L) => segDist(p, L.a, L.b) < 0.04 * H && Math.abs(Math.sin(L.angle - lineAng)) < 0.42)) onLimb++;
      }
      if (onLimb > 4) continue;
    }
    // Held: a wrist near the (extended) line.
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const len = Math.hypot(dx, dy) || 1;
    let best: { bone: number; dist: number; t: number } | null = null;
    for (const hnd of hands) {
      const t = ((hnd.wrist.x - l.a.x) * dx + (hnd.wrist.y - l.a.y) * dy) / (len * len);
      const perp = Math.abs((hnd.wrist.x - l.a.x) * dy - (hnd.wrist.y - l.a.y) * dx) / len;
      const beyond = t < 0 ? -t * len : t > 1 ? (t - 1) * len : 0;
      if (perp < 0.08 * H && beyond < 0.35 * H && (!best || perp + beyond < best.dist)) best = { bone: hnd.bone, dist: perp + beyond, t };
    }
    if (!best) continue;
    const t0 = Math.min(0, best.t);
    const t1 = Math.max(1, best.t);
    out.push({
      a: { x: l.a.x + dx * t0, y: l.a.y + dy * t0 },
      b: { x: l.a.x + dx * t1, y: l.a.y + dy * t1 },
      radius: l.half * 2.2 + 1,
      bone: best.bone,
    });
  }
  return out;
}

/**
 * Splits a single-image source into the body and one part per prop (same
 * texture page, own mesh). The prop keeps the pixels within its capsule; the
 * body keeps the rest.
 */
export function splitProps(src: Source, props: Prop[], H: number): Source {
  if (src.parts.length !== 1 || !props.length) return src;
  const { width: w, height: h } = src;
  const owner = new Int16Array(w * h).fill(-1);
  props.forEach((pr, k) => {
    // Extend past the far end to take the spear head / blade tip.
    const dx = pr.b.x - pr.a.x;
    const dy = pr.b.y - pr.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ext = Math.max(pr.radius * 2, H * 0.04) / len;
    const a = { x: pr.a.x - dx * ext, y: pr.a.y - dy * ext };
    const b = { x: pr.b.x + dx * ext, y: pr.b.y + dy * ext };
    const r = pr.radius;
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + r));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + r));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (src.mask[y * w + x] && owner[y * w + x] < 0 && segDist({ x, y }, a, b) <= r) owner[y * w + x] = k;
  });
  const partOf = (k: number, name: string): SourcePart | null => {
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src.mask[i] && owner[i] === k) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
    if (x1 < x0) return null;
    const pw = x1 - x0 + 1;
    const ph = y1 - y0 + 1;
    const mask = new Uint8Array(pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) mask[y * pw + x] = src.mask[(y + y0) * w + x + x0] && owner[(y + y0) * w + x + x0] === k ? 1 : 0;
    return { name, x: x0, y: y0, width: pw, height: ph, mask, page: 0, region: { x: x0, y: y0, width: pw, height: ph } };
  };
  const body = partOf(-1, 'body');
  const parts = [body, ...props.map((_, k) => partOf(k, props.length > 1 ? `prop ${k + 1}` : 'prop'))].filter((p): p is SourcePart => !!p);
  return { ...src, parts };
}
