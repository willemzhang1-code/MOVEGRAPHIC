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

/** Raw skeleton cases: arbitrary JSON, all bones recorded. Animation must be named 'drive'. */
export interface RawCase {
  name: string;
  json: Record<string, unknown>;
  seconds?: number;
  skScale?: [number, number];
}

const ikRig = (o: { thighScale?: [number, number]; cy?: number; tx: number; ty: number; bend?: boolean; extra?: Record<string, unknown>; parentScale?: [number, number]; childScale?: [number, number]; move?: [number, number]; shinRot?: number; inherit?: string }) => ({
  skeleton: { spine: '4.2.43' },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', y: 200, scaleX: o.parentScale?.[0] ?? 1, scaleY: o.parentScale?.[1] ?? 1 },
    { name: 'thigh', parent: 'hip', rotation: -95, length: 75, x: -17, y: -11, scaleX: o.thighScale?.[0] ?? 1, scaleY: o.thighScale?.[1] ?? 1 },
    { name: 'shin', parent: 'thigh', rotation: o.shinRot ?? -2, length: 128, x: 78, y: o.cy ?? 0, scaleX: o.childScale?.[0] ?? 1, scaleY: o.childScale?.[1] ?? 1, ...(o.inherit ? { inherit: o.inherit } : {}) },
    { name: 'foot', parent: 'shin', x: 128 },
    { name: 'target', parent: 'root', x: o.tx, y: o.ty },
  ],
  slots: [],
  skins: [{ name: 'default', attachments: {} }],
  ik: [{ name: 'ik', bones: ['thigh', 'shin'], target: 'target', bendPositive: o.bend ?? false, ...o.extra }],
  animations: { drive: { bones: { target: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1, x: o.move?.[0] ?? 120, y: o.move?.[1] ?? 160 }] } } } },
});

const inheritRig = (inherit: string, o: { cshx?: number; cshy?: number; psx?: [number, number]; psy?: [number, number]; prot?: [number, number]; pshx?: number; pshy?: number; crot?: number; csx?: number; csy?: number; gp?: Record<string, number> } = {}) => ({
  skeleton: { spine: '4.2.43' },
  bones: [
    { name: 'root' },
    { name: 'gp', parent: 'root', rotation: 20, ...(o.gp ?? {}) },
    { name: 'parent', parent: 'gp', x: 30, y: 10, length: 80, shearX: o.pshx ?? 0, shearY: o.pshy ?? 0 },
    { name: 'child', parent: 'parent', x: 80, y: 6, rotation: o.crot ?? 30, length: 60, scaleX: o.csx ?? 1, scaleY: o.csy ?? 1, shearX: o.cshx ?? 0, shearY: o.cshy ?? 0, inherit },
    { name: 'grandchild', parent: 'child', x: 60, rotation: 15, length: 40 },
  ],
  slots: [],
  skins: [{ name: 'default', attachments: {} }],
  animations: {
    drive: {
      bones: {
        parent: {
          rotate: [{ time: 0, value: o.prot?.[0] ?? 0 }, { time: 1, value: o.prot?.[1] ?? 300 }],
          scale: [{ time: 0, x: o.psx?.[0] ?? 1, y: o.psy?.[0] ?? 1 }, { time: 1, x: o.psx?.[1] ?? 1, y: o.psy?.[1] ?? 1 }],
        },
      },
    },
  },
});
const INHERITS = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
const inheritCases: RawCase[] = INHERITS.flatMap((m) => [
  { name: `inh-${m}-rot`, json: inheritRig(m) },
  { name: `inh-${m}-nonuni`, json: inheritRig(m, { psx: [1.5, 0.6], psy: [0.7, 1.4] }) },
  { name: `inh-${m}-neg`, json: inheritRig(m, { psx: [-1, -1.3], psy: [1, 0.8] }) },
  { name: `inh-${m}-negy`, json: inheritRig(m, { psx: [1, 1.2], psy: [-1, -0.7] }) },
  { name: `inh-${m}-shear`, json: inheritRig(m, { psx: [1.2, 0.9], pshx: 15, pshy: -20 }) },
  { name: `inh-${m}-gpscale`, json: inheritRig(m, { gp: { scaleX: 1.6, scaleY: 0.5 } }) },
  { name: `inh-${m}-skflip`, json: inheritRig(m, { psx: [1.3, 0.8] }), skScale: [-1, 1] as [number, number] },
  { name: `inh-${m}-skscale`, json: inheritRig(m, { psx: [1.3, 0.8] }), skScale: [2, 0.5] as [number, number] },
  { name: `inh-${m}-cscale`, json: inheritRig(m, { psx: [1.3, 0.8], csx: 1.4, csy: 0.6 }) },
  { name: `inh-${m}-cshear`, json: inheritRig(m, { psx: [1.3, 0.8], psy: [0.9, 1.2], cshx: 20, cshy: -10 }) },
  { name: `inh-${m}-skflipy`, json: inheritRig(m, { psx: [1.3, 0.8], psy: [1, -1] }), skScale: [1, -1] as [number, number] },
]);

