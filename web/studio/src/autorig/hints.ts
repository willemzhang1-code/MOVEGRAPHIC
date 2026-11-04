// Joint placement from named layers (PSD). Layer names in English or Chinese
// are matched to body parts; each part's principal axis gives its joints.

import type { SourcePart } from './source';
import type { Pt, TemplateId } from './templates';

type Kind = 'head' | 'torso' | 'arm' | 'leg' | 'tail';

const PATTERNS: [Kind, RegExp][] = [
  ['tail', /tail|尾/i],
  ['head', /head|face|头|脸|首/i],
  ['arm', /arm|hand|fore|elbow|wrist|sleeve|手|臂|胳膊|袖/i],
  ['leg', /leg|thigh|shin|calf|foot|feet|knee|boot|shoe|腿|脚|足|膝|靴|鞋/i],
  ['torso', /torso|body|chest|trunk|belly|hip|pelvis|身|躯|胸|腹|胯|腰/i],
];

export function classify(name: string): Kind | null {
  for (const [k, re] of PATTERNS) if (re.test(name)) return k;
  return null;
}

interface Axis {
  center: Pt;
  /** Endpoints along the major axis, document space. */
  a: Pt;
  b: Pt;
  top: number;
  bottom: number;
}

/** Principal axis of the union of part masks. */
function axisOf(parts: SourcePart[]): Axis | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  const pts: number[] = [];
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of parts) {
    const step = Math.max(1, Math.round(Math.sqrt((p.width * p.height) / 4000)));
    for (let y = 0; y < p.height; y += step) {
      for (let x = 0; x < p.width; x += step) {
        if (!p.mask[y * p.width + x]) continue;
        const X = p.x + x;
        const Y = p.y + y;
        pts.push(X, Y);
        sx += X;
        sy += Y;
        n++;
        top = Math.min(top, Y);
        bottom = Math.max(bottom, Y);
      }
    }
  }
  if (n < 3) return null;
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - cx;
    const dy = pts[i + 1] - cy;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const t = (pts[i] - cx) * ux + (pts[i + 1] - cy) * uy;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  // Inset the endpoints a little so joints sit inside the shape.
  const inset = (hi - lo) * 0.06;
  return {
    center: { x: cx, y: cy },
    a: { x: cx + ux * (lo + inset), y: cy + uy * (lo + inset) },
    b: { x: cx + ux * (hi - inset), y: cy + uy * (hi - inset) },
    top,
    bottom,
  };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Splits limb layers into screen-left / screen-right groups around `cx`. */
function sides(parts: SourcePart[], cx: number): [SourcePart[], SourcePart[]] {
  if (parts.length < 2) return [parts, []];
  const centers = parts.map((p) => p.x + p.width / 2);
  const sorted = [...centers].sort((a, b) => a - b);
  // Split at the largest gap between centres (falls back to cx).
  let split = cx;
  let gap = -1;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1] - sorted[i] > gap) {
      gap = sorted[i + 1] - sorted[i];
      split = (sorted[i] + sorted[i + 1]) / 2;
    }
  }
  return [parts.filter((_, i) => centers[i] < split), parts.filter((_, i) => centers[i] >= split)];
}

/**
 * Refines guessed humanoid joints with named layers. Returns the joints and
 * whether a tail layer was found, or null when no layer names are useful.
 */
export function jointsFromLayers(template: TemplateId, parts: SourcePart[], guess: Record<string, Pt>): { joints: Record<string, Pt>; tail: boolean } | null {
  if (template !== 'humanoid' || parts.length < 3) return null;
  const by: Record<Kind, SourcePart[]> = { head: [], torso: [], arm: [], leg: [], tail: [] };
  for (const p of parts) {
    const k = classify(p.name);
    if (k) by[k].push(p);
  }
  const named = Object.values(by).filter((l) => l.length).length;
  if (named < 2) return null;
  const j = { ...guess };

  const torso = axisOf(by.torso);
  const head = axisOf(by.head);
  // Heads and torsos are often round: use a vertical axis through the centroid.
  if (torso) {
    const h = torso.bottom - torso.top;
    j.neck = { x: torso.center.x, y: torso.top + h * 0.04 };
    j.chest = { x: torso.center.x, y: torso.top + h * 0.3 };
    j.pelvis = { x: torso.center.x, y: torso.top + h * 0.9 };
  }
  if (head) {
    j.head_top = { x: head.center.x, y: head.top };
    const base = { x: head.center.x, y: head.bottom - (head.bottom - head.top) * 0.08 };
    j.neck = torso ? lerp(j.neck, base, 0.5) : base;
  }
  const cx = j.pelvis.x;
  const limb = (list: SourcePart[], prefix: 'arm' | 'leg') => {
    const [left, right] = sides(list, cx);
    for (const [group, side] of [[left, 'l'], [right, 'r']] as const) {
      const ax = axisOf(group);
      if (!ax) continue;
      const anchor = prefix === 'arm' ? j.neck : j.pelvis;
      const [root, end] = dist(ax.a, anchor) < dist(ax.b, anchor) ? [ax.a, ax.b] : [ax.b, ax.a];
      if (prefix === 'arm') {
        j[`shoulder_${side}`] = root;
        j[`elbow_${side}`] = lerp(root, end, 0.5);
        j[`wrist_${side}`] = lerp(root, end, 0.85);
      } else {
        const h = ax.bottom - Math.min(root.y, end.y);
        j[`hip_${side}`] = root;
        j[`ankle_${side}`] = { x: lerp(root, end, 0.92).x, y: ax.bottom - h * 0.06 };
        j[`knee_${side}`] = lerp(j[`hip_${side}`], j[`ankle_${side}`], 0.5);
        j[`toe_${side}`] = { x: j[`ankle_${side}`].x + h * 0.15, y: ax.bottom - h * 0.01 };
      }
    }
    // A single limb layer covers both sides.
    if (!right.length && left.length) {
      for (const n of prefix === 'arm' ? ['shoulder', 'elbow', 'wrist'] : ['hip', 'knee', 'ankle', 'toe']) j[`${n}_r`] = { ...j[`${n}_l`] };
    }
  };
  if (by.arm.length) limb(by.arm, 'arm');
  if (by.leg.length) limb(by.leg, 'leg');
  if (by.leg.length) j.ground = { x: j.pelvis.x, y: Math.max(...by.leg.map((p) => p.y + p.height)) };
  const tail = axisOf(by.tail);
  if (tail) {
    const [base, tip] = dist(tail.a, j.pelvis) < dist(tail.b, j.pelvis) ? [tail.a, tail.b] : [tail.b, tail.a];
    j.tail_base = base;
    j.tail_mid = lerp(base, tip, 0.5);
    j.tail_tip = tip;
  }
  return { joints: j, tail: !!tail };
}
