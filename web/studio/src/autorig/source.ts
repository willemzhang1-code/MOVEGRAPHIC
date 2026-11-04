// Image sources for rigging: a single cutout, a layered PSD, or a saved project.

import { readPsd, type Layer } from 'ag-psd';
import type { RigDoc } from '../doc';
import type { Cutout } from './mask';
import type { PartMask } from './rig';

export interface SourcePart extends PartMask {
  name: string;
  page: number;
  region: { x: number; y: number; width: number; height: number };
}

export interface Source {
  name: string;
  kind: 'image' | 'psd' | 'project';
  width: number;
  height: number;
  /** Composite silhouette, document space. */
  mask: Uint8Array;
  /** Back to front. */
  parts: SourcePart[];
  pages: HTMLCanvasElement[];
}

const MAX_DOC = 1400;
const MAX_PAGE = 2048;
const PAD = 2;

function alphaMask(canvas: HTMLCanvasElement, threshold = 96): Uint8Array {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > threshold ? 1 : 0;
  return m;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** Shelf-packs images into pages; returns placements and page canvases. */
function pack(images: HTMLCanvasElement[]): { page: number; x: number; y: number }[] & { pages: HTMLCanvasElement[] } {
  const order = images.map((im, i) => i).sort((a, b) => images[b].height - images[a].height);
  const placements: { page: number; x: number; y: number }[] = new Array(images.length);
  const sizes: { w: number; h: number }[] = [];
  let page = 0;
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  sizes.push({ w: 0, h: 0 });
  for (const i of order) {
    const { width: w, height: h } = images[i];
    if (x + w + PAD > MAX_PAGE) {
      x = PAD;
      y += shelf + PAD;
      shelf = 0;
    }
    if (y + h + PAD > MAX_PAGE) {
      page++;
      sizes.push({ w: 0, h: 0 });
      x = PAD;
      y = PAD;
      shelf = 0;
    }
    placements[i] = { page, x, y };
    x += w + PAD;
    shelf = Math.max(shelf, h);
    sizes[page].w = Math.max(sizes[page].w, x);
    sizes[page].h = Math.max(sizes[page].h, y + h + PAD);
  }
  const pages = sizes.map((s) => canvasOf(s.w, s.h));
  images.forEach((im, i) => pages[placements[i].page].getContext('2d')!.drawImage(im, placements[i].x, placements[i].y));
  return Object.assign(placements, { pages });
}

export function sourceFromCutout(name: string, cut: Cutout): Source {
  return {
    name,
    kind: 'image',
    width: cut.width,
    height: cut.height,
    mask: cut.mask,
    parts: [
      {
        name: 'body',
        x: 0,
        y: 0,
        width: cut.width,
        height: cut.height,
        mask: cut.mask,
        page: 0,
        region: { x: 0, y: 0, width: cut.width, height: cut.height },
      },
    ],
    pages: [cut.canvas],
  };
}

function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((raw) => {
    const base = raw.replace(/[:\r\n\t]/g, ' ').trim().replace(/\s+/g, ' ') || 'layer';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base} ${n + 1}` : base;
  });
}

/** Layered PSD: every visible pixel layer becomes a part. */
export function sourceFromPsd(name: string, buffer: ArrayBuffer): Source {
  const psd = readPsd(buffer, { skipThumbnail: true });
  const layers: Layer[] = [];
  const walk = (list: Layer[] | undefined) => {
    for (const l of list ?? []) {
      if (l.hidden) continue;
      if (l.children) walk(l.children);
      else if (l.canvas && (l.right ?? 0) > (l.left ?? 0) && (l.bottom ?? 0) > (l.top ?? 0)) layers.push(l);
    }
  };
  walk(psd.children);
  if (!layers.length) throw new Error('The PSD has no visible pixel layers');

  const scale = Math.min(1, MAX_DOC / Math.max(psd.width, psd.height));
  const W = Math.round(psd.width * scale);
  const H = Math.round(psd.height * scale);
  const compose = (order: Layer[]) => {
    const c = canvasOf(W, H);
    const g = c.getContext('2d')!;
    for (const l of order) {
      g.globalAlpha = l.opacity ?? 1;
      g.drawImage(l.canvas!, (l.left ?? 0) * scale, (l.top ?? 0) * scale, l.canvas!.width * scale, l.canvas!.height * scale);
    }
    return c;
  };
  // Layer order: trust the file's composite when present (bottom→top is the norm).
  let ordered = layers;
  if (psd.canvas) {
    const ref = canvasOf(64, 64);
    ref.getContext('2d')!.drawImage(psd.canvas, 0, 0, 64, 64);
    const score = (order: Layer[]) => {
      const t = canvasOf(64, 64);
      t.getContext('2d')!.drawImage(compose(order), 0, 0, 64, 64);
      const a = ref.getContext('2d')!.getImageData(0, 0, 64, 64).data;
      const b = t.getContext('2d')!.getImageData(0, 0, 64, 64).data;
      let d = 0;
      for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
      return d;
    };
    if (score([...layers].reverse()) < score(layers)) ordered = [...layers].reverse();
  }

  // Trim each layer to its opaque bounds.
  const images: HTMLCanvasElement[] = [];
  const rects: { x: number; y: number }[] = [];
  const keep: Layer[] = [];
  for (const l of ordered) {
    const lw = Math.max(1, Math.round(l.canvas!.width * scale));
    const lh = Math.max(1, Math.round(l.canvas!.height * scale));
    const full = canvasOf(lw, lh);
    const g = full.getContext('2d', { willReadFrequently: true })!;
    g.globalAlpha = l.opacity ?? 1;
    g.drawImage(l.canvas!, 0, 0, lw, lh);
    const d = g.getImageData(0, 0, lw, lh).data;
    let x0 = lw, y0 = lh, x1 = -1, y1 = -1;
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        if (d[(y * lw + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) continue;
    const img = canvasOf(x1 - x0 + 1, y1 - y0 + 1);
    img.getContext('2d')!.drawImage(full, -x0, -y0);
    images.push(img);
    rects.push({ x: Math.round((l.left ?? 0) * scale) + x0, y: Math.round((l.top ?? 0) * scale) + y0 });
    keep.push(l);
  }
  const names = uniqueNames(keep.map((l) => l.name ?? 'layer'));
  const placed = pack(images);
  const parts: SourcePart[] = images.map((img, i) => ({
    name: names[i],
    x: rects[i].x,
    y: rects[i].y,
    width: img.width,
    height: img.height,
    mask: alphaMask(img),
    page: placed[i].page,
    region: { x: placed[i].x, y: placed[i].y, width: img.width, height: img.height },
  }));
  return { name, kind: 'psd', width: W, height: H, mask: compositeMask(parts, W, H), parts, pages: placed.pages };
}

function compositeMask(parts: PartMask[], W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (const p of parts) {
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        if (!p.mask[y * p.width + x]) continue;
        const X = p.x + x;
        const Y = p.y + y;
        if (X >= 0 && Y >= 0 && X < W && Y < H) m[Y * W + X] = 1;
      }
    }
  }
  return m;
}

/** Rebuilds a source from a saved project's texture pages. */
export function sourceFromProject(doc: RigDoc, pages: HTMLImageElement[]): Source {
  const canvases = pages.map((im) => {
    const c = canvasOf(im.naturalWidth, im.naturalHeight);
    c.getContext('2d')!.drawImage(im, 0, 0);
    return c;
  });
  const parts: SourcePart[] = doc.parts.map((p) => {
    const c = canvasOf(p.region.width, p.region.height);
    c.getContext('2d')!.drawImage(canvases[p.page], -p.region.x, -p.region.y);
    return { name: p.name, x: p.x, y: p.y, width: p.width, height: p.height, mask: alphaMask(c), page: p.page, region: p.region };
  });
  return {
    name: doc.name,
    kind: 'project',
    width: doc.image.width,
    height: doc.image.height,
    mask: compositeMask(parts, doc.image.width, doc.image.height),
    parts,
    pages: canvases,
  };
}
