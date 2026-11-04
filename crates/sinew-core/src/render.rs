//! Render output: interleaved vertices, indices and draw batches.

use crate::math::{Color, Vec2};
use crate::model::{AttachmentKind, BlendMode, Vertices};
use crate::skeleton::Skeleton;

/// 32-bit words per vertex: x, y, u, v (f32 bits), light rgba8, dark rgba8.
pub const VERTEX_WORDS: usize = 6;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RenderBatch {
    pub page: u32,
    pub blend: u32,
    pub first_index: u32,
    pub index_count: u32,
}

#[derive(Clone, Debug, Default)]
pub struct RenderBuffers {
    pub vertices: Vec<u32>,
    pub indices: Vec<u32>,
    pub batches: Vec<RenderBatch>,
    world: Vec<Vec2>,
}

impl RenderBuffers {
    pub fn vertex_count(&self) -> usize {
        self.vertices.len() / VERTEX_WORDS
    }

    pub fn clear(&mut self) {
        self.vertices.clear();
        self.indices.clear();
        self.batches.clear();
    }

    fn push_vertex(&mut self, p: Vec2, uv: (f32, f32), light: u32, dark: u32) {
        self.vertices.extend_from_slice(&[p.x.to_bits(), p.y.to_bits(), uv.0.to_bits(), uv.1.to_bits(), light, dark]);
    }

    fn push_batch(&mut self, page: u32, blend: BlendMode, first: u32, count: u32) {
        if let Some(last) = self.batches.last_mut() {
            if last.page == page && last.blend == blend as u32 && last.first_index + last.index_count == first {
                last.index_count += count;
                return;
            }
        }
        self.batches.push(RenderBatch { page, blend: blend as u32, first_index: first, index_count: count });
    }

    /// Axis-aligned bounds of the last render (min x, min y, max x, max y).
    pub fn bounds(&self) -> Option<[f32; 4]> {
        let mut it = self.vertices.chunks_exact(VERTEX_WORDS);
        let first = it.next()?;
        let (x, y) = (f32::from_bits(first[0]), f32::from_bits(first[1]));
        let mut b = [x, y, x, y];
        for v in it {
            let (x, y) = (f32::from_bits(v[0]), f32::from_bits(v[1]));
            b[0] = b[0].min(x);
            b[1] = b[1].min(y);
            b[2] = b[2].max(x);
            b[3] = b[3].max(y);
        }
        Some(b)
    }
}

/// World positions of an attachment's vertices (meshes and other vertex attachments).
pub fn world_vertices(sk: &Skeleton, slot: usize, vertices: &Vertices, vertex_count: usize, out: &mut Vec<Vec2>) {
    out.clear();
    let deform = &sk.slots[slot].deform;
    match vertices {
        Vertices::Plain(v) => {
            let src = if deform.len() == v.len() { deform } else { v };
            let w = sk.bones[sk.data.slots[slot].bone].world;
            for i in 0..vertex_count {
                out.push(w.apply(Vec2::new(src[i * 2], src[i * 2 + 1])));
            }
        }
        Vertices::Weighted { bones, weights } => {
            let use_deform = deform.len() == weights.len() / 3 * 2;
            let (mut bi, mut wi, mut fi) = (0usize, 0usize, 0usize);
            for _ in 0..vertex_count {
                let count = bones[bi] as usize;
                bi += 1;
                let mut p = Vec2::ZERO;
                for _ in 0..count {
                    let b = bones[bi] as usize;
                    bi += 1;
                    let (mut x, mut y, weight) = (weights[wi], weights[wi + 1], weights[wi + 2]);
                    wi += 3;
                    if use_deform {
                        x += deform[fi];
                        y += deform[fi + 1];
                    }
                    fi += 2;
                    p = p.add(sk.bones[b].world.apply(Vec2::new(x, y)).scale(weight));
                }
                out.push(p);
            }
        }
    }
}

