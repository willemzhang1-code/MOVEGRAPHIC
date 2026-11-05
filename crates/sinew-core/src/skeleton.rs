//! Skeleton instance: pose, world transforms and update order.

use std::sync::Arc;

use crate::constraints;
use crate::math::{atan2_deg, cos_deg, sin_deg, Affine, Color, Transform, Vec2};
use crate::model::{AttachmentRef, ConstraintRef, Inherit, PhysicsParams, SkeletonData, TransformMix};

#[derive(Clone, Debug)]
pub struct Bone {
    /// Animated local transform.
    pub pose: Transform,
    /// Local transform after constraints.
    pub applied: Transform,
    pub inherit: Inherit,
    pub world: Affine,
    pub active: bool,
}

#[derive(Clone, Debug)]
pub struct Slot {
    pub color: Color,
    pub dark: Option<Color>,
    pub attachment: Option<AttachmentRef>,
    /// Deform values for the current attachment; empty means setup vertices.
    pub deform: Vec<f32>,
    /// Current frame of a sequence attachment (-1 = setup frame).
    pub sequence_index: i32,
}

#[derive(Clone, Copy, Debug)]
pub struct IkConstraint {
    pub mix: f32,
    pub softness: f32,
    pub bend_positive: bool,
    pub compress: bool,
    pub stretch: bool,
    pub active: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct TransformConstraint {
    pub mix: TransformMix,
    pub active: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct PathConstraint {
    pub position: f32,
    pub spacing: f32,
    pub mix_rotate: f32,
    pub mix_x: f32,
    pub mix_y: f32,
    pub active: bool,
}

/// Simulation state of a physics constraint. Offsets are applied on top of
/// the bone's animated world transform.
///
/// Model (fitted to the reference runtime's step responses, see
/// web/parity/physics.html): each channel is a damped spring integrated at a
/// fixed rate; bone movement feeds it as inertia (the origin lags, the tip
/// stays where it was drawn).
#[derive(Clone, Copy, Debug)]
pub struct PhysicsConstraint {
    pub params: PhysicsParams,
    pub active: bool,
    pub(crate) reset: bool,
    /// Has simulated at least once (the step clock is running).
    pub(crate) started: bool,
    /// Bone origin and direction (radians) before physics, last frame.
    pub(crate) last_pos: Vec2,
    pub(crate) last_angle: f32,
    /// Bone length (world-scaled) last frame.
    pub(crate) last_len: f32,
    pub(crate) last_time: f64,
    /// Simulation time not yet stepped.
    pub(crate) remaining: f64,
    /// Translation offset and velocity (world units).
    pub(crate) offset: Vec2,
    pub(crate) velocity: Vec2,
    /// Rotation offset (radians) and velocity.
    pub(crate) rotation: f32,
    pub(crate) rotation_velocity: f32,
    /// Scale offset (fraction) and velocity.
    pub(crate) scale: f32,
    pub(crate) scale_velocity: f32,
}

impl PhysicsConstraint {
    fn new(params: PhysicsParams) -> Self {
        PhysicsConstraint {
            params,
            active: true,
            reset: true,
            started: false,
            last_pos: Vec2::ZERO,
            last_angle: 0.0,
            last_len: 0.0,
            last_time: 0.0,
            remaining: 0.0,
            offset: Vec2::ZERO,
            velocity: Vec2::ZERO,
            rotation: 0.0,
            rotation_velocity: 0.0,
            scale: 0.0,
            scale_velocity: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateItem {
    Bone(usize),
    Constraint(ConstraintRef),
}

#[derive(Clone, Debug)]
pub struct Skeleton {
    pub data: Arc<SkeletonData>,
    pub bones: Vec<Bone>,
    pub slots: Vec<Slot>,
    pub draw_order: Vec<usize>,
    pub ik: Vec<IkConstraint>,
    pub transforms: Vec<TransformConstraint>,
    pub physics: Vec<PhysicsConstraint>,
    pub paths: Vec<PathConstraint>,
    pub skin: Option<usize>,
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub color: Color,
    cache: Vec<UpdateItem>,
    children: Vec<Vec<usize>>,
    pub(crate) scratch: Vec<f32>,
    /// Skeleton clock driving physics (seconds).
    pub(crate) physics_time: f64,
    /// Whether the current world update simulates physics (otherwise the
    /// current offsets are only applied).
    pub(crate) physics_step: bool,
}

impl Skeleton {
    pub fn new(data: Arc<SkeletonData>) -> Skeleton {
        let mut children = vec![Vec::new(); data.bones.len()];
        for (i, b) in data.bones.iter().enumerate() {
            if let Some(p) = b.parent {
                children[p].push(i);
            }
        }
        let bones = data
            .bones
            .iter()
            .map(|b| Bone { pose: b.setup, applied: b.setup, inherit: b.inherit, world: Affine::IDENTITY, active: true })
            .collect();
        let slots = data
            .slots
            .iter()
            .map(|s| Slot { color: s.color, dark: s.dark, attachment: None, deform: Vec::new(), sequence_index: -1 })
            .collect();
        let ik = data
            .ik
            .iter()
            .map(|c| IkConstraint {
                mix: c.mix,
                softness: c.softness,
                bend_positive: c.bend_positive,
                compress: c.compress,
                stretch: c.stretch,
                active: true,
            })
            .collect();
        let transforms = data.transforms.iter().map(|c| TransformConstraint { mix: c.mix, active: true }).collect();
        let physics = data.physics.iter().map(|c| PhysicsConstraint::new(c.params)).collect();
        let paths = data
            .paths
            .iter()
            .map(|c| PathConstraint { position: c.position, spacing: c.spacing, mix_rotate: c.mix_rotate, mix_x: c.mix_x, mix_y: c.mix_y, active: true })
            .collect();
        let mut sk = Skeleton {
            draw_order: (0..data.slots.len()).collect(),
            data,
            bones,
            slots,
            ik,
            transforms,
            physics,
            paths,
            skin: None,
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            color: Color::WHITE,
            cache: Vec::new(),
            children,
            scratch: Vec::new(),
            physics_time: 0.0,
            physics_step: false,
        };
        sk.update_cache();
        sk.setup_pose();
        sk
    }

    pub fn setup_pose(&mut self) {
        self.setup_pose_bones();
        self.setup_pose_slots();
    }

    pub fn setup_pose_bones(&mut self) {
        let data = &self.data;
        for (b, d) in self.bones.iter_mut().zip(&data.bones) {
            b.pose = d.setup;
            b.inherit = d.inherit;
        }
        for (c, d) in self.ik.iter_mut().zip(&data.ik) {
            c.mix = d.mix;
            c.softness = d.softness;
            c.bend_positive = d.bend_positive;
            c.compress = d.compress;
            c.stretch = d.stretch;
        }
        for (c, d) in self.transforms.iter_mut().zip(&data.transforms) {
            c.mix = d.mix;
        }
        for (c, d) in self.physics.iter_mut().zip(&data.physics) {
            c.params = d.params;
        }
        for (c, d) in self.paths.iter_mut().zip(&data.paths) {
            c.position = d.position;
            c.spacing = d.spacing;
            c.mix_rotate = d.mix_rotate;
            c.mix_x = d.mix_x;
            c.mix_y = d.mix_y;
        }
    }

    /// Restarts all physics simulations from the current pose.
    pub fn reset_physics(&mut self) {
        for c in &mut self.physics {
            c.reset = true;
        }
    }

    pub fn setup_pose_slots(&mut self) {
        self.reset_draw_order();
        let data = self.data.clone();
        for (i, d) in data.slots.iter().enumerate() {
            let s = &mut self.slots[i];
            s.color = d.color;
            s.dark = d.dark;
            s.sequence_index = -1;
            self.set_attachment(i, d.attachment.as_deref());
        }
    }

    pub fn reset_draw_order(&mut self) {
        self.draw_order.clear();
        self.draw_order.extend(0..self.slots.len());
    }

    /// Looks up an attachment by name in the current skin, then the default skin.
    pub fn find_attachment(&self, slot: usize, name: &str) -> Option<AttachmentRef> {
        for skin in [self.skin, self.data.default_skin].into_iter().flatten() {
            if let Some(index) = self.data.skins[skin].find(slot, name) {
                return Some(AttachmentRef { skin, index });
            }
        }
        None
    }

    pub fn set_attachment(&mut self, slot: usize, name: Option<&str>) {
        let r = name.and_then(|n| self.find_attachment(slot, n));
        let s = &mut self.slots[slot];
        if s.attachment != r {
            let keep_deform = match (s.attachment, r) {
                (Some(a), Some(b)) => self.data.attachment(a).deform_id == self.data.attachment(b).deform_id,
                _ => false,
            };
            if !keep_deform {
                s.deform.clear();
            }
            s.attachment = r;
            s.sequence_index = -1;
        }
    }

    /// Sets the skin by name (`None` clears it). Returns false if not found.
    pub fn set_skin(&mut self, name: Option<&str>) -> bool {
        let new = match name {
            Some(n) => match self.data.find_skin(n) {
                Some(i) => Some(i),
                None => return false,
            },
            None => None,
        };
        if new == self.skin {
            return true;
        }
        if let Some(ns) = new {
            let data = self.data.clone();
            for (i, slot) in self.slots.iter_mut().enumerate() {
                let name = match (self.skin, slot.attachment) {
                    (Some(_), Some(r)) => Some(data.skins[r.skin].keys[r.index].as_str()),
                    (None, _) => data.slots[i].attachment.as_deref(),
                    _ => None,
                };
                if let Some(index) = name.and_then(|n| data.skins[ns].find(i, n)) {
                    slot.attachment = Some(AttachmentRef { skin: ns, index });
                    slot.deform.clear();
                }
            }
        }
        self.skin = new;
        self.update_cache();
        true
    }

    /// Rebuilds bone/constraint activity and the update order.
    pub fn update_cache(&mut self) {
        let data = self.data.clone();
        let skin = self.skin.map(|s| &data.skins[s]);
        for (i, b) in data.bones.iter().enumerate() {
            let parent_active = b.parent.map_or(true, |p| self.bones[p].active);
            let in_skin = !b.skin_required || skin.is_some_and(|s| s.bones.contains(&i));
            self.bones[i].active = parent_active && in_skin;
        }
        for (i, c) in data.ik.iter().enumerate() {
            let in_skin = !c.skin_required || skin.is_some_and(|s| s.ik.contains(&i));
            let bones_active = self.bones[c.target].active && c.bones.iter().all(|&b| self.bones[b].active);
            self.ik[i].active = in_skin && bones_active;
        }
        for (i, c) in data.transforms.iter().enumerate() {
            let in_skin = !c.skin_required || skin.is_some_and(|s| s.transforms.contains(&i));
            let bones_active = self.bones[c.target].active && c.bones.iter().all(|&b| self.bones[b].active);
            self.transforms[i].active = in_skin && bones_active;
        }
        for (i, c) in data.physics.iter().enumerate() {
            let in_skin = !c.skin_required || skin.is_some_and(|s| s.physics.contains(&i));
            self.physics[i].active = in_skin && self.bones[c.bone].active;
        }
        for (i, c) in data.paths.iter().enumerate() {
            let in_skin = !c.skin_required || skin.is_some_and(|s| s.paths.contains(&i));
            let bones_active = self.bones[data.slots[c.target].bone].active && c.bones.iter().all(|&b| self.bones[b].active);
            self.paths[i].active = in_skin && bones_active;
        }

        let mut sorted = vec![false; data.bones.len()];
        let mut cache = Vec::new();
        for c in data.constraint_order() {
            let single;
            let (active, target, constrained): (bool, usize, &[usize]) = match c {
                ConstraintRef::Ik(i) => (self.ik[i].active, data.ik[i].target, &data.ik[i].bones),
                ConstraintRef::Transform(i) => (self.transforms[i].active, data.transforms[i].target, &data.transforms[i].bones),
                ConstraintRef::Physics(i) => {
                    single = [data.physics[i].bone];
                    (self.physics[i].active, data.physics[i].bone, &single[..])
                }
                ConstraintRef::Path(i) => {
                    let d = &data.paths[i];
                    if self.paths[i].active {
                        // The path's own bones (weighted path attachments) come first.
                        for skin in &data.skins {
                            for (slot, att) in &skin.attachments {
                                if *slot != d.target {
                                    continue;
                                }
                                if let crate::model::AttachmentKind::Path(p) = &att.kind {
                                    if let crate::model::Vertices::Weighted { bones, .. } = &p.shape.vertices {
                                        let mut k = 0;
                                        while k < bones.len() {
                                            let n = bones[k] as usize;
                                            for &b in &bones[k + 1..k + 1 + n] {
                                                self.ensure_sorted(b as usize, &mut sorted, &mut cache);
                                            }
                                            k += n + 1;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    (self.paths[i].active, data.slots[d.target].bone, &d.bones[..])
                }
            };
            if !active {
                continue;
            }
            self.ensure_sorted(target, &mut sorted, &mut cache);
            for &b in constrained {
                self.ensure_sorted(b, &mut sorted, &mut cache);
            }
            cache.push(UpdateItem::Constraint(c));
            // Descendants must be recomputed after the constraint changes their
            // parents; the constrained bones themselves are set by the constraint.
            for &b in constrained {
                self.unsort_descendants(b, &mut sorted);
            }
            for &b in constrained {
                sorted[b] = true;
            }
        }
        for i in 0..data.bones.len() {
            self.ensure_sorted(i, &mut sorted, &mut cache);
        }
        self.cache = cache;
    }

    fn ensure_sorted(&self, bone: usize, sorted: &mut [bool], cache: &mut Vec<UpdateItem>) {
        if sorted[bone] || !self.bones[bone].active {
            return;
        }
        if let Some(p) = self.data.bones[bone].parent {
            self.ensure_sorted(p, sorted, cache);
        }
        cache.push(UpdateItem::Bone(bone));
        sorted[bone] = true;
    }

    fn unsort_descendants(&self, bone: usize, sorted: &mut [bool]) {
        for &c in &self.children[bone] {
            sorted[c] = false;
            self.unsort_descendants(c, sorted);
        }
    }

    pub fn update_order(&self) -> &[UpdateItem] {
        &self.cache
    }

    /// Computes world transforms of all active bones, running constraints.
    pub fn update_world(&mut self) {
        for b in &mut self.bones {
            b.applied = b.pose;
        }
        let cache = std::mem::take(&mut self.cache);
        for item in &cache {
            match *item {
                UpdateItem::Bone(i) => self.update_bone_world(i),
                UpdateItem::Constraint(ConstraintRef::Ik(i)) => constraints::apply_ik(self, i),
                UpdateItem::Constraint(ConstraintRef::Transform(i)) => constraints::apply_transform(self, i),
                UpdateItem::Constraint(ConstraintRef::Physics(i)) => constraints::apply_physics(self, i),
                UpdateItem::Constraint(ConstraintRef::Path(i)) => constraints::apply_path(self, i),
            }
        }
        self.cache = cache;
    }

    /// Like `update_world`, also advancing physics simulations by `dt` seconds.
    pub fn update_world_with_physics(&mut self, dt: f64) {
        self.physics_time += dt.max(0.0);
        self.physics_step = true;
        self.update_world();
        self.physics_step = false;
    }

    /// The skeleton's own transform, acting as the root bone's parent.
    pub fn root_matrix(&self) -> Affine {
        Affine { a: self.scale_x, b: 0.0, c: 0.0, d: self.scale_y, x: self.x, y: self.y }
    }

    pub fn parent_world(&self, bone: usize) -> Affine {
        match self.data.bones[bone].parent {
            Some(p) => self.bones[p].world,
            None => self.root_matrix(),
        }
    }

    /// Linear basis a bone's local matrix is multiplied by, given its
    /// inherit mode: `world.linear = basis * local.linear`. `rotation` is the
    /// bone's local rotation (degrees): for the no-scale modes the bone's X
    /// axis follows where the parent maps that direction.
    pub fn basis(&self, inherit: Inherit, parent: &Affine, rotation: f32) -> Affine {
        let (sx, sy) = (self.scale_x, self.scale_y);
        match inherit {
            Inherit::Normal => Affine::linear(parent.a, parent.b, parent.c, parent.d),
            Inherit::OnlyTranslation => Affine::scaling(sx, sy),
            Inherit::NoRotationOrReflection => {
                let p = self.unscaled(parent);
                let len = p.scale_x();
                let theta = if len > 1e-6 { atan2_deg(p.c, p.a) } else { atan2_deg(p.d, p.b) - 90.0 };
                let other = if len > 1e-6 { p.det().abs() / len } else { p.scale_y() };
                let local = Affine::rotation(theta).mul_linear(&Affine::scaling(len, other)).mul_linear(&Affine::rotation(-theta));
                Affine::scaling(sx, sy).mul_linear(&local)
            }
            Inherit::NoScale | Inherit::NoScaleOrReflection => {
                let p = self.unscaled(parent);
                let frame = self.no_scale_frame(inherit, parent, &p, rotation);
                Affine::scaling(sx, sy).mul_linear(&frame).mul_linear(&Affine::rotation(-rotation))
            }
        }
    }

    /// Parent linear part without the skeleton's own scale / flip.
    fn unscaled(&self, parent: &Affine) -> Affine {
        let isx = if self.scale_x != 0.0 { 1.0 / self.scale_x } else { 0.0 };
        let isy = if self.scale_y != 0.0 { 1.0 / self.scale_y } else { 0.0 };
        Affine::linear(parent.a * isx, parent.b * isx, parent.c * isy, parent.d * isy)
    }

    /// Orthonormal frame of a no-scale bone: X along the parent-mapped local
    /// rotation, Y perpendicular (mirrored for noScale under a reflection).
    fn no_scale_frame(&self, inherit: Inherit, parent: &Affine, p: &Affine, rotation: f32) -> Affine {
        let v = p.apply_vec(Vec2::new(cos_deg(rotation), sin_deg(rotation)));
        let len = v.len();
        let x = if len > 1e-6 { v.scale(1.0 / len) } else { Vec2::new(cos_deg(rotation), sin_deg(rotation)) };
        let flipped = (parent.det() < 0.0) != ((self.scale_x < 0.0) != (self.scale_y < 0.0));
        let sign = if inherit == Inherit::NoScale && flipped { -1.0 } else { 1.0 };
        Affine::linear(x.x, -x.y * sign, x.y, x.x * sign)
    }

    /// World transform of one bone from its parent's world and applied pose.
    pub fn update_bone_world(&mut self, i: usize) {
        let parent = self.parent_world(i);
        let bone = &self.bones[i];
        let l = bone.applied.matrix();
        let pos = parent.apply(Vec2::new(l.x, l.y));
        let w = self.basis(bone.inherit, &parent, bone.applied.rotation).mul_linear(&l);
        self.bones[i].world = Affine { a: w.a, b: w.b, c: w.c, d: w.d, x: pos.x, y: pos.y };
    }

    /// Recomputes a bone's applied local pose from its world transform.
    pub fn world_to_applied(&mut self, i: usize) {
        let parent = self.parent_world(i);
        let w = self.bones[i].world;
        let lp = parent.inverse().apply(w.position());
        let inherit = self.bones[i].inherit;
        let l = match inherit {
            Inherit::NoScale | Inherit::NoScaleOrReflection => {
                // Find the local rotation whose frame has the world X axis.
                let p = self.unscaled(&parent);
                let m = Affine::scaling(self.scale_x, self.scale_y).inverse().mul_linear(&w);
                let col = Vec2::new(m.a, m.c);
                let pi = p.inverse();
                let rotation = if col.len() > 1e-6 && p.det().abs() > 1e-9 {
                    pi.apply_vec(col).angle_deg()
                } else {
                    self.bones[i].applied.rotation
                };
                let frame = self.no_scale_frame(inherit, &parent, &p, rotation);
                let local = frame.inverse().mul_linear(&m);
                Affine::rotation(rotation).mul_linear(&local)
            }
            _ => self.basis(inherit, &parent, 0.0).inverse().mul_linear(&w),
        };
        self.bones[i].applied = Transform::from_matrix(&Affine { x: lp.x, y: lp.y, ..l });
    }

    /// World position of a bone's tip (origin + length along its x axis).
    pub fn bone_tip(&self, i: usize) -> Vec2 {
        self.bones[i].world.apply(Vec2::new(self.data.bones[i].length, 0.0))
    }

    pub fn find_bone(&self, name: &str) -> Option<usize> {
        self.data.find_bone(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BoneData;

    fn bone(name: &str, parent: Option<usize>, setup: Transform, inherit: Inherit) -> BoneData {
        BoneData { name: name.into(), parent, length: 10.0, setup, inherit, skin_required: false, color: Color::WHITE }
    }

    fn t(x: f32, y: f32, rot: f32, sx: f32, sy: f32) -> Transform {
        Transform { x, y, rotation: rot, scale_x: sx, scale_y: sy, ..Default::default() }
    }

    fn close(a: Vec2, b: Vec2) -> bool {
        (a.x - b.x).abs() < 1e-3 && (a.y - b.y).abs() < 1e-3
    }

    #[test]
    fn hierarchy_world_positions() {
        let data = SkeletonData {
            bones: vec![
                bone("root", None, t(0.0, 0.0, 0.0, 1.0, 1.0), Inherit::Normal),
                bone("a", Some(0), t(10.0, 0.0, 90.0, 1.0, 1.0), Inherit::Normal),
                bone("b", Some(1), t(10.0, 0.0, 0.0, 1.0, 1.0), Inherit::Normal),
            ],
            ..Default::default()
        };
        let mut sk = Skeleton::new(Arc::new(data));
        sk.update_world();
        assert!(close(sk.bones[2].world.position(), Vec2::new(10.0, 10.0)));
        assert!(close(sk.bone_tip(2), Vec2::new(10.0, 20.0)));
        // Skeleton flip mirrors everything.
        sk.scale_x = -1.0;
        sk.update_world();
        assert!(close(sk.bones[2].world.position(), Vec2::new(-10.0, 10.0)));
    }

    #[test]
    fn inherit_modes() {
        let data = SkeletonData {
            bones: vec![
                bone("root", None, t(0.0, 0.0, 30.0, 2.0, 2.0), Inherit::Normal),
                bone("norot", Some(0), t(5.0, 0.0, 0.0, 1.0, 1.0), Inherit::NoRotationOrReflection),
                bone("noscale", Some(0), t(5.0, 0.0, 0.0, 1.0, 1.0), Inherit::NoScale),
                bone("onlyt", Some(0), t(5.0, 0.0, 0.0, 1.0, 1.0), Inherit::OnlyTranslation),
            ],
            ..Default::default()
        };
        let mut sk = Skeleton::new(Arc::new(data));
        sk.update_world();
        let norot = sk.bones[1].world;
        assert!(norot.rotation_deg().abs() < 1e-3 && (norot.scale_x() - 2.0).abs() < 1e-3);
        let noscale = sk.bones[2].world;
        assert!((noscale.rotation_deg() - 30.0).abs() < 1e-3 && (noscale.scale_x() - 1.0).abs() < 1e-3);
        let onlyt = sk.bones[3].world;
        assert!(onlyt.rotation_deg().abs() < 1e-3 && (onlyt.scale_x() - 1.0).abs() < 1e-3);
        // All are positioned by the parent's full transform.
        let expected = Vec2::from_angle_deg(30.0, 10.0);
        for i in 1..4 {
            assert!(close(sk.bones[i].world.position(), expected));
        }
        // world_to_applied inverts update_bone_world.
        for i in 1..4 {
            let before = sk.bones[i].world;
            sk.world_to_applied(i);
            sk.update_bone_world(i);
            let after = sk.bones[i].world;
            assert!((before.a - after.a).abs() < 1e-3 && (before.d - after.d).abs() < 1e-3);
        }
    }
}
