import { motionLibrary } from '../motions';
import type { AnimDoc, Part, RigDoc } from '../doc';
import { buildMesh, type Mesh } from './mesh';
import { dangles, jointsFromLayers } from './hints';
import { assignBones, computeWeights, resolveBones, toWorld, type BoneGeom } from './rig';
import type { Source } from './source';
import { TEMPLATES, type Pt, type TemplateId } from './templates';

export { cutout } from './mask';
export type { Cutout } from './mask';
export { sourceFromCutout, sourceFromProject, sourceFromPsd } from './source';
export type { Source } from './source';
export { TEMPLATES } from './templates';
export type { Pt, TemplateId } from './templates';

/** Vertices along the character height. */
export const DEFAULT_DENSITY = 30;

export function characterHeight(joints: Record<string, Pt>): number {
  const ys = Object.values(joints).map((p) => p.y);
  return Math.max(1, Math.max(...ys) - Math.min(...ys));
}

export interface RigOptions {
  template: TemplateId;
  density?: number;
  joints?: Record<string, Pt>;
  groups?: Record<string, boolean>;
  /** Reuse meshes (document space), one per part. */
  meshes?: Mesh[];
  animations?: AnimDoc[];
}

function offsetMesh(m: Mesh, dx: number, dy: number, w: number, h: number): Mesh {
  if (m.triangles.length === 0) {
    // Too small or thin for the grid: a single quad.
    return {
      points: Float32Array.from([dx, dy, dx + w, dy, dx + w, dy + h, dx, dy + h]),
      triangles: Uint32Array.from([0, 1, 2, 2, 3, 0]),
      hull: 4,
      edges: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0]),
    };
  }
  const points = new Float32Array(m.points.length);
  for (let i = 0; i < m.points.length; i += 2) {
    points[i] = m.points[i] + dx;
    points[i + 1] = m.points[i + 1] + dy;
  }
  return { ...m, points };
}

/** Joint guess: silhouette heuristics, refined by named layers when available. */
export function guessJoints(src: Source, template: TemplateId): { joints: Record<string, Pt>; groups: Record<string, boolean> } {
  const g = TEMPLATES[template].guess(src.mask, src.width, src.height);
  const hint = src.parts.length > 1 ? jointsFromLayers(template, src.parts, g.joints) : null;
  return hint ? { joints: hint.joints, groups: { ...g.groups, tail: hint.tail } } : g;
}

/** Two-bone physics chains for hair / cloth layers, hanging from head or chest. */
function addDangles(bones: BoneGeom[], src: Source, joints: Record<string, Pt>) {
  const head = bones.findIndex((b) => b.name === 'head');
  const chest = bones.findIndex((b) => b.name === 'chest');
  if (head < 0 || chest < 0) return;
  const used = new Set<string>();
  for (const d of dangles(src.parts, { head: joints.neck, chest: joints.chest })) {
    const base = `dangle_${d.part.replace(/[^A-Za-z0-9\u4e00-\u9fff]+/g, '_')}`;
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base}_${k}`;
    used.add(name);
    const [a, m, e] = d.points.map((p) => toWorld(p, joints.ground));
    const seg = (p: Pt, q: Pt) => ({ rotation: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI, length: Math.hypot(q.x - p.x, q.y - p.y) });
    const first = bones.length;
    bones.push({ name: `${name}_1`, parent: d.kind === 'hair' ? head : chest, x: a.x, y: a.y, ...seg(a, m), skin: true, physics: true });
    bones.push({ name: `${name}_2`, parent: first, x: m.x, y: m.y, ...seg(m, e), skin: true, physics: true });
  }
}

/** Full auto-rig: joints (guessed unless given), meshes, bones, weights, motions. */
export function buildDoc(src: Source, o: RigOptions): RigDoc {
  const t = TEMPLATES[o.template];
  const guess = o.joints && o.groups ? null : guessJoints(src, o.template);
  const joints = o.joints ?? guess!.joints;
  const groups = o.groups ?? guess?.groups ?? {};
  const spacing = Math.max(5, characterHeight(joints) / (o.density ?? DEFAULT_DENSITY));
  const bones = resolveBones(t, joints, groups);
  if (src.parts.length > 1 && o.template === 'humanoid') addDangles(bones, src, joints);
  const allowed = src.parts.length > 1 ? assignBones(src.parts, bones, joints.ground) : [null];
  const parts: Part[] = src.parts.map((sp, i) => {
    const local = Math.min(spacing, Math.max(4, Math.min(sp.width, sp.height) / 3));
    const mesh = o.meshes?.[i] ?? offsetMesh(buildMesh(sp.mask, sp.width, sp.height, local), sp.x, sp.y, sp.width, sp.height);
    const weights = computeWeights(mesh, sp, bones, joints.ground, allowed[i] ?? null);
    return { name: sp.name, x: sp.x, y: sp.y, width: sp.width, height: sp.height, mesh, weights, page: sp.page, region: sp.region };
  });
  return {
    name: src.name,
    template: o.template,
    image: { width: src.width, height: src.height },
    joints,
    groups,
    parts,
    pages: src.pages.map((c) => ({ width: c.width, height: c.height })),
    bones,
    animations: o.animations ?? motionLibrary(o.template),
  };
}
