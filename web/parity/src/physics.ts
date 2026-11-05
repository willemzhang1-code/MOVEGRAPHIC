// Physics probe: drives a one-bone physics rig with step / sine inputs and
// records the simulated bone's world transform per frame, in the official
// spine-webgl runtime (black box) and in the RABBIT core. Dev-only; the
// recorded traces are used to fit our own physics model.
import * as spine from '@esotericsoftware/spine-webgl';
import { SinewRuntime } from '@sinew/runtime';

export interface ProbeCase {
  name: string;
  /** Physics constraint fields (Spine JSON names). */
  phys: Record<string, number>;
  /** Simulated bone: rotation (deg), length, x offset from the driven bone. */
  bone?: { rotation?: number; length?: number; x?: number };
  /** Driven bone keys: translate [x, y] or rotate [deg], stepped or linear. */
  drive?: { prop: 'translate' | 'rotate'; keys: [number, ...number[]][]; stepped?: boolean; target?: string };
  seconds?: number;
  dt?: number;
  /** Physics on the child bone 'tip' too (length 60). */
  tipPhys?: Record<string, number>;
  /** Skeleton (instance) scale. */
  skScale?: number;
  /** Third bone 'tip2' under 'tip' with tipPhys too; constraint orders for phys, tip, tip2. */
  chain3?: [number, number, number];
  /** Child constraint ordered before the parent's. */
  tipFirst?: boolean;
  /** Skeleton referenceScale (default 100). */
  ref?: number;
  /** Uniform scale on the driven bone. */
  scale?: number;
}

const step = (x: number, y: number, at = 0.25): ProbeCase['drive'] => ({ prop: 'translate', keys: [[0, 0, 0], [at, x, y]], stepped: true });
const sine = (amp: number, hz: number, seconds: number): ProbeCase['drive'] => {
  const keys: [number, number, number][] = [];
  for (let t = 0; t <= seconds + 1e-9; t += 1 / 60) keys.push([Math.round(t * 1e4) / 1e4, amp * Math.sin(2 * Math.PI * hz * t), 0]);
  return { prop: 'translate', keys };
};

/** Slightly off 1/60 so the fixed-step accumulator never jitters between 0 and 2 steps. */
const DT = (1 / 60) * 1.0005;
const down = { rotation: -90, length: 100 };
const P = (o: Record<string, number>) => ({ inertia: 1, strength: 100, damping: 1, mass: 1, ...o });

