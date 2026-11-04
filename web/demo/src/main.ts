import {
  EventKind,
  SinewRenderer,
  SinewRuntime,
  ortho,
  type SinewTexture,
  type SkeletonData,
  type SkeletonInstance,
} from '@sinew/runtime';
import { buildAtlas, type PartSpec } from './textures';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

interface ExampleEntry {
  name: string;
  skeleton: string;
  atlas: string;
  pages: string[];
}

interface Loaded {
  id: string;
  data: SkeletonData;
  pages: SinewTexture[];
  /** Setup-pose bounds: minX, minY, maxX, maxY. */
  bounds: [number, number, number, number];
  isDemo: boolean;
}

const EXAMPLES_DIR = '/examples/4.2';
const DEMO_ID = 'critter (demo)';

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Prefers complete skins (e.g. "full-skins/girl") over partial ones. */
function pickSkin(d: SkeletonData): string {
  const named = d.skins.filter((s) => s !== 'default');
  return named.find((s) => /full/i.test(s)) ?? named[0] ?? '';
}

async function main() {
  const rt = await SinewRuntime.load(new URL('/sinew.wasm', location.href));
  const canvas = $<HTMLCanvasElement>('#view');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) throw new Error('WebGL2 is not available');
  const renderer = new SinewRenderer(gl);

  const examples: ExampleEntry[] = await fetch(`${EXAMPLES_DIR}/index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const assetSel = $<HTMLSelectElement>('#asset');
  assetSel.add(new Option(DEMO_ID, DEMO_ID));
  for (const e of examples) assetSel.add(new Option(`${e.name} (Spine 4.2 example)`, e.name));

  const opts = { base: '', waving: false, skin: '', mix: 0.25, speed: 1, crowd: 1, showBones: false, flip: false };
  const instances: SkeletonInstance[] = [];
  let asset: Loaded | null = null;
  let camera = { x: 0, y: 0, zoom: 1 };

  function measure(data: SkeletonData, skin: string | null): [number, number, number, number] {
    const inst = data.createInstance();
    if (skin) inst.setSkin(skin);
    inst.update(0);
    const v = inst.render().vertices;
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i += 6) {
      b[0] = Math.min(b[0], v[i]);
      b[1] = Math.min(b[1], v[i + 1]);
      b[2] = Math.max(b[2], v[i]);
      b[3] = Math.max(b[3], v[i + 1]);
    }
    inst.dispose();
    return Number.isFinite(b[0]) ? b : [-100, 0, 100, 200];
  }

  async function load(id: string): Promise<Loaded> {
    if (id === DEMO_ID) {
      const [json, parts] = await Promise.all([
        fetch('/assets/critter.json').then((r) => r.text()),
        fetch('/assets/critter.parts.json').then((r) => r.json() as Promise<Record<string, PartSpec>>),
      ]);
      const atlas = buildAtlas(parts);
      const data = rt.loadSpine(json, atlas.text);
      const pages = data.pages.map((p) => renderer.createTexture(atlas.canvas, p.pma));
      return { id, data, pages, bounds: measure(data, 'green'), isDemo: true };
    }
    const e = examples.find((x) => x.name === id)!;
    const base = `${EXAMPLES_DIR}/${e.name}`;
    const [json, atlasText, images] = await Promise.all([
      fetch(`${base}/${e.skeleton}`).then((r) => r.text()),
      fetch(`${base}/${e.atlas}`).then((r) => r.text()),
      Promise.all(e.pages.map((p) => loadImage(`${base}/${p}`))),
    ]);
    const data = rt.loadSpine(json, atlasText);
    const pages = data.pages.map((p, i) => renderer.createTexture(images[i], p.pma));
    return { id, data, pages, bounds: measure(data, pickSkin(data) || null), isDemo: false };
  }

  function skinFor(i: number): string | null {
    if (!asset) return null;
    if (asset.isDemo) return i % 3 === 2 ? (opts.skin === 'green' ? 'purple' : 'green') : opts.skin;
    return opts.skin || null;
  }

  function makeInstance(i: number): SkeletonInstance {
    const inst = asset!.data.createInstance();
    inst.setSkin(skinFor(i));
    inst.setDefaultMix(opts.mix);
    inst.setTimeScale(opts.speed);
    if (opts.base) inst.setAnimation(0, opts.base, true);
    if (opts.waving) startWave(inst);
    inst.update(i === 0 ? 0 : Math.random() * 2);
    return inst;
  }

  function startWave(inst: SkeletonInstance) {
    inst.setEmptyAnimation(1, 0);
    inst.addAnimation(1, 'wave', true, 0);
  }

  function layout() {
    if (!asset) return;
    const [x0, y0, x1, y1] = asset.bounds;
    const bw = x1 - x0;
    const bh = y1 - y0;
    const sx = bw * 1.1;
    const sy = bh * 1.1;
    const n = instances.length;
    const cols = Math.ceil(Math.sqrt(n * (sy / sx) * 1.6));
    const rows = Math.ceil(n / cols);
    const flip = opts.flip ? -1 : 1;
    instances.forEach((inst, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      inst.setTransform((c - (cols - 1) / 2) * sx, ((rows - 1) / 2 - r) * sy, flip, 1);
    });
    const rect = canvas.getBoundingClientRect();
    const w = (cols - 1) * sx + bw;
    const h = (rows - 1) * sy + bh;
    const cx = n === 1 ? (flip * (x0 + x1)) / 2 : 0;
    const cy = n === 1 ? (y0 + y1) / 2 : 0;
    camera = { x: cx, y: cy, zoom: Math.min(rect.width / (w * 1.15), rect.height / (h * 1.15)) };
    $('#ground').style.display = n === 1 && asset.isDemo ? '' : 'none';
  }

  function rebuild() {
    while (instances.length) instances.pop()!.dispose();
    for (let i = 0; i < opts.crowd; i++) instances.push(makeInstance(i));
    layout();
  }

  const forAll = (fn: (i: SkeletonInstance) => void) => instances.forEach(fn);

  function setBase(name: string) {
    opts.base = name;
    document.querySelectorAll<HTMLButtonElement>('#anims button').forEach((b) => b.classList.toggle('on', b.dataset.anim === name));
    forAll((i) => i.setAnimation(0, name, true));
  }

  async function selectAsset(id: string) {
    while (instances.length) instances.pop()!.dispose();
    if (asset) {
      asset.pages.forEach((p) => renderer.deleteTexture(p));
      asset.data.dispose();
    }
    asset = await load(id);
    const d = asset.data;
    opts.waving = false;
    opts.skin = asset.isDemo ? 'green' : pickSkin(d);
    const preferred = ['idle', 'walk', 'run', 'animation'];
    opts.base = preferred.find((p) => d.animations.some((a) => a.name === p)) ?? d.animations[0]?.name ?? '';

    const anims = $('#anims');
    anims.replaceChildren();
    const playable = asset.isDemo ? d.animations.filter((a) => ['idle', 'walk'].includes(a.name)) : d.animations;
    playable.forEach((a, i) => {
      const b = document.createElement('button');
      b.dataset.anim = a.name;
      b.innerHTML = `${a.name}${asset!.isDemo ? `<kbd>${i + 1}</kbd>` : ''}`;
      b.addEventListener('click', () => setBase(a.name));
      anims.append(b);
    });
    if (asset.isDemo) {
      const j = document.createElement('button');
      j.innerHTML = 'jump<kbd>space</kbd>';
      j.addEventListener('click', jump);
      anims.append(j);
    }
    $('#layers').hidden = !asset.isDemo;
    $<HTMLButtonElement>('#wave').classList.remove('on');

    const skinSel = $<HTMLSelectElement>('#skin');
    skinSel.replaceChildren();
    for (const s of d.skins.filter((s) => s !== 'default' || d.skins.length === 1)) skinSel.add(new Option(s, s));
    skinSel.value = opts.skin;
    skinSel.disabled = skinSel.options.length <= 1;

    $('#info').textContent = `core ${rt.version} · ${d.bones.length} bones · ${d.slots.length} slots · ${d.animations.length} animations · ${d.skins.length} skins`;
    $('#warnings').textContent = d.warnings.length ? d.warnings.join('\n') : 'none';
    $('#events').replaceChildren();
    rebuild();
    setBase(opts.base);
    document.body.dataset.asset = id;
  }

  const jump = () =>
    asset?.isDemo &&
    forAll((i) => {
      i.setAnimation(0, 'jump', false);
      i.addAnimation(0, opts.base, true, 0);
    });
  const hit = () =>
    asset?.isDemo &&
    forAll((i) => {
      i.setAnimation(2, 'hit', false);
      i.addEmptyAnimation(2, 0.15, 0);
    });
  const toggleWave = (on = !opts.waving) => {
    if (!asset?.isDemo) return;
    opts.waving = on;
    $<HTMLButtonElement>('#wave').classList.toggle('on', on);
    forAll((i) => (on ? startWave(i) : i.setEmptyAnimation(1, Math.max(opts.mix, 0.2))));
  };
  const toggleBones = (on = !opts.showBones) => {
    opts.showBones = on;
    $<HTMLInputElement>('#bones').checked = on;
  };

  // ---------------------------------------------------------------- controls
  assetSel.addEventListener('change', () => selectAsset(assetSel.value));
  $('#hit').addEventListener('click', hit);
  $('#wave').addEventListener('click', () => toggleWave());
  $<HTMLSelectElement>('#skin').addEventListener('change', (e) => {
    opts.skin = (e.target as HTMLSelectElement).value;
    instances.forEach((inst, i) => inst.setSkin(skinFor(i)));
  });
  const bindRange = (id: string, fmt: (v: number) => string, fn: (v: number) => void) => {
    const el = $<HTMLInputElement>(`#${id}`);
    const out = $(`#${id}-v`);
    const update = () => {
      const v = Number(el.value);
      out.textContent = fmt(v);
      fn(v);
    };
    el.addEventListener('input', update);
    out.textContent = fmt(Number(el.value));
  };
  bindRange('mix', (v) => `${v.toFixed(2)}s`, (v) => {
    opts.mix = v;
    forAll((i) => i.setDefaultMix(v));
  });
  bindRange('speed', (v) => `${v.toFixed(2)}×`, (v) => {
    opts.speed = v;
    forAll((i) => i.setTimeScale(v));
  });
  bindRange('crowd', (v) => String(v), (v) => {
    opts.crowd = v;
    while (instances.length < v) instances.push(makeInstance(instances.length));
    while (instances.length > v) instances.pop()!.dispose();
    layout();
  });
  $<HTMLInputElement>('#bones').addEventListener('change', (e) => toggleBones((e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('#flip').addEventListener('change', (e) => {
    opts.flip = (e.target as HTMLInputElement).checked;
    layout();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (asset?.isDemo && k === '1') setBase('idle');
    else if (asset?.isDemo && k === '2') setBase('walk');
    else if (k === ' ') {
      e.preventDefault();
      jump();
    } else if (k === 'h') hit();
    else if (k === 'w') toggleWave();
    else if (k === 'b') toggleBones();
  });
  window.addEventListener('resize', layout);

  // ---------------------------------------------------------------- loop
  const log = $('#events');
  const logEvent = (text: string) => {
    const li = document.createElement('li');
    li.textContent = text;
    log.prepend(li);
    while (log.children.length > 8) log.lastChild!.remove();
  };
  let last = performance.now();
  let coreMs = 0;
  let fps = 60;
  let statsAt = 0;
  let clock = 0;

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      layout();
    }
    gl!.viewport(0, 0, w, h);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);

    let vertices = 0;
    if (asset) {
      const ppu = camera.zoom * dpr;
      renderer.begin(ortho(camera.x, camera.y, ppu, w, h));
      let core = 0;
      for (const inst of instances) {
        const t0 = performance.now();
        inst.update(dt);
        const view = inst.render();
        core += performance.now() - t0;
        vertices += view.vertices.length / 6;
        renderer.draw(view, asset.pages);
      }
      if (opts.showBones) for (const inst of instances.slice(0, 50)) renderer.drawBones(inst.boneWorld(), asset.data, ppu);
      coreMs = coreMs * 0.9 + core * 0.1;
      instances.forEach((inst, idx) => {
        for (const e of inst.pollEvents()) {
          if (idx === 0 && e.kind === EventKind.Event) logEvent(`${clock.toFixed(2)}s  ${e.name}${e.int ? ` #${e.int}` : ''}  (track ${e.track})`);
        }
      });
      $('#ground').style.top = `${rect.height / 2 + camera.y * camera.zoom}px`;
    }

    if (now - statsAt > 250) {
      statsAt = now;
      $('#stat-fps').textContent = fps.toFixed(0);
      $('#stat-core').textContent = `${coreMs.toFixed(2)} ms`;
      $('#stat-verts').textContent = vertices.toLocaleString();
      $('#stat-draws').textContent = String(renderer.drawCalls);
    }
    requestAnimationFrame(frame);
  }

  const initial = new URLSearchParams(location.search).get('asset');
  const start = initial && examples.some((e) => e.name === initial) ? initial : DEMO_ID;
  assetSel.value = start;
  await selectAsset(start);
  requestAnimationFrame(frame);
  document.body.dataset.ready = 'true';
}

main().catch((e) => {
  console.error(e);
  $('#error').textContent = String(e);
  document.body.dataset.ready = 'error';
});
