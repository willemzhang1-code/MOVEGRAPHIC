// Skeleton templates and an initial joint guess from the silhouette.
// "l"/"r" mean screen-left / screen-right; characters are assumed to face right.

export interface Pt {
  x: number;
  y: number;
}

export type TemplateId = 'humanoid' | 'quadruped' | 'blob';

export interface BoneDef {
  name: string;
  parent: string | null;
  /** Joint the bone starts at. */
  from: string;
  /** Joint the bone points to; omitted → extends the parent's direction. */
  to?: string;
  /** Length as a fraction of the parent's length when `to` is omitted. */
  tip?: number;
  /** Receives mesh weights (default true). */
  skin?: boolean;
  /** Optional bone group; included only when the group is enabled. */
  group?: string;
}

export interface Guess {
  joints: Record<string, Pt>;
  /** Optional groups detected in the image (e.g. a tail). */
  groups: Record<string, boolean>;
}

export interface Template {
  id: TemplateId;
  label: string;
  joints: string[];
  bones: BoneDef[];
  groups?: { id: string; label: string; joints: string[] }[];
  guess(mask: Uint8Array, w: number, h: number): Guess;
}

interface Row {
  runs: [number, number][];
  left: number;
  right: number;
  width: number;
  center: number;
}

function analyze(mask: Uint8Array, w: number, h: number) {
  const rows: Row[] = [];
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x];
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push([start, x - 1]);
        start = -1;
      }
    }
    const width = runs.reduce((s, [a, b]) => s + b - a + 1, 0);
    const center = width ? runs.reduce((s, [a, b]) => s + ((a + b) / 2) * (b - a + 1), 0) / width : w / 2;
    rows.push({ runs, left: runs[0]?.[0] ?? -1, right: runs.at(-1)?.[1] ?? -1, width, center });
    if (width) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  const H = Math.max(1, bottom - top);
  const minRun = Math.max(2, H * 0.012);
  const row = (y: number) => rows[Math.min(h - 1, Math.max(0, Math.round(y)))];
  const bigRuns = (y: number) => row(y).runs.filter(([a, b]) => b - a + 1 >= minRun);
  let x0 = w;
  let x1 = 0;
  for (const r of rows) {
    if (r.width) {
      x0 = Math.min(x0, r.left);
      x1 = Math.max(x1, r.right);
    }
  }
  return { rows, row, bigRuns, top, bottom, H, x0, x1, W: Math.max(1, x1 - x0) };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const runCenter = ([a, b]: [number, number]) => (a + b) / 2;

