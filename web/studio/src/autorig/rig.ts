// Bone geometry from joints, and automatic skin weights.

import type { Mesh } from './mesh';
import type { Pt, Template } from './templates';

/** A bone in skeleton space (origin at the ground joint, y up, pixels). */
export interface BoneGeom {
  name: string;
  parent: number;
  x: number;
  y: number;
  /** World rotation, degrees. */
  rotation: number;
  length: number;
  skin: boolean;
}

export const toWorld = (p: Pt, ground: Pt): Pt => ({ x: p.x - ground.x, y: ground.y - p.y });
export const toImage = (p: Pt, ground: Pt): Pt => ({ x: p.x + ground.x, y: ground.y - p.y });

export function resolveBones(template: Template, joints: Record<string, Pt>, groups: Record<string, boolean> = {}): BoneGeom[] {
  const ground = joints.ground;
  const out: BoneGeom[] = [];
  const index = new Map<string, number>();
  for (const def of template.bones) {
    if (def.group && !groups[def.group]) continue;
    const start = toWorld(joints[def.from], ground);
    const parent = def.parent ? index.get(def.parent)! : -1;
    // Root (no target) stays axis-aligned so translations on its children are in world axes.
    let rotation = 0;
    let length = 0;
    if (def.to) {
      const end = toWorld(joints[def.to], ground);
      rotation = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
      length = Math.hypot(end.x - start.x, end.y - start.y);
    } else if (parent >= 0) {
      rotation = out[parent].rotation;
      length = out[parent].length * (def.tip ?? 0.5);
    }
    index.set(def.name, out.length);
    out.push({ name: def.name, parent, x: start.x, y: start.y, rotation, length, skin: def.skin !== false });
  }
  return out;
}

/** Per vertex: list of [bone index, weight]. */
export type Weights = [number, number][][];

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return [Math.hypot(px - cx, py - cy), cx, cy];
}

/**
 * Proximity weights with a line-of-sight test through the silhouette, so a
 * vertex on one leg does not bind to the other leg across a gap; then a few
 * Laplacian smoothing passes over the mesh.
 */
export function computeWeights(mesh: Mesh, mask: Uint8Array, w: number, h: number, bones: BoneGeom[], ground: Pt): Weights {
  const inside = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi >= 0 && yi >= 0 && xi < w && yi < h && mask[yi * w + xi] === 1;
  };
  // Bone segments in image space.
  const segs = bones.map((b) => {
    const r = (b.rotation * Math.PI) / 180;
    const len = Math.max(b.length, 1);
    const a = { x: b.x + ground.x, y: ground.y - b.y };
    return { a, b: { x: a.x + Math.cos(r) * len, y: a.y - Math.sin(r) * len }, skin: b.skin };
  });
  const scale = Math.max(...bones.map((b) => b.length), 1);
  const n = mesh.points.length / 2;
  let weights: Map<number, number>[] = [];
  for (let v = 0; v < n; v++) {
    const px = mesh.points[v * 2];
    const py = mesh.points[v * 2 + 1];
    const cand: [number, number][] = [];
    segs.forEach((s, bi) => {
      if (!s.skin) return;
      let [d, cx, cy] = segDist(px, py, s.a.x, s.a.y, s.b.x, s.b.y);
      // Line of sight: fraction of samples outside the silhouette.
      let outside = 0;
      const steps = 10;
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        if (!inside(px + (cx - px) * t, py + (cy - py) * t)) outside++;
      }
      if (outside > 2) d *= 1 + outside;
      cand.push([bi, d]);
    });
    cand.sort((p, q) => p[1] - q[1]);
    const top = cand.slice(0, 3);
    const m = new Map<number, number>();
    let sum = 0;
    for (const [bi, d] of top) {
      const wgt = 1 / Math.pow(d / scale + 0.02, 3);
      m.set(bi, wgt);
      sum += wgt;
    }
    for (const [k, v2] of m) m.set(k, v2 / sum);
    weights.push(m);
  }

  // Mesh adjacency.
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set());
  const t = mesh.triangles;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    adj[a].add(b).add(c);
    adj[b].add(a).add(c);
    adj[c].add(a).add(b);
  }
  for (let pass = 0; pass < 3; pass++) {
    weights = weights.map((m, v) => {
      const out = new Map<number, number>();
      for (const [k, val] of m) out.set(k, val * 0.5);
      const nb = [...adj[v]];
      for (const u of nb) for (const [k, val] of weights[u]) out.set(k, (out.get(k) ?? 0) + (val * 0.5) / nb.length);
      return out;
    });
  }

  return weights.map((m) => {
    const list = [...m].sort((p, q) => q[1] - p[1]).slice(0, 4).filter(([, v]) => v > 0.03);
    const s = list.reduce((acc, [, v]) => acc + v, 0) || 1;
    return list.map(([k, v]) => [k, v / s] as [number, number]);
  });
}
