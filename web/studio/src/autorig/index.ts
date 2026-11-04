import { motionLibrary } from '../motions';
import type { AnimDoc, RigDoc } from '../doc';
import type { Cutout } from './mask';
import { buildMesh, type Mesh } from './mesh';
import { computeWeights, resolveBones } from './rig';
import { TEMPLATES, type Pt, type TemplateId } from './templates';

export { cutout } from './mask';
export type { Cutout } from './mask';
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
  mesh?: Mesh;
  animations?: AnimDoc[];
}

/** Full auto-rig: joints (guessed unless given), mesh, bones, weights, motions. */
export function buildDoc(name: string, cut: Cutout, o: RigOptions): RigDoc {
  const t = TEMPLATES[o.template];
  const guess = o.joints && o.groups ? null : t.guess(cut.mask, cut.width, cut.height);
  const joints = o.joints ?? guess!.joints;
  const groups = o.groups ?? guess?.groups ?? {};
  const spacing = Math.max(5, characterHeight(joints) / (o.density ?? DEFAULT_DENSITY));
  const mesh = o.mesh ?? buildMesh(cut.mask, cut.width, cut.height, spacing);
  const bones = resolveBones(t, joints, groups);
  const weights = computeWeights(mesh, cut.mask, cut.width, cut.height, bones, joints.ground);
  return {
    name,
    template: o.template,
    image: { width: cut.width, height: cut.height },
    joints,
    groups,
    mesh,
    bones,
    weights,
    animations: o.animations ?? motionLibrary(o.template),
  };
}
