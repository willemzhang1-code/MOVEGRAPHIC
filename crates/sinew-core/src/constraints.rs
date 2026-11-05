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
    let inv = sk.basis(sk.bones[b].inherit, &parent, sk.bones[b].applied.rotation).inverse();
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

/// Two-bone IK. Solved in the parent's basis space with the parent's scale
/// taken into account: as the child rotates, its tip traces an ellipse
/// (the child segment scaled by the parent's non-uniform scale); the solution
/// is where that ellipse meets the circle of radius |target| around the
/// parent's origin.
#[allow(clippy::too_many_arguments)]
/// Two-bone chain geometry in the parent's unrotated frame (f64).
struct Geo2 {
    cx: f64,
    cy: f64,
    sx: f64,
    sy: f64,
    l2: f64,
}

impl Geo2 {
    /// Child tip for child rotation `phi`, parent scale multiplied by (kx, ky).
    fn tip(&self, phi: f64, kx: f64, ky: f64) -> (f64, f64) {
        let (sx, sy) = (self.sx * kx, self.sy * ky);
        (self.cx * sx + sx * self.l2 * phi.cos(), self.cy * sy + sy * self.l2 * phi.sin())
    }

    /// Child rotation of the straight (farthest-reaching) pose, and its reach.
    fn straight(&self, kx: f64, ky: f64) -> (f64, f64) {
        let (sx, sy) = (self.sx * kx, self.sy * ky);
        let (cx, cy) = (self.cx * sx, self.cy * sy);
        let (a, b) = (sx * self.l2, sy * self.l2);
        let r = |phi: f64| {
            let (x, y) = self.tip(phi, kx, ky);
            x.hypot(y)
        };
        // Start from the best sample, then Newton on d|tip|²/dphi = 0.
        let mut phi = (cy * b).atan2(cx * a);
        let mut best = r(phi);
        for i in 0..64 {
            let p = std::f64::consts::TAU * i as f64 / 64.0;
            if r(p) > best {
                best = r(p);
                phi = p;
            }
        }
        for _ in 0..30 {
            let (s, c) = phi.sin_cos();
            let g = (b * b - a * a) * s * c - cx * a * s + cy * b * c;
            let dg = (b * b - a * a) * (c * c - s * s) - cx * a * c - cy * b * s;
            if dg.abs() < 1e-15 {
                break;
            }
            let next = phi - g / dg;
            if r(next) + 1e-12 < r(phi) {
                break;
            }
            phi = next;
        }
        (phi, r(phi))
    }

