//! RABBIT runtime for Godot 4 (GDExtension). `RabbitSkeleton2D` plays Spine
//! 4.2 JSON skeletons (as exported by RABBIT Studio or Spine) with the sinew
//! core: animation mixing, constraints, physics, meshes.

use std::sync::Arc;

use godot::classes::canvas_item_material::BlendMode as GdBlendMode;
use godot::classes::{CanvasItemMaterial, FileAccess, INode2D, Image, ImageTexture, Node2D, RenderingServer, ResourceLoader, Texture2D};
use godot::prelude::*;
use sinew_core::import::load_spine_json;
use sinew_core::render::VERTEX_WORDS;
use sinew_core::{AnimationState, Atlas, RenderBuffers, Skeleton, SkeletonData, StateEventKind};

struct RabbitExtension;

#[gdextension]
unsafe impl ExtensionLibrary for RabbitExtension {}

struct Loaded {
    data: Arc<SkeletonData>,
    skeleton: Skeleton,
    state: AnimationState,
    textures: Vec<Gd<Texture2D>>,
    pma: bool,
}

/// A skeleton animated by the RABBIT core.
#[derive(GodotClass)]
#[class(base = Node2D)]
pub struct RabbitSkeleton2D {
    base: Base<Node2D>,
    /// Spine 4.x JSON skeleton (res:// path).
    #[export(file = "*.json")]
    skeleton_file: GString,
    /// Texture atlas (libGDX / Spine text format). Pages are loaded next to it.
    #[export(file = "*.atlas")]
    atlas_file: GString,
    /// Animation played on track 0 when ready.
    #[export]
    animation: GString,
    #[export]
    looping: bool,
    #[export]
    skin: GString,
    #[export]
    time_scale: f32,
    /// Default crossfade duration, seconds.
    #[export]
    default_mix: f32,
    loaded: Option<Loaded>,
    buffers: RenderBuffers,
}

#[godot_api]
impl INode2D for RabbitSkeleton2D {
    fn init(base: Base<Node2D>) -> Self {
        Self {
            base,
            skeleton_file: GString::new(),
            atlas_file: GString::new(),
            animation: GString::new(),
            looping: true,
            skin: GString::new(),
            time_scale: 1.0,
            default_mix: 0.2,
            loaded: None,
            buffers: RenderBuffers::default(),
        }
    }

    fn ready(&mut self) {
        self.reload();
    }

    fn process(&mut self, delta: f64) {
        let dt = delta as f32 * self.time_scale;
        let mut fired: Vec<(String, i32, f32, String)> = Vec::new();
        if let Some(l) = &mut self.loaded {
            l.state.update(dt);
            l.state.apply(&mut l.skeleton);
            l.skeleton.update_world_with_physics(dt);
            for e in l.state.drain_events() {
                if let StateEventKind::Event(k) = e.kind {
                    fired.push((l.data.events[k.event].name.clone(), k.int, k.float, k.string));
                }
            }
        } else {
            return;
        }
        for (name, i, f, s) in fired {
            self.signals().animation_event().emit(&GString::from(name.as_str()), i as i64, f as f64, &GString::from(s.as_str()));
        }
        self.base_mut().queue_redraw();
    }

