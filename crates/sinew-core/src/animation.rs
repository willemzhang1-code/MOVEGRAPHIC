//! Animations as generic property channels.
//!
//! Bone transform channels are relative to the setup pose (rotation,
//! translation and shear are offsets, scale is a multiplier) so animations
//! stay meaningful when reused across rigs. Colors and constraint mixes are
//! absolute.

use std::collections::HashSet;

use crate::curve::Curve;
use crate::math::{wrap_deg, Color};
use crate::model::Inherit;
use crate::skeleton::Skeleton;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MixBlend {
    /// Result = setup pose blended toward the animation by alpha.
    Setup,
    /// Result = current pose blended toward the animation by alpha.
    Replace,
    /// Animation delta (relative to setup) is added, scaled by alpha.
    Add,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Property {
    BoneRotate(usize),
    BoneTranslate(usize),
    BoneTranslateX(usize),
    BoneTranslateY(usize),
    BoneScale(usize),
    BoneScaleX(usize),
    BoneScaleY(usize),
    BoneShear(usize),
    BoneShearX(usize),
    BoneShearY(usize),
    SlotRgba(usize),
    SlotRgb(usize),
    SlotAlpha(usize),
    /// Light rgba + dark rgb.
    SlotRgba2(usize),
    /// Light rgb + dark rgb.
    SlotRgb2(usize),
    /// mix, softness (+ per-key flags).
    Ik(usize),
    /// rotate, x, y, scale_x, scale_y, shear_y mixes.
    Transform(usize),
    /// Vertex offsets; the curve is a 0..1 percentage.
    Deform { slot: usize, attachment: u32 },
    /// One physics parameter (0 inertia, 1 strength, 2 damping, 3 mass, 4 wind,
    /// 5 gravity, 6 mix) of one constraint, or of all constraints with that
    /// parameter marked global when `constraint == usize::MAX`.
    Physics { constraint: usize, param: u8 },
}

pub const PHYSICS_GLOBAL: usize = usize::MAX;

pub mod prop_kind {
    pub const ROTATE: u64 = 1;
    pub const X: u64 = 2;
    pub const Y: u64 = 3;
    pub const SCALE_X: u64 = 4;
    pub const SCALE_Y: u64 = 5;
    pub const SHEAR_X: u64 = 6;
    pub const SHEAR_Y: u64 = 7;
    pub const RGB: u64 = 8;
    pub const ALPHA: u64 = 9;
    pub const DARK: u64 = 10;
    pub const IK: u64 = 11;
    pub const TRANSFORM: u64 = 12;
    pub const DEFORM: u64 = 13;
    pub const ATTACHMENT: u64 = 14;
    pub const DRAW_ORDER: u64 = 15;
    pub const INHERIT: u64 = 16;
    pub const PHYSICS: u64 = 17;
}

/// Identifies one scalar-ish animatable property, used to decide which
/// properties two animations have in common when mixing.
#[inline]
pub fn prop_id(kind: u64, index: usize, extra: u32) -> u64 {
    (kind << 56) | (((index as u64) & 0xFF_FFFF) << 32) | extra as u64
}

impl Property {
    pub fn stride(&self) -> usize {
        match self {
            Property::BoneTranslate(_) | Property::BoneScale(_) | Property::BoneShear(_) | Property::Ik(_) => 2,
            Property::SlotRgba(_) => 4,
            Property::SlotRgb(_) => 3,
            Property::SlotRgba2(_) => 7,
            Property::SlotRgb2(_) => 6,
            Property::Transform(_) => 6,
            Property::Deform { .. } => 0,
            _ => 1,
        }
    }

    pub fn ids(&self) -> Vec<u64> {
        use prop_kind::*;
        match *self {
            Property::BoneRotate(b) => vec![prop_id(ROTATE, b, 0)],
            Property::BoneTranslate(b) => vec![prop_id(X, b, 0), prop_id(Y, b, 0)],
            Property::BoneTranslateX(b) => vec![prop_id(X, b, 0)],
            Property::BoneTranslateY(b) => vec![prop_id(Y, b, 0)],
            Property::BoneScale(b) => vec![prop_id(SCALE_X, b, 0), prop_id(SCALE_Y, b, 0)],
            Property::BoneScaleX(b) => vec![prop_id(SCALE_X, b, 0)],
            Property::BoneScaleY(b) => vec![prop_id(SCALE_Y, b, 0)],
            Property::BoneShear(b) => vec![prop_id(SHEAR_X, b, 0), prop_id(SHEAR_Y, b, 0)],
            Property::BoneShearX(b) => vec![prop_id(SHEAR_X, b, 0)],
            Property::BoneShearY(b) => vec![prop_id(SHEAR_Y, b, 0)],
            Property::SlotRgba(s) => vec![prop_id(RGB, s, 0), prop_id(ALPHA, s, 0)],
            Property::SlotRgb(s) => vec![prop_id(RGB, s, 0)],
            Property::SlotAlpha(s) => vec![prop_id(ALPHA, s, 0)],
            Property::SlotRgba2(s) => vec![prop_id(RGB, s, 0), prop_id(ALPHA, s, 0), prop_id(DARK, s, 0)],
            Property::SlotRgb2(s) => vec![prop_id(RGB, s, 0), prop_id(DARK, s, 0)],
            Property::Ik(i) => vec![prop_id(IK, i, 0)],
            Property::Transform(i) => vec![prop_id(TRANSFORM, i, 0)],
            Property::Deform { slot, attachment } => vec![prop_id(DEFORM, slot, attachment)],
            Property::Physics { constraint, param } => vec![prop_id(PHYSICS, constraint & 0xFF_FFFF, param as u32)],
        }
    }
}

pub mod ik_flags {
    pub const BEND_POSITIVE: u8 = 1;
    pub const COMPRESS: u8 = 2;
    pub const STRETCH: u8 = 4;
}

/// Keyframed numeric channel.
#[derive(Clone, Debug)]
pub struct CurveChannel {
    pub property: Property,
    /// Values per key.
    pub stride: usize,
    pub times: Vec<f32>,
    pub values: Vec<f32>,
    /// Curve of the segment starting at each key; `curve_stride` per key.
    pub curves: Vec<Curve>,
    pub curve_stride: usize,
    /// Single 0..1 percentage curve applied to all components.
    pub percent_curve: bool,
    /// Per-key flags (IK).
    pub flags: Vec<u8>,
    pub ids: Vec<u64>,
}

impl CurveChannel {
    pub fn new(property: Property) -> CurveChannel {
        let stride = property.stride();
        CurveChannel {
            property,
            stride,
            times: Vec::new(),
            values: Vec::new(),
            curves: Vec::new(),
            curve_stride: stride,
            percent_curve: false,
            flags: Vec::new(),
            ids: property.ids(),
        }
    }

    /// Deform channel with `len` values per key and one percentage curve.
    pub fn new_deform(slot: usize, attachment: u32, len: usize) -> CurveChannel {
        let property = Property::Deform { slot, attachment };
        CurveChannel {
            property,
            stride: len,
            times: Vec::new(),
            values: Vec::new(),
            curves: Vec::new(),
            curve_stride: 1,
            percent_curve: true,
            flags: Vec::new(),
            ids: property.ids(),
        }
    }

    pub fn push(&mut self, time: f32, values: &[f32], curves: &[Curve], flags: u8) {
        debug_assert_eq!(values.len(), self.stride);
        self.times.push(time);
        self.values.extend_from_slice(values);
        for i in 0..self.curve_stride {
            self.curves.push(*curves.get(i).or(curves.first()).unwrap_or(&Curve::Linear));
        }
        self.flags.push(flags);
    }

    #[inline]
    pub fn key_count(&self) -> usize {
        self.times.len()
    }

    /// Index of the last key at or before `time`.
    pub fn key_at(&self, time: f32) -> Option<usize> {
        if self.times.is_empty() || time < self.times[0] {
            return None;
        }
        Some(self.times.partition_point(|&t| t <= time) - 1)
    }

    /// Writes interpolated values at `time` into `out` (len == stride).
    /// Returns the key index, or `None` before the first key.
    pub fn sample(&self, time: f32, out: &mut [f32]) -> Option<usize> {
        let k = self.key_at(time)?;
        let s = self.stride;
        let v0 = &self.values[k * s..k * s + s];
        if k + 1 >= self.times.len() {
            out.copy_from_slice(v0);
            return Some(k);
        }
        let v1 = &self.values[(k + 1) * s..(k + 2) * s];
        let (t0, t1) = (self.times[k], self.times[k + 1]);
        if self.percent_curve {
            let p = self.curves[k].eval(time, t0, 0.0, t1, 1.0);
            for j in 0..s {
                out[j] = v0[j] + (v1[j] - v0[j]) * p;
            }
        } else {
            for j in 0..s {
                out[j] = self.curves[k * self.curve_stride + j].eval(time, t0, v0[j], t1, v1[j]);
            }
        }
        Some(k)
    }
}

#[derive(Clone, Debug)]
pub enum DiscreteChannel {
    Attachment { slot: usize, times: Vec<f32>, names: Vec<Option<String>> },
    /// `None` restores setup order.
    DrawOrder { times: Vec<f32>, orders: Vec<Option<Vec<usize>>> },
    Inherit { bone: usize, times: Vec<f32>, values: Vec<Inherit> },
}

impl DiscreteChannel {
    pub fn times(&self) -> &[f32] {
        match self {
            DiscreteChannel::Attachment { times, .. }
            | DiscreteChannel::DrawOrder { times, .. }
            | DiscreteChannel::Inherit { times, .. } => times,
        }
    }

    pub fn ids(&self) -> Vec<u64> {
        use prop_kind::*;
        match self {
            DiscreteChannel::Attachment { slot, .. } => vec![prop_id(ATTACHMENT, *slot, 0)],
            DiscreteChannel::DrawOrder { .. } => vec![prop_id(DRAW_ORDER, 0, 0)],
            DiscreteChannel::Inherit { bone, .. } => vec![prop_id(INHERIT, *bone, 0)],
        }
    }

    fn key_at(&self, time: f32) -> Option<usize> {
        let t = self.times();
        if t.is_empty() || time < t[0] {
            return None;
        }
        Some(t.partition_point(|&k| k <= time) - 1)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EventKey {
    pub time: f32,
    pub event: usize,
    pub int: i32,
    pub float: f32,
    pub string: String,
    pub volume: f32,
    pub balance: f32,
}

#[derive(Clone, Debug, Default)]
pub struct Animation {
    pub name: String,
    pub duration: f32,
    pub curves: Vec<CurveChannel>,
    pub discrete: Vec<DiscreteChannel>,
    /// Sorted by time.
    pub events: Vec<EventKey>,
    pub property_ids: HashSet<u64>,
}

impl Animation {
    pub fn new(name: impl Into<String>) -> Animation {
        Animation { name: name.into(), ..Default::default() }
    }

    /// Computes duration (if zero) and the keyed property set. Call after
    /// adding channels.
    pub fn finalize(&mut self) {
        let mut max = 0.0f32;
        self.property_ids.clear();
        for c in &self.curves {
            max = max.max(c.times.last().copied().unwrap_or(0.0));
            self.property_ids.extend(c.ids.iter().copied());
        }
        for d in &self.discrete {
            max = max.max(d.times().last().copied().unwrap_or(0.0));
            self.property_ids.extend(d.ids());
        }
        self.events.sort_by(|a, b| a.time.total_cmp(&b.time));
        if let Some(e) = self.events.last() {
            max = max.max(e.time);
        }
        if self.duration <= 0.0 {
            self.duration = max;
        }
    }

    /// Applies all channels with one alpha.
    pub fn apply(&self, sk: &mut Skeleton, time: f32, alpha: f32, blend: MixBlend) {
        self.apply_curves(sk, time, blend, &|_| alpha);
        if alpha > 0.0 {
            self.apply_discrete(sk, time, blend);
        }
    }

    /// Applies numeric channels; `alpha_of` maps a channel's property ids to its alpha.
    pub fn apply_curves(&self, sk: &mut Skeleton, time: f32, blend: MixBlend, alpha_of: &dyn Fn(&[u64]) -> f32) {
        for ch in &self.curves {
            let alpha = alpha_of(&ch.ids);
            apply_curve_channel(ch, sk, time, alpha, blend);
        }
    }

    pub fn apply_discrete(&self, sk: &mut Skeleton, time: f32, blend: MixBlend) {
        for ch in &self.discrete {
            let k = ch.key_at(time);
            match ch {
                DiscreteChannel::Attachment { slot, names, .. } => {
                    let name = match k {
                        Some(k) => names[k].clone(),
                        None if blend == MixBlend::Setup => sk.data.slots[*slot].attachment.clone(),
                        None => continue,
                    };
                    sk.set_attachment(*slot, name.as_deref());
                }
                DiscreteChannel::DrawOrder { orders, .. } => match k {
                    Some(k) => match &orders[k] {
                        Some(o) => sk.draw_order.clone_from(o),
                        None => sk.reset_draw_order(),
                    },
                    None if blend == MixBlend::Setup => sk.reset_draw_order(),
                    None => {}
                },
                DiscreteChannel::Inherit { bone, values, .. } => match k {
                    Some(k) => sk.bones[*bone].inherit = values[k],
                    None if blend == MixBlend::Setup => sk.bones[*bone].inherit = sk.data.bones[*bone].inherit,
                    None => {}
                },
            }
        }
    }

    /// Events in `(last, time]`; `last == None` means "from before the start".
    /// When `time < last` the animation wrapped around.
    pub fn collect_events(&self, last: Option<f32>, time: f32, out: &mut Vec<EventKey>) {
        match last {
            None => out.extend(self.events.iter().filter(|e| e.time <= time).cloned()),
            Some(l) if time >= l => out.extend(self.events.iter().filter(|e| e.time > l && e.time <= time).cloned()),
            Some(l) => {
                out.extend(self.events.iter().filter(|e| e.time > l).cloned());
                out.extend(self.events.iter().filter(|e| e.time <= time).cloned());
            }
        }
    }
}

#[inline]
fn blend_offset(cur: f32, setup: f32, v: f32, alpha: f32, blend: MixBlend) -> f32 {
    match blend {
        MixBlend::Setup => setup + v * alpha,
        MixBlend::Replace => cur + (setup + v - cur) * alpha,
        MixBlend::Add => cur + v * alpha,
    }
}

#[inline]
fn blend_rotation(cur: f32, setup: f32, v: f32, alpha: f32, blend: MixBlend) -> f32 {
    match blend {
        MixBlend::Replace if alpha < 1.0 => cur + wrap_deg(setup + v - cur) * alpha,
        _ => blend_offset(cur, setup, v, alpha, blend),
    }
}

#[inline]
fn blend_scale(cur: f32, setup: f32, v: f32, alpha: f32, blend: MixBlend) -> f32 {
    let target = setup * v;
    match blend {
        MixBlend::Setup => setup + (target - setup) * alpha,
        MixBlend::Replace => cur + (target - cur) * alpha,
        MixBlend::Add => cur + (target - setup) * alpha,
    }
}

#[inline]
fn blend_abs(cur: f32, setup: f32, v: f32, alpha: f32, blend: MixBlend) -> f32 {
    match blend {
        MixBlend::Setup => setup + (v - setup) * alpha,
        MixBlend::Replace => cur + (v - cur) * alpha,
        MixBlend::Add => cur + (v - setup) * alpha,
    }
}

#[inline]
fn blend_color(cur: Color, setup: Color, v: Color, alpha: f32, blend: MixBlend) -> Color {
    match blend {
        MixBlend::Setup => setup.lerp(v, alpha),
        // Additive color is not meaningful; treat as replace.
        _ => cur.lerp(v, alpha),
    }
}

fn apply_curve_channel(ch: &CurveChannel, sk: &mut Skeleton, time: f32, alpha: f32, blend: MixBlend) {
    if alpha <= 0.0 && blend != MixBlend::Setup {
        return;
    }
    if let Property::Deform { slot, attachment } = ch.property {
        apply_deform(ch, sk, slot, attachment, time, alpha, blend);
        return;
    }
    let mut buf = [0.0f32; 8];
    let s = ch.stride;
    let key = ch.sample(time, &mut buf[..s]);
    let Some(key) = key else {
        if blend == MixBlend::Setup {
            reset_property(sk, ch.property);
        }
        return;
    };
    let v = &buf[..s];
    match ch.property {
        Property::BoneRotate(b)
        | Property::BoneTranslate(b)
        | Property::BoneTranslateX(b)
        | Property::BoneTranslateY(b)
        | Property::BoneScale(b)
        | Property::BoneScaleX(b)
        | Property::BoneScaleY(b)
        | Property::BoneShear(b)
        | Property::BoneShearX(b)
        | Property::BoneShearY(b) => {
            if !sk.bones[b].active {
                return;
            }
            let su = sk.data.bones[b].setup;
            let p = &mut sk.bones[b].pose;
            match ch.property {
                Property::BoneRotate(_) => p.rotation = blend_rotation(p.rotation, su.rotation, v[0], alpha, blend),
                Property::BoneTranslate(_) => {
                    p.x = blend_offset(p.x, su.x, v[0], alpha, blend);
                    p.y = blend_offset(p.y, su.y, v[1], alpha, blend);
                }
                Property::BoneTranslateX(_) => p.x = blend_offset(p.x, su.x, v[0], alpha, blend),
                Property::BoneTranslateY(_) => p.y = blend_offset(p.y, su.y, v[0], alpha, blend),
                Property::BoneScale(_) => {
                    p.scale_x = blend_scale(p.scale_x, su.scale_x, v[0], alpha, blend);
                    p.scale_y = blend_scale(p.scale_y, su.scale_y, v[1], alpha, blend);
                }
                Property::BoneScaleX(_) => p.scale_x = blend_scale(p.scale_x, su.scale_x, v[0], alpha, blend),
                Property::BoneScaleY(_) => p.scale_y = blend_scale(p.scale_y, su.scale_y, v[0], alpha, blend),
                Property::BoneShear(_) => {
                    p.shear_x = blend_offset(p.shear_x, su.shear_x, v[0], alpha, blend);
                    p.shear_y = blend_offset(p.shear_y, su.shear_y, v[1], alpha, blend);
                }
                Property::BoneShearX(_) => p.shear_x = blend_offset(p.shear_x, su.shear_x, v[0], alpha, blend),
                Property::BoneShearY(_) => p.shear_y = blend_offset(p.shear_y, su.shear_y, v[0], alpha, blend),
                _ => unreachable!(),
            }
        }
        Property::SlotRgba(s) | Property::SlotRgb(s) | Property::SlotAlpha(s) | Property::SlotRgba2(s) | Property::SlotRgb2(s) => {
            let setup = &sk.data.slots[s];
            let (setup_light, setup_dark) = (setup.color, setup.dark.unwrap_or(Color::BLACK));
            let slot = &mut sk.slots[s];
            let cur = slot.color;
            let (light, dark) = match ch.property {
                Property::SlotRgba(_) => (Color::new(v[0], v[1], v[2], v[3]), None),
                Property::SlotRgb(_) => (Color::new(v[0], v[1], v[2], cur.a), None),
                Property::SlotAlpha(_) => (Color { a: v[0], ..cur }, None),
                Property::SlotRgba2(_) => (Color::new(v[0], v[1], v[2], v[3]), Some(Color::new(v[4], v[5], v[6], 1.0))),
                Property::SlotRgb2(_) => (Color::new(v[0], v[1], v[2], cur.a), Some(Color::new(v[3], v[4], v[5], 1.0))),
                _ => unreachable!(),
            };
            let setup_light = match ch.property {
                Property::SlotRgb(_) | Property::SlotRgb2(_) => Color { a: cur.a, ..setup_light },
                Property::SlotAlpha(_) => Color { a: setup_light.a, ..cur },
                _ => setup_light,
            };
            slot.color = blend_color(cur, setup_light, light, alpha, blend);
            if let Some(d) = dark {
                let cur_dark = slot.dark.unwrap_or(setup_dark);
                slot.dark = Some(blend_color(cur_dark, setup_dark, d, alpha, blend));
            }
        }
        Property::Ik(i) => {
            let d = &sk.data.ik[i];
            let (mix0, soft0) = (d.mix, d.softness);
            let c = &mut sk.ik[i];
            c.mix = blend_abs(c.mix, mix0, v[0], alpha, blend);
            c.softness = blend_abs(c.softness, soft0, v[1], alpha, blend);
            let f = ch.flags[key];
            c.bend_positive = f & ik_flags::BEND_POSITIVE != 0;
            c.compress = f & ik_flags::COMPRESS != 0;
            c.stretch = f & ik_flags::STRETCH != 0;
        }
        Property::Transform(i) => {
            let m0 = sk.data.transforms[i].mix;
            let m = &mut sk.transforms[i].mix;
            m.rotate = blend_abs(m.rotate, m0.rotate, v[0], alpha, blend);
            m.x = blend_abs(m.x, m0.x, v[1], alpha, blend);
            m.y = blend_abs(m.y, m0.y, v[2], alpha, blend);
            m.scale_x = blend_abs(m.scale_x, m0.scale_x, v[3], alpha, blend);
            m.scale_y = blend_abs(m.scale_y, m0.scale_y, v[4], alpha, blend);
            m.shear_y = blend_abs(m.shear_y, m0.shear_y, v[5], alpha, blend);
        }
        Property::Physics { constraint, param } => {
            let value = if param == 3 { 1.0 / v[0].max(1e-6) } else { v[0] };
            let data = sk.data.clone();
            for (i, d) in data.physics.iter().enumerate() {
                if constraint != PHYSICS_GLOBAL && constraint != i {
                    continue;
                }
                if constraint == PHYSICS_GLOBAL && !d.global[param as usize] {
                    continue;
                }
                let setup = physics_param(&d.params, param);
                let cur = physics_param_mut(&mut sk.physics[i].params, param);
                *cur = blend_abs(*cur, setup, value, alpha, blend);
            }
        }
        Property::Deform { .. } => unreachable!(),
    }
}

fn physics_param(p: &crate::model::PhysicsParams, i: u8) -> f32 {
    match i {
        0 => p.inertia,
        1 => p.strength,
        2 => p.damping,
        3 => p.mass_inverse,
        4 => p.wind,
        5 => p.gravity,
        _ => p.mix,
    }
}

fn physics_param_mut(p: &mut crate::model::PhysicsParams, i: u8) -> &mut f32 {
    match i {
        0 => &mut p.inertia,
        1 => &mut p.strength,
        2 => &mut p.damping,
        3 => &mut p.mass_inverse,
        4 => &mut p.wind,
        5 => &mut p.gravity,
        _ => &mut p.mix,
    }
}

fn reset_property(sk: &mut Skeleton, p: Property) {
    match p {
        Property::BoneRotate(b)
        | Property::BoneTranslate(b)
        | Property::BoneTranslateX(b)
        | Property::BoneTranslateY(b)
        | Property::BoneScale(b)
        | Property::BoneScaleX(b)
        | Property::BoneScaleY(b)
        | Property::BoneShear(b)
        | Property::BoneShearX(b)
        | Property::BoneShearY(b) => {
            let su = sk.data.bones[b].setup;
            let pose = &mut sk.bones[b].pose;
            match p {
                Property::BoneRotate(_) => pose.rotation = su.rotation,
                Property::BoneTranslate(_) => {
                    pose.x = su.x;
                    pose.y = su.y;
                }
                Property::BoneTranslateX(_) => pose.x = su.x,
                Property::BoneTranslateY(_) => pose.y = su.y,
                Property::BoneScale(_) => {
                    pose.scale_x = su.scale_x;
                    pose.scale_y = su.scale_y;
                }
                Property::BoneScaleX(_) => pose.scale_x = su.scale_x,
                Property::BoneScaleY(_) => pose.scale_y = su.scale_y,
                Property::BoneShear(_) => {
                    pose.shear_x = su.shear_x;
                    pose.shear_y = su.shear_y;
                }
                Property::BoneShearX(_) => pose.shear_x = su.shear_x,
                Property::BoneShearY(_) => pose.shear_y = su.shear_y,
                _ => {}
            }
        }
        Property::SlotRgba(s) | Property::SlotRgb(s) | Property::SlotAlpha(s) | Property::SlotRgba2(s) | Property::SlotRgb2(s) => {
            let d = &sk.data.slots[s];
            sk.slots[s].color = d.color;
            sk.slots[s].dark = d.dark;
        }
        Property::Ik(i) => {
            let d = &sk.data.ik[i];
            let c = &mut sk.ik[i];
            c.mix = d.mix;
            c.softness = d.softness;
            c.bend_positive = d.bend_positive;
            c.compress = d.compress;
            c.stretch = d.stretch;
        }
        Property::Transform(i) => sk.transforms[i].mix = sk.data.transforms[i].mix,
        Property::Deform { slot, .. } => sk.slots[slot].deform.clear(),
        Property::Physics { constraint, .. } => {
            let data = sk.data.clone();
            for (i, d) in data.physics.iter().enumerate() {
                if constraint == PHYSICS_GLOBAL || constraint == i {
                    sk.physics[i].params = d.params;
                }
            }
        }
    }
}

fn apply_deform(ch: &CurveChannel, sk: &mut Skeleton, slot: usize, attachment: u32, time: f32, alpha: f32, blend: MixBlend) {
    let Some(r) = sk.slots[slot].attachment else { return };
    let data = sk.data.clone();
    let att = data.attachment(r);
    if att.deform_id != attachment {
        return;
    }
    let Some(verts) = att.vertices() else { return };
    let n = verts.deform_len();
    if n != ch.stride {
        return;
    }
    let mut target = std::mem::take(&mut sk.scratch);
    target.resize(n, 0.0);
    if ch.sample(time, &mut target).is_none() {
        if blend == MixBlend::Setup {
            sk.slots[slot].deform.clear();
        }
        sk.scratch = target;
        return;
    }
    let setup = |i: usize| -> f32 {
        match verts {
            crate::model::Vertices::Plain(v) => v[i],
            crate::model::Vertices::Weighted { .. } => 0.0,
        }
    };
    let deform = &mut sk.slots[slot].deform;
    if deform.len() != n {
        deform.clear();
        deform.extend((0..n).map(setup));
    }
    match blend {
        MixBlend::Setup => {
            for i in 0..n {
                let s = setup(i);
                deform[i] = s + (target[i] - s) * alpha;
            }
        }
        MixBlend::Replace => {
            for i in 0..n {
                deform[i] += (target[i] - deform[i]) * alpha;
            }
        }
        MixBlend::Add => {
            for i in 0..n {
                deform[i] += (target[i] - setup(i)) * alpha;
            }
        }
    }
    sk.scratch = target;
}
