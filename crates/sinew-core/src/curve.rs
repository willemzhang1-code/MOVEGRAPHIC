//! Keyframe interpolation curves.

/// Interpolation for the segment starting at a key. Bezier control points
/// are absolute (time, value) coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    Linear,
    Stepped,
    Bezier { cx1: f32, cy1: f32, cx2: f32, cy2: f32 },
}

impl Curve {
    /// Value at `t` for the segment (t0, v0) → (t1, v1).
    pub fn eval(&self, t: f32, t0: f32, v0: f32, t1: f32, v1: f32) -> f32 {
        match *self {
            Curve::Stepped => v0,
            Curve::Linear => {
                let span = t1 - t0;
                if span <= 0.0 {
                    v1
                } else {
                    v0 + (v1 - v0) * ((t - t0) / span)
                }
            }
            Curve::Bezier { cx1, cy1, cx2, cy2 } => {
                if t1 <= t0 {
                    return v1;
                }
                // Clamp control times so x(u) is monotonic.
                let cx1 = cx1.clamp(t0, t1);
                let cx2 = cx2.clamp(t0, t1);
                let u = solve_bezier_x(t, t0, cx1, cx2, t1);
                cubic(u, v0, cy1, cy2, v1)
            }
        }
    }
}

#[inline]
fn cubic(u: f32, p0: f32, p1: f32, p2: f32, p3: f32) -> f32 {
    let iu = 1.0 - u;
    iu * iu * iu * p0 + 3.0 * iu * iu * u * p1 + 3.0 * iu * u * u * p2 + u * u * u * p3
}

#[inline]
fn cubic_deriv(u: f32, p0: f32, p1: f32, p2: f32, p3: f32) -> f32 {
    let iu = 1.0 - u;
    3.0 * iu * iu * (p1 - p0) + 6.0 * iu * u * (p2 - p1) + 3.0 * u * u * (p3 - p2)
}

/// Finds u in [0, 1] with x(u) == t (x monotonic). Newton with bisection fallback.
fn solve_bezier_x(t: f32, x0: f32, x1: f32, x2: f32, x3: f32) -> f32 {
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    let mut u = ((t - x0) / (x3 - x0)).clamp(0.0, 1.0);
    for _ in 0..24 {
        let x = cubic(u, x0, x1, x2, x3) - t;
        if x.abs() < 1e-6 {
            return u;
        }
        if x > 0.0 {
            hi = u;
        } else {
            lo = u;
        }
        let dx = cubic_deriv(u, x0, x1, x2, x3);
        let next = if dx.abs() > 1e-6 { u - x / dx } else { -1.0 };
        u = if next > lo && next < hi { next } else { 0.5 * (lo + hi) };
    }
    u
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linear_and_stepped() {
        assert_eq!(Curve::Linear.eval(0.5, 0.0, 0.0, 1.0, 10.0), 5.0);
        assert_eq!(Curve::Stepped.eval(0.9, 0.0, 0.0, 1.0, 10.0), 0.0);
    }

    #[test]
    fn bezier_endpoints_and_linear_equivalent() {
        // Control points on the straight line reproduce linear interpolation.
        let c = Curve::Bezier { cx1: 1.0 / 3.0, cy1: 10.0 / 3.0, cx2: 2.0 / 3.0, cy2: 20.0 / 3.0 };
        for i in 0..=10 {
            let t = i as f32 / 10.0;
            assert!((c.eval(t, 0.0, 0.0, 1.0, 10.0) - t * 10.0).abs() < 1e-3);
        }
        // Ease-in-out is symmetric and slower at the ends.
        let e = Curve::Bezier { cx1: 0.5, cy1: 0.0, cx2: 0.5, cy2: 1.0 };
        assert!((e.eval(0.5, 0.0, 0.0, 1.0, 1.0) - 0.5).abs() < 1e-3);
        assert!(e.eval(0.1, 0.0, 0.0, 1.0, 1.0) < 0.1);
    }
}
