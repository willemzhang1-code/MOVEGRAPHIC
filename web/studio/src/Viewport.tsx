import { useEffect, useMemo, useRef } from 'react';
import { SinewRenderer, ortho, type SinewRuntime, type SinewTexture, type SkeletonData, type SkeletonInstance } from '@sinew/runtime';
import { compile, type RigDoc } from './doc';
import { TEMPLATES, type Pt } from './autorig';
import { toWorld } from './autorig/rig';

export type ViewMode = 'rig' | 'animate';

interface Props {
  rt: SinewRuntime;
  doc: RigDoc;
  pages: HTMLCanvasElement[];
  mode: ViewMode;
  anim: string | null;
  playing: boolean;
  time: number;
  speed: number;
  showMesh: boolean;
  showBones: boolean;
  selectedBone: string | null;
  onTime(t: number): void;
  onSelectBone(name: string | null): void;
  /** Rig mode: joint positions edited (commit = drag finished). */
  onJoints(joints: Record<string, Pt>, commit: boolean): void;
  /** Animate mode: rotate a bone by `delta` degrees from the drag start. */
  onRotate(bone: string, delta: number, commit: boolean): void;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function Viewport(p: Props) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const props = useRef(p);
  props.current = p;
  const state = useRef({
    renderer: null as SinewRenderer | null,
    textures: [] as SinewTexture[],
    textureSources: [] as HTMLCanvasElement[],
    data: null as SkeletonData | null,
    inst: null as SkeletonInstance | null,
    anim: null as string | null,
    camera: { x: 0, y: 0, zoom: 1 } as Camera,
    joints: null as Record<string, Pt> | null,
    drag: null as null | { kind: 'joint'; name: string } | { kind: 'bone'; bone: string; start: number },
    hoverJoint: null as string | null,
    lastTimeReport: 0,
  });

  const compiled = useMemo(() => {
    const { json, atlas } = compile(p.doc);
    return { json: JSON.stringify(json), atlas };
  }, [p.doc]);

