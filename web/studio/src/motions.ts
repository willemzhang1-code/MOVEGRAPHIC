// Motion library authored against the skeleton templates. Rotations are
// offsets from the rig's setup pose (degrees, + = counter-clockwise, so for a
// right-facing character limbs swing forward); translations are fractions of
// the character height. Any rig built from a template can use them as-is.

import type { AnimDoc, Channel, ChannelProp, Key } from './doc';
import type { TemplateId, View } from './autorig/templates';

type Spec = [number, ...number[]][];

const smooth = (target: string, prop: ChannelProp, spec: Spec): Channel => ({
  target,
  prop,
  keys: spec.map(([t, ...v], i) => ({ t, v, ease: i < spec.length - 1 ? 'smooth' : undefined })),
});

/** Samples a periodic function into linear keys (last key repeats the first). */
const cyc = (target: string, prop: ChannelProp, duration: number, samples: number, fn: (p: number) => number[]): Channel => {
  const keys: Key[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    keys.push({ t: Math.round(duration * p * 1000) / 1000, v: fn(p % 1).map((x) => Math.round(x * 1000) / 1000), ease: 'linear' });
  }
  return { target, prop, keys };
};

const TAU = Math.PI * 2;
const pos = (x: number) => Math.max(0, x);
const anim = (name: string, duration: number, loop: boolean, channels: Channel[]): AnimDoc => ({ name, duration, loop, channels });
const flash = (target: string, at: number, end: number): Channel =>
  smooth(target, 'color', [
    [0, 1, 1, 1, 1],
    [at, 1, 0.45, 0.45, 1],
    [end, 1, 1, 1, 1],
  ]);

function gait(d: number, thigh: number, knee: number, arm: number, forearm: number, lean: number, bob: number): AnimDoc['channels'] {
  const n = 16;
  const legs = (side: 'l' | 'r', phase: number) => [
    cyc(`thigh_${side}`, 'rotate', d, n, (p) => [thigh * Math.sin(TAU * (p + phase))]),
    cyc(`shin_${side}`, 'rotate', d, n, (p) => [-(knee * 0.15 + knee * Math.pow(pos(Math.cos(TAU * (p + phase))), 1.5))]),
    cyc(`foot_${side}`, 'rotate', d, n, (p) => [
      -0.6 * (thigh * Math.sin(TAU * (p + phase)) - (knee * 0.15 + knee * Math.pow(pos(Math.cos(TAU * (p + phase))), 1.5))),
    ]),
    cyc(`upper_arm_${side}`, 'rotate', d, n, (p) => [-arm * Math.sin(TAU * (p + phase))]),
    cyc(`forearm_${side}`, 'rotate', d, n, (p) => [forearm * (0.6 + 0.4 * pos(-Math.sin(TAU * (p + phase))))]),
  ];
  return [
    ...legs('l', 0),
    ...legs('r', 0.5),
    cyc('hip', 'translate', d, n, (p) => [0, bob * Math.cos(2 * TAU * p) - bob]),
    cyc('chest', 'rotate', d, n, (p) => [lean + 1.5 * Math.sin(2 * TAU * p)]),
    cyc('head', 'rotate', d, n, (p) => [-lean * 0.5 - 1.5 * Math.sin(2 * TAU * p)]),
  ];
}

/**
 * Walking seen from the front / 3-4: legs lift in place (thigh shortened
 * along the bone, which reads as the knee coming toward the viewer), arms
 * barely sway, the body bobs. Side-view swings would cross the legs and fling
 * the arms out.
 */
function frontGait(d: number, lift: number, arm: number, bob: number): AnimDoc['channels'] {
  const n = 16;
  const legs = (side: 'l' | 'r', phase: number, out: number) => {
    const up = (p: number) => pos(Math.sin(TAU * (p + phase)));
    return [
      cyc(`thigh_${side}`, 'scale', d, n, (p) => [1 - lift * up(p), 1]),
      cyc(`thigh_${side}`, 'rotate', d, n, (p) => [out * 3 * up(p)]),
      cyc(`foot_${side}`, 'rotate', d, n, (p) => [out * -4 * up(p)]),
      cyc(`upper_arm_${side}`, 'rotate', d, n, (p) => [out * arm * Math.sin(TAU * (p + phase + 0.5))]),
      cyc(`forearm_${side}`, 'rotate', d, n, (p) => [-out * arm * 0.5 * (0.5 + 0.5 * Math.sin(TAU * (p + phase + 0.5)))]),
    ];
  };
  return [
    // Image-left limbs are "_l"; outward for them is clockwise.
    ...legs('l', 0, -1),
    ...legs('r', 0.5, 1),
    cyc('hip', 'translate', d, n, (p) => [0, bob * Math.abs(Math.cos(TAU * p)) - bob]),
    cyc('chest', 'rotate', d, n, (p) => [1.5 * Math.sin(TAU * p)]),
    cyc('head', 'rotate', d, n, (p) => [-1 * Math.sin(TAU * p)]),
  ];
}

