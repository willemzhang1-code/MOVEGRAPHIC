import { EventKind, SinewRenderer, SinewRuntime, ortho, type SinewTexture, type SkeletonInstance } from '@sinew/runtime';
import { buildAtlas, type PartSpec } from './textures';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const SPACING_X = 230;
const SPACING_Y = 360;
const CHAR_BOUNDS = { minX: -175, maxX: 95, minY: -10, maxY: 325 };

async function main() {
  const [rt, json, parts] = await Promise.all([
    SinewRuntime.load(new URL('sinew.wasm', document.baseURI)),
    fetch('assets/critter.json').then((r) => r.text()),
    fetch('assets/critter.parts.json').then((r) => r.json() as Promise<Record<string, PartSpec>>),
  ]);
  const atlas = buildAtlas(parts);
  const data = rt.loadSpine(json, atlas.text);

  const canvas = $<HTMLCanvasElement>('#view');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) throw new Error('WebGL2 is not available');
  const renderer = new SinewRenderer(gl);
  const pages: SinewTexture[] = data.pages.map((p) => renderer.createTexture(atlas.canvas, p.pma));

  const opts = { base: 'idle', waving: false, skin: 'green', mix: 0.25, speed: 1, showBones: false, flip: false };
  const instances: SkeletonInstance[] = [];
  let camera = { x: 0, y: 160, zoom: 1 };

  $('#info').textContent = `core ${rt.version} · ${data.bones.length} bones · ${data.slots.length} slots · ${data.animations.length} animations`;
  const warnings = $('#warnings');
  warnings.textContent = data.warnings.length ? data.warnings.join('\n') : 'none';

  function startWave(inst: SkeletonInstance) {
    inst.setEmptyAnimation(1, 0);
    inst.addAnimation(1, 'wave', true, 0);
  }

  function makeInstance(i: number): SkeletonInstance {
    const inst = data.createInstance();
    inst.setSkin(i % 3 === 2 ? (opts.skin === 'green' ? 'purple' : 'green') : opts.skin);
    inst.setDefaultMix(opts.mix);
    inst.setTimeScale(opts.speed);
    inst.setAnimation(0, opts.base, true);
    if (opts.waving) startWave(inst);
    inst.update(i === 0 ? 0 : Math.random() * 2);
    return inst;
  }

  function layout() {
    const n = instances.length;
    const cols = Math.ceil(Math.sqrt(n * 1.8));
    const rows = Math.ceil(n / cols);
    instances.forEach((inst, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = (c - (cols - 1) / 2) * SPACING_X;
      const y = ((rows - 1) / 2 - r) * SPACING_Y;
      inst.setTransform(x, y, opts.flip ? -1 : 1, 1);
    });
    const w = (cols - 1) * SPACING_X + (CHAR_BOUNDS.maxX - CHAR_BOUNDS.minX);
    const h = (rows - 1) * SPACING_Y + (CHAR_BOUNDS.maxY - CHAR_BOUNDS.minY);
    camera = {
      x: (opts.flip ? 1 : -1) * ((CHAR_BOUNDS.maxX + CHAR_BOUNDS.minX) / -2) * (n === 1 ? 1 : 0),
      y: (CHAR_BOUNDS.maxY + CHAR_BOUNDS.minY) / 2,
      zoom: 0,
    };
    if (n === 1) camera.x = opts.flip ? -(CHAR_BOUNDS.maxX + CHAR_BOUNDS.minX) / 2 : (CHAR_BOUNDS.maxX + CHAR_BOUNDS.minX) / 2;
    const rect = canvas.getBoundingClientRect();
    camera.zoom = Math.min(rect.width / (w * 1.15), rect.height / (h * 1.15));
    $('#ground').style.display = n === 1 ? '' : 'none';
  }

  function setCrowd(n: number) {
    while (instances.length < n) instances.push(makeInstance(instances.length));
    while (instances.length > n) instances.pop()!.dispose();
    layout();
  }

  const forAll = (fn: (i: SkeletonInstance) => void) => instances.forEach(fn);

  // ---------------------------------------------------------------- controls
  const setBase = (name: string) => {
    opts.base = name;
    document.querySelectorAll<HTMLButtonElement>('[data-base]').forEach((b) => b.classList.toggle('on', b.dataset.base === name));
    forAll((i) => i.setAnimation(0, name, true));
  };
  const jump = () =>
    forAll((i) => {
      i.setAnimation(0, 'jump', false);
      i.addAnimation(0, opts.base, true, 0);
    });
  const hit = () =>
    forAll((i) => {
      i.setAnimation(2, 'hit', false);
      i.addEmptyAnimation(2, 0.15, 0);
    });
  const toggleWave = (on = !opts.waving) => {
    opts.waving = on;
    $<HTMLButtonElement>('#wave').classList.toggle('on', on);
    forAll((i) => (on ? startWave(i) : i.setEmptyAnimation(1, Math.max(opts.mix, 0.2))));
  };
  const toggleBones = (on = !opts.showBones) => {
    opts.showBones = on;
    $<HTMLInputElement>('#bones').checked = on;
  };

  document.querySelectorAll<HTMLButtonElement>('[data-base]').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base!)));
  $('#jump').addEventListener('click', jump);
  $('#hit').addEventListener('click', hit);
  $('#wave').addEventListener('click', () => toggleWave());
  const skinSel = $<HTMLSelectElement>('#skin');
  for (const s of data.skins.filter((s) => s !== 'default')) skinSel.add(new Option(s, s));
  skinSel.value = opts.skin;
  skinSel.addEventListener('change', () => {
    opts.skin = skinSel.value;
    instances.forEach((inst, i) => inst.setSkin(i % 3 === 2 ? (opts.skin === 'green' ? 'purple' : 'green') : opts.skin));
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
    update();
  };
  bindRange('mix', (v) => `${v.toFixed(2)}s`, (v) => {
    opts.mix = v;
    forAll((i) => i.setDefaultMix(v));
  });
  bindRange('speed', (v) => `${v.toFixed(2)}×`, (v) => {
    opts.speed = v;
    forAll((i) => i.setTimeScale(v));
  });
  bindRange('crowd', (v) => String(v), (v) => setCrowd(v));
  $<HTMLInputElement>('#bones').addEventListener('change', (e) => toggleBones((e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('#flip').addEventListener('change', (e) => {
    opts.flip = (e.target as HTMLInputElement).checked;
    layout();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (k === '1') setBase('idle');
    else if (k === '2') setBase('walk');
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

    const ppu = camera.zoom * dpr;
    renderer.begin(ortho(camera.x, camera.y, ppu, w, h));
    let vertices = 0;
    let core = 0;
    for (const inst of instances) {
      const t0 = performance.now();
      inst.update(dt);
      const view = inst.render();
      core += performance.now() - t0;
      vertices += view.vertices.length / 6;
      renderer.draw(view, pages);
    }
    if (opts.showBones) for (const inst of instances.slice(0, 50)) renderer.drawBones(inst.boneWorld(), data, ppu);
    coreMs = coreMs * 0.9 + core * 0.1;

    instances.forEach((inst, idx) => {
      for (const e of inst.pollEvents()) {
        if (idx === 0 && e.kind === EventKind.Event) logEvent(`${clock.toFixed(2)}s  ${e.name}${e.int ? ` #${e.int}` : ''}  (track ${e.track})`);
      }
    });

    const ground = $('#ground');
    ground.style.top = `${rect.height / 2 + camera.y * camera.zoom}px`;

    if (now - statsAt > 250) {
      statsAt = now;
      $('#stat-fps').textContent = fps.toFixed(0);
      $('#stat-core').textContent = `${coreMs.toFixed(2)} ms`;
      $('#stat-verts').textContent = vertices.toLocaleString();
      $('#stat-draws').textContent = String(renderer.drawCalls);
    }
    requestAnimationFrame(frame);
  }
  setCrowd(1);
  setBase('idle');
  requestAnimationFrame(frame);
  document.body.dataset.ready = 'true';
}

main().catch((e) => {
  console.error(e);
  $('#error').textContent = String(e);
  document.body.dataset.ready = 'error';
});
