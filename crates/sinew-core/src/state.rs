//! Multi-track animation playback with crossfading and layering.
//!
//! Semantics: every `apply` starts from the setup pose. Track 0 uses
//! `Replace`; higher tracks use their entry's blend (`Replace` or `Add`).
//! During a crossfade from A to B, properties keyed by both are held at A
//! and blended to B by the mix ratio; properties keyed only by A fade out
//! to whatever is underneath.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, OnceLock};

use crate::animation::{Animation, EventKey, MixBlend};
use crate::model::SkeletonData;
use crate::skeleton::Skeleton;

/// Animation index used for the empty animation.
pub const EMPTY_ANIMATION: usize = usize::MAX;

fn empty_animation() -> &'static Animation {
    static EMPTY: OnceLock<Animation> = OnceLock::new();
    EMPTY.get_or_init(|| Animation::new("<empty>"))
}

#[derive(Clone, Debug)]
pub struct TrackEntry {
    pub id: u64,
    pub animation: usize,
    pub looping: bool,
    /// For queued entries: start when the previous entry's track time reaches this.
    pub delay: f32,
    pub track_time: f32,
    pub time_scale: f32,
    pub alpha: f32,
    pub anim_start: f32,
    pub anim_end: f32,
    pub mix_duration: f32,
    pub mix_time: f32,
    pub blend: MixBlend,
    /// Mixing-out entries keep firing events while the mix ratio is below this.
    pub event_threshold: f32,
    /// Mixing-out entries keep applying attachment / draw order keys below this.
    pub discrete_threshold: f32,
    pub mixing_from: Option<Box<TrackEntry>>,
    last_anim_time: Option<f32>,
    /// Animation time at which a queued entry took over; events up to it still fire.
    interrupted_at: Option<f32>,
}

impl TrackEntry {
    /// Animation-local time for the current track time.
    pub fn animation_time(&self) -> f32 {
        let dur = self.anim_end - self.anim_start;
        if self.looping {
            if dur <= 0.0 {
                self.anim_start
            } else {
                self.anim_start + self.track_time.rem_euclid(dur)
            }
        } else {
            (self.anim_start + self.track_time).min(self.anim_end)
        }
    }

    /// Crossfade progress 0..1 (1 when not mixing).
    pub fn mix_ratio(&self) -> f32 {
        if self.mixing_from.is_none() || self.mix_duration <= 0.0 {
            1.0
        } else {
            (self.mix_time / self.mix_duration).min(1.0)
        }
    }