    fn min_reach(&self) -> f64 {
        (0..256)
            .map(|i| {
                let (x, y) = self.tip(std::f64::consts::TAU * i as f64 / 256.0, 1.0, 1.0);
                x.hypot(y)
            })
            .fold(f64::MAX, f64::min)
    }
}

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
    let basis = sk.basis(sk.bones[p].inherit, &parent, sk.bones[p].applied.rotation);
    let origin = sk.bones[p].world.position();
    let t = basis.inverse().apply_vec(target.sub(origin));
    let ap = sk.bones[p].applied;
    let (sx, sy) = (ap.scale_x, ap.scale_y);
    // With a non-uniformly scaled parent, or stretch, the child's origin is
    // placed on the parent's X axis (its local y is dropped), as the
    // reference runtime does.
    if stretch || (sx.abs() - sy.abs()).abs() > 1e-4 {
        sk.bones[c].applied.y = 0.0;
    }
    let ac = sk.bones[c].applied;
    let l2 = sk.data.bones[c].length * ac.scale_x;
    if Vec2::new(ac.x * sx, ac.y * sy).len() < 1e-4 || l2.abs() < 1e-4 {
        ik_one(sk, p, target, false, stretch, uniform, mix);
        return;
    }
    let mut d = t.len();
    if d < 1e-6 {
        return;
    }
    // Child tip in the parent's (unrotated) frame for child rotation phi, with
    // the parent's scale multiplied by (kx, ky) (stretch).
    let geo = Geo2 { cx: ac.x as f64, cy: ac.y as f64, sx: sx as f64, sy: sy as f64, l2: l2 as f64 };
    let (mut phi_max, mut max_r) = geo.straight(1.0, 1.0);
    let min_r = geo.min_reach();
    let mut k = (1.0f64, 1.0f64);
    // Softness is authored in unscaled units: scale it like the chain.
    let softness = softness * sx.abs() * (ac.scale_x.abs() + 1.0) * 0.5;
    if softness > 0.0 {
        // Bends ease in over `softness` before full reach (quadratic), reaching
        // it at max + softness. Stretch never engages with softness.
        let start = max_r as f32 - softness;
        if d > start {
            let p = ((d - start) / (softness * 2.0)).min(1.0);
            d = start + softness * (1.0 - (1.0 - p) * (1.0 - p));
        }
    } else if stretch && d as f64 > max_r {
        // Stretch the parent (X, or both axes when uniform) until the straight
        // chain reaches the target exactly.
        let (mut lo, mut hi) = (1.0f64, 2.0f64);
        let ky = |s: f64| if uniform { s } else { 1.0 };
        while geo.straight(hi, ky(hi)).1 < d as f64 && hi < 1e6 {
            lo = hi;
            hi *= 2.0;
        }
        for _ in 0..60 {
            let m = 0.5 * (lo + hi);
            if geo.straight(m, ky(m)).1 < d as f64 {
                lo = m;
            } else {
                hi = m;
            }
        }
        k = (hi, ky(hi));
        (phi_max, max_r) = geo.straight(k.0, k.1);
    }
    let scale = k.0 as f32;
    let d = (d as f64).clamp(min_r, max_r);
    let tip = |phi: f64| geo.tip(phi, k.0, k.1);
    // Bend side: positive child rotation for bendPositive (mirrored by
    // reflection), measured from the straight pose.
    let mut bend = if bend_positive { 1.0 } else { -1.0 };
    if sx * sy < 0.0 {
        bend = -bend;
    }
    let f = |phi: f64| tip(phi).0.hypot(tip(phi).1) - d;
    let pi = std::f64::consts::PI;
    let (lo, hi) = if bend > 0.0 { (phi_max, phi_max + pi) } else { (phi_max - pi, phi_max) };
    // Root of f on the bend side: scan, then bisect; fall back to the closest sample.
    const N: usize = 96;
    let mut best = lo;
    let mut best_err = f(lo).abs();
    let mut root = None;
    let mut prev = (lo, f(lo));
    for i in 1..=N {
        let phi = lo + (hi - lo) * i as f64 / N as f64;
        let v = f(phi);
        if v.abs() < best_err {
            best_err = v.abs();
            best = phi;
        }
        if root.is_none() && (prev.1 <= 0.0) != (v <= 0.0) {
            let (mut a, mut b) = (prev.0, phi);
            let fa = prev.1;
            for _ in 0..60 {
                let m = 0.5 * (a + b);
                if (f(m) <= 0.0) == (fa <= 0.0) {
                    a = m;
                } else {
                    b = m;
                }
            }
            root = Some(0.5 * (a + b));
        }
        prev = (phi, v);
    }
    let phi = root.unwrap_or(best);
    let (rx, ry) = tip(phi);
    let reach = Vec2::new(rx as f32, ry as f32);
    let phi = phi as f32;
    let theta = t.angle_deg() - reach.angle_deg();
    {
        let ap = &mut sk.bones[p].applied;
        let cur = ap.rotation + ap.shear_x;
        ap.rotation += wrap_deg(theta - cur) * mix;
        if scale != 1.0 {
            let s = (scale - 1.0) * mix + 1.0;
            ap.scale_x *= s;
            if uniform {
                ap.scale_y *= s;
            }
        }
    }
    {
        let acm = &mut sk.bones[c].applied;
        let want = phi * RAD_TO_DEG;
        let cur = acm.rotation + acm.shear_x;
        acm.rotation += wrap_deg(want - cur) * mix;
    }
    sk.update_bone_world(p);
    sk.update_bone_world(c);
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

/// Arc-length sampled path in world space.
/// A path attachment's curves in world space, with arc-length lookup
/// matching the reference runtime: each curve's length is its 4-chord
/// approximation (or the attachment's stored lengths without constant
/// speed); within a curve, constant speed maps distance to the curve
/// parameter through a 10-chord table. Open paths continue straight past
/// their ends along the end handles; closed paths wrap.
struct PathSamples {
    /// Control points per curve (p0, p1, p2, p3).
    curves: Vec<[Vec2; 4]>,
    /// Cumulative length at the end of each curve.
    ends: Vec<f32>,
    constant: bool,
    closed: bool,
}