const humanoid: Template = {
  id: 'humanoid',
  label: 'Humanoid',
  joints: [
    'ground', 'pelvis', 'chest', 'neck', 'head_top',
    'shoulder_l', 'elbow_l', 'wrist_l', 'shoulder_r', 'elbow_r', 'wrist_r',
    'hip_l', 'knee_l', 'ankle_l', 'toe_l', 'hip_r', 'knee_r', 'ankle_r', 'toe_r',
    'tail_base', 'tail_mid', 'tail_tip',
  ],
  groups: [{ id: 'tail', label: 'Tail', joints: ['tail_base', 'tail_mid', 'tail_tip'] }],
  bones: [
    { name: 'root', parent: null, from: 'ground', skin: false },
    { name: 'hip', parent: 'root', from: 'pelvis', to: 'chest' },
    { name: 'chest', parent: 'hip', from: 'chest', to: 'neck' },
    { name: 'head', parent: 'chest', from: 'neck', to: 'head_top' },
    { name: 'upper_arm_l', parent: 'chest', from: 'shoulder_l', to: 'elbow_l' },
    { name: 'forearm_l', parent: 'upper_arm_l', from: 'elbow_l', to: 'wrist_l' },
    { name: 'hand_l', parent: 'forearm_l', from: 'wrist_l', tip: 0.45 },
    { name: 'upper_arm_r', parent: 'chest', from: 'shoulder_r', to: 'elbow_r' },
    { name: 'forearm_r', parent: 'upper_arm_r', from: 'elbow_r', to: 'wrist_r' },
    { name: 'hand_r', parent: 'forearm_r', from: 'wrist_r', tip: 0.45 },
    { name: 'thigh_l', parent: 'hip', from: 'hip_l', to: 'knee_l' },
    { name: 'shin_l', parent: 'thigh_l', from: 'knee_l', to: 'ankle_l' },
    { name: 'foot_l', parent: 'shin_l', from: 'ankle_l', to: 'toe_l' },
    { name: 'thigh_r', parent: 'hip', from: 'hip_r', to: 'knee_r' },
    { name: 'shin_r', parent: 'thigh_r', from: 'knee_r', to: 'ankle_r' },
    { name: 'foot_r', parent: 'shin_r', from: 'ankle_r', to: 'toe_r' },
    { name: 'tail1', parent: 'hip', from: 'tail_base', to: 'tail_mid', group: 'tail' },
    { name: 'tail2', parent: 'tail1', from: 'tail_mid', to: 'tail_tip', group: 'tail' },
  ],
  guess(mask, w, h) {
    const a = analyze(mask, w, h);
    const { top, bottom, H, row, bigRuns } = a;
    const minRun = Math.max(2, H * 0.012);
    // Feet centre: runs on the bottom rows close to the overall centre.
    const footRuns = bigRuns(bottom - H * 0.02);
    const footX = footRuns.length ? (footRuns[0][0] + footRuns.at(-1)![1]) / 2 : row(bottom).center;
    // Trunk tracking from the top: follow the run nearest to the previous centre.
    const core: { y: number; x: number; l: number; r: number }[] = [];
    let cx = row(top + 1).center;
    for (let y = top; y <= bottom; y++) {
      const runs = row(y).runs.filter(([s0, e0]) => e0 - s0 + 1 >= minRun);
      if (!runs.length) {
        core.push({ y, x: cx, l: cx, r: cx });
        continue;
      }
      let best = runs[0];
      let bd = Infinity;
      for (const r of runs) {
        const d = r[0] <= cx && cx <= r[1] ? 0 : Math.min(Math.abs(r[0] - cx), Math.abs(r[1] - cx));
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      cx = cx * 0.7 + ((best[0] + best[1]) / 2) * 0.3;
      core.push({ y, x: cx, l: best[0], r: best[1] });
    }
    const coreAt = (y: number) => core[Math.min(core.length - 1, Math.max(0, Math.round(y - top)))];
    const coreW = (y: number) => {
      let s0 = 0;
      for (let k = -2; k <= 2; k++) {
        const c = coreAt(y + k);
        s0 += c.r - c.l;
      }
      return s0 / 5;
    };
    // Crotch: scanning up from the feet, the last row with two leg runs near the feet centre.
    const legRuns = (y: number) => bigRuns(y).filter(([s0, e0]) => Math.abs((s0 + e0) / 2 - footX) < H * 0.22);
    let crotch = bottom - H * 0.04;
    while (crotch > top + H * 0.3 && legRuns(crotch).length >= 2) crotch--;
    if (crotch >= bottom - H * 0.05) crotch = top + H * 0.55;
    const pelvis = { x: (coreAt(crotch - H * 0.03).x + footX) / 2, y: crotch - H * 0.03 };
    // Neck: narrowest trunk row below the widest part of the head.
    let headMaxY = top + H * 0.05;
    let headMax = 0;
    for (let y = top + H * 0.02; y < top + (pelvis.y - top) * 0.6; y++) {
      const cw = coreW(y);
      if (cw > headMax) {
        headMax = cw;
        headMaxY = y;
      }
    }
    let neckY = headMaxY + (pelvis.y - headMaxY) * 0.3;
    let neckW = Infinity;
    for (let y = headMaxY; y < headMaxY + (pelvis.y - top) * 0.45 && y < pelvis.y - H * 0.1; y++) {
      const cw = coreW(y);
      if (cw < neckW) {
        neckW = cw;
        neckY = y;
      }
    }
    if (neckW > headMax * 0.9) neckY = top + (pelvis.y - top) * 0.38;
    const neck = { x: coreAt(neckY).x, y: neckY };
    const headTop = { x: coreAt(top + H * 0.02).x, y: top };
    const chest = lerp(pelvis, neck, 0.72);
    // Torso half width from trunk rows between chest and pelvis.
    const widths: number[] = [];
    for (let y = chest.y; y < pelvis.y; y++) widths.push(coreAt(y).r - coreAt(y).l);
    widths.sort((p, q) => p - q);
    const halfW = Math.max(H * 0.05, (widths[widths.length >> 1] ?? H * 0.15) / 2);
    const shoulderY = neck.y + (pelvis.y - neck.y) * 0.12;
    const shoulder_l = { x: neck.x - halfW * 0.65, y: shoulderY };
    const shoulder_r = { x: neck.x + halfW * 0.65, y: shoulderY };
    // Arms: hang along the torso unless a separate arm-like run sits right next to it.
    const armLen = Math.max(H * 0.18, (pelvis.y - shoulderY) * 0.95);
    let wrist_l = { x: shoulder_l.x - H * 0.025, y: shoulderY + armLen };
    let wrist_r = { x: shoulder_r.x + H * 0.025, y: shoulderY + armLen };
    for (let y = shoulderY + armLen * 0.5; y < shoulderY + armLen * 1.15; y++) {
      const c = coreAt(y);
      for (const [s0, e0] of bigRuns(y)) {
        const mid = (s0 + e0) / 2;
        if (e0 < c.l && c.l - e0 < H * 0.08 && e0 - s0 < H * 0.12) wrist_l = { x: mid, y };
        if (s0 > c.r && s0 - c.r < H * 0.08 && e0 - s0 < H * 0.12) wrist_r = { x: mid, y };
      }
    }
    const elbow_l = { x: (shoulder_l.x + wrist_l.x) / 2 - H * 0.01, y: (shoulder_l.y + wrist_l.y) / 2 };
    const elbow_r = { x: (shoulder_r.x + wrist_r.x) / 2 + H * 0.01, y: (shoulder_r.y + wrist_r.y) / 2 };
    // Legs.
    const ankleY = bottom - H * 0.05;
    const feet = legRuns(ankleY).map(runCenter);
    const ankle_l = { x: feet.length >= 2 ? feet[0] : pelvis.x - H * 0.04, y: ankleY };
    const ankle_r = { x: feet.length >= 2 ? feet[feet.length - 1] : pelvis.x + H * 0.04, y: ankleY };
    const hipHalf = Math.min(halfW, Math.max(H * 0.04, Math.abs(ankle_r.x - ankle_l.x) / 2));
    const hip_l = { x: pelvis.x - hipHalf * 0.6, y: pelvis.y + H * 0.02 };
    const hip_r = { x: pelvis.x + hipHalf * 0.6, y: pelvis.y + H * 0.02 };
    const knee_l = { ...lerp(hip_l, ankle_l, 0.5), x: lerp(hip_l, ankle_l, 0.5).x + H * 0.01 };
    const knee_r = { ...lerp(hip_r, ankle_r, 0.5), x: lerp(hip_r, ankle_r, 0.5).x + H * 0.01 };
    // Tail: something sticking out behind (left of) the trunk around the hips.
    let tailTip: Pt | null = null;
    for (let y = pelvis.y - H * 0.3; y < pelvis.y + H * 0.15; y++) {
      const c = coreAt(y);
      const r = row(y);
      if (r.width && r.left < c.l - H * 0.02 && r.left < pelvis.x - halfW - H * 0.12 && (!tailTip || r.left < tailTip.x)) tailTip = { x: r.left, y };
    }
    const tail_base = { x: pelvis.x - halfW * 0.8, y: pelvis.y - H * 0.03 };
    const tip = tailTip ?? { x: tail_base.x - H * 0.15, y: tail_base.y - H * 0.05 };
    return {
      joints: {
        ground: { x: pelvis.x, y: bottom },
        pelvis, chest, neck, head_top: headTop,
        shoulder_l, elbow_l, wrist_l, shoulder_r, elbow_r, wrist_r,
        hip_l, knee_l, ankle_l, toe_l: { x: ankle_l.x + H * 0.06, y: bottom - H * 0.01 },
        hip_r, knee_r, ankle_r, toe_r: { x: ankle_r.x + H * 0.06, y: bottom - H * 0.01 },
        tail_base, tail_mid: lerp(tail_base, tip, 0.5), tail_tip: tip,
      },
      groups: { tail: tailTip !== null },
    };
  },
};

const quadruped: Template = {
  id: 'quadruped',
  label: 'Quadruped',
  joints: [
    'ground', 'pelvis', 'withers', 'head', 'nose', 'tail_base', 'tail_mid', 'tail_tip',
    'fl_shoulder', 'fl_knee', 'fl_paw', 'fr_shoulder', 'fr_knee', 'fr_paw',
    'bl_hip', 'bl_knee', 'bl_paw', 'br_hip', 'br_knee', 'br_paw',
  ],
  bones: [
    { name: 'root', parent: null, from: 'ground', skin: false },
    { name: 'body', parent: 'root', from: 'pelvis', to: 'withers' },
    { name: 'neck', parent: 'body', from: 'withers', to: 'head' },
    { name: 'head', parent: 'neck', from: 'head', to: 'nose' },
    { name: 'tail1', parent: 'body', from: 'tail_base', to: 'tail_mid' },
    { name: 'tail2', parent: 'tail1', from: 'tail_mid', to: 'tail_tip' },
    { name: 'leg_fl_upper', parent: 'body', from: 'fl_shoulder', to: 'fl_knee' },
    { name: 'leg_fl_lower', parent: 'leg_fl_upper', from: 'fl_knee', to: 'fl_paw' },
    { name: 'leg_fr_upper', parent: 'body', from: 'fr_shoulder', to: 'fr_knee' },
    { name: 'leg_fr_lower', parent: 'leg_fr_upper', from: 'fr_knee', to: 'fr_paw' },
    { name: 'leg_bl_upper', parent: 'body', from: 'bl_hip', to: 'bl_knee' },
    { name: 'leg_bl_lower', parent: 'leg_bl_upper', from: 'bl_knee', to: 'bl_paw' },
    { name: 'leg_br_upper', parent: 'body', from: 'br_hip', to: 'br_knee' },
    { name: 'leg_br_lower', parent: 'leg_br_upper', from: 'br_knee', to: 'br_paw' },
  ],
  guess(mask, w, h) {
    const a = analyze(mask, w, h);
    const { top, bottom, H, W, x0, x1, row, bigRuns, rows } = a;
    let legTop = bottom - H * 0.03;
    while (legTop > top + H * 0.3 && bigRuns(legTop).length >= 2) legTop--;
    const bodyY = legTop - H * 0.1;
    const pelvis = { x: x0 + W * 0.3, y: bodyY };
    const withers = { x: x0 + W * 0.66, y: bodyY - H * 0.03 };
    // Head: highest point in the right 40%; nose: rightmost point in the upper 60%.
    let headTop = { x: x1 - W * 0.15, y: bodyY - H * 0.2 };
    for (let y = top; y < bottom; y++) {
      const r = rows[y];
      const hit = r.runs.find(([, e]) => e > x0 + W * 0.6);
      if (hit) {
        headTop = { x: Math.max(hit[0], x0 + W * 0.6), y };
        break;
      }
    }
    let nose = { x: x1, y: headTop.y + H * 0.1 };
    for (let y = top; y < top + H * 0.6; y++) if (row(y).right >= nose.x - 1 && row(y).width) nose = { x: row(y).right, y };
    const head = { x: lerp(headTop, nose, 0.35).x, y: headTop.y + H * 0.08 };
    let tailTip = { x: x0, y: bodyY };
    for (let y = top; y < top + H * 0.75; y++) if (row(y).width && row(y).left <= tailTip.x + 1) tailTip = { x: row(y).left, y };
    const tail_base = { x: x0 + W * 0.2, y: bodyY - H * 0.03 };
    const pawY = bottom - H * 0.02;
    let c = bigRuns(pawY).map(runCenter);
    if (c.length === 0) c = [x0 + W * 0.25, x0 + W * 0.75];
    if (c.length === 1) c = [c[0] - W * 0.2, c[0] + W * 0.2];
    const sp = H * 0.04;
    const [bl, br, fl, fr] =
      c.length >= 4 ? [c[0], c[1], c[c.length - 2], c[c.length - 1]] : c.length === 3 ? [c[0], c[0] + sp, c[1], c[2]] : [c[0] - sp, c[0] + sp, c[1] - sp, c[1] + sp];
    const leg = (x: number, top: number) => {
      const s = { x, y: top };
      const p = { x, y: pawY };
      return [s, lerp(s, p, 0.5), p];
    };
    const [fls, flk, flp] = leg(fl, withers.y + H * 0.06);
    const [frs, frk, frp] = leg(fr, withers.y + H * 0.06);
    const [blh, blk, blp] = leg(bl, pelvis.y + H * 0.06);
    const [brh, brk, brp] = leg(br, pelvis.y + H * 0.06);
    const joints = {
      ground: { x: (x0 + x1) / 2, y: bottom },
      pelvis, withers, head, nose,
      tail_base, tail_mid: lerp(tail_base, tailTip, 0.5), tail_tip: tailTip,
      fl_shoulder: fls, fl_knee: flk, fl_paw: flp, fr_shoulder: frs, fr_knee: frk, fr_paw: frp,
      bl_hip: blh, bl_knee: blk, bl_paw: blp, br_hip: brh, br_knee: brk, br_paw: brp,
    };
    return { joints, groups: {} };
  },
};

const blob: Template = {
  id: 'blob',
  label: 'Blob / prop',
  joints: ['ground', 'base', 'center', 'crown'],
  bones: [
    { name: 'root', parent: null, from: 'ground', skin: false },
    { name: 'body', parent: 'root', from: 'base', to: 'center' },
    { name: 'top', parent: 'body', from: 'center', to: 'crown' },
  ],
  guess(mask, w, h) {
    const { top, bottom, H, x0, x1 } = analyze(mask, w, h);
    const cx = (x0 + x1) / 2;
    return {
      joints: {
        ground: { x: cx, y: bottom },
        base: { x: cx, y: bottom - H * 0.08 },
        center: { x: cx, y: top + H * 0.5 },
        crown: { x: cx, y: top + H * 0.06 },
      },
      groups: {},
    };
  },
};

export const TEMPLATES: Record<TemplateId, Template> = { humanoid, quadruped, blob };
