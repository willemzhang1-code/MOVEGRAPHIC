// Thin wrapper over the Sinew C ABI compiled to WebAssembly.
// Buffers are read straight out of linear memory (no copies on the JS side).

interface Exports {
  memory: WebAssembly.Memory;
  sinew_alloc(len: number): number;
  sinew_free(ptr: number, len: number): void;
  sinew_last_error(outLen: number): number;
  sinew_version(): number;
  sinew_data_load_spine(json: number, jsonLen: number, atlas: number, atlasLen: number): number;
  sinew_data_free(d: number): void;
  sinew_data_count(d: number, kind: number): number;
  sinew_data_name(d: number, kind: number, index: number, outLen: number): number;
  sinew_data_bone_parent(d: number, index: number): number;
  sinew_data_bone_length(d: number, index: number): number;
  sinew_data_animation_duration(d: number, index: number): number;
  sinew_data_page_pma(d: number, index: number): number;
  sinew_instance_new(d: number): number;
  sinew_instance_free(i: number): void;
  sinew_instance_set_transform(i: number, x: number, y: number, sx: number, sy: number): void;
  sinew_instance_set_color(i: number, r: number, g: number, b: number, a: number): void;
  sinew_instance_set_skin(i: number, name: number, len: number): number;
  sinew_instance_set_animation(i: number, track: number, name: number, len: number, loop: number): number;
  sinew_instance_add_animation(i: number, track: number, name: number, len: number, loop: number, delay: number): number;
  sinew_instance_set_empty_animation(i: number, track: number, mix: number): number;
  sinew_instance_add_empty_animation(i: number, track: number, mix: number, delay: number): number;
  sinew_instance_clear_track(i: number, track: number): void;
  sinew_instance_set_default_mix(i: number, duration: number): void;
  sinew_instance_set_mix(i: number, from: number, fromLen: number, to: number, toLen: number, duration: number): number;
  sinew_instance_set_track_alpha(i: number, track: number, alpha: number): void;
  sinew_instance_set_track_additive(i: number, track: number, additive: number): void;
  sinew_instance_set_time_scale(i: number, scale: number): void;
  sinew_instance_update(i: number, dt: number): void;
  sinew_instance_render(i: number): number;
  sinew_instance_vertices(i: number, outLen: number): number;
  sinew_instance_indices(i: number, outLen: number): number;
  sinew_instance_batches(i: number, outLen: number): number;
  sinew_instance_bone_world(i: number, outLen: number): number;
  sinew_instance_poll_events(i: number, outLen: number): number;
}

enum Kind {
  Bones = 0,
  Slots = 1,
  Skins = 2,
  Animations = 3,
  Events = 4,
  Pages = 5,
  Warnings = 6,
}

export const VERTEX_BYTES = 24;
export enum BlendMode {
  Normal = 0,
  Additive = 1,
  Multiply = 2,
  Screen = 3,
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SinewRuntime {
  private readonly out: number;

  private constructor(readonly x: Exports) {
    this.out = x.sinew_alloc(8);
  }

  static async load(source: string | URL | BufferSource): Promise<SinewRuntime> {
    let bytes: BufferSource;
    if (typeof source === 'string' || source instanceof URL) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`failed to fetch ${source}: ${res.status}`);
      bytes = await res.arrayBuffer();
    } else {
      bytes = source;
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new SinewRuntime(instance.exports as unknown as Exports);
  }

  get version(): string {
    const v = this.x.sinew_version();
    return `${v >> 16}.${(v >> 8) & 0xff}.${v & 0xff}`;
  }

  /** Length written by the last call that took an out-length pointer. */
  outLen(): number {
    return new Uint32Array(this.x.memory.buffer, this.out, 1)[0];
  }

  get outPtr(): number {
    return this.out;
  }

  readString(ptr: number, len: number): string {
    return decoder.decode(new Uint8Array(this.x.memory.buffer, ptr, len));
  }

