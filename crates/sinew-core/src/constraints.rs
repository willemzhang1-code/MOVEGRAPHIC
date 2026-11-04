//! Constraint solvers. Each solver writes the bone's applied (local) pose
//! and world transform, so later recomputation from the applied pose is
//! consistent.

use crate::math::{atan2_deg, cos_deg, sin_deg, wrap_deg, Affine, Vec2, RAD_TO_DEG};
use crate::skeleton::Skeleton;

pub fn apply_ik(sk: &mut Skeleton, i: usize) {
    let c = sk.ik[i];
    if c.mix == 0.0 {
        return;
    }
    let data = sk.data.clone();
    let d = &data.ik[i];
    let target = sk.bones[d.target].world.position();
    match d.bones.as_slice() {
        [b] => ik_one(sk, *b, target, c.compress, c.stretch, d.uniform, c.mix),
        [p, ch] => ik_two(sk, *p, *ch, target, c.bend_positive, c.stretch, d.uniform, c.softness, c.mix),
        _ => {}
    }
}

/// Rotates a bone so its x axis points at `target` (world).
pub fn ik_one(sk: &mut Skeleton, b: usize, target: Vec2, compress: bool, stretch: bool, uniform: bool, mix: f32) {
    let parent = sk.parent_world(b);
    let inv = sk.basis(sk.bones[b].inherit, &parent).inverse();
    let pos = sk.bones[b].world.position();
    let local = inv.apply_vec(target.sub(pos));
    let length = sk.data.bones[b].length;
    let ap = &mut sk.bones[b].applied;
    let mut rot = local.angle_deg() - ap.shear_x;
    if ap.scale_x < 0.0 {
        rot += 180.0;
    }
    ap.rotation += wrap_deg(rot - ap.rotation) * mix;
    if compress || stretch {
        let len = (length * ap.scale_x).abs();
        let dist = local.len();
        if len > 1e-4 && ((compress && dist < len) || (stretch && dist > len)) {
            let s = (dist / len - 1.0) * mix + 1.0;
            ap.scale_x *= s;
            if uniform {
                ap.scale_y *= s;
            }
        }
    }
    sk.update_bone_world(b);
}

/// Two-bone IK solved in the parent bone's basis space (law of cosines),
/// independent of child offsets from the parent's axis.
#[allow(clippy::too_many_arguments)]
pub fn ik_two(
    sk: &mut Skeleton,
    p: usize,
    c: usize,
    target: Vec2,
    bend_positive: bool,
    stretch: bool,
    uniform: bool,
    softness: f32,
    mix: f32,
) {
    let parent = sk.parent_world(p);
    let basis = sk.basis(sk.bones[p].inherit, &parent);
    let inv = basis.inverse();
    let origin = sk.bones[p].world.position();
    let to_local = |v: Vec2| inv.apply_vec(v.sub(origin));

    let cw = sk.bones[c].world;
    let cpos = to_local(cw.position());
    let tip = to_local(cw.apply(Vec2::new(sk.data.bones[c].length, 0.0)));
    let mut t = to_local(target);
    let l1 = cpos.len();
    let l2 = tip.sub(cpos).len();
    let mut d = t.len();
    if l1 < 1e-4 || l2 < 1e-4 || d < 1e-6 {
        ik_one(sk, p, target, false, stretch, uniform, mix);
        return;
    }

    let reach = l1 + l2;
    let mut scale = 1.0;
    if stretch && d > reach {
        scale = d / reach;
    } else if softness > 0.0 {
        let start = reach - softness;
        if d > start {
            let soft = start + softness * (1.0 - (-(d - start) / softness).exp());
            t = t.scale(soft / d);
            d = soft;
        }
    }
    let (l1s, l2s) = (l1 * scale, l2 * scale);

    let ap = sk.bones[p].applied;
    let mut bend = if bend_positive { 1.0 } else { -1.0 };
    if ap.scale_x * ap.scale_y < 0.0 {
        bend = -bend;
    }
    let cos_a = ((l1s * l1s + d * d - l2s * l2s) / (2.0 * l1s * d)).clamp(-1.0, 1.0);
    let a = cos_a.acos() * RAD_TO_DEG;
    let desired = t.angle_deg() - bend * a;
    let delta = wrap_deg(desired - cpos.angle_deg());
    {
        let ap = &mut sk.bones[p].applied;
        ap.rotation += delta * mix;
        if scale != 1.0 {
            let s = (scale - 1.0) * mix + 1.0;
            ap.scale_x *= s;
            if uniform {
                ap.scale_y *= s;
            }
        }
    }
    sk.update_bone_world(p);
    sk.update_bone_world(c);
    // Child aims at the (possibly softened) target from its new position.
    let soft_target = basis.apply_vec(t).add(origin);
    ik_one(sk, c, soft_target, false, false, false, mix);
}