const chibiLeg = (bend: boolean, dx: number) => ({
  skeleton: { spine: '4.2.43' },
  bones: [
    { name: 'root' },
    { name: 'hips', parent: 'root', y: 155.08 },
    { name: 'leg-r', parent: 'hips', x: -42.43, y: 10.89 },
    { name: 'leg-up-r', parent: 'leg-r', length: 82.42, rotation: -90 },
    { name: 'leg-down-r', parent: 'leg-up-r', length: 82.42, x: 82.42 },
    { name: 'leg-target-r', parent: 'root', rotation: -90, x: -42.43, y: 1.14 },
  ],
  slots: [],
  skins: [{ name: 'default', attachments: {} }],
  ik: [{ name: 'leg-target-r', bones: ['leg-up-r', 'leg-down-r'], target: 'leg-target-r', ...(bend ? {} : { bendPositive: false }) }],
  animations: { drive: { bones: { hips: { translate: [{ x: dx }, { time: 1, x: dx + 10 }] } } } },
});

const pathRig = (c: Record<string, unknown>, o: { closed?: boolean; constant?: boolean; weighted?: boolean; bonesScale?: number; n?: number } = {}) => {
  // Cubic path: 2 curves (open) or 3 (closed); vertices are [in, point, out] triples.
  const verts = o.closed
    ? [-60, -40, 0, 0, 60, 40, 140, 80, 200, 60, 260, 40, 280, -20, 260, -80, 180, -100, 80, -100, 0, -90, -40, -60]
    : [-40, -60, 0, 0, 40, 60, 120, 120, 200, 80, 260, 40, 300, -20, 340, 40, 380, 120];
  const n = o.n ?? 5;
  const bones: Record<string, unknown>[] = [{ name: 'root' }, { name: 'pathbone', parent: 'root', x: 20, y: 30 }];
  for (let i = 0; i < n; i++) bones.push({ name: `b${i}`, parent: i ? `b${i - 1}` : 'root', x: i ? 40 : 0, length: 40, scaleX: o.bonesScale ?? 1 });
  return {
    skeleton: { spine: '4.2.43' },
    bones,
    slots: [{ name: 'path', bone: 'pathbone', attachment: 'path' }],
    skins: [{ name: 'default', attachments: { path: { path: { type: 'path', closed: !!o.closed, constantSpeed: o.constant ?? true, lengths: o.closed ? [200, 400, 600, 800] : [200, 400], vertexCount: verts.length / 2, vertices: verts } } } }],
    path: [{ name: 'p', bones: bones.slice(2).map((b) => b.name), target: 'path', ...c }],
    animations: { drive: { bones: { pathbone: { rotate: [{ value: 0 }, { time: 1, value: 25 }], translate: [{ x: 0 }, { time: 1, x: 15, y: -10 }] } }, path: { p: { position: [{ value: (c.position as number) ?? 0 }, { time: 1, value: ((c.position as number) ?? 0) + (c.positionMode === 'fixed' ? 120 : 0.3) }] } } } },
  };
};