const tailWag = (d: number, amp: number) => [
  cyc('tail1', 'rotate', d, 8, (p) => [amp * Math.sin(TAU * p)]),
  cyc('tail2', 'rotate', d, 8, (p) => [amp * 1.5 * Math.sin(TAU * p - 1.1)]),
];

function humanoid(view: View): AnimDoc[] {
  const limbs = (side: string, spec: Spec) => [smooth(`upper_arm_${side}`, 'rotate', spec)];
  return [
    anim('idle', 2, true, [
      smooth('chest', 'scale', [[0, 1, 1], [1, 1.03, 1], [2, 1, 1]]),
      smooth('head', 'rotate', [[0, 0], [1, -3], [2, 0]]),
      ...limbs('l', [[0, 0], [1, 3], [2, 0]]),
      ...limbs('r', [[0, 0], [1, -3], [2, 0]]),
      smooth('forearm_l', 'rotate', [[0, 0], [1, 4], [2, 0]]),
      smooth('forearm_r', 'rotate', [[0, 0], [1, 4], [2, 0]]),
      smooth('hip', 'translate', [[0, 0, 0], [1, 0, -0.006], [2, 0, 0]]),
      ...tailWag(2, 6),
    ]),
    view === 'front'
      ? anim('walk', 1, true, [...frontGait(1, 0.14, 4, 0.012), ...tailWag(1, 9)])
      : anim('walk', 1, true, [...gait(1, 24, 38, 20, 14, -4, 0.008), ...tailWag(1, 9)]),
    view === 'front'
      ? anim('run', 0.6, true, [...frontGait(0.6, 0.24, 9, 0.03), ...tailWag(0.6, 7)])
      : anim('run', 0.6, true, [...gait(0.6, 40, 75, 40, 60, -12, 0.02), ...tailWag(0.6, 7)]),
    anim('jump', 1, false, [
      smooth('hip', 'translate', [[0, 0, 0], [0.15, 0, -0.06], [0.35, 0, 0.35], [0.55, 0, 0.4], [0.8, 0, 0], [0.9, 0, -0.04], [1, 0, 0]]),
      ...['l', 'r'].flatMap((s) => [
        smooth(`thigh_${s}`, 'rotate', [[0, 0], [0.15, 25], [0.35, -5], [0.55, 30], [0.8, 0], [0.9, 20], [1, 0]]),
        smooth(`shin_${s}`, 'rotate', [[0, 0], [0.15, -45], [0.35, 5], [0.55, -55], [0.8, 0], [0.9, -35], [1, 0]]),
        smooth(`foot_${s}`, 'rotate', [[0, 0], [0.15, 20], [0.35, -20], [0.55, 25], [0.8, 0], [0.9, 15], [1, 0]]),
        smooth(`upper_arm_${s}`, 'rotate', [[0, 0], [0.15, -35], [0.35, 150], [0.6, 120], [0.85, 0], [1, 0]]),
      ]),
      smooth('chest', 'rotate', [[0, 0], [0.15, -15], [0.35, 5], [0.8, -5], [1, 0]]),
    ]),
    anim('attack', 0.6, false, [
      smooth('upper_arm_r', 'rotate', [[0, 0], [0.18, -70], [0.3, 110], [0.45, 90], [0.6, 0]]),
      smooth('forearm_r', 'rotate', [[0, 0], [0.18, -40], [0.3, 10], [0.6, 0]]),
      smooth('upper_arm_l', 'rotate', [[0, 0], [0.18, 30], [0.3, -25], [0.6, 0]]),
      smooth('chest', 'rotate', [[0, 0], [0.18, 8], [0.3, -12], [0.6, 0]]),
      smooth('hip', 'translate', [[0, 0, 0], [0.3, 0.04, 0], [0.6, 0, 0]]),
    ]),
    anim('hit', 0.4, false, [
      smooth('chest', 'rotate', [[0, 0], [0.08, 12], [0.4, 0]]),
      smooth('head', 'rotate', [[0, 0], [0.08, 15], [0.4, 0]]),
      smooth('hip', 'translate', [[0, 0, 0], [0.08, -0.03, 0], [0.4, 0, 0]]),
      flash('*', 0.08, 0.4),
    ]),
    anim('die', 1.2, false, [
      smooth('root', 'rotate', [[0, 0], [0.25, 6], [0.8, 86], [1, 80], [1.2, 83]]),
      smooth('upper_arm_l', 'rotate', [[0, 0], [0.4, 60], [1.2, 40]]),
      smooth('upper_arm_r', 'rotate', [[0, 0], [0.4, 70], [1.2, 50]]),
      smooth('head', 'rotate', [[0, 0], [0.6, 20], [1.2, 10]]),
      smooth('thigh_l', 'rotate', [[0, 0], [0.6, 15], [1.2, 10]]),
    ]),
    anim('wave', 1.2, true, [
      smooth('upper_arm_r', 'rotate', [[0, 150], [0.6, 140], [1.2, 150]]),
      smooth('forearm_r', 'rotate', [[0, 20], [0.3, 55], [0.6, 20], [0.9, 55], [1.2, 20]]),
    ]),
  ];
}

