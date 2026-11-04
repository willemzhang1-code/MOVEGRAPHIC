//! 2D math primitives. Angles in the public API are degrees; y points up.

use std::f32::consts::PI;

pub const DEG_TO_RAD: f32 = PI / 180.0;
pub const RAD_TO_DEG: f32 = 180.0 / PI;

#[inline]
pub fn cos_deg(d: f32) -> f32 {
    (d * DEG_TO_RAD).cos()
}

#[inline]
pub fn sin_deg(d: f32) -> f32 {
    (d * DEG_TO_RAD).sin()
}

#[inline]
pub fn atan2_deg(y: f32, x: f32) -> f32 {
    y.atan2(x) * RAD_TO_DEG
}

/// Wraps an angle in degrees to (-180, 180].
#[inline]
pub fn wrap_deg(d: f32) -> f32 {
    let mut r = d % 360.0;
    if r > 180.0 {
        r -= 360.0;
    } else if r <= -180.0 {
        r += 360.0;
    }
    r
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    #[inline]
    pub const fn new(x: f32, y: f32) -> Self {
        Vec2 { x, y }
    }
    #[inline]
    pub fn len(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
    #[inline]
    pub fn add(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x + o.x, self.y + o.y)
    }
    #[inline]
    pub fn sub(self, o: Vec2) -> Vec2 {
        Vec2::new(self.x - o.x, self.y - o.y)
    }
    #[inline]
    pub fn scale(self, s: f32) -> Vec2 {
        Vec2::new(self.x * s, self.y * s)
    }
    #[inline]
    pub fn angle_deg(self) -> f32 {
        atan2_deg(self.y, self.x)
    }
    #[inline]
    pub fn from_angle_deg(deg: f32, len: f32) -> Vec2 {
        Vec2::new(cos_deg(deg) * len, sin_deg(deg) * len)
    }
}

/// 2D affine transform:
/// ```text
/// | a b x |
/// | c d y |
/// ```
/// Column 0 (a, c) is the transformed x axis, column 1 (b, d) the y axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    pub a: f32,
    pub b: f32,
    pub c: f32,
    pub d: f32,
    pub x: f32,
    pub y: f32,
}

impl Default for Affine {
    fn default() -> Self {
        Affine::IDENTITY
    }
}

impl Affine {
    pub const IDENTITY: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, x: 0.0, y: 0.0 };

    #[inline]
    pub const fn linear(a: f32, b: f32, c: f32, d: f32) -> Affine {
        Affine { a, b, c, d, x: 0.0, y: 0.0 }
    }

    #[inline]
    pub fn rotation(deg: f32) -> Affine {
        let (s, c) = (sin_deg(deg), cos_deg(deg));
        Affine::linear(c, -s, s, c)
    }

    #[inline]
    pub fn scaling(sx: f32, sy: f32) -> Affine {
        Affine::linear(sx, 0.0, 0.0, sy)
    }

    /// `self * o` (apply `o` first, then `self`).
    #[inline]
    pub fn mul(&self, o: &Affine) -> Affine {
        Affine {
            a: self.a * o.a + self.b * o.c,
            b: self.a * o.b + self.b * o.d,
            c: self.c * o.a + self.d * o.c,
            d: self.c * o.b + self.d * o.d,
            x: self.a * o.x + self.b * o.y + self.x,
            y: self.c * o.x + self.d * o.y + self.y,
        }
    }

    /// Product of the 2x2 linear parts; translation of the result is zero.
    #[inline]
    pub fn mul_linear(&self, o: &Affine) -> Affine {
        Affine::linear(
            self.a * o.a + self.b * o.c,
            self.a * o.b + self.b * o.d,
            self.c * o.a + self.d * o.c,
            self.c * o.b + self.d * o.d,
        )
    }

    #[inline]
    pub fn apply(&self, p: Vec2) -> Vec2 {
        Vec2::new(self.a * p.x + self.b * p.y + self.x, self.c * p.x + self.d * p.y + self.y)
    }

    #[inline]
    pub fn apply_vec(&self, v: Vec2) -> Vec2 {
        Vec2::new(self.a * v.x + self.b * v.y, self.c * v.x + self.d * v.y)
    }

    #[inline]
    pub fn det(&self) -> f32 {
        self.a * self.d - self.b * self.c
    }

    /// Inverse transform. Degenerate matrices are inverted with a clamped
    /// determinant so callers never see NaN.
    pub fn inverse(&self) -> Affine {
        let mut det = self.det();
        if det.abs() < 1e-12 {
            det = if det < 0.0 { -1e-12 } else { 1e-12 };
        }
        let inv = 1.0 / det;
        let a = self.d * inv;
        let b = -self.b * inv;
        let c = -self.c * inv;
        let d = self.a * inv;
        Affine { a, b, c, d, x: -(a * self.x + b * self.y), y: -(c * self.x + d * self.y) }
    }

    #[inline]
    pub fn position(&self) -> Vec2 {
        Vec2::new(self.x, self.y)
    }

    /// World rotation of the x axis, degrees.
    #[inline]
    pub fn rotation_deg(&self) -> f32 {
        atan2_deg(self.c, self.a)
    }

    #[inline]
    pub fn scale_x(&self) -> f32 {
        (self.a * self.a + self.c * self.c).sqrt()
    }

    #[inline]
    pub fn scale_y(&self) -> f32 {
        (self.b * self.b + self.d * self.d).sqrt()
    }
}

/// Local transform of a bone or attachment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    pub x: f32,
    pub y: f32,
    pub rotation: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub shear_x: f32,
    pub shear_y: f32,
}

impl Default for Transform {
    fn default() -> Self {
        Transform { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, shear_x: 0.0, shear_y: 0.0 }
    }
}