export const CASES: ProbeCase[] = [
  { name: 'rot-base', phys: P({ rotate: 1 }), bone: down, drive: step(50, 0) },
  { name: 'rot-damp0.5', phys: P({ rotate: 1, damping: 0.5 }), bone: down, drive: step(50, 0) },
  { name: 'rot-damp0.9', phys: P({ rotate: 1, damping: 0.9 }), bone: down, drive: step(50, 0) },
  { name: 'rot-str50', phys: P({ rotate: 1, strength: 50 }), bone: down, drive: step(50, 0) },
  { name: 'rot-str200', phys: P({ rotate: 1, strength: 200 }), bone: down, drive: step(50, 0) },
  { name: 'rot-mass2', phys: P({ rotate: 1, mass: 2 }), bone: down, drive: step(50, 0) },
  { name: 'rot-inertia0.5', phys: P({ rotate: 1, inertia: 0.5 }), bone: down, drive: step(50, 0) },
  { name: 'rot-step10', phys: P({ rotate: 1 }), bone: down, drive: step(10, 0) },
  { name: 'rot-step200', phys: P({ rotate: 1 }), bone: down, drive: step(200, 0) },
  { name: 'rot-len200', phys: P({ rotate: 1 }), bone: { rotation: -90, length: 200 }, drive: step(50, 0) },
  { name: 'rot-along', phys: P({ rotate: 1 }), bone: down, drive: step(0, 50) },
  { name: 'rot-fps30', phys: P({ rotate: 1, fps: 30 }), bone: down, drive: step(50, 0) },
  { name: 'rot-dt30', phys: P({ rotate: 1 }), bone: down, drive: step(50, 0), dt: 1 / 30 },
  { name: 'rot-sine', phys: P({ rotate: 1 }), bone: down, drive: sine(30, 1.5, 2), seconds: 2 },
  { name: 'rot-mix0.5', phys: P({ rotate: 1, mix: 0.5 }), bone: down, drive: step(50, 0) },
  { name: 'rot-gravity', phys: P({ rotate: 1, gravity: 100 }), bone: { rotation: 0, length: 100 } },
  { name: 'rot-wind', phys: P({ rotate: 1, wind: 100 }), bone: down },
  { name: 'rot-parent-rot', phys: P({ rotate: 1 }), bone: { rotation: -90, length: 100, x: 100 }, drive: { prop: 'rotate', keys: [[0, 0], [0.25, 30]], stepped: true } },
  { name: 'x-base', phys: P({ x: 1 }), bone: down, drive: step(50, 0) },
  { name: 'x-damp0.5', phys: P({ x: 1, damping: 0.5 }), bone: down, drive: step(50, 0) },
  { name: 'x-limit10', phys: P({ x: 1, limit: 10 }), bone: down, drive: step(50, 0) },
  { name: 'x-gravity', phys: P({ x: 1, y: 1, gravity: 100 }), bone: down },
  { name: 'y-base', phys: P({ y: 1 }), bone: down, drive: step(0, 50) },
  { name: 'xy-sine', phys: P({ x: 1, y: 1 }), bone: down, drive: sine(30, 1.5, 2), seconds: 2 },
  { name: 'scale-base', phys: P({ scaleX: 1 }), bone: down, drive: step(0, -50) },
  { name: 'scale-cross', phys: P({ scaleX: 1 }), bone: down, drive: step(50, 0) },
  { name: 'shear-base', phys: P({ shearX: 1 }), bone: down, drive: step(50, 0) },
  { name: 'x-damp0.9', phys: P({ x: 1, damping: 0.9 }), bone: down, drive: step(50, 0) },
  { name: 'x-damp0.7', phys: P({ x: 1, damping: 0.7 }), bone: down, drive: step(50, 0) },
  { name: 'x-damp0', phys: P({ x: 1, damping: 0 }), bone: down, drive: step(50, 0) },
  { name: 'x-str50', phys: P({ x: 1, strength: 50 }), bone: down, drive: step(50, 0) },
  { name: 'x-mass2', phys: P({ x: 1, mass: 2 }), bone: down, drive: step(50, 0) },
  { name: 'x-mass2-d0.7', phys: P({ x: 1, mass: 2, damping: 0.7 }), bone: down, drive: step(50, 0) },
  { name: 'x-inertia0.5', phys: P({ x: 1, inertia: 0.5 }), bone: down, drive: step(50, 0) },
  { name: 'x-fps30', phys: P({ x: 1, fps: 30 }), bone: down, drive: step(50, 0) },
  { name: 'x-fps30-d0.7', phys: P({ x: 1, fps: 30, damping: 0.7 }), bone: down, drive: step(50, 0) },
  { name: 'x-wind', phys: P({ x: 1, wind: 100 }), bone: down },
  { name: 'x-gravity-only', phys: P({ y: 1, gravity: 100 }), bone: down },
  { name: 'x-ramp', phys: P({ x: 1, damping: 0.7 }), bone: down, drive: { prop: 'translate', keys: [[0, 0, 0], [0.25, 0, 0], [0.75, 100, 0]] } },
  { name: 'x-scaled', phys: P({ x: 1 }), bone: down, drive: step(50, 0), scale: 2 },
  { name: 'r-diag', phys: P({ rotate: 1 }), bone: down, drive: step(50, 30) },
  { name: 's-diag', phys: P({ scaleX: 1 }), bone: down, drive: step(50, 30) },
  { name: 'rs-diag', phys: P({ rotate: 1, scaleX: 1 }), bone: down, drive: step(50, 30) },
  { name: 'rsh-diag', phys: P({ rotate: 1, shearX: 1 }), bone: down, drive: step(50, 30) },
  { name: 'xys-diag', phys: P({ x: 1, y: 1, scaleX: 1 }), bone: down, drive: step(50, 30) },
  { name: 'xyr-diag', phys: P({ x: 1, y: 1, rotate: 1 }), bone: down, drive: step(50, 30) },
  { name: 'xyrs-diag', phys: P({ x: 1, y: 1, rotate: 1, scaleX: 1 }), bone: down, drive: step(50, 30) },
  { name: 'xr-mix0.5', phys: P({ x: 1, rotate: 1, mix: 0.5 }), bone: down, drive: step(50, 0) },
  { name: 'xr-x0.5', phys: P({ x: 0.5, rotate: 1 }), bone: down, drive: step(50, 0) },
  { name: 'rs-sine', phys: P({ rotate: 1, scaleX: 1, damping: 0.8 }), bone: down, drive: sine(40, 1.2, 2), seconds: 2 },
  { name: 'wind-mass2', phys: P({ x: 1, wind: 100, mass: 2 }), bone: down },
  { name: 'wind-str50', phys: P({ x: 1, wind: 100, strength: 50 }), bone: down },
  { name: 'rgrav-mass2', phys: P({ rotate: 1, gravity: 100, mass: 2 }), bone: { rotation: 0, length: 100 } },
  { name: 'rgrav-len50', phys: P({ rotate: 1, gravity: 100 }), bone: { rotation: 0, length: 50 } },
  { name: 'sgrav', phys: P({ scaleX: 1, gravity: 100 }), bone: down },
  { name: 'limit-fps30', phys: P({ x: 1, limit: 10, fps: 30 }), bone: down, drive: step(50, 0) },
  { name: 'limit-diag', phys: P({ x: 1, y: 1, limit: 10 }), bone: down, drive: step(50, 50) },
  { name: 'rot-scaled', phys: P({ rotate: 1 }), bone: down, drive: step(50, 0), scale: 2 },
  { name: 'rot-dt30-d0.8', phys: P({ rotate: 1, damping: 0.8 }), bone: down, drive: step(50, 0), dt: 1 / 30 },
  { name: 'x-dt30', phys: P({ x: 1 }), bone: down, drive: step(50, 0), dt: 1 / 30 },
  { name: 'x-dt45', phys: P({ x: 1 }), bone: down, drive: step(50, 0, 0.3), dt: 1 / 45 },
  { name: 'x-dt24', phys: P({ x: 1, damping: 0.9 }), bone: down, drive: step(50, 0, 0.3), dt: 1 / 24 },
  { name: 'x-fps50', phys: P({ x: 1, fps: 50 }), bone: down, drive: step(50, 0, 0.3) },
  { name: 'r-dt45', phys: P({ rotate: 1, damping: 0.9 }), bone: down, drive: sine(30, 1.5, 2), seconds: 2, dt: 1 / 45 },
  { name: 'xr-dt24', phys: P({ x: 1, rotate: 1, damping: 0.9 }), bone: down, drive: step(50, 20, 0.3), dt: 1 / 24 },
  { name: 'sgrav-len50', phys: P({ scaleX: 1, gravity: 100 }), bone: { rotation: -90, length: 50 } },
  { name: 'rgrav-ref50', phys: P({ rotate: 1, gravity: 100 }), bone: { rotation: 0, length: 100 }, ref: 50 },
  { name: 'xwind-ref50', phys: P({ x: 1, wind: 100 }), bone: down, ref: 50 },
  { name: 'sgrav-ref50', phys: P({ scaleX: 1, gravity: 100 }), bone: down, ref: 50 },
  { name: 'limit-ref50', phys: P({ x: 1, limit: 10 }), bone: down, drive: step(50, 0), ref: 50 },
  { name: 'rot-ref50', phys: P({ rotate: 1, x: 1 }), bone: down, drive: step(50, 0), ref: 50 },
  { name: 'x-ramp0', phys: P({ x: 1, damping: 0.8 }), bone: down, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5, -200, 0]] } },
  { name: 'x-ramp0-limit', phys: P({ x: 1, damping: 0.8, limit: 300 }), bone: down, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5, -200, 0]] } },
  { name: 'x-ramp0-in0.4', phys: P({ x: 1, damping: 0.8, inertia: 0.4, mass: 3 }), bone: down, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5, -200, 0]] } },
  { name: 'chain-x', phys: P({ x: 1, y: 1, damping: 0.8 }), tipPhys: P({ x: 1, y: 1, damping: 0.8, inertia: 0.5 }), bone: down, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5, -200, 0]] } },
  { name: 'chain-rot', phys: P({ rotate: 1, damping: 0.8 }), tipPhys: P({ rotate: 1, damping: 0.8 }), bone: down, drive: step(50, 0) },
  { name: 'chain-x-rot', phys: P({ x: 1, y: 1, damping: 0.8 }), tipPhys: P({ rotate: 1, damping: 0.8 }), bone: down, drive: step(50, 0) },
  { name: 'chain-x-rev', phys: P({ x: 1, y: 1, damping: 0.8 }), tipPhys: P({ x: 1, y: 1, damping: 0.8, inertia: 0.5 }), tipFirst: true, bone: down, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5, -200, 0]] } },
  { name: 'chain-rot-rev', phys: P({ rotate: 1, damping: 0.8 }), tipPhys: P({ rotate: 1, damping: 0.8 }), tipFirst: true, bone: down, drive: step(50, 0) },
  { name: 'potface', phys: { x: 0.1667, y: 0.1026, limit: 500, inertia: 0.5, strength: 137.3, damping: 0.6078 }, bone: { rotation: 0, length: 0 }, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5667, -389.34, 0]] } },
  { name: 'potface-len', phys: { x: 0.1667, y: 0.1026, limit: 500, inertia: 0.5, strength: 137.3, damping: 0.6078 }, bone: { rotation: 0, length: 50 }, drive: { prop: 'translate', keys: [[0, 0, 0], [0.5667, -389.34, 0]] } },
  { name: 'limit-in0.5', phys: P({ x: 1, inertia: 0.5, limit: 10 }), bone: down, drive: step(50, 0) },
  { name: 'limit-in0.5-rot', phys: P({ rotate: 1, inertia: 0.5, limit: 10 }), bone: down, drive: step(50, 0) },
  { name: 'limit-in0.5-scale', phys: P({ scaleX: 1, inertia: 0.5, limit: 10 }), bone: down, drive: step(0, -50) },
  { name: 'limit-xr', phys: P({ x: 1, rotate: 1, inertia: 0.5, limit: 10 }), bone: down, drive: step(50, 0) },
  { name: 'limit-skscale', phys: P({ x: 1, limit: 10 }), bone: down, drive: step(50, 0), skScale: 2 },
  { name: 'rot-skscale', phys: P({ rotate: 1, gravity: 50 }), bone: down, drive: step(50, 0), skScale: 2 },
  { name: 'x-skscale-wind', phys: P({ x: 1, wind: 50 }), bone: down, skScale: 2 },
  { name: 'rgrav-bonescale2', phys: P({ rotate: 1, gravity: 100 }), bone: { rotation: 0, length: 100 }, scale: 2 },
  { name: 'rgrav-skscale2', phys: P({ rotate: 1, gravity: 100 }), bone: { rotation: 0, length: 100 }, skScale: 2 },
  { name: 'sgrav-skscale2', phys: P({ scaleX: 1, gravity: 100 }), bone: down, skScale: 2 },
  { name: 'sgrav-bonescale2', phys: P({ scaleX: 1, gravity: 100 }), bone: down, scale: 2 },
  { name: 'ygrav-skscale2', phys: P({ y: 1, gravity: 100 }), bone: down, skScale: 2 },
  { name: 'limit-bonescale2', phys: P({ x: 1, limit: 10 }), bone: down, drive: step(50, 0), scale: 2 },
  { name: 'chain3-rot', phys: P({ rotate: 1, damping: 0.85, inertia: 0.5, limit: 500 }), tipPhys: P({ rotate: 1, damping: 0.85, inertia: 0.5, limit: 500 }), chain3: [0, 2, 1], bone: { rotation: -70, length: 33 }, drive: { prop: 'translate', keys: [[0, 0, 0], [0.3, 60, 40], [0.6, -30, 0]] } },
  { name: 'chain3-rot-inorder', phys: P({ rotate: 1, damping: 0.85, inertia: 0.5, limit: 500 }), tipPhys: P({ rotate: 1, damping: 0.85, inertia: 0.5, limit: 500 }), chain3: [0, 1, 2], bone: { rotation: -70, length: 33 }, drive: { prop: 'translate', keys: [[0, 0, 0], [0.3, 60, 40], [0.6, -30, 0]] } },
  { name: 'rot-own', phys: P({ rotate: 1, damping: 0.85 }), bone: down, drive: { prop: 'rotate', keys: [[0, -90], [0.25, -60]], stepped: true, target: 'phys' } },
  { name: 'rot-own-x', phys: P({ rotate: 1, damping: 0.85 }), bone: { rotation: -90, length: 100, x: 50 }, drive: { prop: 'rotate', keys: [[0, -90], [0.25, -60]], stepped: true, target: 'phys' } },
  { name: 'all-base', phys: P({ x: 1, y: 1, rotate: 1, scaleX: 1, shearX: 1 }), bone: down, drive: step(50, 30) },
];