  // GL setup.
  useEffect(() => {
    const gl = glRef.current!.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) return;
    state.current.renderer = new SinewRenderer(gl);
  }, []);

  // Textures.
  useEffect(() => {
    const s = state.current;
    if (!s.renderer || (s.textureSources.length === p.pages.length && s.textureSources.every((c, i) => c === p.pages[i]))) return;
    for (const t of s.textures) s.renderer.deleteTexture(t);
    s.textures = p.pages.map((c) => s.renderer!.createTexture(c, false));
    s.textureSources = p.pages;
  }, [p.pages]);

  // Skeleton data from the compiled document.
  useEffect(() => {
    const s = state.current;
    const data = p.rt.loadSpine(compiled.json, compiled.atlas);
    const inst = data.createInstance();
    s.inst?.dispose();
    s.data?.dispose();
    s.data = data;
    s.inst = inst;
    s.anim = null;
    syncAnimation(true);
    s.joints = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled]);

  function syncAnimation(force = false) {
    const s = state.current;
    const { anim, mode, playing, time } = props.current;
    if (!s.inst) return;
    const want = mode === 'animate' || playing ? anim : null;
    if (force || want !== s.anim) {
      s.anim = want;
      if (want) {
        const a = props.current.doc.animations.find((x) => x.name === want);
        s.inst.setAnimation(0, want, a?.loop ?? true);
        s.inst.seek(0, time);
      } else s.inst.clearTrack(0);
      s.inst.update(0);
    }
    if (!playing && want) {
      s.inst.seek(0, time);
      s.inst.update(0);
    }
  }

  useEffect(() => syncAnimation(), [p.anim, p.mode, p.playing, p.time]);

  // Camera fit.
  function fit() {
    const s = state.current;
    const el = glRef.current!;
    const { doc, mode } = props.current;
    const g = doc.joints.ground;
    const W = doc.image.width;
    const H = doc.image.height;
    const minX = -g.x;
    const maxX = W - g.x;
    const minY = g.y - H;
    const maxY = g.y + (mode === 'animate' ? H * 0.35 : 0);
    const r = el.getBoundingClientRect();
    const zoom = Math.min(r.width / ((maxX - minX) * 1.15), r.height / ((maxY - minY) * 1.12));
    s.camera = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom };
  }
  useEffect(fit, [p.doc.image, p.mode]);

  const toScreen = (wx: number, wy: number): [number, number] => {
    const c = state.current.camera;
    const r = overlayRef.current!.getBoundingClientRect();
    return [(wx - c.x) * c.zoom + r.width / 2, r.height / 2 - (wy - c.y) * c.zoom];
  };
  const toWorldPt = (sx: number, sy: number): Pt => {
    const c = state.current.camera;
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: (sx - r.width / 2) / c.zoom + c.x, y: (r.height / 2 - sy) / c.zoom + c.y };
  };

  // Render loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(dt, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(fit);
    ro.observe(glRef.current!);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(dt: number, now: number) {
    const s = state.current;
    const pr = props.current;
    const gl = glRef.current!;
    const ov = overlayRef.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = gl.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (gl.width !== w || gl.height !== h) {
      gl.width = ov.width = w;
      gl.height = ov.height = h;
      fit();
    }
    const r = s.renderer;
    const ctx = gl.getContext('webgl2')!;
    ctx.viewport(0, 0, w, h);
    ctx.clearColor(0, 0, 0, 0);
    ctx.clear(ctx.COLOR_BUFFER_BIT);
    if (!r || !s.inst || !s.textures.length) return;

    if (pr.playing && s.anim) {
      s.inst.update(dt * pr.speed);
      const t = s.inst.trackTime(0);
      if (now - s.lastTimeReport > 50) {
        s.lastTimeReport = now;
        const a = pr.doc.animations.find((x) => x.name === s.anim);
        pr.onTime(a && a.duration > 0 ? (a.loop ? t % a.duration : Math.min(t, a.duration)) : t);
      }
    }
    const cam = s.camera;
    r.begin(ortho(cam.x, cam.y, cam.zoom * dpr, w, h));
    const view = s.inst.render();
    const verts = view.vertices.slice();
    const idx = view.indices.slice();
    r.draw(view, s.textures);
    const bones = s.inst.boneWorld().slice();

    // Overlay.
    const g = ov.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);
    const accent = css('--accent') || '#2f7d4f';
    const boneColor = css('--bone') || '#ff8a3d';
    if (pr.showMesh) {
      g.strokeStyle = 'rgba(80,140,255,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < idx.length; i += 3) {
        const a = toScreen(verts[idx[i] * 6], verts[idx[i] * 6 + 1]);
        const b = toScreen(verts[idx[i + 1] * 6], verts[idx[i + 1] * 6 + 1]);
        const c = toScreen(verts[idx[i + 2] * 6], verts[idx[i + 2] * 6 + 1]);
        g.moveTo(...a);
        g.lineTo(...b);
        g.lineTo(...c);
        g.closePath();
      }
      g.stroke();
    }
    if (pr.mode === 'rig') drawRig(g, accent, boneColor);
    else if (pr.showBones) drawPosedBones(g, bones, boneColor, accent);
  }

  function drawBoneShape(g: CanvasRenderingContext2D, a: [number, number], b: [number, number], color: string, width: number) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = (-dy / len) * width;
    const ny = (dx / len) * width;
    const m: [number, number] = [a[0] + dx * 0.18, a[1] + dy * 0.18];
    g.beginPath();
    g.moveTo(...a);
    g.lineTo(m[0] + nx, m[1] + ny);
    g.lineTo(...b);
    g.lineTo(m[0] - nx, m[1] - ny);
    g.closePath();
    g.fillStyle = color;
    g.globalAlpha = 0.55;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1;
    g.stroke();
  }

  function drawRig(g: CanvasRenderingContext2D, accent: string, boneColor: string) {
    const s = state.current;
    const { doc } = props.current;
    const joints = s.joints ?? doc.joints;
    const t = TEMPLATES[doc.template];
    const ground = joints.ground;
    const hidden = new Set((t.groups ?? []).filter((g) => !doc.groups?.[g.id]).flatMap((g) => g.joints));
    for (const b of t.bones) {
      if (!b.to || (b.group && !doc.groups?.[b.group])) continue;
      const a = toWorld(joints[b.from], ground);
      const e = toWorld(joints[b.to], ground);
      drawBoneShape(g, toScreen(a.x, a.y), toScreen(e.x, e.y), boneColor, 5);
    }
    for (const name of t.joints) {
      if (hidden.has(name)) continue;
      const pt = toWorld(joints[name], ground);
      const [x, y] = toScreen(pt.x, pt.y);
      const active = s.hoverJoint === name || (s.drag?.kind === 'joint' && s.drag.name === name);
      g.beginPath();
      g.arc(x, y, active ? 7 : 5, 0, Math.PI * 2);
      g.fillStyle = name === 'ground' ? '#888' : accent;
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.stroke();
      if (active) {
        g.font = '12px ui-sans-serif, system-ui';
        g.fillStyle = css('--text') || '#111';
        g.fillText(name.replace('_', ' '), x + 10, y - 8);
      }
    }
  }

  function boneSegments(bones: Float32Array) {
    const { doc } = props.current;
    return doc.bones.map((b, i) => {
      const o = i * 7;
      const len = Math.max(b.length, 12);
      const a = toScreen(bones[o + 4], bones[o + 5]);
      const e = toScreen(bones[o + 4] + bones[o] * len, bones[o + 5] + bones[o + 2] * len);
      return { name: b.name, a, e, skin: b.skin };
    });
  }

  function drawPosedBones(g: CanvasRenderingContext2D, bones: Float32Array, boneColor: string, accent: string) {
    const sel = props.current.selectedBone;
    for (const seg of boneSegments(bones)) {
      drawBoneShape(g, seg.a, seg.e, seg.name === sel ? accent : boneColor, seg.name === sel ? 7 : 5);
    }
    if (sel) {
      const seg = boneSegments(bones).find((x) => x.name === sel);
      if (seg) {
        g.beginPath();
        g.arc(seg.a[0], seg.a[1], Math.hypot(seg.e[0] - seg.a[0], seg.e[1] - seg.a[1]), 0, Math.PI * 2);
        g.setLineDash([4, 4]);
        g.strokeStyle = accent;
        g.lineWidth = 1.5;
        g.stroke();
        g.setLineDash([]);
      }
    }
  }

  // ---------------------------------------------------------------- input
  function local(e: React.PointerEvent): [number, number] {
    const r = overlayRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function nearestJoint(sx: number, sy: number): string | null {
    const { doc } = props.current;
    const joints = state.current.joints ?? doc.joints;
    let best: string | null = null;
    let bd = 12;
    const t = TEMPLATES[doc.template];
    const hidden = new Set((t.groups ?? []).filter((g) => !doc.groups?.[g.id]).flatMap((g) => g.joints));
    for (const name of t.joints) {
      if (hidden.has(name)) continue;
      const pt = toWorld(joints[name], joints.ground);
      const [x, y] = toScreen(pt.x, pt.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bd) {
        bd = d;
        best = name;
      }
    }
    return best;
  }

  function nearestBone(sx: number, sy: number): string | null {
    const s = state.current;
    if (!s.inst) return null;
    let best: string | null = null;
    let bd = 10;
    for (const seg of boneSegments(s.inst.boneWorld().slice())) {
      const [ax, ay] = seg.a;
      const [bx, by] = seg.e;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / l2));
      const d = Math.hypot(sx - (ax + dx * t), sy - (ay + dy * t));
      if (d < bd) {
        bd = d;
        best = seg.name;
      }
    }
    return best;
  }

  function angleAt(bone: string, sx: number, sy: number): number {
    const s = state.current;
    const i = props.current.doc.bones.findIndex((b) => b.name === bone);
    const w = s.inst!.boneWorld();
    const [ox, oy] = toScreen(w[i * 7 + 4], w[i * 7 + 5]);
    return (Math.atan2(-(sy - oy), sx - ox) * 180) / Math.PI;
  }

  function onDown(e: React.PointerEvent) {
    const [sx, sy] = local(e);
    const s = state.current;
    const pr = props.current;
    if (pr.mode === 'rig') {
      const j = nearestJoint(sx, sy);
      if (j) {
        s.drag = { kind: 'joint', name: j };
        s.joints = { ...pr.doc.joints };
        (e.target as Element).setPointerCapture(e.pointerId);
      }
      return;
    }
    const bone = nearestBone(sx, sy) ?? (pr.selectedBone && e.shiftKey ? pr.selectedBone : null);
    pr.onSelectBone(bone);
    if (bone && !pr.playing) {
      s.drag = { kind: 'bone', bone, start: angleAt(bone, sx, sy) };
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  }

  function onMove(e: React.PointerEvent) {
    const [sx, sy] = local(e);
    const s = state.current;
    const pr = props.current;
    if (!s.drag) {
      if (pr.mode === 'rig') s.hoverJoint = nearestJoint(sx, sy);
      overlayRef.current!.style.cursor = pr.mode === 'rig' ? (s.hoverJoint ? 'grab' : 'default') : nearestBone(sx, sy) ? 'pointer' : 'default';
      return;
    }
    if (s.drag.kind === 'joint') {
      const w = toWorldPt(sx, sy);
      const ground = pr.doc.joints.ground;
      const img = { x: w.x + ground.x, y: ground.y - w.y };
      s.joints = { ...s.joints!, [s.drag.name]: img };
      if (s.drag.name === 'ground') s.joints.ground = img;
      pr.onJoints(s.joints, false);
    } else {
      let d = angleAt(s.drag.bone, sx, sy) - s.drag.start;
      d = ((((d + 180) % 360) + 360) % 360) - 180;
      pr.onRotate(s.drag.bone, d, false);
    }
  }

  function onUp(e: React.PointerEvent) {
    const s = state.current;
    const pr = props.current;
    if (!s.drag) return;
    if (s.drag.kind === 'joint') pr.onJoints(s.joints!, true);
    else {
      const [sx, sy] = local(e);
      let d = angleAt(s.drag.bone, sx, sy) - s.drag.start;
      d = ((((d + 180) % 360) + 360) % 360) - 180;
      pr.onRotate(s.drag.bone, d, true);
    }
    s.drag = null;
  }

  return (
    <div className="viewport">
      <canvas ref={glRef} className="layer" />
      <canvas ref={overlayRef} className="layer" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
    </div>
  );
}