  /** Copies a string (or bytes) into wasm memory for the duration of `fn`. */
  withBytes<T>(value: string | Uint8Array, fn: (ptr: number, len: number) => T): T {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    const len = bytes.length;
    const ptr = this.x.sinew_alloc(len);
    new Uint8Array(this.x.memory.buffer, ptr, len).set(bytes);
    try {
      return fn(ptr, len);
    } finally {
      this.x.sinew_free(ptr, len);
    }
  }

  lastError(): string {
    const p = this.x.sinew_last_error(this.out);
    return this.readString(p, this.outLen());
  }

  /** Loads Spine 4.x JSON with a libGDX/Spine text atlas. */
  loadSpine(json: string, atlas = ''): SkeletonData {
    const ptr = this.withBytes(json, (jp, jl) => this.withBytes(atlas, (ap, al) => this.x.sinew_data_load_spine(jp, jl, ap, al)));
    if (!ptr) throw new Error(this.lastError());
    return new SkeletonData(this, ptr);
  }
}

export interface BoneInfo {
  name: string;
  parent: number;
  length: number;
}

export class SkeletonData {
  readonly bones: BoneInfo[];
  readonly slots: string[];
  readonly skins: string[];
  readonly animations: { name: string; duration: number }[];
  readonly events: string[];
  readonly pages: { name: string; pma: boolean }[];
  readonly warnings: string[];

  constructor(readonly rt: SinewRuntime, readonly ptr: number) {
    const x = rt.x;
    const names = (kind: Kind) => {
      const n = x.sinew_data_count(ptr, kind);
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = x.sinew_data_name(ptr, kind, i, rt.outPtr);
        out.push(rt.readString(p, rt.outLen()));
      }
      return out;
    };
    this.bones = names(Kind.Bones).map((name, i) => ({
      name,
      parent: x.sinew_data_bone_parent(ptr, i),
      length: x.sinew_data_bone_length(ptr, i),
    }));
    this.slots = names(Kind.Slots);
    this.skins = names(Kind.Skins);
    this.animations = names(Kind.Animations).map((name, i) => ({ name, duration: x.sinew_data_animation_duration(ptr, i) }));
    this.events = names(Kind.Events);
    this.pages = names(Kind.Pages).map((name, i) => ({ name, pma: x.sinew_data_page_pma(ptr, i) !== 0 }));
    this.warnings = names(Kind.Warnings);
  }

  createInstance(): SkeletonInstance {
    return new SkeletonInstance(this, this.rt.x.sinew_instance_new(this.ptr));
  }

  dispose(): void {
    this.rt.x.sinew_data_free(this.ptr);
  }
}

export interface RenderBatch {
  page: number;
  blend: BlendMode;
  firstIndex: number;
  indexCount: number;
}

/** Views into wasm memory; valid until the next call into the runtime. */
export interface RenderView {
  vertexBytes: Uint8Array;
  vertices: Float32Array;
  indices: Uint32Array;
  batches: RenderBatch[];
}

export enum EventKind {
  Start = 0,
  Interrupt = 1,
  End = 2,
  Complete = 3,
  Event = 4,
}

export interface SinewEvent {
  track: number;
  kind: EventKind;
  entry: number;
  /** For `EventKind.Event`. */
  name?: string;
  int?: number;
  float?: number;
  volume?: number;
  balance?: number;
}

export class SkeletonInstance {
  private readonly x: Exports;

  constructor(readonly data: SkeletonData, readonly ptr: number) {
    this.x = data.rt.x;
  }

  private str<T>(s: string, fn: (p: number, l: number) => T): T {
    return this.data.rt.withBytes(s, fn);
  }

  setTransform(x: number, y: number, scaleX = 1, scaleY = 1): void {
    this.x.sinew_instance_set_transform(this.ptr, x, y, scaleX, scaleY);
  }

  setColor(r: number, g: number, b: number, a = 1): void {
    this.x.sinew_instance_set_color(this.ptr, r, g, b, a);
  }

  setSkin(name: string | null): boolean {
    return this.str(name ?? '', (p, l) => this.x.sinew_instance_set_skin(this.ptr, p, l)) !== 0;
  }