export function caseJson(c: ProbeCase): string {
  const seconds = c.seconds ?? 2;
  const anim: Record<string, unknown> = {};
  if (c.drive) {
    const frames = c.drive.keys.map(([t, ...v]) => {
      const f: Record<string, unknown> = { time: t };
      if (c.drive!.prop === 'rotate') f.value = v[0];
      else {
        f.x = v[0];
        f.y = v[1];
      }
      if (c.drive!.stepped) f.curve = 'stepped';
      return f;
    });
    const last = c.drive.keys[c.drive.keys.length - 1];
    if (last[0] < seconds) frames.push(c.drive.prop === 'rotate' ? { time: seconds, value: last[1] } : { time: seconds, x: last[1], y: last[2] });
    anim.bones = { [c.drive.target ?? 'mover']: { [c.drive.prop]: frames } };
  } else anim.bones = { mover: { translate: [{ time: 0 }, { time: seconds }] } };
  return JSON.stringify({
    skeleton: { spine: '4.2.43', ...(c.ref ? { referenceScale: c.ref } : {}) },
    bones: [
      { name: 'root' },
      { name: 'mover', parent: 'root', scaleX: c.scale ?? 1, scaleY: c.scale ?? 1 },
      { name: 'phys', parent: 'mover', x: c.bone?.x ?? 0, rotation: c.bone?.rotation ?? 0, length: c.bone?.length ?? 100 },
      { name: 'tip', parent: 'phys', x: c.bone?.length ?? 100, ...(c.tipPhys ? { length: c.chain3 ? 35 : 60, rotation: c.chain3 ? -5 : 0 } : {}) },
      ...(c.chain3 ? [{ name: 'tip2', parent: 'tip', x: 35, length: 38, rotation: -3 }] : []),
    ],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    physics: c.chain3
      ? [
          { name: 'p', order: c.chain3[0], bone: 'phys', ...c.phys },
          { name: 'p2', order: c.chain3[1], bone: 'tip', ...c.tipPhys },
          { name: 'p3', order: c.chain3[2], bone: 'tip2', ...c.tipPhys },
        ]
      : [{ name: 'p', order: c.tipFirst ? 1 : 0, bone: 'phys', ...c.phys }, ...(c.tipPhys ? [{ name: 'p2', order: c.tipFirst ? 0 : 1, bone: 'tip', ...c.tipPhys }] : [])],
    animations: { drive: anim },
  });
}