#[inline]
fn bezier(c: &[Vec2; 4], t: f32) -> Vec2 {
    let u = 1.0 - t;
    let (a, b, cc, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    Vec2::new(a * c[0].x + b * c[1].x + cc * c[2].x + d * c[3].x, a * c[0].y + b * c[1].y + cc * c[2].y + d * c[3].y)
}

#[inline]
fn bezier_tangent(c: &[Vec2; 4], t: f32) -> Vec2 {
    let u = 1.0 - t;
    let (a, b, d) = (3.0 * u * u, 6.0 * u * t, 3.0 * t * t);
    Vec2::new(
        a * (c[1].x - c[0].x) + b * (c[2].x - c[1].x) + d * (c[3].x - c[2].x),
        a * (c[1].y - c[0].y) + b * (c[2].y - c[1].y) + d * (c[3].y - c[2].y),
    )
}

fn chord_length(c: &[Vec2; 4], n: usize) -> f32 {
    let mut prev = c[0];
    let mut total = 0.0;
    for k in 1..=n {
        let p = bezier(c, k as f32 / n as f32);
        total += p.sub(prev).len();
        prev = p;
    }
    total
}

impl PathSamples {
    fn total(&self) -> f32 {
        *self.ends.last().unwrap_or(&0.0)
    }

    /// Point and tangent angle (degrees) at distance `d` along the path.
    fn at(&self, mut d: f32) -> (Vec2, f32) {
        let total = self.total();
        let (Some(first), Some(last)) = (self.curves.first(), self.curves.last()) else { return (Vec2::ZERO, 0.0) };
        if total <= 1e-6 {
            return (first[0], 0.0);
        }
        if self.closed {
            d = d.rem_euclid(total);
        } else if d < 0.0 {
            let a = first[1].sub(first[0]).angle_deg();
            return (first[0].add(Vec2::from_angle_deg(a, d)), a);
        } else if d > total {
            let a = last[3].sub(last[2]).angle_deg();
            return (last[3].add(Vec2::from_angle_deg(a, d - total)), a);
        }
        let i = self.ends.partition_point(|&e| e <= d).min(self.curves.len() - 1);
        let start = if i == 0 { 0.0 } else { self.ends[i - 1] };
        let len = self.ends[i] - start;
        let q = if len > 0.0 { (d - start) / len } else { 0.0 };
        let c = &self.curves[i];
        let t = if self.constant { Self::constant_t(c, q) } else { q };
        (bezier(c, t), bezier_tangent(c, t).angle_deg())
    }

    /// Curve parameter at fraction `q` of the curve's 10-chord length.
    fn constant_t(c: &[Vec2; 4], q: f32) -> f32 {
        const N: usize = 10;
        let mut pts = [Vec2::ZERO; N + 1];
        let mut seg = [0.0f32; N];
        pts[0] = c[0];
        let mut total = 0.0;
        for k in 1..=N {
            pts[k] = bezier(c, k as f32 / N as f32);
            seg[k - 1] = pts[k].sub(pts[k - 1]).len();
            total += seg[k - 1];
        }
        let x = q * total;
        let mut acc = 0.0;
        for k in 0..N {
            if x <= acc + seg[k] || k == N - 1 {
                let f = if seg[k] > 0.0 { (x - acc) / seg[k] } else { 0.0 };
                return (k as f32 + f) / N as f32;
            }
            acc += seg[k];
        }
        1.0
    }
}

fn sample_path(pts: &[Vec2], closed: bool, constant: bool, lengths: &[f32]) -> PathSamples {
    let n = pts.len();
    let count = if closed { n / 3 } else { (n / 3).saturating_sub(1) };
    let curves: Vec<[Vec2; 4]> = (0..count)
        .map(|c| [pts[(3 * c + 1) % n], pts[(3 * c + 2) % n], pts[(3 * c + 3) % n], pts[(3 * c + 4) % n]])
        .collect();
    let ends = if constant || lengths.len() < curves.len() {
        let mut total = 0.0;
        curves
            .iter()
            .map(|c| {
                total += chord_length(c, 4);
                total
            })
            .collect()
    } else {
        lengths[..curves.len()].to_vec()
    };
    PathSamples { curves, ends, constant, closed }
}

/// Path constraint: bones follow a Bezier path attachment.
pub fn apply_path(sk: &mut Skeleton, i: usize) {
    use crate::model::{AttachmentKind, PositionMode, RotateMode, SpacingMode};
    let c = sk.paths[i];
    if c.mix_rotate == 0.0 && c.mix_x == 0.0 && c.mix_y == 0.0 {
        return;
    }
    let data = sk.data.clone();
    let d = &data.paths[i];
    let Some(r) = sk.slots[d.target].attachment else { return };
    let AttachmentKind::Path(path) = &data.attachment(r).kind else { return };
    let mut pts = Vec::new();
    crate::render::world_vertices(sk, d.target, &path.shape.vertices, path.shape.vertex_count, &mut pts);
    let samples = sample_path(&pts, path.closed, path.constant_speed, &path.lengths);
    let total = samples.total();
    if total <= 1e-6 {
        return;
    }
    let nb = d.bones.len();
    let bone_len = |sk: &Skeleton, b: usize| data.bones[b].length * sk.bones[b].world.scale_x();
    let mut spaces = vec![0.0f32; nb];
    match d.spacing_mode {
        SpacingMode::Length => {
            for (k, &b) in d.bones.iter().enumerate() {
                spaces[k] = bone_len(sk, b) + c.spacing;
            }
        }
        SpacingMode::Fixed => spaces.fill(c.spacing),
        SpacingMode::Percent => spaces.fill(c.spacing * total),
        SpacingMode::Proportional => {
            let sum: f32 = d.bones.iter().map(|&b| bone_len(sk, b)).sum();
            for (k, &b) in d.bones.iter().enumerate() {
                spaces[k] = if sum > 0.0 { bone_len(sk, b) / sum * c.spacing * total } else { 0.0 };
            }
        }
    }
    let mut dist = match d.position_mode {
        PositionMode::Percent => c.position * total,
        PositionMode::Fixed => c.position,
    };
    // Chain mode without a rotation offset: each bone after the first starts
    // at the previous bone's tip (blended toward the path by mixRotate).
    let tip_mode = d.rotate_mode == RotateMode::Chain && d.offset_rotation == 0.0;
    let mut tip: Option<Vec2> = None;
    for (k, &b) in d.bones.iter().enumerate() {
        let (on_path, tangent) = samples.at(dist);
        let p = if tip_mode { tip.unwrap_or(on_path) } else { on_path };
        let next_dist = dist + spaces[k];
        let (next, _) = samples.at(next_dist);
        let to_next = next.sub(p);
        let raw = match d.rotate_mode {
            RotateMode::Tangent => tangent,
            _ if to_next.len() > 1e-4 => to_next.angle_deg(),
            _ => tangent,
        };
        if tip_mode {
            let ideal = p.add(Vec2::from_angle_deg(raw, bone_len(sk, b)));
            tip = Some(next.add(ideal.sub(next).scale(c.mix_rotate)));
        }
        let mut w = sk.bones[b].world;
        w.x += (p.x - w.x) * c.mix_x;
        w.y += (p.y - w.y) * c.mix_y;
        if c.mix_rotate > 0.0 {
            if d.rotate_mode == RotateMode::ChainScale {
                let len = bone_len(sk, b);
                if len > 1e-4 {
                    let s = (to_next.len() / len - 1.0) * c.mix_rotate + 1.0;
                    w.a *= s;
                    w.c *= s;
                }
            }
            let delta = wrap_deg(raw + d.offset_rotation - w.rotation_deg()) * c.mix_rotate;
            let rotated = Affine::rotation(delta).mul_linear(&w);
            w = Affine { x: w.x, y: w.y, ..rotated };
        }
        sk.bones[b].world = w;
        dist = next_dist;
    }
    // Local poses once every bone is placed (bones may be listed out of hierarchy order).
    for &b in &d.bones {
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
    let angle = w.c.atan2(w.a);
    let data_len = data.bones[b].length;
    let len = data_len * (w.a * w.a + w.c * w.c).sqrt();
    let ref_scale = if data.reference_scale > 0.0 { data.reference_scale } else { 100.0 };
    let (skx, sky) = (sk.scale_x, sk.scale_y);
    let time = sk.physics_time;
    let step = sk.physics_step;
    let c = &mut sk.physics[i];
    let p = c.params;
    if !step {
        // Pose only: draw the current simulation state.
        if !c.reset {
            apply_physics_offsets(sk, i);
        }
        return;
    }
    if !c.started {
        c.started = true;
        c.last_time = time;
    }
    let delta = (time - c.last_time).max(0.0);
    c.last_time = time;
    if c.reset {
        c.remaining = 0.0;
    }
    c.remaining += delta;
    if c.reset {
        // Rest at the current pose; this frame's time is simulated next frame.
        c.reset = false;
        c.last_pos = pos;
        c.last_angle = angle;
        c.last_len = len;
        c.offset = Vec2::ZERO;
        c.velocity = Vec2::ZERO;
        c.rotation = 0.0;
        c.rotation_velocity = 0.0;
        c.scale = 0.0;
        c.scale_velocity = 0.0;
        return;
    }
    let h = 1.0 / (d.fps.max(1.0) as f64);
    let mut steps = 0u32;
    while c.remaining >= h {
        c.remaining -= h;
        steps += 1;
    }
    if steps > MAX_PHYSICS_STEPS {
        // Long stall (e.g. a backgrounded tab): don't burn the frame catching up.
        steps = MAX_PHYSICS_STEPS;
    }
    let hf = h as f32;
    let mix = p.mix;
    let inertia = p.inertia;
    let k = p.strength * p.mass_inverse;
    let gamma = if p.damping >= 1.0 { 1.0 } else { p.damping.max(0.0).powf(60.0 * hf) };
    // Wind / gravity as acceleration (per unit mass); translation works in skeleton units.
    let g = Vec2::new(p.wind, -p.gravity).scale(p.mass_inverse);
    let force = Vec2::new(g.x * ref_scale * skx, g.y * ref_scale * sky);

    // Inertia: the bone's origin stays behind when it moves, by at most
    // `limit` per second (per axis, in skeleton-scaled units).
    let lim = (d.limit * delta as f32).abs();
    let (qx, qy) = (lim * skx.abs(), lim * sky.abs());
    let mv = pos.sub(c.last_pos);
    let before = c.offset;
    c.offset.x -= (mv.x * inertia).clamp(-qx, qx);
    c.offset.y -= (mv.y * inertia).clamp(-qy, qy);
    for _ in 0..steps {
        c.velocity = c.velocity.scale(gamma).add(force.sub(c.offset.scale(k)).scale(hf));
        c.offset = c.offset.add(c.velocity.scale(hf));
    }

    // Rotation / scale: the tip drawn last frame stays put while the drawn origin moves.
    let moved = Vec2::new(
        (mv.x + (c.offset.x - before.x) * d.x * mix).clamp(-qx, qx),
        (mv.y + (c.offset.y - before.y) * d.y * mix).clamp(-qy, qy),
    );
    let turn = (d.rotate + d.shear_x) * mix;
    if len > 0.0 {
        let last_tip_angle = c.last_angle + c.rotation * turn;
        let last_len = c.last_len * (1.0 + c.scale * d.scale_x * mix);
        let v = Vec2::new(last_tip_angle.cos() * last_len - moved.x, last_tip_angle.sin() * last_len - moved.y);
        let base = angle + c.rotation * turn;
        let (bc, bs) = (base.cos(), base.sin());
        c.rotation += inertia * (bc * v.y - bs * v.x).atan2(bc * v.x + bs * v.y);
        let dir = angle + c.rotation * turn;
        c.scale -= inertia * (moved.x * dir.cos() + moved.y * dir.sin()) / len;
    }
    for _ in 0..steps {
        let a = angle + c.rotation;
        let (ac, as_) = (a.cos(), a.sin());
        // Gravity / wind torque ignores bone and skeleton scale.
        let torque = (ac * g.y - as_ * g.x) * data_len / ref_scale;
        c.rotation_velocity = c.rotation_velocity * gamma + (torque - k * c.rotation) * hf;
        c.rotation += c.rotation_velocity * hf;
        let pull = ac * g.x + as_ * g.y;
        c.scale_velocity = c.scale_velocity * gamma + (pull - k * c.scale) * hf;
        c.scale += c.scale_velocity * hf;
    }
    c.last_pos = pos;
    c.last_angle = angle;
    c.last_len = len;

    apply_physics_offsets(sk, i);
}

/// Adds a physics constraint's current offsets to its bone's world transform.
fn apply_physics_offsets(sk: &mut Skeleton, i: usize) {
    let d = &sk.data.physics[i];
    let (b, dx, dy, drot, dsx, dsh) = (d.bone, d.x, d.y, d.rotate, d.scale_x, d.shear_x);
    let c = &sk.physics[i];
    let mix = c.params.mix;
    if mix == 0.0 {
        return;
    }
    let (off, rot, scale) = (c.offset, c.rotation, c.scale);
    let mut w = sk.bones[b].world;
    w.x += off.x * dx * mix;
    w.y += off.y * dy * mix;
    let r = rot * drot * mix;
    if r != 0.0 {
        let rotated = Affine::rotation(r * RAD_TO_DEG).mul_linear(&w);
        w = Affine { x: w.x, y: w.y, ..rotated };
    }
    // shearX turns only the X axis; scaleX stretches it.
    let sh = rot * dsh * mix;
    let s = 1.0 + scale * dsx * mix;
    if sh != 0.0 || s != 1.0 {
        let (cs, sn) = (sh.cos() * s, sh.sin() * s);
        let (a, c2) = (w.a, w.c);
        w.a = a * cs - c2 * sn;
        w.c = a * sn + c2 * cs;
    }
    sk.bones[b].world = w;
    sk.world_to_applied(b);
}

/// Upper bound on simulation steps per frame.
const MAX_PHYSICS_STEPS: u32 = 600;

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

    fn physics_rig(x: f32, rotate: f32, damping: f32) -> Skeleton {
        use crate::model::{PhysicsConstraintData, PhysicsParams};
        let data = SkeletonData {
            bones: vec![bone("root", None, 0.0, 0.0, 0.0, 0.0), bone("tail", Some(0), 0.0, 0.0, -90.0, 100.0)],
            physics: vec![PhysicsConstraintData {
                name: "p".into(),
                order: 0,
                skin_required: false,
                bone: 1,
                x,
                y: x,
                rotate,
                scale_x: 0.0,
                shear_x: 0.0,
                limit: 5000.0,
                fps: 60.0,
                params: PhysicsParams { inertia: 1.0, strength: 100.0, damping, mass_inverse: 1.0, wind: 0.0, gravity: 0.0, mix: 1.0 },
                global: [false; 7],
            }],
            reference_scale: 100.0,
            ..Default::default()
        };
        Skeleton::new(Arc::new(data))
    }

    // Reference values: step responses recorded from the official runtime
    // (web/parity/physics.html, cases x-base and rot-base).
    const DT: f64 = 1.0005 / 60.0;

    #[test]
    fn physics_translation_step_matches_reference() {
        let mut sk = physics_rig(1.0, 0.0, 1.0);
        sk.update_world_with_physics(DT);
        sk.x = 50.0;
        for want in [-48.611, -45.872, -41.858, -36.682, -30.487] {
            sk.update_world_with_physics(DT);
            let got = sk.bones[1].world.x - 50.0;
            assert!((got - want).abs() < 2e-3, "offset {got} want {want}");
        }
    }

    #[test]
    fn physics_rotation_step_matches_reference() {
        let mut sk = physics_rig(0.0, 1.0, 1.0);
        sk.update_world_with_physics(DT);
        sk.x = 50.0;
        for want in [-25.827, -24.372, -22.239, -19.489] {
            sk.update_world_with_physics(DT);
            let got = sk.bones[1].world.rotation_deg() + 90.0;
            assert!((got - want).abs() < 2e-3, "rotation {got} want {want}");
        }
    }

    #[test]
    fn physics_settles_with_damping() {
        let mut sk = physics_rig(1.0, 1.0, 0.85);
        sk.update_world_with_physics(DT);
        sk.x = 40.0;
        sk.y = 20.0;
        for _ in 0..600 {
            sk.update_world_with_physics(DT);
        }
        let w = sk.bones[1].world;
        assert!((w.x - 40.0).abs() < 0.05 && (w.y - 20.0).abs() < 0.05, "settled at {:?}", w.position());
        assert!((w.rotation_deg() + 90.0).abs() < 0.05);
    }
}