    /// Track time at which the current loop (or the whole animation) completes.
    fn track_complete(&self) -> f32 {
        let dur = self.anim_end - self.anim_start;
        if dur <= 0.0 {
            return self.track_time;
        }
        if self.looping {
            dur * ((self.track_time / dur).floor() + 1.0)
        } else {
            dur
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum StateEventKind {
    Start,
    Interrupt,
    End,
    Complete,
    Event(EventKey),
}

#[derive(Clone, Debug, PartialEq)]
pub struct StateEvent {
    pub track: usize,
    pub entry: u64,
    pub kind: StateEventKind,
}

pub struct AnimationState {
    pub data: Arc<SkeletonData>,
    pub tracks: Vec<Option<TrackEntry>>,
    queues: Vec<VecDeque<TrackEntry>>,
    pub default_mix: f32,
    mixes: HashMap<(usize, usize), f32>,
    pub time_scale: f32,
    events: Vec<StateEvent>,
    next_id: u64,
    scratch: Vec<EventKey>,
}

impl AnimationState {
    pub fn new(data: Arc<SkeletonData>) -> AnimationState {
        AnimationState {
            data,
            tracks: Vec::new(),
            queues: Vec::new(),
            default_mix: 0.2,
            mixes: HashMap::new(),
            time_scale: 1.0,
            events: Vec::new(),
            next_id: 1,
            scratch: Vec::new(),
        }
    }

    fn animation<'a>(data: &'a SkeletonData, index: usize) -> &'a Animation {
        if index == EMPTY_ANIMATION {
            empty_animation()
        } else {
            &data.animations[index]
        }
    }

    pub fn set_mix(&mut self, from: &str, to: &str, duration: f32) -> bool {
        match (self.data.find_animation(from), self.data.find_animation(to)) {
            (Some(a), Some(b)) => {
                self.mixes.insert((a, b), duration);
                true
            }
            _ => false,
        }
    }

    fn mix_duration(&self, from: usize, to: usize) -> f32 {
        self.mixes.get(&(from, to)).copied().unwrap_or(self.default_mix)
    }

    fn ensure_track(&mut self, track: usize) {
        if self.tracks.len() <= track {
            self.tracks.resize_with(track + 1, || None);
            self.queues.resize_with(track + 1, VecDeque::new);
        }
    }

    fn new_entry(&mut self, animation: usize, looping: bool, previous: Option<usize>) -> TrackEntry {
        let duration = Self::animation(&self.data, animation).duration;
        let id = self.next_id;
        self.next_id += 1;
        TrackEntry {
            id,
            animation,
            looping,
            delay: 0.0,
            track_time: 0.0,
            time_scale: 1.0,
            alpha: 1.0,
            anim_start: 0.0,
            anim_end: duration,
            mix_duration: previous.map_or(0.0, |p| self.mix_duration(p, animation)),
            mix_time: 0.0,
            blend: MixBlend::Replace,
            event_threshold: 0.0,
            discrete_threshold: 0.0,
            mixing_from: None,
            last_anim_time: None,
            interrupted_at: None,
        }
    }

    pub fn current(&self, track: usize) -> Option<&TrackEntry> {
        self.tracks.get(track).and_then(|t| t.as_ref())
    }

    pub fn current_mut(&mut self, track: usize) -> Option<&mut TrackEntry> {
        self.tracks.get_mut(track).and_then(|t| t.as_mut())
    }

    /// Plays an animation now, crossfading from the current one.
    pub fn set_animation(&mut self, track: usize, name: &str, looping: bool) -> Option<u64> {
        let index = self.data.find_animation(name)?;
        Some(self.set_animation_index(track, index, looping))
    }

    pub fn set_animation_index(&mut self, track: usize, animation: usize, looping: bool) -> u64 {
        self.ensure_track(track);
        self.queues[track].clear();
        let current = self.tracks[track].take();
        let mut entry = self.new_entry(animation, looping, current.as_ref().map(|c| c.animation));
        let id = entry.id;
        if let Some(cur) = current {
            self.events.push(StateEvent { track, entry: cur.id, kind: StateEventKind::Interrupt });
            if entry.mix_duration > 0.0 {
                entry.mixing_from = Some(Box::new(cur));
            } else {
                self.end_chain(track, &cur);
            }
        }
        self.events.push(StateEvent { track, entry: id, kind: StateEventKind::Start });
        self.tracks[track] = Some(entry);
        id
    }

    /// Queues an animation after the last queued (or current) entry.
    /// `delay <= 0` means "when the previous completes, minus the mix, plus delay".
    pub fn add_animation(&mut self, track: usize, name: &str, looping: bool, delay: f32) -> Option<u64> {
        let index = self.data.find_animation(name)?;
        Some(self.add_animation_index(track, index, looping, delay))
    }

    pub fn add_animation_index(&mut self, track: usize, animation: usize, looping: bool, delay: f32) -> u64 {
        self.ensure_track(track);
        let last = self.queues[track].back().or(self.tracks[track].as_ref()).cloned();
        let Some(last) = last else {
            return self.set_animation_index(track, animation, looping);
        };
        let mut entry = self.new_entry(animation, looping, Some(last.animation));
        entry.delay = if delay <= 0.0 { (delay + last.track_complete() - entry.mix_duration).max(0.0) } else { delay };
        let id = entry.id;
        self.queues[track].push_back(entry);
        id
    }

    /// Fades the track out to the pose underneath over `mix_duration`.
    pub fn set_empty_animation(&mut self, track: usize, mix_duration: f32) -> u64 {
        let id = self.set_animation_index(track, EMPTY_ANIMATION, false);
        if let Some(e) = self.current_mut(track) {
            e.mix_duration = mix_duration;
            if mix_duration > 0.0 && e.mixing_from.is_none() {
                // Nothing to fade from; keep as plain empty entry.
            }
        }
        id
    }

    pub fn add_empty_animation(&mut self, track: usize, mix_duration: f32, delay: f32) -> u64 {
        let id = self.add_animation_index(track, EMPTY_ANIMATION, false, delay);
        let fix = |e: &mut TrackEntry| {
            if e.id == id {
                if delay <= 0.0 {
                    e.delay = (e.delay + e.mix_duration - mix_duration).max(0.0);
                }
                e.mix_duration = mix_duration;
            }
        };
        if let Some(e) = self.queues[track].back_mut() {
            fix(e);
        } else if let Some(e) = self.current_mut(track) {
            fix(e);
        }
        id
    }

    pub fn clear_track(&mut self, track: usize) {
        if track >= self.tracks.len() {
            return;
        }
        self.queues[track].clear();
        if let Some(cur) = self.tracks[track].take() {
            self.end_chain(track, &cur);
        }
    }

    pub fn clear_tracks(&mut self) {
        for t in 0..self.tracks.len() {
            self.clear_track(t);
        }
    }

    fn end_chain(&mut self, track: usize, e: &TrackEntry) {
        self.events.push(StateEvent { track, entry: e.id, kind: StateEventKind::End });
        if let Some(f) = &e.mixing_from {
            self.end_chain(track, f);
        }
    }

    /// Advances time. Call once per frame before `apply`.
    pub fn update(&mut self, dt: f32) {
        let dt = dt * self.time_scale;
        for t in 0..self.tracks.len() {
            let Some(mut cur) = self.tracks[t].take() else { continue };
            let before = cur.track_time;
            cur.track_time += dt * cur.time_scale;
            self.check_complete(t, &cur, before);

            while let Some(next) = self.queues[t].front() {
                if cur.track_time < next.delay {
                    break;
                }
                let mut next = self.queues[t].pop_front().unwrap();
                let overshoot = if cur.time_scale > 0.0 { (cur.track_time - next.delay) / cur.time_scale } else { 0.0 };
                next.track_time = overshoot * next.time_scale;
                next.mix_time = overshoot;
                cur.interrupted_at = Some(TrackEntry { track_time: next.delay, ..cur.clone() }.animation_time());
                self.events.push(StateEvent { track: t, entry: cur.id, kind: StateEventKind::Interrupt });
                self.events.push(StateEvent { track: t, entry: next.id, kind: StateEventKind::Start });
                if next.mix_duration > 0.0 {
                    next.mixing_from = Some(Box::new(cur));
                } else {
                    self.end_chain(t, &cur);
                }
                cur = next;
            }
            self.update_mixing(t, &mut cur, dt);
            self.tracks[t] = Some(cur);
        }
    }

    fn check_complete(&mut self, track: usize, e: &TrackEntry, before: f32) {
        let dur = e.anim_end - e.anim_start;
        if dur <= 0.0 {
            return;
        }
        let done = if e.looping {
            (e.track_time / dur).floor() > (before / dur).floor()
        } else {
            before < dur && e.track_time >= dur
        };
        if done {
            self.events.push(StateEvent { track, entry: e.id, kind: StateEventKind::Complete });
        }
    }

    fn update_mixing(&mut self, track: usize, to: &mut TrackEntry, dt: f32) {
        let Some(from) = to.mixing_from.as_deref_mut() else { return };
        self.update_mixing(track, from, dt);
        let before = from.track_time;
        from.track_time += dt * from.time_scale;
        let snapshot = from.clone();
        self.check_complete(track, &snapshot, before);
        to.mix_time += dt;
        if to.mix_time >= to.mix_duration {
            if let Some(from) = to.mixing_from.take() {
                self.end_chain(track, &from);
            }
        }
    }

    /// Poses the skeleton from the setup pose and all tracks. Call
    /// `skeleton.update_world()` afterwards.
    pub fn apply(&mut self, sk: &mut Skeleton) {
        sk.setup_pose();
        let data = self.data.clone();
        for t in 0..self.tracks.len() {
            let Some(mut e) = self.tracks[t].take() else { continue };
            let blend = if t == 0 { MixBlend::Replace } else { e.blend };
            self.apply_entry(t, &mut e, sk, blend, &data);
            self.tracks[t] = Some(e);
        }
    }

    fn apply_entry(&mut self, track: usize, e: &mut TrackEntry, sk: &mut Skeleton, blend: MixBlend, data: &SkeletonData) {
        let mix = e.mix_ratio();
        let anim = Self::animation(data, e.animation);
        if let Some(from) = e.mixing_from.as_deref_mut() {
            self.apply_from(track, from, sk, blend, mix, &anim.property_ids, data);
        }
        let alpha = e.alpha * mix;
        let time = e.animation_time();
        anim.apply_curves(sk, time, blend, &|_| alpha);
        if alpha > 0.0 {
            anim.apply_discrete(sk, time, MixBlend::Replace);
        }
        self.fire_events(track, e, anim, time);
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_from(
        &mut self,
        track: usize,
        from: &mut TrackEntry,
        sk: &mut Skeleton,
        blend: MixBlend,
        to_mix: f32,
        to_props: &HashSet<u64>,
        data: &SkeletonData,
    ) {
        let own_mix = from.mix_ratio();
        let anim = Self::animation(data, from.animation);
        if let Some(ff) = from.mixing_from.as_deref_mut() {
            self.apply_from(track, ff, sk, blend, own_mix, &anim.property_ids, data);
        }
        let hold = from.alpha * own_mix;
        let fade = hold * (1.0 - to_mix);
        let time = from.animation_time();
        anim.apply_curves(sk, time, blend, &|ids| if ids.iter().any(|i| to_props.contains(i)) { hold } else { fade });
        if to_mix < from.discrete_threshold {
            anim.apply_discrete(sk, time, MixBlend::Replace);
        }
        if to_mix < from.event_threshold {
            self.fire_events(track, from, anim, time);
        } else {
            if let Some(t) = from.interrupted_at.take() {
                self.fire_events(track, from, anim, t);
            }
            from.last_anim_time = Some(time);
        }
    }

    fn fire_events(&mut self, track: usize, e: &mut TrackEntry, anim: &Animation, time: f32) {
        if !anim.events.is_empty() && e.last_anim_time != Some(time) {
            self.scratch.clear();
            anim.collect_events(e.last_anim_time, time, &mut self.scratch);
            for ev in self.scratch.drain(..) {
                self.events.push(StateEvent { track, entry: e.id, kind: StateEventKind::Event(ev) });
            }
        }
        e.last_anim_time = Some(time);
    }

    /// Jumps a track to `track_time` (editor scrubbing): ends any crossfade
    /// and suppresses events between the old and new time.
    pub fn seek(&mut self, track: usize, track_time: f32) {
        let Some(mut e) = self.tracks.get_mut(track).and_then(|t| t.take()) else { return };
        if let Some(from) = e.mixing_from.take() {
            self.end_chain(track, &from);
        }
        e.track_time = track_time.max(0.0);
        e.mix_time = e.mix_duration;
        e.last_anim_time = Some(e.animation_time());
        e.interrupted_at = None;
        self.tracks[track] = Some(e);
    }

    /// Takes all events produced since the last call.
    pub fn drain_events(&mut self) -> Vec<StateEvent> {
        std::mem::take(&mut self.events)
    }
}
