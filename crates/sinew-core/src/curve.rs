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
                // The curve is flattened to BEZIER_SEGMENTS lines (uniform in
                // the curve parameter), as the reference runtimes do; the
                // exact solve differs by up to ~1.5% of the key delta.
                let (mut px, mut py) = (t0, v0);
                for i in 1..=BEZIER_SEGMENTS {
                    let u = i as f32 / BEZIER_SEGMENTS as f32;
                    let x = cubic(u, t0, cx1, cx2, t1);
                    let y = cubic(u, v0, cy1, cy2, v1);
                    if x >= t {
                        let dx = x - px;
                        return if dx > 0.0 { py + (y - py) * (t - px) / dx } else { y };
                    }
                    px = x;
                    py = y;
                }
                v1
            }
        }
    }
}

/// Line segments a bezier key is flattened to.
const BEZIER_SEGMENTS: u32 = 10;

#[inline]
fn cubic(u: f32, p0: f32, p1: f32, p2: f32, p3: f32) -> f32 {
    let iu = 1.0 - u;
    iu * iu * iu * p0 + 3.0 * iu * iu * u * p1 + 3.0 * iu * u * u * p2 + u * u * u * p3
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
