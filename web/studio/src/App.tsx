import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SinewRuntime } from '@sinew/runtime';
import { buildDoc, cutout, DEFAULT_DENSITY, guessJoints, sourceFromCutout, sourceFromProject, sourceFromPsd, TEMPLATES, type Pt, type Source, type TemplateId } from './autorig';
import { compile, pageFile, sampleChannel, triangleCount, vertexCount, type AnimDoc, type Channel, type RigDoc } from './doc';
import { motionLibrary } from './motions';
import { Timeline } from './Timeline';
import { Viewport } from './Viewport';
import { jointsFromBoxes, requestBoxes } from './autorig/ai';
import { zip } from './zip';

type Step = 'import' | 'rig' | 'animate' | 'export';
const STEPS: { id: Step; label: string }[] = [
  { id: 'import', label: '1 · Image' },
  { id: 'rig', label: '2 · Rig' },
  { id: 'animate', label: '3 · Animate' },
  { id: 'export', label: '4 · Export' },
];

const SAMPLES = [
  { name: 'critter', url: '/samples/critter.png', thumb: '/samples/critter.png' },
  { name: 'layered PSD', url: '/samples/layered.psd', thumb: '/samples/layered-thumb.png' },
];

let runtimePromise: Promise<SinewRuntime> | null = null;
const loadRuntime = () => (runtimePromise ??= SinewRuntime.load(new URL('/sinew.wasm', location.href)));

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character';

function serialize(doc: RigDoc, pages: string[]) {
  return JSON.stringify({
    format: 'rabbit-project',
    version: 2,
    pages,
    doc: {
      ...doc,
      parts: doc.parts.map((p) => ({
        ...p,
        mesh: { ...p.mesh, points: Array.from(p.mesh.points), triangles: Array.from(p.mesh.triangles), edges: Array.from(p.mesh.edges) },
      })),
    },
  });
}

function deserializeDoc(o: { doc: RigDoc }): RigDoc {
  const d = o.doc;
  return {
    ...d,
    groups: d.groups ?? {},
    parts: d.parts.map((p) => ({
      ...p,
      mesh: {
        ...p.mesh,
        points: Float32Array.from(p.mesh.points as unknown as number[]),
        triangles: Uint32Array.from(p.mesh.triangles as unknown as number[]),
        edges: Uint32Array.from(p.mesh.edges as unknown as number[]),
      },
    })),
  };
}

const toPng = (c: HTMLCanvasElement) => new Promise<Uint8Array>((r) => c.toBlob(async (b) => r(new Uint8Array(await b!.arrayBuffer())), 'image/png'));