/// Twice the signed area of a polygon (positive = counter-clockwise).
fn signed_area(poly: &[Vec2]) -> f32 {
    let n = poly.len();
    (0..n).map(|i| {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        a.x * b.y - b.x * a.y
    }).sum()
}

/// Ear-clipping triangulation of a simple polygon (counter-clockwise).
fn triangulate(poly: &[Vec2]) -> Vec<[usize; 3]> {
    let mut idx: Vec<usize> = (0..poly.len()).collect();
    let mut out = Vec::new();
    let cross = |a: Vec2, b: Vec2, c: Vec2| (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let mut guard = 0;
    while idx.len() > 3 && guard < 10_000 {
        guard += 1;
        let n = idx.len();
        let mut clipped = false;
        for i in 0..n {
            let (pi, ci, ni) = (idx[(i + n - 1) % n], idx[i], idx[(i + 1) % n]);
            let (a, b, c) = (poly[pi], poly[ci], poly[ni]);
            if cross(a, b, c) <= 0.0 {
                continue;
            }
            let inside = idx.iter().any(|&j| {
                if j == pi || j == ci || j == ni {
                    return false;
                }
                let p = poly[j];
                cross(a, b, p) >= 0.0 && cross(b, c, p) >= 0.0 && cross(c, a, p) >= 0.0
            });
            if !inside {
                out.push([pi, ci, ni]);
                idx.remove(i);
                clipped = true;
                break;
            }
        }
        if !clipped {
            // Degenerate polygon: fan the rest.
            break;
        }
    }
    for k in 1..idx.len().saturating_sub(1) {
        out.push([idx[0], idx[k], idx[k + 1]]);
    }
    out
}

/// Sutherland-Hodgman: clips a polygon (with UVs) against a convex CCW polygon.
fn clip_polygon(subject: &[(Vec2, (f32, f32))], clip: &[Vec2]) -> Vec<(Vec2, (f32, f32))> {
    let mut out: Vec<(Vec2, (f32, f32))> = subject.to_vec();
    let n = clip.len();
    for e in 0..n {
        if out.is_empty() {
            break;
        }
        let (a, b) = (clip[e], clip[(e + 1) % n]);
        let side = |p: Vec2| (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        let input = std::mem::take(&mut out);
        for i in 0..input.len() {
            let cur = input[i];
            let prev = input[(i + input.len() - 1) % input.len()];
            let (sc, sp) = (side(cur.0), side(prev.0));
            if sc >= 0.0 {
                if sp < 0.0 {
                    out.push(lerp_vertex(prev, cur, sp / (sp - sc)));
                }
                out.push(cur);
            } else if sp >= 0.0 {
                out.push(lerp_vertex(prev, cur, sp / (sp - sc)));
            }
        }
    }
    out
}

fn lerp_vertex(a: (Vec2, (f32, f32)), b: (Vec2, (f32, f32)), t: f32) -> (Vec2, (f32, f32)) {
    (a.0.add(b.0.sub(a.0).scale(t)), (a.1 .0 + (b.1 .0 - a.1 .0) * t, a.1 .1 + (b.1 .1 - a.1 .1) * t))
}

struct Clip {
    /// Convex pieces (triangles) of the clipping polygon, world space, CCW.
    pieces: Vec<[Vec2; 3]>,
    end_slot: Option<usize>,
}

impl Skeleton {
    /// Fills render buffers for the current world pose.
    pub fn render(&self, out: &mut RenderBuffers) {
        out.clear();
        let mut world = std::mem::take(&mut out.world);
        let data = &*self.data;
        let mut clip: Option<Clip> = None;
        let mut pos: Vec<Vec2> = Vec::new();
        let mut uvs: Vec<(f32, f32)> = Vec::new();
        let mut tris: Vec<u32> = Vec::new();
        for &s in &self.draw_order {
            let sd = &data.slots[s];
            let slot = &self.slots[s];
            let visible = self.bones[sd.bone].active;
            let mut started_clip = false;
            if let (true, Some(r)) = (visible, slot.attachment) {
                let att = data.attachment(r);
                pos.clear();
                uvs.clear();
                tris.clear();
                let mut page = 0;
                let mut color = None;
                match &att.kind {
                    AttachmentKind::Clipping(c) => {
                        world_vertices(self, s, &c.shape.vertices, c.shape.vertex_count, &mut world);
                        let mut poly = world.clone();
                        if signed_area(&poly) < 0.0 {
                            poly.reverse();
                        }
                        let pieces = triangulate(&poly).into_iter().map(|[a, b, c]| [poly[a], poly[b], poly[c]]).collect();
                        if clip.is_none() {
                            clip = Some(Clip { pieces, end_slot: c.end_slot });
                            started_clip = true;
                        }
                    }
                    AttachmentKind::Region(a) => {
                        let region = a.region_for(slot.sequence_index);
                        let (corners, quv) = a.quad_with(region);
                        let w = self.bones[sd.bone].world;
                        for i in 0..4 {
                            pos.push(w.apply(corners[i]));
                            uvs.push(quv[i]);
                        }
                        tris.extend_from_slice(&[0, 1, 2, 2, 3, 0]);
                        page = region.map_or(0, |r| r.page);
                        color = Some(a.color);
                    }
                    AttachmentKind::Mesh(m) => {
                        world_vertices(self, s, &m.vertices, m.vertex_count, &mut world);
                        let (region, muvs) = m.frame(slot.sequence_index);
                        for (i, p) in world.iter().enumerate() {
                            pos.push(*p);
                            uvs.push((muvs.get(i * 2).copied().unwrap_or(0.0), muvs.get(i * 2 + 1).copied().unwrap_or(0.0)));
                        }
                        tris.extend_from_slice(&m.triangles);
                        page = region.map_or(0, |r| r.page);
                        color = Some(m.color);
                    }
                    _ => {}
                }
                if let Some(att_color) = color {
                    let light = self.color.mul(slot.color).mul(att_color);
                    if light.a > 0.0 {
                        let light = light.pack_rgba8();
                        let dark = slot.dark.map_or(0, |d| Color { a: 0.0, ..d }.pack_rgba8());
                        let first = out.indices.len() as u32;
                        match &clip {
                            None => {
                                let base = out.vertex_count() as u32;
                                for (p, uv) in pos.iter().zip(&uvs) {
                                    out.push_vertex(*p, *uv, light, dark);
                                }
                                out.indices.extend(tris.iter().map(|&t| base + t));
                            }
                            Some(c) => {
                                for t in tris.chunks_exact(3) {
                                    let tri = [
                                        (pos[t[0] as usize], uvs[t[0] as usize]),
                                        (pos[t[1] as usize], uvs[t[1] as usize]),
                                        (pos[t[2] as usize], uvs[t[2] as usize]),
                                    ];
                                    for piece in &c.pieces {
                                        let poly = clip_polygon(&tri, piece);
                                        if poly.len() < 3 {
                                            continue;
                                        }
                                        let base = out.vertex_count() as u32;
                                        for (p, uv) in &poly {
                                            out.push_vertex(*p, *uv, light, dark);
                                        }
                                        for k in 1..poly.len() as u32 - 1 {
                                            out.indices.extend_from_slice(&[base, base + k, base + k + 1]);
                                        }
                                    }
                                }
                            }
                        }
                        let count = out.indices.len() as u32 - first;
                        if count > 0 {
                            out.push_batch(page, sd.blend, first, count);
                        }
                    }
                }
            }
            // The slot that starts clipping never ends it (an end slot equal to
            // the clipping slot clips to the end of the draw order).
            if !started_clip && clip.as_ref().is_some_and(|c| c.end_slot == Some(s)) {
                clip = None;
            }
        }
        out.world = world;
    }
}