/** Per frame: phys worldX, worldY, a, b, c, d, tip worldX, tip worldY. */
export type Trace = number[][];

export function runRef(c: ProbeCase): Trace {
  const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(new spine.TextureAtlas(''))).readSkeletonData(JSON.parse(caseJson(c)));
  const sk = new spine.Skeleton(data);
  sk.scaleX = sk.scaleY = c.skScale ?? 1;
  sk.setToSetupPose();
  const st = new spine.AnimationState(new spine.AnimationStateData(data));
  st.setAnimation(0, 'drive', false);
  st.apply(sk);
  sk.updateWorldTransform(spine.Physics.reset);
  const dt = c.dt ?? DT;
  const n = Math.round((c.seconds ?? 2) / dt);
  const out: Trace = [];
  const b = sk.findBone('phys')!;
  const tip = sk.findBone('tip')!;
  for (let i = 0; i < n; i++) {
    st.update(dt);
    st.apply(sk);
    sk.update(dt);
    sk.updateWorldTransform(spine.Physics.update);
    out.push([b.worldX, b.worldY, b.a, b.b, b.c, b.d, tip.worldX, tip.worldY]);
  }
  return out;
}

export function runOurs(rt: SinewRuntime, c: ProbeCase): Trace {
  const data = rt.loadSpine(caseJson(c), '');
  const inst = data.createInstance();
  if (c.skScale) inst.setTransform(0, 0, c.skScale, c.skScale);
  inst.setAnimation(0, 'drive', false);
  inst.update(0);
  const dt = c.dt ?? DT;
  const n = Math.round((c.seconds ?? 2) / dt);
  const bi = data.bones.findIndex((b) => b.name === 'phys');
  const ti = data.bones.findIndex((b) => b.name === 'tip');
  const out: Trace = [];
  for (let i = 0; i < n; i++) {
    inst.update(dt);
    const w = inst.boneWorld();
    const o = bi * 7;
    const t = ti * 7;
    out.push([w[o + 4], w[o + 5], w[o], w[o + 1], w[o + 2], w[o + 3], w[t + 4], w[t + 5]]);
  }
  inst.dispose();
  data.dispose();
  return out;
}