impl Transform {
    /// Matrix of this transform: the x axis is rotated by `rotation + shear_x`
    /// and scaled by `scale_x`; the y axis is rotated by `rotation + 90 + shear_y`
    /// and scaled by `scale_y`. Translation is `(x, y)`.
    pub fn matrix(&self) -> Affine {
        let rx = self.rotation + self.shear_x;
        let ry = self.rotation + 90.0 + self.shear_y;
        Affine {
            a: cos_deg(rx) * self.scale_x,
            b: cos_deg(ry) * self.scale_y,
            c: sin_deg(rx) * self.scale_x,
            d: sin_deg(ry) * self.scale_y,
            x: self.x,
            y: self.y,
        }
    }

    /// Decomposes a matrix into a transform with `shear_x == 0`. Reflection is
    /// expressed through a negative `scale_y`.
    pub fn from_matrix(m: &Affine) -> Transform {
        let sx = (m.a * m.a + m.c * m.c).sqrt();
        if sx > 1e-6 {
            let rotation = atan2_deg(m.c, m.a);
            let len_y = (m.b * m.b + m.d * m.d).sqrt();
            let (scale_y, axis_y) = if m.det() < 0.0 {
                (-len_y, atan2_deg(-m.d, -m.b))
            } else {
                (len_y, atan2_deg(m.d, m.b))
            };
            let shear_y = if len_y > 1e-6 { wrap_deg(axis_y - rotation - 90.0) } else { 0.0 };
            Transform { x: m.x, y: m.y, rotation, scale_x: sx, scale_y, shear_x: 0.0, shear_y }
        } else {
            let len_y = (m.b * m.b + m.d * m.d).sqrt();
            Transform {
                x: m.x,
                y: m.y,
                rotation: atan2_deg(m.d, m.b) - 90.0,
                scale_x: 0.0,
                scale_y: len_y,
                shear_x: 0.0,
                shear_y: 0.0,
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Default for Color {
    fn default() -> Self {
        Color::WHITE
    }
}

impl Color {
    pub const WHITE: Color = Color { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    pub const BLACK: Color = Color { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };

    pub const fn new(r: f32, g: f32, b: f32, a: f32) -> Color {
        Color { r, g, b, a }
    }

    /// Parses `rrggbb` or `rrggbbaa` hex.
    pub fn from_hex(s: &str) -> Option<Color> {
        let s = s.trim_start_matches('#');
        if s.len() != 6 && s.len() != 8 {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&s[i..i + 2], 16).ok().map(|v| v as f32 / 255.0);
        Some(Color {
            r: byte(0)?,
            g: byte(2)?,
            b: byte(4)?,
            a: if s.len() == 8 { byte(6)? } else { 1.0 },
        })
    }

    #[inline]
    pub fn mul(self, o: Color) -> Color {
        Color::new(self.r * o.r, self.g * o.g, self.b * o.b, self.a * o.a)
    }

    #[inline]
    pub fn lerp(self, o: Color, t: f32) -> Color {
        Color::new(
            self.r + (o.r - self.r) * t,
            self.g + (o.g - self.g) * t,
            self.b + (o.b - self.b) * t,
            self.a + (o.a - self.a) * t,
        )
    }

    #[inline]
    pub fn clamped(self) -> Color {
        Color::new(self.r.clamp(0.0, 1.0), self.g.clamp(0.0, 1.0), self.b.clamp(0.0, 1.0), self.a.clamp(0.0, 1.0))
    }

    /// Packs to RGBA8, byte order r, g, b, a in memory (little-endian u32).
    #[inline]
    pub fn pack_rgba8(self) -> u32 {
        let c = self.clamped();
        let q = |v: f32| (v * 255.0 + 0.5) as u32;
        q(c.r) | (q(c.g) << 8) | (q(c.b) << 16) | (q(c.a) << 24)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn decompose_roundtrip() {
        let cases = [
            Transform { x: 3.0, y: -2.0, rotation: 30.0, scale_x: 2.0, scale_y: 0.5, shear_x: 0.0, shear_y: 10.0 },
            Transform { x: 0.0, y: 0.0, rotation: -120.0, scale_x: 1.0, scale_y: -1.5, shear_x: 0.0, shear_y: 0.0 },
            Transform { x: 1.0, y: 1.0, rotation: 179.0, scale_x: 0.3, scale_y: 4.0, shear_x: 0.0, shear_y: -25.0 },
        ];
        for t in cases {
            let m = t.matrix();
            let back = Transform::from_matrix(&m).matrix();
            for (u, v) in [(m.a, back.a), (m.b, back.b), (m.c, back.c), (m.d, back.d), (m.x, back.x), (m.y, back.y)] {
                assert!(close(u, v), "{t:?}: {m:?} vs {back:?}");
            }
        }
    }

    #[test]
    fn inverse_works() {
        let m = Transform { x: 5.0, y: 7.0, rotation: 40.0, scale_x: 2.0, scale_y: 3.0, shear_x: 5.0, shear_y: 0.0 }.matrix();
        let p = Vec2::new(1.5, -4.0);
        let q = m.inverse().apply(m.apply(p));
        assert!(close(p.x, q.x) && close(p.y, q.y));
    }

    #[test]
    fn wrap() {
        assert!(close(wrap_deg(190.0), -170.0));
        assert!(close(wrap_deg(-190.0), 170.0));
        assert!(close(wrap_deg(720.0), 0.0));
        assert!(close(wrap_deg(180.0), 180.0));
    }

    #[test]
    fn hex_color() {
        let c = Color::from_hex("ff800040").unwrap();
        assert!(close(c.r, 1.0) && close(c.g, 128.0 / 255.0) && close(c.b, 0.0) && close(c.a, 64.0 / 255.0));
        assert_eq!(Color::from_hex("zz"), None);
    }
}