function quadruped(): AnimDoc[] {
  const legs = (d: number, amp: number, flex: number) => {
    const n = 16;
    const pairs: [string, number][] = [['fl', 0], ['br', 0], ['fr', 0.5], ['bl', 0.5]];
    return pairs.flatMap(([leg, ph]) => [
      cyc(`leg_${leg}_upper`, 'rotate', d, n, (p) => [amp * Math.sin(TAU * (p + ph))]),
      cyc(`leg_${leg}_lower`, 'rotate', d, n, (p) => [(leg.startsWith('f') ? -1 : 1) * flex * Math.pow(pos(Math.cos(TAU * (p + ph))), 1.5)]),
    ]);
  };
  const tail = (d: number, amp: number) => [
    cyc('tail1', 'rotate', d, 8, (p) => [amp * Math.sin(TAU * p)]),
    cyc('tail2', 'rotate', d, 8, (p) => [amp * 1.4 * Math.sin(TAU * p - 1)]),
  ];
  return [
    anim('idle', 2, true, [
      smooth('body', 'scale', [[0, 1, 1], [1, 1, 1.03], [2, 1, 1]]),
      smooth('head', 'rotate', [[0, 0], [1, 4], [2, 0]]),
      ...tail(2, 8),
    ]),
    anim('walk', 1, true, [
      ...legs(1, 20, 30),
      cyc('body', 'translate', 1, 16, (p) => [0, 0.008 * Math.cos(2 * TAU * p)]),
      cyc('neck', 'rotate', 1, 16, (p) => [2 * Math.sin(2 * TAU * p)]),
      ...tail(1, 10),
    ]),
    anim('run', 0.5, true, [
      ...legs(0.5, 35, 55),
      cyc('body', 'rotate', 0.5, 16, (p) => [4 * Math.sin(TAU * p)]),
      cyc('body', 'translate', 0.5, 16, (p) => [0, 0.03 * Math.abs(Math.sin(TAU * p))]),
      ...tail(0.5, 6),
    ]),
    anim('jump', 0.9, false, [
      smooth('body', 'translate', [[0, 0, 0], [0.15, 0, -0.05], [0.4, 0, 0.35], [0.7, 0, 0], [0.9, 0, 0]]),
      smooth('body', 'rotate', [[0, 0], [0.15, -5], [0.3, 12], [0.55, -8], [0.75, 0]]),
      ...['fl', 'fr', 'bl', 'br'].map((l) => smooth(`leg_${l}_upper`, 'rotate', [[0, 0], [0.4, l.startsWith('f') ? 35 : -35], [0.7, 0]])),
    ]),
    anim('hit', 0.4, false, [
      smooth('head', 'rotate', [[0, 0], [0.08, 15], [0.4, 0]]),
      smooth('body', 'translate', [[0, 0, 0], [0.08, -0.03, 0], [0.4, 0, 0]]),
      flash('*', 0.08, 0.4),
    ]),
  ];
}

function blob(): AnimDoc[] {
  return [
    anim('idle', 1.6, true, [smooth('body', 'scale', [[0, 1, 1], [0.8, 0.93, 1.06], [1.6, 1, 1]]), smooth('top', 'rotate', [[0, 0], [0.8, 3], [1.6, 0]])]),
    anim('hop', 0.8, true, [
      smooth('root', 'translate', [[0, 0, 0], [0.12, 0, 0], [0.4, 0, 0.25], [0.68, 0, 0], [0.8, 0, 0]]),
      smooth('body', 'scale', [[0, 1, 1], [0.12, 0.8, 1.15], [0.3, 1.15, 0.9], [0.68, 1, 1], [0.74, 0.85, 1.12], [0.8, 1, 1]]),
    ]),
    anim('hit', 0.4, false, [smooth('body', 'scale', [[0, 1, 1], [0.08, 0.8, 1.2], [0.4, 1, 1]]), flash('*', 0.08, 0.4)]),
  ];
}

export function motionLibrary(template: TemplateId, view: View = 'side'): AnimDoc[] {
  return template === 'humanoid' ? humanoid(view) : template === 'quadruped' ? quadruped() : blob();
}
