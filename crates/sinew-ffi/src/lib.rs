//! C ABI for Sinew. The same exports serve WebAssembly (JS reads buffers
//! directly from linear memory) and native engines (Godot, Unity, Unreal).
//!
//! Conventions: handles are opaque pointers; strings are (ptr, len) UTF-8
//! without terminator; returned pointers stay valid until the next call that
//! mutates the same handle.

#![allow(clippy::missing_safety_doc)]

use std::cell::RefCell;
use std::sync::Arc;

use sinew_core::import::load_spine_json;
use sinew_core::render::RenderBatch;
use sinew_core::{AnimationState, Atlas, MixBlend, RenderBuffers, Skeleton, SkeletonData, StateEventKind};

thread_local! {
    static LAST_ERROR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn set_error(msg: impl Into<String>) {
    LAST_ERROR.with(|e| *e.borrow_mut() = msg.into().into_bytes());
}

unsafe fn bytes<'a>(p: *const u8, len: usize) -> &'a [u8] {
    if p.is_null() || len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(p, len)
    }
}

unsafe fn text<'a>(p: *const u8, len: usize) -> Option<&'a str> {
    std::str::from_utf8(bytes(p, len)).ok()
}

unsafe fn out<T>(p: *mut usize, v: &[T]) -> *const T {
    if !p.is_null() {
        *p = v.len();
    }
    v.as_ptr()
}

// ---------------------------------------------------------------- memory

#[no_mangle]
pub extern "C" fn sinew_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn sinew_free(p: *mut u8, len: usize) {
    if !p.is_null() {
        drop(Vec::from_raw_parts(p, 0, len.max(1)));
    }
}

#[no_mangle]
pub unsafe extern "C" fn sinew_last_error(out_len: *mut usize) -> *const u8 {
    LAST_ERROR.with(|e| out(out_len, &e.borrow()))
}

#[no_mangle]
pub extern "C" fn sinew_version() -> u32 {
    // major << 16 | minor << 8 | patch
    1 << 8
}

// ---------------------------------------------------------------- data

pub struct SinewData {
    data: Arc<SkeletonData>,
    atlas: Atlas,
}

pub const KIND_BONES: u32 = 0;
pub const KIND_SLOTS: u32 = 1;
pub const KIND_SKINS: u32 = 2;
pub const KIND_ANIMATIONS: u32 = 3;
pub const KIND_EVENTS: u32 = 4;
pub const KIND_PAGES: u32 = 5;
pub const KIND_WARNINGS: u32 = 6;