const pathScan = (verts: number[], lengths: number[], o: { closed?: boolean; constant?: boolean; rotateMode?: string; from?: number; to?: number } = {}) => ({
  skeleton: { spine: '4.2.43' },
  bones: [{ name: 'root' }, { name: 'b0', parent: 'root', length: 0 }],
  slots: [{ name: 'path', bone: 'root', attachment: 'path' }],
  skins: [{ name: 'default', attachments: { path: { path: { type: 'path', closed: !!o.closed, constantSpeed: o.constant ?? true, lengths, vertexCount: verts.length / 2, vertices: verts } } } }],
  path: [{ name: 'p', bones: ['b0'], target: 'path', rotateMode: o.rotateMode ?? 'tangent', spacingMode: 'length', spacing: 0, position: o.from ?? -0.2 }],
  animations: { drive: { path: { p: { position: [{ value: o.from ?? -0.2 }, { time: 2, value: o.to ?? 1.2 }] } } } },
});
const ONE = [-40, -60, 0, 0, 40, 60, 160, 140, 200, 100, 260, 40];
const TWO = [-40, -60, 0, 0, 40, 60, 120, 120, 200, 80, 260, 40, 300, -20, 340, 40, 380, 120];
const pathCases: RawCase[] = [
  { name: 'pscan-one', json: pathScan(ONE, [500]), seconds: 2 },
  { name: 'pscan-one-len300', json: pathScan(ONE, [300]), seconds: 2 },
  { name: 'pscan-one-noconst', json: pathScan(ONE, [500], { constant: false }), seconds: 2 },
  { name: 'pscan-two', json: pathScan(TWO, [200, 600]), seconds: 2 },
  { name: 'pscan-two-noconst', json: pathScan(TWO, [200, 600], { constant: false }), seconds: 2 },
  { name: 'pscan-closed', json: pathScan(TWO, [200, 600, 900], { closed: true, from: -0.3, to: 1.3 }), seconds: 2 },
  { name: 'path-tangent-len', json: pathRig({ rotateMode: 'tangent', spacingMode: 'length', spacing: 0 }) },
  { name: 'path-chain-len', json: pathRig({ rotateMode: 'chain', spacingMode: 'length', spacing: 0 }) },
  { name: 'path-chainscale-len', json: pathRig({ rotateMode: 'chainScale', spacingMode: 'length', spacing: 0 }) },
  { name: 'path-chainscale-pct', json: pathRig({ rotateMode: 'chainScale', spacingMode: 'percent', spacing: 0.1667 }) },
  { name: 'path-chain-pct', json: pathRig({ rotateMode: 'chain', spacingMode: 'percent', spacing: 0.15 }) },
  { name: 'path-tangent-fixed', json: pathRig({ rotateMode: 'tangent', spacingMode: 'fixed', spacing: 50, positionMode: 'fixed', position: 20 }) },
  { name: 'path-chain-prop', json: pathRig({ rotateMode: 'chain', spacingMode: 'proportional', spacing: 0.2 }) },
  { name: 'path-chain-closed', json: pathRig({ rotateMode: 'chain', spacingMode: 'length', spacing: 10 }, { closed: true }) },
  { name: 'path-tangent-noconst', json: pathRig({ rotateMode: 'tangent', spacingMode: 'length', spacing: 5 }, { constant: false }) },
  { name: 'path-chain-mix', json: pathRig({ rotateMode: 'chain', spacingMode: 'length', spacing: 0, mixRotate: 0.6, mixX: 0.7, mixY: 0.3 }) },
  { name: 'path-chain-offset', json: pathRig({ rotateMode: 'chain', spacingMode: 'length', spacing: 0, rotation: 30 }) },
  { name: 'path-chainscale-scaled', json: pathRig({ rotateMode: 'chainScale', spacingMode: 'length', spacing: 0 }, { bonesScale: 1.3 }) },
];

