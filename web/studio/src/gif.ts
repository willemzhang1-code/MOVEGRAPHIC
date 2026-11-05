// Animated GIF export: renders an animation offscreen with the core (physics
// included) at a fixed frame rate and encodes it with gifenc.

import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { SinewRenderer, ortho, type SinewRuntime } from '@sinew/runtime';
import { compile, type RigDoc } from './doc';

export interface GifOptions {
  fps?: number;
  /** Longest side, pixels. */
  size?: number;
  background?: [number, number, number];
  onProgress?: (done: number, total: number) => void;
}

export async function renderGif(rt: SinewRuntime, doc: RigDoc, pages: HTMLCanvasElement[], anim: string, o: GifOptions = {}): Promise<Blob> {
  const fps = o.fps ?? 20;
  const size = o.size ?? 360;
  const [br, bg, bb] = o.background ?? [255, 255, 255];
  const a = doc.animations.find((x) => x.name === anim);
  if (!a) throw new Error(`No animation "${anim}"`);
  const frames = Math.max(1, Math.round((a.duration + (a.loop ? 0 : 0.4)) * fps));
  const { json, atlas } = compile(doc);
  const data = rt.loadSpine(JSON.stringify(json), atlas);
  try {
    // Bounds over the whole animation.
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const probe = data.createInstance();
    probe.setAnimation(0, anim, a.loop);
    probe.update(0);
    for (let i = 0; i < frames; i++) {
      const v = probe.render().vertices;
      for (let k = 0; k < v.length; k += 6) {
        x0 = Math.min(x0, v[k]);
        x1 = Math.max(x1, v[k]);
        y0 = Math.min(y0, v[k + 1]);
        y1 = Math.max(y1, v[k + 1]);
      }
      probe.update(1 / fps);
    }
    probe.dispose();
    if (!Number.isFinite(x0)) throw new Error('Nothing to render');
    const pad = 0.06;
    const bw = (x1 - x0) * (1 + pad * 2);
    const bh = (y1 - y0) * (1 + pad * 2);
    const scale = size / Math.max(bw, bh);
    const w = Math.max(2, Math.round((bw * scale) / 2) * 2);
    const h = Math.max(2, Math.round((bh * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: true, alpha: false, antialias: true })!;
    const renderer = new SinewRenderer(gl);
    const textures = pages.map((p) => renderer.createTexture(p, false));
    const inst = data.createInstance();
    inst.setAnimation(0, anim, a.loop);
    inst.update(0);
    const enc = GIFEncoder();
    const px = new Uint8Array(w * h * 4);
    const flipped = new Uint8Array(w * h * 4);
    for (let i = 0; i < frames; i++) {
      gl.viewport(0, 0, w, h);
      gl.clearColor(br / 255, bg / 255, bb / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      renderer.begin(ortho((x0 + x1) / 2, (y0 + y1) / 2, scale, w, h));
      renderer.draw(inst.render(), textures);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let y = 0; y < h; y++) flipped.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      const palette = quantize(flipped, 256);
      enc.writeFrame(applyPalette(flipped, palette), w, h, { palette, delay: 1000 / fps });
      inst.update(1 / fps);
      o.onProgress?.(i + 1, frames);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    enc.finish();
    inst.dispose();
    textures.forEach((t) => renderer.deleteTexture(t));
    return new Blob([enc.bytes() as BlobPart], { type: 'image/gif' });
  } finally {
    data.dispose();
  }
}
