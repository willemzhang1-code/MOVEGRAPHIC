// Background removal and cropping for a single character image.

export interface Cutout {
  /** Cropped RGBA image with the background made transparent. */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** 1 = character, row-major width*height. */
  mask: Uint8Array;
  /** How the cutout was obtained. */
  method: 'alpha' | 'flood';
}

const MAX_SIZE = 1024;

function toImageData(source: CanvasImageSource, w: number, h: number): ImageData {
  const scale = Math.min(1, MAX_SIZE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

const dist2 = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number) => {
  const dr = d[i] - r;
  const dg = d[i + 1] - g;
  const db = d[i + 2] - b;
  return dr * dr + dg * dg + db * db;
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
}

/** Keeps foreground components larger than a fraction of the largest one. */
function removeSpecks(mask: Uint8Array, w: number, h: number, minFraction = 0.02): void {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let sp = 0;
    let size = 0;
    stack[sp++] = start;
    label[start] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] && label[q] < 0) {
          label[q] = id;
          stack[sp++] = q;
        }
      }
    }
    sizes.push(size);
  }
  const max = Math.max(0, ...sizes);
  for (let i = 0; i < w * h; i++) if (mask[i] && sizes[label[i]] < max * minFraction) mask[i] = 0;
}

/**
 * Flood-fills background-colored pixels reachable from `seeds` into `out`.
 * Returns the indices filled by this call.
 */
function flood(img: ImageData, bg: [number, number, number], tol: number, step: number, seeds: number[], out: Uint8Array): Int32Array {
  const { width: w, height: h, data } = img;
  const tol2 = tol * tol;
  const step2 = step * step;
  const stack = new Int32Array(w * h);
  const filled: number[] = [];
  let sp = 0;
  for (const s of seeds) {
    if (!out[s] && dist2(data, s * 4, ...bg) < tol2) {
      out[s] = 1;
      stack[sp++] = s;
    }
  }
  while (sp) {
    const p = stack[--sp];
    filled.push(p);
    const x = p % w;
    const y = (p / w) | 0;
    const pi = p * 4;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of nb) {
      if (q < 0 || out[q]) continue;
      const qi = q * 4;
      if (dist2(data, qi, ...bg) < tol2 && dist2(data, qi, data[pi], data[pi + 1], data[pi + 2]) < step2) {
        out[q] = 1;
        stack[sp++] = q;
      }
    }
  }
  return Int32Array.from(filled);
}

export function cutout(source: CanvasImageSource, srcW: number, srcH: number): Cutout {
  const img = toImageData(source, srcW, srcH);
  const { width: w, height: h, data } = img;
  const n = w * h;
  const mask = new Uint8Array(n);

  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const transparentBorder = border.filter((p) => data[p * 4 + 3] < 200).length / border.length;

  let method: Cutout['method'];
  if (transparentBorder > 0.5) {
    method = 'alpha';
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] > 96 ? 1 : 0;
  } else {
    method = 'flood';
    const bg: [number, number, number] = [
      median(border.map((p) => data[p * 4])),
      median(border.map((p) => data[p * 4 + 1])),
      median(border.map((p) => data[p * 4 + 2])),
    ];
    const background = new Uint8Array(n);
    flood(img, bg, 46, 14, border, background);
    // Enclosed background pockets (e.g. between an arm and the torso): only
    // large, very uniform regions, to avoid eating grey clothing.
    const pocket = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (background[p] || pocket[p] || dist2(data, p * 4, ...bg) > 10 * 10) continue;
      const region = flood(img, bg, 10, 5, [p], pocket);
      if (region.length > n * 0.002) for (const i of region) background[i] = 1;
    }
    for (let i = 0; i < n; i++) mask[i] = background[i] ? 0 : 1;
  }
  removeSpecks(mask, w, h);

  // Bounding box + margin.
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('No character found in the image');
  const m = 8;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m);
  y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // Soft alpha: 3x3 box blur of the mask, multiplied into source alpha.
  const out = new ImageData(cw, ch);
  const cmask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const sx = x + x0;
      const sy = y + y0;
      let acc = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = Math.min(w - 1, Math.max(0, sx + dx));
          const qy = Math.min(h - 1, Math.max(0, sy + dy));
          acc += mask[qy * w + qx];
        }
      }
      const si = (sy * w + sx) * 4;
      const di = (y * cw + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = Math.round((data[si + 3] * acc) / 9);
      cmask[y * cw + x] = mask[sy * w + sx];
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return { canvas, width: cw, height: ch, mask: cmask, method };
}

/** Distance (pixels, chamfer approximation) from each pixel to the nearest mask pixel. */
export function distanceToMask(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 0 : INF;
  const a = 1;
  const b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}