let THR = 0.05;
/** Bone-by-bone comparison on a real example: first frame where any bone diverges. */
async function compareExample(rt: SinewRuntime, name: string, animName: string | null, frames: number, trace: string | null = null) {
  const dir = `/examples/4.2/${name}/`;
  const index = (await (await fetch('/examples/4.2/index.json')).json()) as { name: string; skeleton: string; atlas: string }[];
  const e = index.find((x) => x.name === name)!;
  const jsonText = await (await fetch(dir + e.skeleton)).text();
  const atlasText = await (await fetch(dir + e.atlas)).text();
  const atlas = new spine.TextureAtlas(atlasText);
  const refData = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(jsonText));
  const anim = animName ?? refData.animations[0].name;
  const sk = new spine.Skeleton(refData);
  sk.setToSetupPose();
  const st = new spine.AnimationState(new spine.AnimationStateData(refData));
  st.setAnimation(0, anim, true);
  st.apply(sk);
  sk.updateWorldTransform(spine.Physics.reset);
  const data = rt.loadSpine(jsonText, atlasText);
  const inst = data.createInstance();
  inst.setAnimation(0, anim, true);
  inst.update(0);
  const physBones = new Set(refData.physicsConstraints.map((c) => c.bone.name));
  const report: string[] = [`${name} / ${anim}: physics bones ${[...physBones].join(', ')}`];
  const DTe = 1 / 60;
  let worstAt = -1;
  for (let f = 0; f < frames; f++) {
    st.update(DTe);
    st.apply(sk);
    sk.update(DTe);
    sk.updateWorldTransform(spine.Physics.update);
    inst.update(DTe);
    const w = inst.boneWorld();
    if (trace) {
      for (const tn of trace.split(',')) {
        const ti = sk.bones.findIndex((b) => b.data.name === tn);
        const b = sk.bones[ti];
        const deg = (y: number, x: number) => ((Math.atan2(y, x) * 180) / Math.PI).toFixed(3);
        report.push(`f${f} ${tn} ref (${b.worldX.toFixed(3)}, ${b.worldY.toFixed(3)}, ${deg(b.c, b.a)}°) ours (${w[ti * 7 + 4].toFixed(3)}, ${w[ti * 7 + 5].toFixed(3)}, ${deg(w[ti * 7 + 2], w[ti * 7])}°)`);
      }
    }
    let worst = { err: 0, bone: '' };
    sk.bones.forEach((b, i) => {
      const o = i * 7;
      const err = Math.max(Math.abs(b.worldX - w[o + 4]), Math.abs(b.worldY - w[o + 5]), 100 * Math.abs(b.a - w[o]), 100 * Math.abs(b.c - w[o + 2]), 100 * Math.abs(b.b - w[o + 1]), 100 * Math.abs(b.d - w[o + 3]));
      if (err > worst.err) worst = { err, bone: b.data.name };
    });
    if (worst.err > THR && worstAt < 0) {
      worstAt = f;
      // List every diverging bone at this frame, parents first.
      sk.bones.forEach((b, i) => {
        const o = i * 7;
        const err = Math.max(Math.abs(b.worldX - w[o + 4]), Math.abs(b.worldY - w[o + 5]), 100 * Math.abs(b.a - w[o]), 100 * Math.abs(b.c - w[o + 2]));
        if (err > THR) report.push(`  f${f} ${b.data.name}${physBones.has(b.data.name) ? ' [phys]' : ''} parent=${b.parent?.data.name} len=${b.data.length.toFixed(1)} ref=(${b.worldX.toFixed(2)},${b.worldY.toFixed(2)} a=${b.a.toFixed(3)} c=${b.c.toFixed(3)}) ours=(${w[o + 4].toFixed(2)},${w[o + 5].toFixed(2)} a=${w[o].toFixed(3)} c=${w[o + 2].toFixed(3)}) err=${err.toFixed(3)}`);
      });
    }
    if (f % 30 === 29) report.push(`frame ${f}: worst ${worst.bone} ${worst.err.toFixed(3)}`);
  }
  inst.dispose();
  data.dispose();
  return report.join('\n');
}