    fn draw(&mut self) {
        let Some(l) = &self.loaded else { return };
        l.skeleton.render(&mut self.buffers);
        let item = self.base().get_canvas_item();
        let mut rs = RenderingServer::singleton();
        let v = &self.buffers.vertices;
        for b in &self.buffers.batches {
            let Some(tex) = l.textures.get(b.page as usize) else { continue };
            let idx = &self.buffers.indices[b.first_index as usize..(b.first_index + b.index_count) as usize];
            let (lo, hi) = idx.iter().fold((u32::MAX, 0), |(lo, hi), &i| (lo.min(i), hi.max(i)));
            if lo > hi {
                continue;
            }
            let mut points = PackedVector2Array::new();
            let mut uvs = PackedVector2Array::new();
            let mut colors = PackedColorArray::new();
            for i in lo..=hi {
                let o = i as usize * VERTEX_WORDS;
                points.push(Vector2::new(f32::from_bits(v[o]), -f32::from_bits(v[o + 1])));
                uvs.push(Vector2::new(f32::from_bits(v[o + 2]), f32::from_bits(v[o + 3])));
                let c = v[o + 4];
                let (r, g, bl, a) = ((c & 0xff) as f32 / 255.0, ((c >> 8) & 0xff) as f32 / 255.0, ((c >> 16) & 0xff) as f32 / 255.0, (c >> 24) as f32 / 255.0);
                colors.push(if l.pma { Color::from_rgba(r * a, g * a, bl * a, a) } else { Color::from_rgba(r, g, bl, a) });
            }
            let indices: PackedInt32Array = idx.iter().map(|&i| (i - lo) as i32).collect();
            rs.canvas_item_add_triangle_array_ex(item, &indices, &points, &colors).uvs(&uvs).texture(tex.get_rid()).done();
        }
    }
}