export function App() {
  const [rt, setRt] = useState<SinewRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('import');
  const [src, setSrc] = useState<Source | null>(null);
  const [doc, setDocState] = useState<RigDoc | null>(null);
  const [density, setDensity] = useState(DEFAULT_DENSITY);
  const [anim, setAnim] = useState<string>('idle');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [showMesh, setShowMesh] = useState(false);
  const [showBones, setShowBones] = useState(true);
  const [selectedBone, setSelectedBone] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const undo = useRef<RigDoc[]>([]);
  const redo = useRef<RigDoc[]>([]);
  const dragBase = useRef<{ doc: RigDoc; value: number } | null>(null);

  useEffect(() => {
    loadRuntime().then(setRt, (e) => setError(String(e)));
  }, []);

  const commit = useCallback((next: RigDoc, base?: RigDoc) => {
    setDocState((prev) => {
      const b = base ?? prev;
      if (b) undo.current.push(b);
      if (undo.current.length > 100) undo.current.shift();
      redo.current = [];
      return next;
    });
  }, []);

  const doUndo = () => {
    const prev = undo.current.pop();
    if (prev && doc) {
      redo.current.push(doc);
      setDocState(prev);
    }
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (next && doc) {
      undo.current.push(doc);
      setDocState(next);
    }
  };

  const current = useMemo(() => doc?.animations.find((a) => a.name === anim) ?? doc?.animations[0] ?? null, [doc, anim]);

  // ------------------------------------------------------------------ import
  async function importImage(url: string, name: string, template: TemplateId = 'humanoid') {
    setError(null);
    setBusy('Removing background and building the rig…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const img = await loadImage(url);
      const source = sourceFromCutout(name, cutout(img, img.naturalWidth, img.naturalHeight));
      const d = buildDoc(source, { template, density });
      undo.current = [];
      redo.current = [];
      setSrc(source);
      setDocState(d);
      setAnim('idle');
      setTime(0);
      setPlaying(false);
      setStep('rig');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openFile(f: File) {
    setError(null);
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith('.json')) {
        const o = JSON.parse(await f.text());
        if (o.format !== 'rabbit-project' || !o.pages) throw new Error('Not a RABBIT project file (version 2)');
        const d = deserializeDoc(o);
        const pages = await Promise.all((o.pages as string[]).map(loadImage));
        undo.current = [];
        redo.current = [];
        setSrc(sourceFromProject(d, pages));
        setDocState(d);
        setAnim(d.animations[0]?.name ?? 'idle');
        setStep('animate');
        return;
      }
      if (lower.endsWith('.psd')) {
        setBusy('Reading layers and building the rig…');
        await new Promise((r) => setTimeout(r, 30));
        const source = sourceFromPsd(f.name.replace(/\.[^.]+$/, ''), await f.arrayBuffer());
        const d = buildDoc(source, { template: 'humanoid', density });
        undo.current = [];
        redo.current = [];
        setSrc(source);
        setDocState(d);
        setAnim('idle');
        setTime(0);
        setPlaying(false);
        setStep('rig');
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    } finally {
      setBusy(null);
    }
    const url = URL.createObjectURL(f);
    await importImage(url, f.name.replace(/\.[^.]+$/, ''));
  }

  // ------------------------------------------------------------------ rig edits
  function rerig(o: { template?: TemplateId; joints?: Record<string, Pt>; groups?: Record<string, boolean>; density?: number; keepMesh?: boolean }) {
    if (!doc || !src) return;
    const template = o.template ?? doc.template;
    const sameTemplate = template === doc.template;
    const next = buildDoc({ ...src, name: doc.name }, {
      template,
      density: o.density ?? density,
      joints: o.joints ?? (sameTemplate ? doc.joints : undefined),
      groups: o.groups ?? (sameTemplate && !o.joints ? doc.groups : o.joints && sameTemplate ? doc.groups : undefined),
      meshes: o.keepMesh ? doc.parts.map((p) => p.mesh) : undefined,
      animations: sameTemplate ? doc.animations : motionLibrary(template),
    });
    commit(next);
    if (!sameTemplate) setAnim(next.animations[0]?.name ?? 'idle');
  }

  // ------------------------------------------------------------------ animation edits
  function updateAnim(fn: (a: AnimDoc) => AnimDoc, base?: RigDoc, record = true) {
    if (!doc || !current) return;
    const next = { ...doc, animations: doc.animations.map((a) => (a.name === current.name ? fn(a) : a)) };
    if (record) commit(next, base);
    else setDocState(next);
  }

  function rotationAt(a: AnimDoc, bone: string, t: number) {
    const ch = a.channels.find((c) => c.target === bone && c.prop === 'rotate');
    return ch ? sampleChannel(ch, t, [0])[0] : 0;
  }

  function onRotate(bone: string, delta: number, done: boolean) {
    if (!doc || !current) return;
    if (!dragBase.current) dragBase.current = { doc, value: rotationAt(current, bone, time) };
    const { doc: baseDoc, value } = dragBase.current;
    const v = Math.round((value + delta) * 10) / 10;
    const baseAnim = baseDoc.animations.find((a) => a.name === current.name)!;
    const t = Math.round(time * 1000) / 1000;
    const nextAnim = setKey(baseAnim, bone, 'rotate', t, [v]);
    const next = { ...baseDoc, animations: baseDoc.animations.map((a) => (a.name === current.name ? nextAnim : a)) };
    if (done) {
      commit(next, baseDoc);
      dragBase.current = null;
    } else setDocState(next);
  }

  function setKey(a: AnimDoc, target: string, prop: Channel['prop'], t: number, v: number[]): AnimDoc {
    const channels = [...a.channels];
    let ci = channels.findIndex((c) => c.target === target && c.prop === prop);
    if (ci < 0) {
      channels.push({ target, prop, keys: [] });
      ci = channels.length - 1;
    }
    const keys = channels[ci].keys.filter((k) => Math.abs(k.t - t) > 1e-3);
    keys.push({ t, v, ease: 'smooth' });
    keys.sort((p, q) => p.t - q.t);
    channels[ci] = { ...channels[ci], keys: keys.map((k, i) => ({ ...k, ease: i === keys.length - 1 ? undefined : k.ease ?? 'smooth' })) };
    return { ...a, channels };
  }

  // ------------------------------------------------------------------ export
  async function exportSpine() {
    if (!doc || !src) return;
    const name = slug(doc.name);
    const { json, atlas } = compile(doc, name);
    const pngs = await Promise.all(src.pages.map(toPng));
    const readme = `RABBIT export — ${doc.name}\n\nSpine 4.2 JSON skeleton + atlas + texture pages (straight alpha).\n\n- RABBIT runtime: loadSpine(json, atlas)\n- Spine runtimes 4.2 / Spine editor: Import Data → ${name}.json\n\nParts: ${doc.parts.length}\nAnimations: ${doc.animations.map((a) => a.name).join(', ')}\n`;
    download(
      zip([
        { name: `${name}/${name}.json`, data: JSON.stringify(json, null, 1) },
        { name: `${name}/${name}.atlas`, data: atlas },
        ...pngs.map((data, i) => ({ name: `${name}/${pageFile(name, i)}`, data })),
        { name: `${name}/${name}.rabbit.json`, data: serialize(doc, src.pages.map((c) => c.toDataURL('image/png'))) },
        { name: `${name}/README.txt`, data: readme },
      ]),
      `${name}.zip`,
    );
  }

  // ------------------------------------------------------------------ keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (e.key === ' ' && doc && step !== 'import') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedRotation = current && selectedBone ? rotationAt(current, selectedBone, time) : null;
  const missing = doc ? motionLibrary(doc.template).filter((m) => !doc.animations.some((a) => a.name === m.name)) : [];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          RABBIT <span>Studio</span>
        </div>
        <nav className="steps">
          {STEPS.map((s) => (
            <button key={s.id} className={step === s.id ? 'on' : ''} disabled={s.id !== 'import' && !doc} onClick={() => {
              setStep(s.id);
              if (s.id === 'rig') setPlaying(false);
            }}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button onClick={doUndo} disabled={!undo.current.length} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={doRedo} disabled={!redo.current.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button className="primary" disabled={!doc} onClick={exportSpine}>Export</button>
        </div>
      </header>

      <main className={`work ${step === 'animate' ? 'with-timeline' : ''}`}>
        <section className="stage">
          {rt && doc && src && step !== 'import' ? (
            <Viewport
              rt={rt}
              doc={doc}
              pages={src.pages}
              mode={step === 'rig' ? 'rig' : 'animate'}
              anim={current?.name ?? null}
              playing={playing}
              time={time}
              speed={speed}
              showMesh={showMesh}
              showBones={showBones && step === 'animate'}
              selectedBone={selectedBone}
              onTime={setTime}
              onSelectBone={setSelectedBone}
              onJoints={(j, done) => done && rerig({ joints: j, keepMesh: true })}
              onRotate={onRotate}
            />
          ) : (
            <div
              className={`drop ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) openFile(f);
              }}
            >
              <div className="drop-inner">
                <h2>Drop a character image</h2>
                <p>One full-body character on a plain or transparent background (PNG / JPG / WebP), a layered PSD for best results, or a .rabbit.json project.</p>
                <label className="button primary">
                  Choose file
                  <input type="file" accept="image/*,.psd,.json" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
                </label>
                <div className="samples">
                  {SAMPLES.map((s) => (
                    <button key={s.name} onClick={async () => {
                      if (s.url.endsWith('.psd')) {
                        const buf = await (await fetch(s.url)).arrayBuffer();
                        await openFile(new File([buf], s.url.split('/').pop()!));
                      } else await importImage(s.url, s.name);
                    }}>
                      <img src={s.thumb} alt="" />
                      Try “{s.name}”
                    </button>
                  ))}
                </div>
                {busy && <p className="busy">{busy}</p>}
              </div>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          {!rt && !error && <div className="busy-overlay">Loading core…</div>}
        </section>

        <aside className="panel">
          {step === 'import' && (
            <>
              <h3>How it works</h3>
              <ol className="howto">
                <li>The background is removed and a mesh is fitted to the silhouette. With a layered PSD, every layer gets its own mesh.</li>
                <li>A skeleton template is placed on the character — drag joints to fix it.</li>
                <li>Weights are computed automatically; pick motions from the library.</li>
                <li>Tweak poses on the timeline and export to Spine 4.2 / RABBIT runtimes.</li>
              </ol>
            </>
          )}

          {step === 'rig' && doc && (
            <>
              <h3>Skeleton</h3>
              <label className="field">
                Template
                <select value={doc.template} onChange={(e) => rerig({ template: e.target.value as TemplateId, joints: undefined })}>
                  {Object.values(TEMPLATES).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">Drag the dots onto the character's joints. Characters should face right.</p>
              <div className="row">
                <button onClick={() => {
                  if (!src) return;
                  const g = guessJoints(src, doc.template);
                  rerig({ joints: g.joints, groups: g.groups, keepMesh: true });
                }}>Re-guess joints</button>
                <button disabled={!!busy || doc.template !== 'humanoid'} title="Vision model finds head, torso and limbs" onClick={async () => {
                  if (!src) return;
                  setError(null);
                  setBusy('Asking the vision model…');
                  try {
                    const boxes = await requestBoxes(src, doc.template);
                    const hint = jointsFromBoxes(src, doc.template, boxes, doc.joints);
                    if (!hint) throw new Error('The model did not recognise enough body parts');
                    rerig({ joints: hint.joints, groups: { ...doc.groups, tail: hint.tail || !!doc.groups?.tail }, keepMesh: true });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(null);
                  }
                }}>AI joints</button>
              </div>
              {busy && <p className="busy">{busy}</p>}
              {TEMPLATES[doc.template].groups?.map((g) => (
                <label key={g.id} className="check">
                  <input type="checkbox" checked={!!doc.groups?.[g.id]} onChange={(e) => rerig({ groups: { ...doc.groups, [g.id]: e.target.checked }, keepMesh: true })} /> {g.label}
                </label>
              ))}
              <label className="check">
                <input type="checkbox" checked={doc.physics !== false} onChange={(e) => commit({ ...doc, physics: e.target.checked })} /> Physics on tail / hair / cloth
                {doc.bones.some((b) => b.physics) ? '' : ' (none found)'}
              </label>
              <h3>Mesh</h3>
              <label className="field">
                Density <output>{density}</output>
                <input type="range" min={12} max={60} value={density} onChange={(e) => setDensity(Number(e.target.value))} onPointerUp={() => rerig({ density })} onKeyUp={() => rerig({ density })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={showMesh} onChange={(e) => setShowMesh(e.target.checked)} /> Show mesh
              </label>
              <p className="stat">
                {doc.parts.length > 1 ? `${doc.parts.length} layers · ` : ''}{vertexCount(doc)} vertices · {triangleCount(doc)} triangles · {doc.bones.length} bones
              </p>
              <h3>Test</h3>
              <div className="row wrap">
                {doc.animations.slice(0, 4).map((a) => (
                  <button key={a.name} className={playing && current?.name === a.name ? 'on' : ''} onClick={() => {
                    setAnim(a.name);
                    setPlaying(!(playing && current?.name === a.name));
                  }}>
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="row next">
                <button className="primary" onClick={() => setStep('animate')}>Next: animate →</button>
              </div>
            </>
          )}

          {step === 'animate' && doc && current && (
            <>
              <h3>Animations</h3>
              <ul className="anim-list">
                {doc.animations.map((a) => (
                  <li key={a.name} className={a.name === current.name ? 'on' : ''} onClick={() => {
                    setAnim(a.name);
                    setTime(0);
                  }}>
                    <span>{a.name}</span>
                    <small>
                      {a.duration.toFixed(1)}s{a.loop ? ' · loop' : ''}
                    </small>
                  </li>
                ))}
              </ul>
              <div className="row wrap">
                <button onClick={() => {
                  const lib = motionLibrary(doc.template).find((m) => m.name === current.name);
                  if (lib) updateAnim(() => lib);
                }}>Reset</button>
                <button onClick={() => {
                  const name = prompt('Name for the copy', `${current.name}_2`);
                  if (name && !doc.animations.some((a) => a.name === name)) commit({ ...doc, animations: [...doc.animations, { ...current, name }] });
                }}>Duplicate</button>
                <button disabled={doc.animations.length <= 1} onClick={() => {
                  commit({ ...doc, animations: doc.animations.filter((a) => a.name !== current.name) });
                  setAnim(doc.animations.find((a) => a.name !== current.name)!.name);
                }}>Delete</button>
                {missing.length > 0 && (
                  <select value="" onChange={(e) => {
                    const m = missing.find((x) => x.name === e.target.value);
                    if (m) {
                      commit({ ...doc, animations: [...doc.animations, m] });
                      setAnim(m.name);
                    }
                  }}>
                    <option value="">+ From library…</option>
                    {missing.map((m) => (
                      <option key={m.name}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <h3>Playback</h3>
              <label className="field">
                Speed <output>{speed.toFixed(2)}×</output>
                <input type="range" min={0.1} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
              </label>
              <label className="check">
                <input type="checkbox" checked={showBones} onChange={(e) => setShowBones(e.target.checked)} /> Show bones
              </label>
              <label className="check">
                <input type="checkbox" checked={showMesh} onChange={(e) => setShowMesh(e.target.checked)} /> Show mesh
              </label>
              <h3>Bone</h3>
              {selectedBone ? (
                <>
                  <p className="stat">{selectedBone}</p>
                  <label className="field">
                    Rotation at {time.toFixed(2)}s
                    <input type="number" step={1} value={selectedRotation?.toFixed(1) ?? 0} onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) updateAnim((a) => setKey(a, selectedBone, 'rotate', Math.round(time * 1000) / 1000, [v]));
                    }} />
                  </label>
                </>
              ) : (
                <p className="hint">Click a bone in the view. Pause, then drag it to rotate — a key is set at the playhead.</p>
              )}
            </>
          )}

          {step === 'export' && doc && (
            <>
              <h3>Export</h3>
              <label className="field">
                Name
                <input value={doc.name} onChange={(e) => setDocState({ ...doc, name: e.target.value })} />
              </label>
              <button className="primary wide" onClick={exportSpine}>Download .zip</button>
              <p className="hint">
                Contains a Spine 4.2 JSON skeleton, atlas and texture (works with the RABBIT runtime and Spine 4.2 runtimes / editor import), plus a <code>.rabbit.json</code> project you can reopen here.
              </p>
              <h3>Contents</h3>
              <p className="stat">
                {doc.bones.length} bones · {doc.parts.length} weighted mesh{doc.parts.length > 1 ? 'es' : ''} ({vertexCount(doc)} vertices) · {doc.animations.length} animations
              </p>
              <ul className="plain">
                {doc.animations.map((a) => (
                  <li key={a.name}>
                    {a.name} — {a.duration.toFixed(2)}s{a.loop ? ', loop' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        {step === 'animate' && doc && current && (
          <Timeline
            anim={current}
            time={time}
            playing={playing}
            selectedBone={selectedBone}
            onSeek={(t) => {
              setPlaying(false);
              setTime(t);
            }}
            onTogglePlay={() => setPlaying((p) => !p)}
            onSelectBone={setSelectedBone}
            onDeleteKey={(ci, ki) =>
              updateAnim((a) => ({
                ...a,
                channels: a.channels.map((c, i) => (i === ci ? { ...c, keys: c.keys.filter((_, j) => j !== ki) } : c)).filter((c) => c.keys.length > 0),
              }))
            }
            onDuration={(d) => updateAnim((a) => ({ ...a, duration: d }))}
            onLoop={(loop) => updateAnim((a) => ({ ...a, loop }))}
          />
        )}
      </main>
    </div>
  );
}