/** Samples a bezier-keyed translate timeline in the reference runtime. */
function curveProbe(): unknown {
  const curves = [
    [0.25, 0, 0.75, 100],
    [0.1, 80, 0.3, 120],
    [0.6, -20, 0.9, 60],
    [0.0, 0, 1.0, 100],
    [0.9, 0, 0.1, 100],
  ];
  return curves.map((cv) => {
    const json = {
      skeleton: { spine: '4.2.43' },
      bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
      slots: [],
      skins: [{ name: 'default', attachments: {} }],
      animations: { a: { bones: { b: { translate: [{ time: 0, y: 0, curve: [cv[0], cv[1], cv[2], cv[3], cv[0], cv[1], cv[2], cv[3]] }, { time: 1, y: 100 }] } } } },
    };
    const data = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(new spine.TextureAtlas(''))).readSkeletonData(json);
    const sk = new spine.Skeleton(data);
    const anim = data.findAnimation('a')!;
    const ys: number[] = [];
    for (let i = 0; i <= 400; i++) {
      sk.setToSetupPose();
      anim.apply(sk, 0, i / 400, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
      sk.updateWorldTransform(spine.Physics.none);
      ys.push(sk.findBone('b')!.worldY);
    }
    return { cv, ys };
  });
}

/** Max bone-world error per example/animation over `frames` frames (pose parity, renderer-independent). */
async function scanAll(rt: SinewRuntime, frames: number, only?: string[]) {
  const index = (await (await fetch('/examples/4.2/index.json')).json()) as { name: string; skeleton: string; atlas: string }[];
  const out: string[] = [];
  for (const e of index) {
    if (only && !only.includes(e.name)) continue;
    const dir = `/examples/4.2/${e.name}/`;
    const jsonText = await (await fetch(dir + e.skeleton)).text();
    const atlasText = await (await fetch(dir + e.atlas)).text();
    const refData = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(new spine.TextureAtlas(atlasText))).readSkeletonData(JSON.parse(jsonText));
    const data = rt.loadSpine(jsonText, atlasText);
    const skins = refData.skins.map((s) => s.name).filter((s) => s !== 'default');
    const skin = skins.find((s) => /full/i.test(s)) ?? skins[0] ?? null;
    for (const anim of refData.animations) {
      const sk = new spine.Skeleton(refData);
      if (skin) sk.setSkinByName(skin);
      sk.setToSetupPose();
      const st = new spine.AnimationState(new spine.AnimationStateData(refData));
      st.setAnimation(0, anim.name, true);
      st.apply(sk);
      sk.updateWorldTransform(spine.Physics.reset);
      const inst = data.createInstance();
      if (skin) inst.setSkin(skin);
      inst.setAnimation(0, anim.name, true);
      inst.update(0);
      let worst = { err: 0, bone: '', f: -1 };
      let first = -1;
      for (let f = 0; f < frames; f++) {
        st.update(1 / 60);
        st.apply(sk);
        sk.update(1 / 60);
        sk.updateWorldTransform(spine.Physics.update);
        inst.update(1 / 60);
        const w = inst.boneWorld();
        sk.bones.forEach((b, i) => {
          if (!b.active) return;
          const o = i * 7;
          const scale = 1 + Math.hypot(b.worldX, b.worldY) * 0;
          const err = Math.max(Math.abs(b.worldX - w[o + 4]), Math.abs(b.worldY - w[o + 5]), 100 * Math.max(Math.abs(b.a - w[o]), Math.abs(b.b - w[o + 1]), Math.abs(b.c - w[o + 2]), Math.abs(b.d - w[o + 3]))) / scale;
          if (err > worst.err) worst = { err, bone: b.data.name, f };
          if (err > 0.5 && first < 0) first = f;
        });
      }
      inst.dispose();
      out.push(`${e.name.padEnd(17)} ${anim.name.padEnd(28)} max ${worst.err.toFixed(3).padStart(9)} (${worst.bone} f${worst.f})${first >= 0 ? ` first>0.5 at f${first}` : ''}`);
    }
    data.dispose();
  }
  return out.join('\n');
}