/// Loads Spine 4.x JSON plus an optional atlas (text format). Returns null on
/// error (see `sinew_last_error`).
#[no_mangle]
pub unsafe extern "C" fn sinew_data_load_spine(json: *const u8, json_len: usize, atlas: *const u8, atlas_len: usize) -> *mut SinewData {
    let Some(json) = text(json, json_len) else {
        set_error("skeleton JSON is not valid UTF-8");
        return std::ptr::null_mut();
    };
    let atlas = match text(atlas, atlas_len) {
        Some("") | None => Atlas::default(),
        Some(t) => match Atlas::parse(t) {
            Ok(a) => a,
            Err(e) => {
                set_error(format!("atlas: {e}"));
                return std::ptr::null_mut();
            }
        },
    };
    match load_spine_json(json) {
        Ok(mut data) => {
            if !atlas.pages.is_empty() {
                for m in data.bind_atlas(&atlas) {
                    data.warnings.push(format!("atlas region not found: {m}"));
                }
            }
            Box::into_raw(Box::new(SinewData { data: Arc::new(data), atlas }))
        }
        Err(e) => {
            set_error(e);
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_free(d: *mut SinewData) {
    if !d.is_null() {
        drop(Box::from_raw(d));
    }
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_count(d: *const SinewData, kind: u32) -> u32 {
    let d = &*d;
    (match kind {
        KIND_BONES => d.data.bones.len(),
        KIND_SLOTS => d.data.slots.len(),
        KIND_SKINS => d.data.skins.len(),
        KIND_ANIMATIONS => d.data.animations.len(),
        KIND_EVENTS => d.data.events.len(),
        KIND_PAGES => d.atlas.pages.len(),
        KIND_WARNINGS => d.data.warnings.len(),
        _ => 0,
    }) as u32
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_name(d: *const SinewData, kind: u32, index: u32, out_len: *mut usize) -> *const u8 {
    let d = &*d;
    let i = index as usize;
    let s: &str = match kind {
        KIND_BONES => d.data.bones.get(i).map(|b| b.name.as_str()),
        KIND_SLOTS => d.data.slots.get(i).map(|b| b.name.as_str()),
        KIND_SKINS => d.data.skins.get(i).map(|b| b.name.as_str()),
        KIND_ANIMATIONS => d.data.animations.get(i).map(|b| b.name.as_str()),
        KIND_EVENTS => d.data.events.get(i).map(|b| b.name.as_str()),
        KIND_PAGES => d.atlas.pages.get(i).map(|b| b.name.as_str()),
        KIND_WARNINGS => d.data.warnings.get(i).map(|b| b.as_str()),
        _ => None,
    }
    .unwrap_or("");
    out(out_len, s.as_bytes())
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_bone_parent(d: *const SinewData, index: u32) -> i32 {
    (&*d).data.bones.get(index as usize).and_then(|b| b.parent).map_or(-1, |p| p as i32)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_bone_length(d: *const SinewData, index: u32) -> f32 {
    (&*d).data.bones.get(index as usize).map_or(0.0, |b| b.length)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_animation_duration(d: *const SinewData, index: u32) -> f32 {
    (&*d).data.animations.get(index as usize).map_or(0.0, |a| a.duration)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_data_page_pma(d: *const SinewData, index: u32) -> u32 {
    (&*d).atlas.pages.get(index as usize).map_or(0, |p| p.pma as u32)
}

// ---------------------------------------------------------------- instance

pub struct SinewInstance {
    sk: Skeleton,
    state: AnimationState,
    buffers: RenderBuffers,
    bone_buf: Vec<f32>,
    event_buf: Vec<f32>,
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_new(d: *const SinewData) -> *mut SinewInstance {
    let data = (&*d).data.clone();
    let mut sk = Skeleton::new(data.clone());
    sk.update_world();
    Box::into_raw(Box::new(SinewInstance {
        sk,
        state: AnimationState::new(data),
        buffers: RenderBuffers::default(),
        bone_buf: Vec::new(),
        event_buf: Vec::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_free(i: *mut SinewInstance) {
    if !i.is_null() {
        drop(Box::from_raw(i));
    }
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_transform(i: *mut SinewInstance, x: f32, y: f32, scale_x: f32, scale_y: f32) {
    let sk = &mut (*i).sk;
    sk.x = x;
    sk.y = y;
    sk.scale_x = scale_x;
    sk.scale_y = scale_y;
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_color(i: *mut SinewInstance, r: f32, g: f32, b: f32, a: f32) {
    (&mut *i).sk.color = sinew_core::Color::new(r, g, b, a);
}

/// Empty name clears the skin. Returns 1 on success.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_skin(i: *mut SinewInstance, name: *const u8, len: usize) -> u32 {
    let name = text(name, len).filter(|s| !s.is_empty());
    (&mut *i).sk.set_skin(name) as u32
}

/// Returns the track entry id, or 0 if the animation does not exist.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_animation(i: *mut SinewInstance, track: u32, name: *const u8, len: usize, looping: u32) -> u32 {
    let Some(name) = text(name, len) else { return 0 };
    (&mut *i).state.set_animation(track as usize, name, looping != 0).map_or(0, |id| id as u32)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_add_animation(
    i: *mut SinewInstance,
    track: u32,
    name: *const u8,
    len: usize,
    looping: u32,
    delay: f32,
) -> u32 {
    let Some(name) = text(name, len) else { return 0 };
    (&mut *i).state.add_animation(track as usize, name, looping != 0, delay).map_or(0, |id| id as u32)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_empty_animation(i: *mut SinewInstance, track: u32, mix: f32) -> u32 {
    (&mut *i).state.set_empty_animation(track as usize, mix) as u32
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_add_empty_animation(i: *mut SinewInstance, track: u32, mix: f32, delay: f32) -> u32 {
    (&mut *i).state.add_empty_animation(track as usize, mix, delay) as u32
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_clear_track(i: *mut SinewInstance, track: u32) {
    (&mut *i).state.clear_track(track as usize);
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_default_mix(i: *mut SinewInstance, duration: f32) {
    (&mut *i).state.default_mix = duration;
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_mix(
    i: *mut SinewInstance,
    from: *const u8,
    from_len: usize,
    to: *const u8,
    to_len: usize,
    duration: f32,
) -> u32 {
    match (text(from, from_len), text(to, to_len)) {
        (Some(a), Some(b)) => (*i).state.set_mix(a, b, duration) as u32,
        _ => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_track_alpha(i: *mut SinewInstance, track: u32, alpha: f32) {
    if let Some(e) = (&mut *i).state.current_mut(track as usize) {
        e.alpha = alpha;
    }
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_track_additive(i: *mut SinewInstance, track: u32, additive: u32) {
    if let Some(e) = (&mut *i).state.current_mut(track as usize) {
        e.blend = if additive != 0 { MixBlend::Add } else { MixBlend::Replace };
    }
}

/// Jumps a track to a time in seconds (editor scrubbing).
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_seek(i: *mut SinewInstance, track: u32, time: f32) {
    (&mut *i).state.seek(track as usize, time);
}

/// Current track time, or -1 if the track is empty.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_track_time(i: *const SinewInstance, track: u32) -> f32 {
    (&*i).state.current(track as usize).map_or(-1.0, |e| e.track_time)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_set_time_scale(i: *mut SinewInstance, time_scale: f32) {
    (&mut *i).state.time_scale = time_scale;
}

/// Advances animation time, poses the skeleton and computes world transforms.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_update(i: *mut SinewInstance, dt: f32) {
    let inst = &mut *i;
    inst.state.update(dt);
    inst.state.apply(&mut inst.sk);
    inst.sk.update_world_with_physics(dt * inst.state.time_scale);
}

/// Restarts physics simulations from the current pose (e.g. after a teleport).
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_reset_physics(i: *mut SinewInstance) {
    (&mut *i).sk.reset_physics();
}

/// Builds render buffers; returns the batch count.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_render(i: *mut SinewInstance) -> u32 {
    let inst = &mut *i;
    inst.sk.render(&mut inst.buffers);
    inst.buffers.batches.len() as u32
}

/// Interleaved vertex words (see `VERTEX_WORDS`).
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_vertices(i: *const SinewInstance, out_len: *mut usize) -> *const u32 {
    out(out_len, &(&*i).buffers.vertices)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_indices(i: *const SinewInstance, out_len: *mut usize) -> *const u32 {
    out(out_len, &(&*i).buffers.indices)
}

#[no_mangle]
pub unsafe extern "C" fn sinew_instance_batches(i: *const SinewInstance, out_len: *mut usize) -> *const RenderBatch {
    out(out_len, &(&*i).buffers.batches)
}

/// Bone world transforms, 7 floats per bone: a, b, c, d, x, y, active.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_bone_world(i: *mut SinewInstance, out_len: *mut usize) -> *const f32 {
    let inst = &mut *i;
    inst.bone_buf.clear();
    for b in &inst.sk.bones {
        let w = b.world;
        inst.bone_buf.extend_from_slice(&[w.a, w.b, w.c, w.d, w.x, w.y, b.active as u32 as f32]);
    }
    out(out_len, &inst.bone_buf)
}

pub const EVENT_START: u32 = 0;
pub const EVENT_INTERRUPT: u32 = 1;
pub const EVENT_END: u32 = 2;
pub const EVENT_COMPLETE: u32 = 3;
pub const EVENT_EVENT: u32 = 4;

/// Drains state events since the last call. 8 floats per record:
/// track, kind, entry id, event index (-1), int, float, volume, balance.
#[no_mangle]
pub unsafe extern "C" fn sinew_instance_poll_events(i: *mut SinewInstance, out_len: *mut usize) -> *const f32 {
    let inst = &mut *i;
    inst.event_buf.clear();
    for e in inst.state.drain_events() {
        let (kind, rest) = match &e.kind {
            StateEventKind::Start => (EVENT_START, [-1.0, 0.0, 0.0, 0.0, 0.0]),
            StateEventKind::Interrupt => (EVENT_INTERRUPT, [-1.0, 0.0, 0.0, 0.0, 0.0]),
            StateEventKind::End => (EVENT_END, [-1.0, 0.0, 0.0, 0.0, 0.0]),
            StateEventKind::Complete => (EVENT_COMPLETE, [-1.0, 0.0, 0.0, 0.0, 0.0]),
            StateEventKind::Event(k) => (EVENT_EVENT, [k.event as f32, k.int as f32, k.float, k.volume, k.balance]),
        };
        inst.event_buf.extend_from_slice(&[e.track as f32, kind as f32, e.entry as f32]);
        inst.event_buf.extend_from_slice(&rest);
    }
    out(out_len, &inst.event_buf)
}