pub fn apply_transform(sk: &mut Skeleton, i: usize) {
    let m = sk.transforms[i].mix;
    if m.rotate == 0.0 && m.x == 0.0 && m.y == 0.0 && m.scale_x == 0.0 && m.scale_y == 0.0 && m.shear_y == 0.0 {
        return;
    }
    let data = sk.data.clone();
    let d = &data.transforms[i];
    if d.local {
        let t = sk.bones[d.target].applied;
        for &b in &d.bones {
            let a = &mut sk.bones[b].applied;
            if d.relative {
                a.rotation += (t.rotation + d.offset_rotation) * m.rotate;
                a.x += (t.x + d.offset_x) * m.x;
                a.y += (t.y + d.offset_y) * m.y;
                a.scale_x *= (t.scale_x - 1.0 + d.offset_scale_x) * m.scale_x + 1.0;
                a.scale_y *= (t.scale_y - 1.0 + d.offset_scale_y) * m.scale_y + 1.0;
                a.shear_y += (t.shear_y + d.offset_shear_y) * m.shear_y;
            } else {
                a.rotation += wrap_deg(t.rotation + d.offset_rotation - a.rotation) * m.rotate;
                a.x += (t.x + d.offset_x - a.x) * m.x;
                a.y += (t.y + d.offset_y - a.y) * m.y;
                a.scale_x += (t.scale_x - a.scale_x + d.offset_scale_x) * m.scale_x;
                a.scale_y += (t.scale_y - a.scale_y + d.offset_scale_y) * m.scale_y;
                a.shear_y += wrap_deg(t.shear_y + d.offset_shear_y - a.shear_y) * m.shear_y;
            }
            sk.update_bone_world(b);
        }
        return;
    }

    let tw = sk.bones[d.target].world;
    let t_shear = atan2_deg(tw.d, tw.b) - atan2_deg(tw.c, tw.a);
    for &b in &d.bones {
        let mut w = sk.bones[b].world;
        if m.rotate != 0.0 {
            let r = if d.relative {
                (tw.rotation_deg() + d.offset_rotation) * m.rotate
            } else {
                wrap_deg(tw.rotation_deg() - w.rotation_deg() + d.offset_rotation) * m.rotate
            };
            let rotated = Affine::rotation(r).mul_linear(&w);
            w = Affine { x: w.x, y: w.y, ..rotated };
        }
        if m.x != 0.0 || m.y != 0.0 {
            let tp = tw.apply(Vec2::new(d.offset_x, d.offset_y));
            if d.relative {
                w.x += tp.x * m.x;
                w.y += tp.y * m.y;
            } else {
                w.x += (tp.x - w.x) * m.x;
                w.y += (tp.y - w.y) * m.y;
            }
        }
        if m.scale_x != 0.0 {
            let s = w.scale_x();
            if s > 1e-6 {
                let k = if d.relative {
                    (tw.scale_x() - 1.0 + d.offset_scale_x) * m.scale_x + 1.0
                } else {
                    (s + (tw.scale_x() - s + d.offset_scale_x) * m.scale_x) / s
                };
                w.a *= k;
                w.c *= k;
            }
        }
        if m.scale_y != 0.0 {
            let s = w.scale_y();
            if s > 1e-6 {
                let k = if d.relative {
                    (tw.scale_y() - 1.0 + d.offset_scale_y) * m.scale_y + 1.0
                } else {
                    (s + (tw.scale_y() - s + d.offset_scale_y) * m.scale_y) / s
                };
                w.b *= k;
                w.d *= k;
            }
        }
        if m.shear_y != 0.0 {
            let ax = atan2_deg(w.c, w.a);
            let ay = atan2_deg(w.d, w.b);
            let shear = ay - ax;
            let r = if d.relative {
                (t_shear + d.offset_shear_y - 90.0) * m.shear_y
            } else {
                wrap_deg(t_shear + d.offset_shear_y - shear) * m.shear_y
            };
            let ny = ay + r;
            let s = w.scale_y();
            w.b = cos_deg(ny) * s;
            w.d = sin_deg(ny) * s;
        }
        sk.bones[b].world = w;
        sk.world_to_applied(b);
    }
}