export const RAW: RawCase[] = [
  ...pathCases,
  { name: 'chibi-leg', json: chibiLeg(true, -5.89) },
  { name: 'chibi-leg-neg', json: chibiLeg(false, -5.89) },
  { name: 'chibi-leg-0', json: chibiLeg(true, 0) },
  ...inheritCases,
  { name: 'ik-reach', json: ikRig({ tx: 0, ty: 20 }) },
  { name: 'ik-reach-cy', json: ikRig({ tx: 0, ty: 20, cy: 1.6 }) },
  { name: 'ik-far-cy', json: ikRig({ tx: -20, ty: -40, cy: 1.6, move: [40, 60] }) },
  { name: 'ik-far', json: ikRig({ tx: -20, ty: -40, move: [40, 60] }) },
  { name: 'ik-cy10-bend', json: ikRig({ tx: 30, ty: 40, cy: 10, bend: true }) },
  { name: 'ik-pscale', json: ikRig({ tx: 30, ty: 40, cy: 5, parentScale: [1.5, 0.8] }) },
  { name: 'ik-pscale-neg', json: ikRig({ tx: 30, ty: 40, cy: 5, parentScale: [-1, 1] }) },
  { name: 'ik-cscale', json: ikRig({ tx: 30, ty: 40, cy: 5, childScale: [1.3, 0.7] }) },
  { name: 'ik-soft', json: ikRig({ tx: -20, ty: -40, cy: 3, move: [40, 80], extra: { softness: 30 } }) },
  { name: 'ik-stretch', json: ikRig({ tx: -20, ty: -60, cy: 3, move: [40, 30], extra: { stretch: true } }) },
  { name: 'ik-stretch-uniform', json: ikRig({ tx: -20, ty: -60, cy: 3, move: [40, 30], extra: { stretch: true, uniform: true } }) },
  { name: 'ik-mix0.5', json: ikRig({ tx: 30, ty: 40, cy: 3, extra: { mix: 0.5 } }) },
  { name: 'soft-a', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { softness: 30 } }), seconds: 1 },
  { name: 'soft-b', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { softness: 80 } }), seconds: 1 },
  { name: 'soft-c', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { softness: 30, mix: 0.6 } }), seconds: 1 },
  { name: 'stretch-a', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { stretch: true } }), seconds: 1 },
  { name: 'stretch-u', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { stretch: true, uniform: true } }), seconds: 1 },
  { name: 'stretch-soft', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { stretch: true, softness: 30 } }), seconds: 1 },
  { name: 'compress', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { compress: true } }), seconds: 1 },
  { name: 'ik-ownscale', json: ikRig({ tx: 30, ty: 40, cy: 5, thighScale: [1.3, 0.8] }) },
  { name: 'ik-ownscale-far', json: ikRig({ tx: -20, ty: -40, cy: 5, thighScale: [1.3, 0.8], move: [40, 60] }) },
  { name: 'ik-ownscale-neg', json: ikRig({ tx: 30, ty: 40, cy: 5, thighScale: [-1, 1] }) },
  { name: 'ik-ownscale-u', json: ikRig({ tx: 30, ty: 40, cy: 5, thighScale: [1.3, 1.3] }) },
  { name: 'ss-a', json: ikRig({ tx: -40, ty: -120, move: [80, 260], extra: { stretch: true, softness: 15 } }), seconds: 1 },
  { name: 'ss-scaled', json: ikRig({ tx: -40, ty: -120, move: [80, 260], thighScale: [1.07, 1.07], extra: { stretch: true, softness: 15 } }), seconds: 1 },
  { name: 'ss-cy', json: ikRig({ tx: -40, ty: -120, move: [80, 260], cy: -0.42, extra: { stretch: true, softness: 15 } }), seconds: 1 },
  { name: 'ss-cscale', json: ikRig({ tx: -40, ty: -120, move: [80, 260], childScale: [1.1, 1.1], extra: { stretch: true, softness: 15 } }), seconds: 1 },
  { name: 'ik-noscale', json: ikRig({ tx: 30, ty: 40, cy: 3, parentScale: [1.5, 0.8], inherit: 'noScale' }) },
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
      if (!b.active) return;
      const o = i * 7;
      const err = Math.max(Math.abs(b.worldX - w[o + 4]), Math.abs(b.worldY - w[o + 5]), 100 * Math.abs(b.a - w[o]), 100 * Math.abs(b.c - w[o + 2]), 100 * Math.abs(b.b - w[o + 1]), 100 * Math.abs(b.d - w[o + 3]));
      if (err > worst.err) worst = { err, bone: b.data.name };
    });
    if (worst.err > THR && worstAt < 0) {
      worstAt = f;
      // List every diverging bone at this frame, parents first.
      sk.bones.forEach((b, i) => {
        if (!b.active) return;
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
async function scanAll(rt: SinewRuntime, frames: number, only?: string[], dt = 1 / 60) {
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
        st.update(dt);
        st.apply(sk);
        sk.update(dt);
        sk.updateWorldTransform(spine.Physics.update);
        inst.update(dt);
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

function runRaw(rt: SinewRuntime, c: RawCase, dump?: { ref: number[][][]; ours: number[][][] }): { err: number; bone: string; f: number } {
  const text = JSON.stringify(c.json);
  const refData = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(new spine.TextureAtlas(''))).readSkeletonData(JSON.parse(text));
  const sk = new spine.Skeleton(refData);
  if (c.skScale) [sk.scaleX, sk.scaleY] = c.skScale;
  sk.setToSetupPose();
  const st = new spine.AnimationState(new spine.AnimationStateData(refData));
  st.setAnimation(0, 'drive', false);
  st.apply(sk);
  sk.updateWorldTransform(spine.Physics.reset);
  const data = rt.loadSpine(text, '');
  const inst = data.createInstance();
  if (c.skScale) inst.setTransform(0, 0, c.skScale[0], c.skScale[1]);
  inst.setAnimation(0, 'drive', false);
  inst.update(0);
  let worst = { err: 0, bone: '', f: -1 };
  const n = Math.round((c.seconds ?? 1) * 60);
  for (let f = 0; f < n; f++) {
    st.update(1 / 60);
    st.apply(sk);
    sk.update(1 / 60);
    sk.updateWorldTransform(spine.Physics.update);
    inst.update(1 / 60);
    const w = inst.boneWorld();
    if (dump) {
      dump.ref.push(sk.bones.map((b) => [b.worldX, b.worldY, b.a, b.b, b.c, b.d]));
      dump.ours.push(sk.bones.map((_, i) => [w[i * 7 + 4], w[i * 7 + 5], w[i * 7], w[i * 7 + 1], w[i * 7 + 2], w[i * 7 + 3]]));
    }
    sk.bones.forEach((b, i) => {
      const o = i * 7;
      const err = Math.max(Math.abs(b.worldX - w[o + 4]), Math.abs(b.worldY - w[o + 5]), 100 * Math.max(Math.abs(b.a - w[o]), Math.abs(b.b - w[o + 1]), Math.abs(b.c - w[o + 2]), Math.abs(b.d - w[o + 3])));
      if (err > worst.err) worst = { err, bone: b.data.name, f };
    });
  }
  inst.dispose();
  data.dispose();
  return worst;
}

async function main() {
  const status = document.getElementById('status')!;
  const q = new URLSearchParams(location.search);
  if (q.get('rawdump')) {
    const rt0 = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
    const re = new RegExp(q.get('rawdump')!);
    (window as unknown as { __probe: unknown }).__probe = RAW.filter((c) => re.test(c.name)).map((c) => {
      const dump = { ref: [] as number[][][], ours: [] as number[][][] };
      runRaw(rt0, c, dump);
      return { name: c.name, json: c.json, ...dump };
    });
    status.textContent = 'dumped';
    document.body.dataset.done = 'true';
    return;
  }
  if (q.get('raw')) {
    const rt0 = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
    const filter = q.get('raw') === '1' ? null : new RegExp(q.get('raw')!);
    status.textContent = RAW.filter((c) => !filter || filter.test(c.name))
      .map((c) => {
        const r = runRaw(rt0, c);
        return `${c.name.padEnd(22)} max ${r.err.toFixed(3).padStart(9)} (${r.bone} f${r.f})`;
      })
      .join('\n');
    document.body.dataset.done = 'true';
    return;
  }
  if (q.get('scan')) {
    const rt0 = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
    status.textContent = await scanAll(rt0, Number(q.get('frames') ?? 120), q.get('only')?.split(','), Number(q.get('dt') ?? 1 / 60));
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