  setAnimation(track: number, name: string, loop: boolean): number {
    const id = this.str(name, (p, l) => this.x.sinew_instance_set_animation(this.ptr, track, p, l, loop ? 1 : 0));
    if (!id) throw new Error(`animation not found: ${name}`);
    return id;
  }

  addAnimation(track: number, name: string, loop: boolean, delay = 0): number {
    const id = this.str(name, (p, l) => this.x.sinew_instance_add_animation(this.ptr, track, p, l, loop ? 1 : 0, delay));
    if (!id) throw new Error(`animation not found: ${name}`);
    return id;
  }

  setEmptyAnimation(track: number, mix: number): number {
    return this.x.sinew_instance_set_empty_animation(this.ptr, track, mix);
  }

  addEmptyAnimation(track: number, mix: number, delay = 0): number {
    return this.x.sinew_instance_add_empty_animation(this.ptr, track, mix, delay);
  }

  clearTrack(track: number): void {
    this.x.sinew_instance_clear_track(this.ptr, track);
  }

  setDefaultMix(seconds: number): void {
    this.x.sinew_instance_set_default_mix(this.ptr, seconds);
  }

  setMix(from: string, to: string, seconds: number): boolean {
    return this.str(from, (fp, fl) => this.str(to, (tp, tl) => this.x.sinew_instance_set_mix(this.ptr, fp, fl, tp, tl, seconds))) !== 0;
  }

  setTrackAlpha(track: number, alpha: number): void {
    this.x.sinew_instance_set_track_alpha(this.ptr, track, alpha);
  }

  setTrackAdditive(track: number, additive: boolean): void {
    this.x.sinew_instance_set_track_additive(this.ptr, track, additive ? 1 : 0);
  }

  setTimeScale(scale: number): void {
    this.x.sinew_instance_set_time_scale(this.ptr, scale);
  }

  /** Advances time, applies animations and constraints. */
  update(dt: number): void {
    this.x.sinew_instance_update(this.ptr, dt);
  }

  render(): RenderView {
    const rt = this.data.rt;
    const n = this.x.sinew_instance_render(this.ptr);
    const vp = this.x.sinew_instance_vertices(this.ptr, rt.outPtr);
    const words = rt.outLen();
    const ip = this.x.sinew_instance_indices(this.ptr, rt.outPtr);
    const indexCount = rt.outLen();
    const bp = this.x.sinew_instance_batches(this.ptr, rt.outPtr);
    const buf = this.x.memory.buffer;
    const raw = new Uint32Array(buf, bp, n * 4);
    const batches: RenderBatch[] = [];
    for (let i = 0; i < n; i++) {
      batches.push({ page: raw[i * 4], blend: raw[i * 4 + 1], firstIndex: raw[i * 4 + 2], indexCount: raw[i * 4 + 3] });
    }
    return {
      vertexBytes: new Uint8Array(buf, vp, words * 4),
      vertices: new Float32Array(buf, vp, words),
      indices: new Uint32Array(buf, ip, indexCount),
      batches,
    };
  }

  /** 7 floats per bone: a, b, c, d, x, y, active. */
  boneWorld(): Float32Array {
    const rt = this.data.rt;
    const p = this.x.sinew_instance_bone_world(this.ptr, rt.outPtr);
    return new Float32Array(this.x.memory.buffer, p, rt.outLen());
  }

  pollEvents(): SinewEvent[] {
    const rt = this.data.rt;
    const p = this.x.sinew_instance_poll_events(this.ptr, rt.outPtr);
    const f = new Float32Array(this.x.memory.buffer, p, rt.outLen());
    const out: SinewEvent[] = [];
    for (let i = 0; i < f.length; i += 8) {
      const e: SinewEvent = { track: f[i], kind: f[i + 1], entry: f[i + 2] };
      if (e.kind === EventKind.Event) {
        e.name = this.data.events[f[i + 3]];
        e.int = f[i + 4];
        e.float = f[i + 5];
        e.volume = f[i + 6];
        e.balance = f[i + 7];
      }
      out.push(e);
    }
    return out;
  }

  dispose(): void {
    this.x.sinew_instance_free(this.ptr);
  }
}