async function main() {
  const status = document.getElementById('status')!;
  const q = new URLSearchParams(location.search);
  if (q.get('scan')) {
    const rt0 = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
    status.textContent = await scanAll(rt0, Number(q.get('frames') ?? 120), q.get('only')?.split(','));
    document.body.dataset.done = 'true';
    return;
  }
  if (q.get('curve')) {
    (window as unknown as { __probe: unknown }).__probe = curveProbe();
    status.textContent = 'curves';
    document.body.dataset.done = 'true';
    return;
  }
  const only = q.get('only')?.split(',');
  if (q.get('thr')) THR = Number(q.get('thr'));
  if (q.get('example')) {
    const rt0 = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
    status.textContent = await compareExample(rt0, q.get('example')!, q.get('anim'), Number(q.get('frames') ?? 180), q.get('trace'));
    document.body.dataset.done = 'true';
    return;
  }
  const rt = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
  const results: { name: string; c: ProbeCase; ref: Trace; ours: Trace }[] = [];
  const lines: string[] = [];
  for (const c of CASES) {
    if (only && !only.includes(c.name)) continue;
    const ref = runRef(c);
    const ours = runOurs(rt, c);
    let err = 0;
    for (let i = 0; i < ref.length; i++) err = Math.max(err, Math.hypot(ref[i][6] - ours[i][6], ref[i][7] - ours[i][7]));
    lines.push(`${c.name.padEnd(16)} max tip error ${err.toFixed(2)}`);
    results.push({ name: c.name, c, ref, ours });
  }
  status.textContent = lines.join('\n');
  (window as unknown as { __probe: unknown }).__probe = results;
  document.body.dataset.done = 'true';
}

main().catch((e) => {
  document.getElementById('status')!.textContent = String(e?.stack ?? e);
  document.body.dataset.done = 'error';
});
