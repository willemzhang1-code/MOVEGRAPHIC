//! Immutable skeleton data (shared by all instances).

use std::collections::HashMap;

use crate::animation::Animation;
use crate::atlas::Atlas;
use crate::math::{Color, Transform, Vec2};

/// How a bone inherits its parent's world transform.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Inherit {
    #[default]
    Normal,
    OnlyTranslation,
    NoRotationOrReflection,
    NoScale,
    NoScaleOrReflection,
}

impl Inherit {
    pub fn parse(s: &str) -> Option<Inherit> {
        Some(match s {
            "normal" => Inherit::Normal,
            "onlyTranslation" => Inherit::OnlyTranslation,
            "noRotationOrReflection" => Inherit::NoRotationOrReflection,
            "noScale" => Inherit::NoScale,
            "noScaleOrReflection" => Inherit::NoScaleOrReflection,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u32)]
pub enum BlendMode {
    #[default]
    Normal = 0,
    Additive = 1,
    Multiply = 2,
    Screen = 3,
}

impl BlendMode {
    pub fn parse(s: &str) -> BlendMode {
        match s {
            "additive" => BlendMode::Additive,
            "multiply" => BlendMode::Multiply,
            "screen" => BlendMode::Screen,
            _ => BlendMode::Normal,
        }
    }
}

#[derive(Clone, Debug)]
pub struct BoneData {
    pub name: String,
    pub parent: Option<usize>,
    pub length: f32,
    pub setup: Transform,
    pub inherit: Inherit,
    /// Bone is only active when the current skin lists it.
    pub skin_required: bool,
    pub color: Color,
}

#[derive(Clone, Debug)]
pub struct SlotData {
    pub name: String,
    pub bone: usize,
    pub color: Color,
    pub dark: Option<Color>,
    pub attachment: Option<String>,
    pub blend: BlendMode,
}

/// A rectangle in a texture page, with optional whitespace trimming and
/// rotation (degrees, multiples of 90) as produced by texture packers.
#[derive(Clone, Debug, PartialEq)]
pub struct TextureRegion {
    pub page: u32,
    pub page_width: f32,
    pub page_height: f32,
    /// Top-left of the packed rect in the page, pixels.
    pub x: f32,
    pub y: f32,
    /// Packed size before rotation, pixels.
    pub width: f32,
    pub height: f32,
    /// Trim offset from the bottom-left of the original image.
    pub offset_x: f32,
    pub offset_y: f32,
    pub original_width: f32,
    pub original_height: f32,
    pub degrees: i32,
}

impl TextureRegion {
    /// A region covering a whole page.
    pub fn whole(page: u32, width: f32, height: f32) -> TextureRegion {
        TextureRegion {
            page,
            page_width: width,
            page_height: height,
            x: 0.0,
            y: 0.0,
            width,
            height,
            offset_x: 0.0,
            offset_y: 0.0,
            original_width: width,
            original_height: height,
            degrees: 0,
        }
    }

    /// Maps a coordinate in original-image UV space (0..1, y down) to page UV.
    pub fn map_uv(&self, ux: f32, uy: f32) -> (f32, f32) {
        // Position inside the trimmed rect (unrotated), pixels, y down.
        let px = ux * self.original_width - self.offset_x;
        let py = uy * self.original_height - (self.original_height - self.offset_y - self.height);
        let (tx, ty) = match self.degrees.rem_euclid(360) {
            90 => (py, self.width - px),
            180 => (self.width - px, self.height - py),
            270 => (self.height - py, px),
            _ => (px, py),
        };
        ((self.x + tx) / self.page_width, (self.y + ty) / self.page_height)
    }
}

#[derive(Clone, Debug)]
pub enum Vertices {
    /// x, y pairs in bone space.
    Plain(Vec<f32>),
    /// Per vertex: `bones = [count, b0, b1, ...]`, `weights = [x, y, w] * count`.
    Weighted { bones: Vec<u32>, weights: Vec<f32> },
}

impl Vertices {
    /// Length of a deform array for these vertices (2 floats per influence).
    pub fn deform_len(&self) -> usize {
        match self {
            Vertices::Plain(v) => v.len(),
            Vertices::Weighted { weights, .. } => weights.len() / 3 * 2,
        }
    }

    /// Setup values a deform key is relative to.
    pub fn deform_setup(&self) -> Vec<f32> {
        match self {
            Vertices::Plain(v) => v.clone(),
            Vertices::Weighted { weights, .. } => vec![0.0; weights.len() / 3 * 2],
        }
    }
}

#[derive(Clone, Debug)]
pub struct RegionAttachment {
    pub path: String,
    pub transform: Transform,
    pub width: f32,
    pub height: f32,
    pub color: Color,
    pub region: Option<TextureRegion>,
}

impl RegionAttachment {
    /// Corners (BL, TL, TR, BR) in bone space and their page UVs.
    pub fn quad(&self) -> ([Vec2; 4], [(f32, f32); 4]) {
        let fallback;
        let r = match &self.region {
            Some(r) => r,
            None => {
                fallback = TextureRegion::whole(0, self.width.max(1.0), self.height.max(1.0));
                &fallback
            }
        };
        let t = &self.transform;
        let sx = self.width / r.original_width * t.scale_x;
        let sy = self.height / r.original_height * t.scale_y;
        let x0 = -self.width / 2.0 * t.scale_x + r.offset_x * sx;
        let y0 = -self.height / 2.0 * t.scale_y + r.offset_y * sy;
        let x1 = x0 + r.width * sx;
        let y1 = y0 + r.height * sy;
        let m = Transform { scale_x: 1.0, scale_y: 1.0, shear_x: 0.0, shear_y: 0.0, ..*t }.matrix();
        let corners = [
            m.apply(Vec2::new(x0, y0)),
            m.apply(Vec2::new(x0, y1)),
            m.apply(Vec2::new(x1, y1)),
            m.apply(Vec2::new(x1, y0)),
        ];
        let (ow, oh) = (r.original_width, r.original_height);
        let u0 = r.offset_x / ow;
        let u1 = (r.offset_x + r.width) / ow;
        let v_bottom = (oh - r.offset_y) / oh;
        let v_top = (oh - r.offset_y - r.height) / oh;
        let uvs = [r.map_uv(u0, v_bottom), r.map_uv(u0, v_top), r.map_uv(u1, v_top), r.map_uv(u1, v_bottom)];
        (corners, uvs)
    }
}

#[derive(Clone, Debug)]
pub struct MeshAttachment {
    pub path: String,
    pub color: Color,
    pub vertices: Vertices,
    pub vertex_count: usize,
    /// UVs in original-image space (0..1, y down), 2 per vertex.
    pub region_uvs: Vec<f32>,
    pub triangles: Vec<u32>,
    pub hull_length: u32,
    pub edges: Vec<u32>,
    pub width: f32,
    pub height: f32,
    pub region: Option<TextureRegion>,
    /// Page UVs, computed by `bind_region`.
    pub uvs: Vec<f32>,
}

impl MeshAttachment {
    pub fn bind_region(&mut self, region: Option<TextureRegion>) {
        self.region = region;
        self.uvs.clear();
        match &self.region {
            Some(r) => {
                for p in self.region_uvs.chunks_exact(2) {
                    let (u, v) = r.map_uv(p[0], p[1]);
                    self.uvs.push(u);
                    self.uvs.push(v);
                }
            }
            None => self.uvs.extend_from_slice(&self.region_uvs),
        }
    }
}

#[derive(Clone, Debug)]
pub struct VertexAttachment {
    pub vertices: Vertices,
    pub vertex_count: usize,
    pub color: Color,
}

#[derive(Clone, Debug)]
pub struct ClippingAttachment {
    pub shape: VertexAttachment,
    pub end_slot: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct PointAttachment {
    pub x: f32,
    pub y: f32,
    pub rotation: f32,
    pub color: Color,
}

#[derive(Clone, Debug)]
pub struct PathAttachment {
    pub shape: VertexAttachment,
    pub closed: bool,
    pub constant_speed: bool,
    pub lengths: Vec<f32>,
}

#[derive(Clone, Debug)]
pub enum AttachmentKind {
    Region(RegionAttachment),
    Mesh(MeshAttachment),
    BoundingBox(VertexAttachment),
    Clipping(ClippingAttachment),
    Point(PointAttachment),
    Path(PathAttachment),
}

#[derive(Clone, Debug)]
pub struct Attachment {
    /// Unique across the skeleton.
    pub id: u32,
    /// Deform channels keyed to this id apply to this attachment
    /// (linked meshes may share their parent's id).
    pub deform_id: u32,
    pub name: String,
    pub kind: AttachmentKind,
}

impl Attachment {
    pub fn vertices(&self) -> Option<&Vertices> {
        match &self.kind {
            AttachmentKind::Mesh(m) => Some(&m.vertices),
            AttachmentKind::BoundingBox(v) => Some(&v.vertices),
            AttachmentKind::Clipping(c) => Some(&c.shape.vertices),
            AttachmentKind::Path(p) => Some(&p.shape.vertices),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Skin {
    pub name: String,
    pub attachments: Vec<(usize, Attachment)>,
    /// Placeholder key per attachment (what slots, timelines and skins refer to).
    pub keys: Vec<String>,
    index: HashMap<(usize, String), usize>,
    pub bones: Vec<usize>,
    pub ik: Vec<usize>,
    pub transforms: Vec<usize>,
    pub physics: Vec<usize>,
    pub paths: Vec<usize>,
}

impl Skin {
    pub fn new(name: impl Into<String>) -> Skin {
        Skin { name: name.into(), ..Default::default() }
    }

    /// Adds an attachment under its placeholder `key` (may differ from `attachment.name`).
    pub fn insert(&mut self, slot: usize, key: &str, attachment: Attachment) {
        let k = (slot, key.to_string());
        if let Some(&i) = self.index.get(&k) {
            self.attachments[i] = (slot, attachment);
        } else {
            self.index.insert(k, self.attachments.len());
            self.attachments.push((slot, attachment));
            self.keys.push(key.to_string());
        }
    }

    pub fn find(&self, slot: usize, name: &str) -> Option<usize> {
        self.index.get(&(slot, name.to_string())).copied()
    }

    pub fn get(&self, slot: usize, name: &str) -> Option<&Attachment> {
        self.find(slot, name).map(|i| &self.attachments[i].1)
    }
}

#[derive(Clone, Debug)]
pub struct IkConstraintData {
    pub name: String,
    pub order: i32,
    pub skin_required: bool,
    pub bones: Vec<usize>,
    pub target: usize,
    pub mix: f32,
    pub softness: f32,
    pub bend_positive: bool,
    pub compress: bool,
    pub stretch: bool,
    pub uniform: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransformMix {
    pub rotate: f32,
    pub x: f32,
    pub y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub shear_y: f32,
}

#[derive(Clone, Debug)]
pub struct TransformConstraintData {
    pub name: String,
    pub order: i32,
    pub skin_required: bool,
    pub bones: Vec<usize>,
    pub target: usize,
    pub offset_rotation: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub offset_scale_x: f32,
    pub offset_scale_y: f32,
    pub offset_shear_y: f32,
    pub mix: TransformMix,
    pub local: bool,
    pub relative: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionMode {
    Fixed,
    Percent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpacingMode {
    Length,
    Fixed,
    Percent,
    Proportional,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RotateMode {
    Tangent,
    Chain,
    ChainScale,
}

#[derive(Clone, Debug)]
pub struct PathConstraintData {
    pub name: String,
    pub order: i32,
    pub skin_required: bool,
    pub bones: Vec<usize>,
    /// Slot whose attachment is the path.
    pub target: usize,
    pub position_mode: PositionMode,
    pub spacing_mode: SpacingMode,
    pub rotate_mode: RotateMode,
    pub offset_rotation: f32,
    pub position: f32,
    pub spacing: f32,
    pub mix_rotate: f32,
    pub mix_x: f32,
    pub mix_y: f32,
}

/// Physics parameters that animations (and the skeleton-wide "global"
/// timelines) can drive.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsParams {
    pub inertia: f32,
    pub strength: f32,
    pub damping: f32,
    pub mass_inverse: f32,
    pub wind: f32,
    pub gravity: f32,
    pub mix: f32,
}

#[derive(Clone, Debug)]
pub struct PhysicsConstraintData {
    pub name: String,
    pub order: i32,
    pub skin_required: bool,
    pub bone: usize,
    /// How strongly each property is simulated (0..1).
    pub x: f32,
    pub y: f32,
    pub rotate: f32,
    pub scale_x: f32,
    pub shear_x: f32,
    /// Maximum translation offset, skeleton units.
    pub limit: f32,
    /// Simulation steps per second.
    pub fps: f32,
    pub params: PhysicsParams,
    /// Per parameter (inertia, strength, damping, mass, wind, gravity, mix):
    /// follows the skeleton-wide physics timelines.
    pub global: [bool; 7],
}

#[derive(Clone, Debug, Default)]
pub struct EventData {
    pub name: String,
    pub int: i32,
    pub float: f32,
    pub string: String,
    pub audio: Option<String>,
    pub volume: f32,
    pub balance: f32,
}

/// Reference to an attachment inside a skin.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AttachmentRef {
    pub skin: usize,
    pub index: usize,
}

/// Index of a constraint in update order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConstraintRef {
    Ik(usize),
    Transform(usize),
    Path(usize),
    Physics(usize),
}

#[derive(Clone, Debug, Default)]
pub struct SkeletonData {
    pub name: String,
    pub version: String,
    pub fps: f32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub bones: Vec<BoneData>,
    pub slots: Vec<SlotData>,
    pub skins: Vec<Skin>,
    pub default_skin: Option<usize>,
    pub ik: Vec<IkConstraintData>,
    pub transforms: Vec<TransformConstraintData>,
    pub physics: Vec<PhysicsConstraintData>,
    pub paths: Vec<PathConstraintData>,
    pub events: Vec<EventData>,
    pub animations: Vec<Animation>,
    /// Non-fatal issues found while loading (unsupported features etc).
    pub warnings: Vec<String>,
}

impl SkeletonData {
    pub fn attachment(&self, r: AttachmentRef) -> &Attachment {
        &self.skins[r.skin].attachments[r.index].1
    }

    pub fn find_bone(&self, name: &str) -> Option<usize> {
        self.bones.iter().position(|b| b.name == name)
    }
    pub fn find_slot(&self, name: &str) -> Option<usize> {
        self.slots.iter().position(|s| s.name == name)
    }
    pub fn find_skin(&self, name: &str) -> Option<usize> {
        self.skins.iter().position(|s| s.name == name)
    }
    pub fn find_animation(&self, name: &str) -> Option<usize> {
        self.animations.iter().position(|a| a.name == name)
    }
    pub fn find_event(&self, name: &str) -> Option<usize> {
        self.events.iter().position(|e| e.name == name)
    }
    pub fn find_ik(&self, name: &str) -> Option<usize> {
        self.ik.iter().position(|c| c.name == name)
    }
    pub fn find_path(&self, name: &str) -> Option<usize> {
        self.paths.iter().position(|c| c.name == name)
    }
    pub fn find_physics(&self, name: &str) -> Option<usize> {
        self.physics.iter().position(|c| c.name == name)
    }
    pub fn find_transform(&self, name: &str) -> Option<usize> {
        self.transforms.iter().position(|c| c.name == name)
    }

    /// Constraints sorted by their `order`.
    pub fn constraint_order(&self) -> Vec<ConstraintRef> {
        let mut v: Vec<(i32, ConstraintRef)> = Vec::new();
        v.extend(self.ik.iter().enumerate().map(|(i, c)| (c.order, ConstraintRef::Ik(i))));
        v.extend(self.transforms.iter().enumerate().map(|(i, c)| (c.order, ConstraintRef::Transform(i))));
        v.extend(self.paths.iter().enumerate().map(|(i, c)| (c.order, ConstraintRef::Path(i))));
        v.extend(self.physics.iter().enumerate().map(|(i, c)| (c.order, ConstraintRef::Physics(i))));
        v.sort_by_key(|(o, _)| *o);
        v.into_iter().map(|(_, c)| c).collect()
    }

    /// Resolves attachment texture regions against an atlas. Returns the
    /// attachment paths that were not found.
    pub fn bind_atlas(&mut self, atlas: &Atlas) -> Vec<String> {
        let mut missing = Vec::new();
        for skin in &mut self.skins {
            for (_, att) in &mut skin.attachments {
                match &mut att.kind {
                    AttachmentKind::Region(r) => {
                        r.region = atlas.find(&r.path).cloned();
                        if r.region.is_none() {
                            missing.push(r.path.clone());
                        }
                    }
                    AttachmentKind::Mesh(m) => {
                        let region = atlas.find(&m.path).cloned();
                        if region.is_none() {
                            missing.push(m.path.clone());
                        }
                        m.bind_region(region);
                    }
                    _ => {}
                }
            }
        }
        missing.sort();
        missing.dedup();
        missing
    }
}
