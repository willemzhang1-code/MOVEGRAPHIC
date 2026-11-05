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
  /** Simulated with a physics constraint (secondary motion). */
  physics?: boolean;
}

export const toWorld = (p: Pt, ground: Pt): Pt => ({ x: p.x - ground.x, y: ground.y - p.y });
export const toImage = (p: Pt, ground: Pt): Pt => ({ x: p.x + ground.x, y: ground.y - p.y });

/** A user-added bone (image space endpoints). */
export interface CustomBone {
  name: string;
  parent: string;
  from: Pt;
  to: Pt;
  physics: boolean;
}

export function resolveBones(template: Template, joints: Record<string, Pt>, groups: Record<string, boolean> = {}, custom: CustomBone[] = []): BoneGeom[] {
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
    out.push({ name: def.name, parent, x: start.x, y: start.y, rotation, length, skin: def.skin !== false, physics: def.name.startsWith('tail') });
    index.set(def.name, out.length - 1);
  }
  for (const c of custom) {
    const a = toWorld(c.from, ground);
    const e = toWorld(c.to, ground);
    out.push({
      name: c.name,
      parent: index.get(c.parent) ?? 0,
      x: a.x,
      y: a.y,
      rotation: (Math.atan2(e.y - a.y, e.x - a.x) * 180) / Math.PI,
      length: Math.hypot(e.x - a.x, e.y - a.y),
      skin: true,
      physics: c.physics,
    });
    index.set(c.name, out.length - 1);
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
export interface PartMask {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Part-local, 1 = opaque. */
  mask: Uint8Array;
}

/** Bone segment endpoints in document (image) space. */
function segments(bones: BoneGeom[], ground: Pt) {
  return bones.map((b) => {
    const r = (b.rotation * Math.PI) / 180;
    const len = Math.max(b.length, 1);
    const a = { x: b.x + ground.x, y: ground.y - b.y };
    return { a, b: { x: a.x + Math.cos(r) * len, y: a.y - Math.sin(r) * len }, skin: b.skin, parent: b.parent };
  });
}

const insidePart = (p: PartMask, x: number, y: number, pad = 0) => {
  for (let dy = -pad; dy <= pad; dy += pad || 1) {
    for (let dx = -pad; dx <= pad; dx += pad || 1) {
      const xi = Math.round(x - p.x + dx);
      const yi = Math.round(y - p.y + dy);
      if (xi >= 0 && yi >= 0 && xi < p.width && yi < p.height && p.mask[yi * p.width + xi]) return true;
    }
  }
  return false;
};

/**
 * Which bones may influence each part. Every skinned bone gets a "home" part
 * (the part its segment lies in most, preferring smaller, more specific
 * parts); a part is driven by its home bones plus the parents/children of
 * those that touch it, so joints blend but an arm layer drawn over the torso
 * does not drag the torso along.
 */
export function assignBones(parts: PartMask[], bones: BoneGeom[], ground: Pt): Set<number>[] {
  const segs = segments(bones, ground);
  const maxArea = Math.max(...parts.map((p) => p.width * p.height), 1);
  const coverage = parts.map((p) =>
    segs.map((s) => {
      if (!s.skin) return 0;
      let hit = 0;
      const n = 12;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        if (insidePart(p, s.a.x + (s.b.x - s.a.x) * t, s.a.y + (s.b.y - s.a.y) * t, 2)) hit++;
      }
      return hit / (n + 1);
    }),
  );
  const allowed = parts.map(() => new Set<number>());
  segs.forEach((s, bi) => {
    if (!s.skin) return;
    let best = -1;
    let bestScore = 0.2;
    parts.forEach((p, pi) => {
      const score = coverage[pi][bi] - 0.15 * ((p.width * p.height) / maxArea);
      if (coverage[pi][bi] >= 0.25 && score > bestScore - 1e-9 && (best < 0 || score > bestScore)) {
        best = pi;
        bestScore = score;
      }
    });
    if (best >= 0) allowed[best].add(bi);
  });
  parts.forEach((p, pi) => {
    const home = [...allowed[pi]];
    for (const bi of home) {
      segs.forEach((s, other) => {
        const related = s.parent === bi || segs[bi].parent === other;
        if (related && s.skin && coverage[pi][other] >= 0.05) allowed[pi].add(other);
      });
      const parent = segs[bi].parent;
      if (parent >= 0 && segs[parent].skin && insidePart(p, segs[bi].a.x, segs[bi].a.y, 3)) allowed[pi].add(parent);
    }
    if (!allowed[pi].size) {
      // No bone runs through this part: bind it to the nearest bone.
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      let bd = Infinity;
      let nb = -1;
      segs.forEach((s, bi) => {
        if (!s.skin) return;
        const [d] = segDist(cx, cy, s.a.x, s.a.y, s.b.x, s.b.y);
        if (d < bd) {
          bd = d;
          nb = bi;
        }
      });
      if (nb >= 0) allowed[pi].add(nb);
    }
  });
  return allowed;
}

export function computeWeights(mesh: Mesh, part: PartMask, bones: BoneGeom[], ground: Pt, allowed: Set<number> | null = null): Weights {
  const inside = (x: number, y: number) => insidePart(part, x, y);
  const segs = segments(bones, ground);
  const scale = Math.max(...bones.map((b) => b.length), 1);
  const n = mesh.points.length / 2;
  let weights: Map<number, number>[] = [];
  for (let v = 0; v < n; v++) {
    const px = mesh.points[v * 2];
    const py = mesh.points[v * 2 + 1];
    const cand: [number, number][] = [];
    segs.forEach((s, bi) => {
      if (!s.skin || (allowed && !allowed.has(bi))) return;
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
