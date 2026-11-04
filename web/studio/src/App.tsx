import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SinewRuntime } from '@sinew/runtime';
import { buildDoc, cutout, DEFAULT_DENSITY, TEMPLATES, type Cutout, type Pt, type TemplateId } from './autorig';
import { compile, sampleChannel, type AnimDoc, type Channel, type RigDoc } from './doc';
import { motionLibrary } from './motions';
import { Timeline } from './Timeline';
import { Viewport } from './Viewport';
import { zip } from './zip';

type Step = 'import' | 'rig' | 'animate' | 'export';
const STEPS: { id: Step; label: string }[] = [
  { id: 'import', label: '1 · Image' },
  { id: 'rig', label: '2 · Rig' },
  { id: 'animate', label: '3 · Animate' },
  { id: 'export', label: '4 · Export' },
];

const SAMPLES = [{ name: 'critter', url: '/samples/critter.png', template: 'humanoid' as TemplateId }];

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

function serialize(doc: RigDoc, image: string) {
  return JSON.stringify({
    format: 'rabbit-project',
    version: 1,
    image,
    doc: { ...doc, mesh: { ...doc.mesh, points: Array.from(doc.mesh.points), triangles: Array.from(doc.mesh.triangles), edges: Array.from(doc.mesh.edges) } },
  });
}

function deserializeDoc(o: { doc: RigDoc }): RigDoc {
  const d = o.doc;
  return {
    ...d,
    groups: d.groups ?? {},
    mesh: {
      ...d.mesh,
      points: Float32Array.from(d.mesh.points as unknown as number[]),
      triangles: Uint32Array.from(d.mesh.triangles as unknown as number[]),
      edges: Uint32Array.from(d.mesh.edges as unknown as number[]),
    },
  };
}

export function App() {
  const [rt, setRt] = useState<SinewRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('import');
  const [cut, setCut] = useState<Cutout | null>(null);
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
  async function importImage(src: string, name: string, template: TemplateId = 'humanoid') {
    setError(null);
    setBusy('Removing background and building the rig…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const img = await loadImage(src);
      const c = cutout(img, img.naturalWidth, img.naturalHeight);
      const d = buildDoc(name, c, { template, density });
      undo.current = [];
      redo.current = [];
      setCut(c);
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
    if (f.name.endsWith('.json')) {
      try {
        const o = JSON.parse(await f.text());
        if (o.format !== 'rabbit-project') throw new Error('Not a RABBIT project file');
        const img = await loadImage(o.image);
        const c = cutout(img, img.naturalWidth, img.naturalHeight);
        const d = deserializeDoc(o);
        undo.current = [];
        setCut(c);
        setDocState(d);
        setAnim(d.animations[0]?.name ?? 'idle');
        setStep('animate');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    const url = URL.createObjectURL(f);
    await importImage(url, f.name.replace(/\.[^.]+$/, ''));
  }

  // ------------------------------------------------------------------ rig edits
  function rerig(o: { template?: TemplateId; joints?: Record<string, Pt>; groups?: Record<string, boolean>; density?: number; keepMesh?: boolean }) {
    if (!doc || !cut) return;
    const template = o.template ?? doc.template;
    const sameTemplate = template === doc.template;
    const next = buildDoc(doc.name, cut, {
      template,
      density: o.density ?? density,
      joints: o.joints ?? (sameTemplate ? doc.joints : undefined),
      groups: o.groups ?? (sameTemplate && !o.joints ? doc.groups : o.joints && sameTemplate ? doc.groups : undefined),
      mesh: o.keepMesh ? doc.mesh : undefined,
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
    if (!doc || !cut) return;
    const name = slug(doc.name);
    const { json, atlas } = compile(doc, `${name}.png`);
    const png = new Uint8Array(await (await new Promise<Blob>((r) => cut.canvas.toBlob((b) => r(b!), 'image/png'))).arrayBuffer());
    const readme = `RABBIT export — ${doc.name}\n\nSpine 4.2 JSON skeleton + atlas + texture (straight alpha).\n\n- RABBIT runtime: loadSpine(json, atlas)\n- Spine runtimes 4.2 / Spine editor: Import Data → ${name}.json\n\nAnimations: ${doc.animations.map((a) => a.name).join(', ')}\n`;
    download(
      zip([
        { name: `${name}/${name}.json`, data: JSON.stringify(json, null, 1) },
        { name: `${name}/${name}.atlas`, data: atlas },
        { name: `${name}/${name}.png`, data: png },
        { name: `${name}/${name}.rabbit.json`, data: serialize(doc, cut.canvas.toDataURL('image/png')) },
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
          {rt && doc && cut && step !== 'import' ? (
            <Viewport
              rt={rt}
              doc={doc}
              texture={cut.canvas}
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
                <p>One full-body character on a plain or transparent background. PNG / JPG / WebP, or a .rabbit.json project.</p>
                <label className="button primary">
                  Choose file
                  <input type="file" accept="image/*,.json" hidden onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} />
                </label>
                <div className="samples">
                  {SAMPLES.map((s) => (
                    <button key={s.name} onClick={() => importImage(s.url, s.name, s.template)}>
                      <img src={s.url} alt="" />
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
                <li>The background is removed and a mesh is fitted to the silhouette.</li>
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
                  if (!cut) return;
                  const g = TEMPLATES[doc.template].guess(cut.mask, cut.width, cut.height);
                  rerig({ joints: g.joints, groups: g.groups, keepMesh: true });
                }}>Re-guess joints</button>
              </div>
              {TEMPLATES[doc.template].groups?.map((g) => (
                <label key={g.id} className="check">
                  <input type="checkbox" checked={!!doc.groups?.[g.id]} onChange={(e) => rerig({ groups: { ...doc.groups, [g.id]: e.target.checked }, keepMesh: true })} /> {g.label}
                </label>
              ))}
              <h3>Mesh</h3>
              <label className="field">
                Density <output>{density}</output>
                <input type="range" min={12} max={60} value={density} onChange={(e) => setDensity(Number(e.target.value))} onPointerUp={() => rerig({ density })} onKeyUp={() => rerig({ density })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={showMesh} onChange={(e) => setShowMesh(e.target.checked)} /> Show mesh
              </label>
              <p className="stat">
                {doc.mesh.points.length / 2} vertices · {doc.mesh.triangles.length / 3} triangles · {doc.bones.length} bones
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
                {doc.bones.length} bones · 1 weighted mesh ({doc.mesh.points.length / 2} vertices) · {doc.animations.length} animations
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
