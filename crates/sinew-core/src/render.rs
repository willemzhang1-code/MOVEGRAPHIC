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

impl Skeleton {
    /// Fills render buffers for the current world pose.
    pub fn render(&self, out: &mut RenderBuffers) {
        out.clear();
        let mut world = std::mem::take(&mut out.world);
        let data = &*self.data;
        for &s in &self.draw_order {
            let sd = &data.slots[s];
            if !self.bones[sd.bone].active {
                continue;
            }
            let slot = &self.slots[s];
            let Some(r) = slot.attachment else { continue };
            let att = data.attachment(r);
            let att_color = match &att.kind {
                AttachmentKind::Region(a) => a.color,
                AttachmentKind::Mesh(m) => m.color,
                _ => continue,
            };
            let light = self.color.mul(slot.color).mul(att_color);
            if light.a <= 0.0 {
                continue;
            }
            let light = light.pack_rgba8();
            let dark = slot.dark.map_or(0, |d| Color { a: 0.0, ..d }.pack_rgba8());
            let base = out.vertex_count() as u32;
            let first = out.indices.len() as u32;
            let page = match &att.kind {
                AttachmentKind::Region(a) => {
                    let (corners, uvs) = a.quad();
                    let w = self.bones[sd.bone].world;
                    for i in 0..4 {
                        out.push_vertex(w.apply(corners[i]), uvs[i], light, dark);
                    }
                    out.indices.extend_from_slice(&[base, base + 1, base + 2, base + 2, base + 3, base]);
                    a.region.as_ref().map_or(0, |r| r.page)
                }
                AttachmentKind::Mesh(m) => {
                    world_vertices(self, s, &m.vertices, m.vertex_count, &mut world);
                    for (i, p) in world.iter().enumerate() {
                        let uv = (m.uvs.get(i * 2).copied().unwrap_or(0.0), m.uvs.get(i * 2 + 1).copied().unwrap_or(0.0));
                        out.push_vertex(*p, uv, light, dark);
                    }
                    out.indices.extend(m.triangles.iter().map(|&t| base + t));
                    m.region.as_ref().map_or(0, |r| r.page)
                }
                _ => unreachable!(),
            };
            let count = out.indices.len() as u32 - first;
            out.push_batch(page, sd.blend, first, count);
        }
        out.world = world;
    }
}
