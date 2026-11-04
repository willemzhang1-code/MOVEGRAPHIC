// Parity harness: renders the same Spine 4.2 example with the official
// spine-webgl runtime (reference, used as a black box) and the RABBIT core,
// then compares silhouettes (IoU) and colors. Dev-only; needs the examples
// from tools/fetch-spine-examples.mjs and a Spine license.
import * as spine from '@esotericsoftware/spine-webgl';
import { SinewRenderer, SinewRuntime, ortho } from '@sinew/runtime';

const SIZE = 360;
const DT = 1 / 60;
const DIR = '/examples/4.2';

interface Entry {
  name: string;
  skeleton: string;
  atlas: string;
  pages: string[];
}

export interface CaseResult {
  example: string;
  animation: string;
  time: number;
  iou: number;
  meanDiff: number;
  badPixels: number;
}

function pickSkin(names: string[]): string | null {
  const named = names.filter((s) => s !== 'default');
  return named.find((s) => /full/i.test(s)) ?? named[0] ?? null;
}

async function loadImage(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function read(gl: WebGLRenderingContext | WebGL2RenderingContext): Uint8Array {
  const px = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

async function main() {
  const params = new URLSearchParams(location.search);
  const only = params.get('only')?.split(',');
  const animFilter = params.get('anim');
  const tFilter = params.get('t');
  const debugBones = params.get('bones')?.split(',') ?? [];
  const debug: unknown[] = [];
  (window as unknown as { __debug: unknown[] }).__debug = debug;
  const index: Entry[] = await (await fetch(`${DIR}/index.json`)).json();
  const rt = await SinewRuntime.load(new URL('/sinew.wasm', location.href));

  const refCanvas = document.getElementById('ref') as HTMLCanvasElement;
  const ourCanvas = document.getElementById('ours') as HTMLCanvasElement;
  const diffCanvas = document.getElementById('diff') as HTMLCanvasElement;
  const refGl = new spine.ManagedWebGLRenderingContext(refCanvas, { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true });
  const scene = new spine.SceneRenderer(refCanvas, refGl, true);
  const ourGl = ourCanvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: true })!;
  const ours = new SinewRenderer(ourGl);
  const results: CaseResult[] = [];
  const tbody = document.querySelector('#results tbody')!;
  const status = document.getElementById('status')!;

  for (const e of index) {
    if (only && !only.includes(e.name)) continue;
    status.textContent = e.name;
    const base = `${DIR}/${e.name}/`;
    const assets = new spine.AssetManager(refGl, base);
    assets.loadTextureAtlas(e.atlas);
    assets.loadText(e.skeleton);
    await assets.loadAll();
    const atlas = assets.require(e.atlas) as spine.TextureAtlas;
    const jsonText = assets.require(e.skeleton) as string;
    const refData = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(jsonText));
    const pma = atlas.pages.some((p) => p.pma);

    const atlasText = await (await fetch(base + e.atlas)).text();
    const data = rt.loadSpine(jsonText, atlasText);
    const images = await Promise.all(e.pages.map((p) => loadImage(base + p)));
    const textures = data.pages.map((p, i) => ours.createTexture(images[i], p.pma));
    const skin = pickSkin(data.skins);

    // Camera from our setup-pose bounds.
    const probe = data.createInstance();
    if (skin) probe.setSkin(skin);
    probe.update(0);
    const v = probe.render().vertices;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 6) {
      x0 = Math.min(x0, v[i]);
      x1 = Math.max(x1, v[i]);
      y0 = Math.min(y0, v[i + 1]);
      y1 = Math.max(y1, v[i + 1]);
    }
    probe.dispose();
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const ppu = SIZE / (Math.max(x1 - x0, y1 - y0) * 1.5);

    for (const anim of animFilter ? data.animations.filter((a) => a.name === animFilter) : data.animations.slice(0, 3)) {
      for (const frac of tFilter ? tFilter.split(',').map((x) => Number(x) / Math.max(anim.duration, 1e-6)) : [0, 0.37, 0.71]) {
        const t = Math.round(anim.duration * frac * 60) / 60;
        const steps = Math.round(t / DT);

        // Reference.
        const sk = new spine.Skeleton(refData);
        if (skin) sk.setSkinByName(skin);
        sk.setToSetupPose();
        const st = new spine.AnimationState(new spine.AnimationStateData(refData));
        st.setAnimation(0, anim.name, true);
        st.apply(sk);
        sk.updateWorldTransform(spine.Physics.reset);
        for (let i = 0; i < steps; i++) {
          st.update(DT);
          st.apply(sk);
          sk.update(DT);
          sk.updateWorldTransform(spine.Physics.update);
        }
        refGl.gl.viewport(0, 0, SIZE, SIZE);
        refGl.gl.clearColor(0, 0, 0, 0);
        refGl.gl.clear(refGl.gl.COLOR_BUFFER_BIT);
        scene.camera.setViewport(SIZE, SIZE);
        scene.camera.position.x = cx;
        scene.camera.position.y = cy;
        scene.camera.zoom = 1 / ppu;
        scene.begin();
        scene.drawSkeleton(sk, pma);
        scene.end();
        const a = read(refGl.gl);
        const refBones = debugBones.map((n) => {
          const b = sk.findBone(n);
          return b ? [n, +b.worldX.toFixed(1), +b.worldY.toFixed(1), +b.getWorldRotationX().toFixed(1)] : [n, null];
        });

        // RABBIT.
        const inst = data.createInstance();
        if (skin) inst.setSkin(skin);
        inst.setAnimation(0, anim.name, true);
        inst.update(0);
        for (let i = 0; i < steps; i++) inst.update(DT);
        ourGl.viewport(0, 0, SIZE, SIZE);
        ourGl.clearColor(0, 0, 0, 0);
        ourGl.clear(ourGl.COLOR_BUFFER_BIT);
        ours.begin(ortho(cx, cy, ppu, SIZE, SIZE));
        ours.draw(inst.render(), textures);
        if (debugBones.length) {
          const w = inst.boneWorld();
          const ourBones = debugBones.map((n) => {
            const i = data.bones.findIndex((b) => b.name === n);
            if (i < 0) return [n, null];
            const o = i * 7;
            return [n, +w[o + 4].toFixed(1), +w[o + 5].toFixed(1), +((Math.atan2(w[o + 2], w[o]) * 180) / Math.PI).toFixed(1)];
          });
          debug.push({ example: e.name, anim: anim.name, t, ref: refBones, ours: ourBones });
        }
        inst.dispose();
        const b = read(ourGl);

        // Compare.
        let inter = 0;
        let union = 0;
        let sum = 0;
        let bad = 0;
        const d = diffCanvas.getContext('2d')!;
        const img = d.createImageData(SIZE, SIZE);
        for (let p = 0; p < SIZE * SIZE; p++) {
          const i = p * 4;
          const ina = a[i + 3] > 32;
          const inb = b[i + 3] > 32;
          if (ina || inb) union++;
          if (ina && inb) inter++;
          let m = 0;
          for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(a[i + c] - b[i + c]));
          sum += m;
          if (m > 40) bad++;
          // readPixels is bottom-up.
          const o = ((SIZE - 1 - Math.floor(p / SIZE)) * SIZE + (p % SIZE)) * 4;
          img.data[o] = m;
          img.data[o + 1] = ina && !inb ? 200 : 0;
          img.data[o + 2] = inb && !ina ? 200 : 0;
          img.data[o + 3] = 255;
        }
        d.putImageData(img, 0, 0);
        const r: CaseResult = {
          example: e.name,
          animation: anim.name,
          time: t,
          iou: union ? inter / union : 1,
          meanDiff: sum / (SIZE * SIZE),
          badPixels: bad / Math.max(1, union),
        };
        results.push(r);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.example}</td><td>${r.animation}</td><td>${r.time.toFixed(2)}</td><td class="${r.iou < 0.95 ? 'bad' : 'ok'}">${r.iou.toFixed(3)}</td><td>${r.meanDiff.toFixed(2)}</td><td>${(r.badPixels * 100).toFixed(1)}%</td>`;
        tbody.append(tr);
      }
    }
    textures.forEach((t) => ours.deleteTexture(t));
    data.dispose();
  }
  status.textContent = 'done';
  (window as unknown as { __parity: CaseResult[] }).__parity = results;
  document.body.dataset.done = 'true';
}

main().catch((e) => {
  document.getElementById('status')!.textContent = String(e);
  document.body.dataset.done = 'error';
  console.error(e);
});
