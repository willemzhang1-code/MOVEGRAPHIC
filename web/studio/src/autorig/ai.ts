// AI-assisted joint placement: a vision model (Workers AI, via the RABBIT
// worker's /api/keypoints) returns body-part boxes; each box intersected with
// the silhouette becomes a virtual named layer, and the named-layer joint
// logic places the joints. Parts the model does not return keep the
// silhouette guess.

import { jointsFromLayers } from './hints';
import type { Source, SourcePart } from './source';
import type { Pt, TemplateId } from './templates';

const MAX = 512;
const NAMES: Record<string, string> = {
  head: 'head',
  torso: 'torso',
  body: 'torso',
  arm_left_of_image: 'arm L',
  arm_right_of_image: 'arm R',
  leg_left_of_image: 'leg L',
  leg_right_of_image: 'leg R',
  tail: 'tail',
};

/** The character composited on a light background, at most MAX px. */
function snapshot(src: Source): HTMLCanvasElement {
  const scale = Math.min(1, MAX / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  const g = c.getContext('2d')!;
  g.fillStyle = '#ececec';
  g.fillRect(0, 0, c.width, c.height);
  g.scale(scale, scale);
  for (const p of src.parts) {
    g.drawImage(src.pages[p.page], p.region.x, p.region.y, p.region.width, p.region.height, p.x, p.y, p.width, p.height);
  }
  return c;
}

export type Boxes = Record<string, [number, number, number, number]>;

/** How the model sees the character turned (humanoids). */
export type Facing = 'profile' | 'three_quarter' | 'front' | 'back';

export async function requestBoxes(src: Source, template: TemplateId): Promise<Boxes & { facing?: Facing }> {
  const image = snapshot(src).toDataURL('image/png');
  let res: Response;
  try {
    res = await fetch('/api/keypoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image, template, model: 'boxes' }),
    });
  } catch {
    throw new Error('AI service is not reachable from here');
  }
  if (res.status === 404) throw new Error('AI service is only available on the deployed site');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `AI service error ${res.status}`);
  const boxes: Boxes & { facing?: Facing } = { ...(body.boxes ?? {}) };
  if (body.facing) Object.defineProperty(boxes, 'facing', { value: body.facing, enumerable: false });
  return boxes;
}

/** Virtual layers: silhouette ∩ each box (document space). */
export function boxesToParts(src: Source, boxes: Boxes): SourcePart[] {
  const out: SourcePart[] = [];
  for (const [key, b] of Object.entries(boxes)) {
    const name = NAMES[key];
    if (!name) continue;
    const x0 = Math.max(0, Math.floor(b[0] * src.width));
    const y0 = Math.max(0, Math.floor(b[1] * src.height));
    const x1 = Math.min(src.width, Math.ceil(b[2] * src.width));
    const y1 = Math.min(src.height, Math.ceil(b[3] * src.height));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 || h < 2) continue;
    const mask = new Uint8Array(w * h);
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = src.mask[(y + y0) * src.width + x + x0];
        mask[y * w + x] = v;
        n += v;
      }
    }
    if (n < 20) continue;
    out.push({ name, x: x0, y: y0, width: w, height: h, mask, page: 0, region: { x: 0, y: 0, width: w, height: h } });
  }
  return out;
}

export function jointsFromBoxes(src: Source, template: TemplateId, boxes: Boxes, guess: Record<string, Pt>) {
  return jointsFromLayers(template, boxesToParts(src, boxes), guess, 2);
}