/// Physics: the bone lags behind its animated motion like a damped spring
/// (translation, rotation from tip lag, stretch along the bone), stepped at
/// a fixed rate and pushed by wind / gravity. Offsets are added on top of the
/// animated world transform.
pub fn apply_physics(sk: &mut Skeleton, i: usize) {
    let data = sk.data.clone();
    let d = &data.physics[i];
    let b = d.bone;
    let w = sk.bones[b].world;
    let pos = w.position();
    let dt_total = sk.physics_dt;
    let c = &mut sk.physics[i];
    let p = c.params;
    if c.reset {
        c.reset = false;
        c.last = pos;
        c.accum = 0.0;
        c.offset = Vec2::ZERO;
        c.velocity = Vec2::ZERO;
        c.rotation = 0.0;
        c.rotation_velocity = 0.0;
        c.scale = 0.0;
        c.scale_velocity = 0.0;
    }
    let len = (data.bones[b].length * w.scale_x()).max(1e-3);
    let sx = w.scale_x().max(1e-6);
    let dir = Vec2::new(w.a / sx, w.c / sx);

    if dt_total > 0.0 {
        // Inertia: the simulated bone stays behind when its origin moves.
        let delta = pos.sub(c.last);
        c.last = pos;
        let lag = delta.scale(-p.inertia);
        c.offset = c.offset.add(lag);
        c.rotation += (dir.x * lag.y - dir.y * lag.x) / len * RAD_TO_DEG;
        c.scale += (dir.x * lag.x + dir.y * lag.y) / len;

        let step = 1.0 / d.fps.max(1.0);
        c.accum = (c.accum + dt_total).min(step * 30.0);
        let k = p.strength;
        let damp = p.damping * 2.0 * k.max(0.0).sqrt() * 0.5;
        let force = Vec2::new(p.wind, -p.gravity);
        let ext_rot = (dir.x * force.y - dir.y * force.x) / len * RAD_TO_DEG;
        let ext_scale = (dir.x * force.x + dir.y * force.y) / len;
        while c.accum >= step {
            c.accum -= step;
            let a = c.offset.scale(-k * p.mass_inverse).sub(c.velocity.scale(damp)).add(force.scale(p.mass_inverse));
            c.velocity = c.velocity.add(a.scale(step));
            c.offset = c.offset.add(c.velocity.scale(step));
            let ra = -k * c.rotation * p.mass_inverse - damp * c.rotation_velocity + ext_rot * p.mass_inverse;
            c.rotation_velocity += ra * step;
            c.rotation += c.rotation_velocity * step;
            let sa = -k * c.scale * p.mass_inverse - damp * c.scale_velocity + ext_scale * p.mass_inverse;
            c.scale_velocity += sa * step;
            c.scale += c.scale_velocity * step;
        }
        let l = c.offset.len();
        if l > d.limit && l > 0.0 {
            c.offset = c.offset.scale(d.limit / l);
            c.velocity = Vec2::ZERO;
        }
        c.rotation = c.rotation.clamp(-170.0, 170.0);
        c.scale = c.scale.clamp(-0.9, 4.0);
    } else {
        c.last = pos;
    }

    let mix = p.mix;
    let (off, rot, scale) = (c.offset, c.rotation, c.scale);
    if mix == 0.0 {
        return;
    }
    let mut w = sk.bones[b].world;
    w.x += off.x * d.x * mix;
    w.y += off.y * d.y * mix;
    let r = rot * d.rotate * mix;
    if r != 0.0 {
        let rotated = Affine::rotation(r).mul_linear(&w);
        w = Affine { x: w.x, y: w.y, ..rotated };
    }
    let s = 1.0 + scale * d.scale_x * mix;
    if s != 1.0 {
        w.a *= s;
        w.c *= s;
    }
    let sh = rot * d.shear_x * mix;
    if sh != 0.0 {
        let ry = Affine::rotation(sh).apply_vec(Vec2::new(w.b, w.d));
        w.b = ry.x;
        w.d = ry.y;
    }
    sk.bones[b].world = w;
    sk.world_to_applied(b);
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::math::{Color, Transform};
    use crate::model::{BoneData, IkConstraintData, Inherit, SkeletonData};

    fn bone(name: &str, parent: Option<usize>, x: f32, y: f32, rot: f32, len: f32) -> BoneData {
        BoneData {
            name: name.into(),
            parent,
            length: len,
            setup: Transform { x, y, rotation: rot, ..Default::default() },
            inherit: Inherit::Normal,
            skin_required: false,
            color: Color::WHITE,
        }
    }

    fn ik(bones: Vec<usize>, target: usize, bend_positive: bool) -> IkConstraintData {
        IkConstraintData {
            name: "ik".into(),
            order: 0,
            skin_required: false,
            bones,
            target,
            mix: 1.0,
            softness: 0.0,
            bend_positive,
            compress: false,
            stretch: false,
            uniform: false,
        }
    }

    #[test]
    fn two_bone_ik_reaches_target() {
        // Leg pointing down: thigh (len 50), shin (len 50), target in reach.
        let data = SkeletonData {
            bones: vec![
                bone("root", None, 0.0, 0.0, 0.0, 0.0),
                bone("thigh", Some(0), 0.0, 100.0, -90.0, 50.0),
                bone("shin", Some(1), 50.0, 0.0, 0.0, 50.0),
                bone("target", Some(0), 20.0, 30.0, 0.0, 0.0),
            ],
            ik: vec![ik(vec![1, 2], 3, true)],
            ..Default::default()
        };
        let mut sk = Skeleton::new(Arc::new(data));
        sk.update_world();
        let tip = sk.bone_tip(2);
        assert!((tip.x - 20.0).abs() < 1e-2 && (tip.y - 30.0).abs() < 1e-2, "tip {tip:?}");
        // Knee bends to one side, and flips with bend direction.
        let knee_pos = sk.bones[2].world.position();
        let mut sk2 = sk.clone();
        sk2.ik[0].bend_positive = false;
        sk2.update_world();
        let knee_neg = sk2.bones[2].world.position();
        assert!((knee_pos.x - knee_neg.x).abs() > 1.0);
        let tip2 = sk2.bone_tip(2);
        assert!((tip2.x - 20.0).abs() < 1e-2 && (tip2.y - 30.0).abs() < 1e-2);
    }

    #[test]
    fn two_bone_ik_out_of_reach_straightens() {
        let data = SkeletonData {
            bones: vec![
                bone("root", None, 0.0, 0.0, 0.0, 0.0),
                bone("a", Some(0), 0.0, 0.0, 0.0, 10.0),
                bone("b", Some(1), 10.0, 0.0, 30.0, 10.0),
                bone("target", Some(0), 0.0, 100.0, 0.0, 0.0),
            ],
            ik: vec![ik(vec![1, 2], 3, true)],
            ..Default::default()
        };
        let mut sk = Skeleton::new(Arc::new(data));
        sk.update_world();
        let tip = sk.bone_tip(2);
        assert!(tip.x.abs() < 1e-2 && (tip.y - 20.0).abs() < 1e-2, "tip {tip:?}");
    }

    #[test]
    fn one_bone_ik_points_at_target() {
        let data = SkeletonData {
            bones: vec![
                bone("root", None, 0.0, 0.0, 0.0, 0.0),
                bone("arm", Some(0), 5.0, 5.0, 0.0, 10.0),
                bone("target", Some(0), 5.0, 25.0, 0.0, 0.0),
            ],
            ik: vec![ik(vec![1], 2, true)],
            ..Default::default()
        };
        let mut sk = Skeleton::new(Arc::new(data));
        sk.update_world();
        assert!((sk.bones[1].world.rotation_deg() - 90.0).abs() < 1e-3);
    }

    #[test]
    fn physics_lags_then_settles() {
        use crate::model::{PhysicsConstraintData, PhysicsParams};
        let data = SkeletonData {
            bones: vec![bone("root", None, 0.0, 0.0, 0.0, 0.0), bone("tail", Some(0), 0.0, 0.0, 0.0, 50.0)],
            physics: vec![PhysicsConstraintData {
                name: "p".into(),
                order: 0,
                skin_required: false,
                bone: 1,
                x: 1.0,
                y: 1.0,
                rotate: 1.0,
                scale_x: 0.0,
                shear_x: 0.0,
                limit: 5000.0,
                fps: 60.0,
                params: PhysicsParams { inertia: 1.0, strength: 100.0, damping: 1.0, mass_inverse: 1.0, wind: 0.0, gravity: 0.0, mix: 1.0 },
                global: [false; 7],
            }],
            ..Default::default()
        };
        let mut sk = Skeleton::new(Arc::new(data));
        sk.update_world_with_physics(1.0 / 60.0);
        // Move the skeleton right: the simulated bone lags behind and rotates.
        sk.x = 100.0;
        sk.update_world_with_physics(1.0 / 60.0);
        let p = sk.bones[1].world.position();
        assert!(p.x < 50.0, "should lag, got {p:?}");
        assert!(sk.physics[0].rotation.abs() < 1e-3, "pure x move along bone: no rotation");
        // Settles back.
        for _ in 0..240 {
            sk.update_world_with_physics(1.0 / 60.0);
        }
        let p = sk.bones[1].world.position();
        assert!((p.x - 100.0).abs() < 0.5 && p.y.abs() < 0.5, "settled at {p:?}");
        // Vertical move rotates the bone (tip lags).
        sk.y = 50.0;
        sk.update_world_with_physics(1.0 / 60.0);
        assert!(sk.physics[0].rotation < -1.0, "rotation {}", sk.physics[0].rotation);
    }
}