fn read_text(path: &GString) -> Option<String> {
    let s = FileAccess::get_file_as_string(path);
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn load_texture(path: &str) -> Option<Gd<Texture2D>> {
    if let Some(res) = ResourceLoader::singleton().load(path) {
        if let Ok(t) = res.try_cast::<Texture2D>() {
            return Some(t);
        }
    }
    // Not imported (e.g. headless, raw files): load the image directly.
    let image = Image::load_from_file(path)?;
    ImageTexture::create_from_image(&image).map(|t| t.upcast())
}

#[godot_api]
impl RabbitSkeleton2D {
    /// Emitted for animation events keyed in the skeleton.
    #[signal]
    fn animation_event(name: GString, int_value: i64, float_value: f64, string_value: GString);

    /// (Re)loads the skeleton and atlas and starts `animation`.
    #[func]
    pub fn reload(&mut self) -> bool {
        self.loaded = None;
        let Some(json) = read_text(&self.skeleton_file) else {
            godot_error!("RabbitSkeleton2D: cannot read skeleton file '{}'", self.skeleton_file);
            return false;
        };
        let mut data = match load_spine_json(&json) {
            Ok(d) => d,
            Err(e) => {
                godot_error!("RabbitSkeleton2D: {e}");
                return false;
            }
        };
        for w in &data.warnings {
            godot_warn!("RabbitSkeleton2D: {w}");
        }
        let mut textures = Vec::new();
        let mut pma = false;
        if !self.atlas_file.is_empty() {
            let Some(text) = read_text(&self.atlas_file) else {
                godot_error!("RabbitSkeleton2D: cannot read atlas '{}'", self.atlas_file);
                return false;
            };
            let atlas = match Atlas::parse(&text) {
                Ok(a) => a,
                Err(e) => {
                    godot_error!("RabbitSkeleton2D: atlas: {e}");
                    return false;
                }
            };
            let path = self.atlas_file.to_string();
            let dir = path.rsplit_once('/').map_or(String::new(), |(d, _)| format!("{d}/"));
            for page in &atlas.pages {
                match load_texture(&format!("{dir}{}", page.name)) {
                    Some(t) => textures.push(t),
                    None => {
                        godot_error!("RabbitSkeleton2D: cannot load texture page '{}{}'", dir, page.name);
                        return false;
                    }
                }
            }
            pma = atlas.pages.iter().any(|p| p.pma);
            for m in data.bind_atlas(&atlas) {
                godot_warn!("RabbitSkeleton2D: atlas region not found: {m}");
            }
        }
        let data = Arc::new(data);
        let mut skeleton = Skeleton::new(data.clone());
        if !self.skin.is_empty() && !skeleton.set_skin(Some(&self.skin.to_string())) {
            godot_warn!("RabbitSkeleton2D: unknown skin '{}'", self.skin);
        }
        let mut state = AnimationState::new(data.clone());
        state.default_mix = self.default_mix;
        if !self.animation.is_empty() && state.set_animation(0, &self.animation.to_string(), self.looping).is_none() {
            godot_warn!("RabbitSkeleton2D: unknown animation '{}'", self.animation);
        }
        state.apply(&mut skeleton);
        skeleton.update_world();
        let mut mat = CanvasItemMaterial::new_gd();
        mat.set_blend_mode(if pma { GdBlendMode::PREMULT_ALPHA } else { GdBlendMode::MIX });
        self.base_mut().set_material(&mat);
        self.loaded = Some(Loaded { data, skeleton, state, textures, pma });
        self.base_mut().queue_redraw();
        true
    }

    /// Plays an animation now, crossfading. Returns false if it does not exist.
    #[func]
    pub fn play(&mut self, track: i32, name: GString, looping: bool) -> bool {
        match &mut self.loaded {
            Some(l) => l.state.set_animation(track.max(0) as usize, &name.to_string(), looping).is_some(),
            None if track == 0 => {
                // Not loaded yet (called before _ready): play once loaded.
                self.animation = name;
                self.looping = looping;
                true
            }
            None => false,
        }
    }

    /// Queues an animation after the current one (`delay <= 0`: when it completes).
    #[func]
    pub fn add_animation(&mut self, track: i32, name: GString, looping: bool, delay: f32) -> bool {
        self.loaded.as_mut().is_some_and(|l| l.state.add_animation(track.max(0) as usize, &name.to_string(), looping, delay).is_some())
    }

    /// Fades a track out over `mix` seconds.
    #[func]
    pub fn set_empty_animation(&mut self, track: i32, mix: f32) {
        if let Some(l) = &mut self.loaded {
            l.state.set_empty_animation(track.max(0) as usize, mix);
        }
    }

    #[func]
    pub fn set_mix(&mut self, from: GString, to: GString, duration: f32) -> bool {
        self.loaded.as_mut().is_some_and(|l| l.state.set_mix(&from.to_string(), &to.to_string(), duration))
    }

    #[func]
    pub fn set_skin_name(&mut self, name: GString) -> bool {
        let name = name.to_string();
        self.loaded.as_mut().is_some_and(|l| l.skeleton.set_skin(if name.is_empty() { None } else { Some(name.as_str()) }))
    }

    #[func]
    pub fn get_animation_names(&self) -> PackedStringArray {
        self.loaded.as_ref().map_or_else(PackedStringArray::new, |l| l.data.animations.iter().map(|a| GString::from(a.name.as_str())).collect())
    }

    #[func]
    pub fn get_skin_names(&self) -> PackedStringArray {
        self.loaded.as_ref().map_or_else(PackedStringArray::new, |l| l.data.skins.iter().map(|s| GString::from(s.name.as_str())).collect())
    }

    /// Current animation on a track, or "" when empty.
    #[func]
    pub fn get_current_animation(&self, track: i32) -> GString {
        self.loaded
            .as_ref()
            .and_then(|l| {
                let e = l.state.current(track.max(0) as usize)?;
                l.data.animations.get(e.animation).map(|a| GString::from(a.name.as_str()))
            })
            .unwrap_or_default()
    }

    /// Bone position in this node's local space (Godot axes, y down).
    #[func]
    pub fn get_bone_position(&self, bone: GString) -> Vector2 {
        let Some(l) = &self.loaded else { return Vector2::ZERO };
        match l.skeleton.find_bone(&bone.to_string()) {
            Some(i) => {
                let w = l.skeleton.bones[i].world;
                Vector2::new(w.x, -w.y)
            }
            None => Vector2::ZERO,
        }
    }

    /// Number of vertices rendered in the last frame (diagnostics).
    #[func]
    pub fn get_rendered_vertex_count(&self) -> i64 {
        self.buffers.vertex_count() as i64
    }

    /// Restarts physics from the current pose (call after teleporting).
    #[func]
    pub fn reset_physics(&mut self) {
        if let Some(l) = &mut self.loaded {
            l.skeleton.reset_physics();
        }
    }
}
