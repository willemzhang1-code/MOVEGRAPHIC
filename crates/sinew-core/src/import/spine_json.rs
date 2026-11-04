//! Importer for Spine 4.x JSON skeleton data, based on the publicly
//! documented export format. Unsupported features are reported in
//! `SkeletonData::warnings` instead of failing the load.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::animation::{ik_flags, Animation, CurveChannel, DiscreteChannel, EventKey, Property};
use crate::curve::Curve;
use crate::math::{Color, Transform};
use crate::model::*;

type Obj = Map<String, Value>;

fn num(v: &Value, key: &str, default: f32) -> f32 {
    v.get(key).and_then(Value::as_f64).map_or(default, |n| n as f32)
}

fn int(v: &Value, key: &str, default: i64) -> i64 {
    v.get(key).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64))).unwrap_or(default)
}

fn boolean(v: &Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(default)
}

fn string<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn color(v: &Value, key: &str) -> Option<Color> {
    string(v, key).and_then(Color::from_hex)
}

fn floats(v: &Value, key: &str) -> Vec<f32> {
    v.get(key).and_then(Value::as_array).map_or_else(Vec::new, |a| a.iter().filter_map(Value::as_f64).map(|n| n as f32).collect())
}

fn obj<'a>(v: &'a Value, key: &str) -> Option<&'a Obj> {
    v.get(key).and_then(Value::as_object)
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map_or(&[], |a| a.as_slice())
}

struct Ctx {
    data: SkeletonData,
    warnings: BTreeSet<String>,
    next_attachment_id: u32,
}

impl Ctx {
    fn warn(&mut self, w: impl Into<String>) {
        self.warnings.insert(w.into());
    }

    fn bone(&self, name: &str, ctx: &str) -> Result<usize, String> {
        self.data.find_bone(name).ok_or_else(|| format!("{ctx}: unknown bone '{name}'"))
    }

    fn slot(&self, name: &str, ctx: &str) -> Result<usize, String> {
        self.data.find_slot(name).ok_or_else(|| format!("{ctx}: unknown slot '{name}'"))
    }
}

struct PendingLink {
    skin: usize,
    slot: usize,
    name: String,
    parent: String,
    parent_skin: Option<String>,
    inherit_timelines: bool,
}

/// Loads Spine 4.x JSON.
pub fn load_spine_json(text: &str) -> Result<SkeletonData, String> {
    let root: Value = serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
    let mut cx = Ctx { data: SkeletonData { fps: 30.0, ..Default::default() }, warnings: BTreeSet::new(), next_attachment_id: 1 };

    if let Some(s) = root.get("skeleton") {
        cx.data.version = string(s, "spine").unwrap_or_default().to_string();
        cx.data.x = num(s, "x", 0.0);
        cx.data.y = num(s, "y", 0.0);
        cx.data.width = num(s, "width", 0.0);
        cx.data.height = num(s, "height", 0.0);
        cx.data.fps = num(s, "fps", 30.0);
    }
    let v = cx.data.version.clone();
    if v.starts_with("3.") || v.starts_with("2.") {
        return Err(format!("Spine {v} JSON is not supported; export with Spine 4.x"));
    }
    if !v.is_empty() && !v.starts_with("4.") {
        cx.warn(format!("untested Spine version {v}"));
    }
    if v.starts_with("4.3") {
        cx.warn("Spine 4.3 data: format changes in 4.3 are not fully verified".to_string());
    }

    read_bones(&mut cx, &root)?;
    read_slots(&mut cx, &root)?;
    read_ik(&mut cx, &root)?;
    read_transforms(&mut cx, &root)?;
    if !arr(&root, "path").is_empty() {
        cx.warn("path constraints are not supported yet (M1)");
    }
    read_physics(&mut cx, &root)?;
    read_skins(&mut cx, &root)?;
    read_events(&mut cx, &root);
    if let Some(anims) = obj(&root, "animations") {
        for (name, a) in anims {
            let anim = read_animation(&mut cx, name, a)?;
            cx.data.animations.push(anim);
        }
    }
    let Ctx { mut data, warnings, .. } = cx;
    data.warnings = warnings.into_iter().collect();
    Ok(data)
}

fn read_bones(cx: &mut Ctx, root: &Value) -> Result<(), String> {
    for b in arr(root, "bones") {
        let name = string(b, "name").ok_or("bone without name")?.to_string();
        let parent = match string(b, "parent") {
            Some(p) => Some(cx.bone(p, &format!("bone '{name}'"))?),
            None => None,
        };
        let inherit = string(b, "inherit").or_else(|| string(b, "transform")).and_then(Inherit::parse).unwrap_or_default();
        cx.data.bones.push(BoneData {
            setup: Transform {
                x: num(b, "x", 0.0),
                y: num(b, "y", 0.0),
                rotation: num(b, "rotation", 0.0),
                scale_x: num(b, "scaleX", 1.0),
                scale_y: num(b, "scaleY", 1.0),
                shear_x: num(b, "shearX", 0.0),
                shear_y: num(b, "shearY", 0.0),
            },
            name,
            parent,
            length: num(b, "length", 0.0),
            inherit,
            skin_required: boolean(b, "skin", false),
            color: color(b, "color").unwrap_or(Color::new(0.61, 0.61, 0.61, 1.0)),
        });
    }
    Ok(())
}

fn read_slots(cx: &mut Ctx, root: &Value) -> Result<(), String> {
    for s in arr(root, "slots") {
        let name = string(s, "name").ok_or("slot without name")?.to_string();
        let bone = cx.bone(string(s, "bone").unwrap_or_default(), &format!("slot '{name}'"))?;
        let dark = string(s, "dark").and_then(Color::from_hex);
        cx.data.slots.push(SlotData {
            name,
            bone,
            color: color(s, "color").unwrap_or(Color::WHITE),
            dark,
            attachment: string(s, "attachment").map(str::to_string),
            blend: BlendMode::parse(string(s, "blend").unwrap_or("normal")),
        });
    }
    Ok(())
}

fn bone_list(cx: &Ctx, v: &Value, ctx: &str) -> Result<Vec<usize>, String> {
    arr(v, "bones").iter().map(|b| cx.bone(b.as_str().unwrap_or_default(), ctx)).collect()
}

fn read_ik(cx: &mut Ctx, root: &Value) -> Result<(), String> {
    for c in arr(root, "ik") {
        let name = string(c, "name").unwrap_or_default().to_string();
        let ctx = format!("ik '{name}'");
        let bones = bone_list(cx, c, &ctx)?;
        let target = cx.bone(string(c, "target").unwrap_or_default(), &ctx)?;
        if bones.is_empty() || bones.len() > 2 {
            return Err(format!("{ctx}: expected 1 or 2 bones"));
        }
        cx.data.ik.push(IkConstraintData {
            name,
            order: int(c, "order", 0) as i32,
            skin_required: boolean(c, "skin", false),
            bones,
            target,
            mix: num(c, "mix", 1.0),
            softness: num(c, "softness", 0.0),
            bend_positive: boolean(c, "bendPositive", true),
            compress: boolean(c, "compress", false),
            stretch: boolean(c, "stretch", false),
            uniform: boolean(c, "uniform", false),
        });
    }
    Ok(())
}

fn read_transforms(cx: &mut Ctx, root: &Value) -> Result<(), String> {
    for c in arr(root, "transform") {
        let name = string(c, "name").unwrap_or_default().to_string();
        let ctx = format!("transform constraint '{name}'");
        let bones = bone_list(cx, c, &ctx)?;
        let Some(target) = string(c, "target") else {
            cx.warn(format!("{ctx}: unsupported layout (no target), skipped"));
            continue;
        };
        let target = cx.bone(target, &ctx)?;
        let mix_x = num(c, "mixX", 1.0);
        let mix_scale_x = num(c, "mixScaleX", 1.0);
        cx.data.transforms.push(TransformConstraintData {
            name,
            order: int(c, "order", 0) as i32,
            skin_required: boolean(c, "skin", false),
            bones,
            target,
            offset_rotation: num(c, "rotation", 0.0),
            offset_x: num(c, "x", 0.0),
            offset_y: num(c, "y", 0.0),
            offset_scale_x: num(c, "scaleX", 0.0),
            offset_scale_y: num(c, "scaleY", 0.0),
            offset_shear_y: num(c, "shearY", 0.0),
            mix: TransformMix {
                rotate: num(c, "mixRotate", 1.0),
                x: mix_x,
                y: num(c, "mixY", mix_x),
                scale_x: mix_scale_x,
                scale_y: num(c, "mixScaleY", mix_scale_x),
                shear_y: num(c, "mixShearY", 1.0),
            },
            local: boolean(c, "local", false),
            relative: boolean(c, "relative", false),
        });
    }
    Ok(())
}

fn read_physics(cx: &mut Ctx, root: &Value) -> Result<(), String> {
    for c in arr(root, "physics") {
        let name = string(c, "name").unwrap_or_default().to_string();
        let ctx = format!("physics constraint '{name}'");
        let bone = cx.bone(string(c, "bone").unwrap_or_default(), &ctx)?;
        let g = |k: &str| boolean(c, k, false);
        cx.data.physics.push(PhysicsConstraintData {
            name,
            order: int(c, "order", 0) as i32,
            skin_required: boolean(c, "skin", false),
            bone,
            x: num(c, "x", 0.0),
            y: num(c, "y", 0.0),
            rotate: num(c, "rotate", 0.0),
            scale_x: num(c, "scaleX", 0.0),
            shear_x: num(c, "shearX", 0.0),
            limit: num(c, "limit", 5000.0),
            fps: num(c, "fps", 60.0),
            params: PhysicsParams {
                inertia: num(c, "inertia", 1.0),
                strength: num(c, "strength", 100.0),
                damping: num(c, "damping", 1.0),
                mass_inverse: 1.0 / num(c, "mass", 1.0).max(1e-6),
                wind: num(c, "wind", 0.0),
                gravity: num(c, "gravity", 0.0),
                mix: num(c, "mix", 1.0),
            },
            global: [
                g("inertiaGlobal"),
                g("strengthGlobal"),
                g("dampingGlobal"),
                g("massGlobal"),
                g("windGlobal"),
                g("gravityGlobal"),
                g("mixGlobal"),
            ],
        });
    }
    Ok(())
}

fn read_vertices(values: Vec<f32>, vertex_count: usize) -> Vertices {
    if values.len() == vertex_count * 2 {
        return Vertices::Plain(values);
    }
    let mut bones = Vec::new();
    let mut weights = Vec::new();
    let mut i = 0;
    while i < values.len() {
        let count = values[i] as usize;
        i += 1;
        bones.push(count as u32);
        for _ in 0..count {
            if i + 3 >= values.len() {
                break;
            }
            bones.push(values[i] as u32);
            weights.extend_from_slice(&[values[i + 1], values[i + 2], values[i + 3]]);
            i += 4;
        }
    }
    Vertices::Weighted { bones, weights }
}

fn read_skins(cx: &mut Ctx, root: &Value) -> Result<(), String> {
    let mut skins: Vec<(String, &Value)> = Vec::new();
    match root.get("skins") {
        Some(Value::Array(a)) => {
            for s in a {
                skins.push((string(s, "name").unwrap_or("default").to_string(), s));
            }
        }
        Some(Value::Object(_)) => return Err("Spine 3.x skin layout is not supported; export with Spine 4.x".into()),
        _ => {}
    }
    let mut links = Vec::new();
    for (name, s) in skins {
        let skin_index = cx.data.skins.len();
        let mut skin = Skin::new(name.clone());
        let ctx = format!("skin '{name}'");
        skin.bones = bone_list(cx, s, &ctx)?;
        for c in arr(s, "ik") {
            if let Some(i) = c.as_str().and_then(|n| cx.data.find_ik(n)) {
                skin.ik.push(i);
            }
        }
        for c in arr(s, "transform") {
            if let Some(i) = c.as_str().and_then(|n| cx.data.find_transform(n)) {
                skin.transforms.push(i);
            }
        }
        for c in arr(s, "physics") {
            if let Some(i) = c.as_str().and_then(|n| cx.data.find_physics(n)) {
                skin.physics.push(i);
            }
        }
        if let Some(slots) = obj(s, "attachments") {
            for (slot_name, atts) in slots {
                let slot = cx.slot(slot_name, &ctx)?;
                let Some(atts) = atts.as_object() else { continue };
                for (att_name, a) in atts {
                    if let Some(att) = read_attachment(cx, skin_index, slot, att_name, a, &mut links)? {
                        skin.insert(slot, att_name, att);
                    }
                }
            }
        }
        if name == "default" {
            cx.data.default_skin = Some(skin_index);
        }
        cx.data.skins.push(skin);
    }
    for l in links {
        let parent_skin = match &l.parent_skin {
            Some(n) => cx.data.find_skin(n),
            None => cx.data.default_skin,
        };
        let parent = parent_skin.and_then(|s| cx.data.skins[s].get(l.slot, &l.parent).cloned());
        let Some(parent) = parent else {
            cx.warn(format!("linked mesh '{}': parent mesh '{}' not found", l.name, l.parent));
            continue;
        };
        let AttachmentKind::Mesh(pm) = &parent.kind else { continue };
        let skin = &mut cx.data.skins[l.skin];
        let Some(i) = skin.find(l.slot, &l.name) else { continue };
        let att = &mut skin.attachments[i].1;
        if l.inherit_timelines {
            att.deform_id = parent.deform_id;
        }
        if let AttachmentKind::Mesh(m) = &mut att.kind {
            m.vertices = pm.vertices.clone();
            m.vertex_count = pm.vertex_count;
            m.region_uvs = pm.region_uvs.clone();
            m.triangles = pm.triangles.clone();
            m.hull_length = pm.hull_length;
            m.edges = pm.edges.clone();
            m.bind_region(None);
        }
    }
    Ok(())
}

fn read_attachment(
    cx: &mut Ctx,
    skin: usize,
    slot: usize,
    key: &str,
    a: &Value,
    links: &mut Vec<PendingLink>,
) -> Result<Option<Attachment>, String> {
    let name = string(a, "name").unwrap_or(key).to_string();
    let path = string(a, "path").unwrap_or(&name).to_string();
    let kind_name = string(a, "type").unwrap_or("region");
    if a.get("sequence").is_some() {
        cx.warn(format!("attachment '{name}': sequences are not supported yet (M1)"));
    }
    let col = color(a, "color").unwrap_or(Color::WHITE);
    let kind = match kind_name {
        "region" => AttachmentKind::Region(RegionAttachment {
            path,
            transform: Transform {
                x: num(a, "x", 0.0),
                y: num(a, "y", 0.0),
                rotation: num(a, "rotation", 0.0),
                scale_x: num(a, "scaleX", 1.0),
                scale_y: num(a, "scaleY", 1.0),
                ..Default::default()
            },
            width: num(a, "width", 32.0),
            height: num(a, "height", 32.0),
            color: col,
            region: None,
        }),
        "mesh" | "linkedmesh" => {
            let mut m = MeshAttachment {
                path,
                color: col,
                vertices: Vertices::Plain(Vec::new()),
                vertex_count: 0,
                region_uvs: Vec::new(),
                triangles: Vec::new(),
                hull_length: 0,
                edges: Vec::new(),
                width: num(a, "width", 0.0),
                height: num(a, "height", 0.0),
                region: None,
                uvs: Vec::new(),
            };
            if kind_name == "linkedmesh" {
                links.push(PendingLink {
                    skin,
                    slot,
                    name: key.to_string(),
                    parent: string(a, "parent").unwrap_or_default().to_string(),
                    parent_skin: string(a, "skin").map(str::to_string),
                    inherit_timelines: boolean(a, "timelines", true),
                });
            } else {
                m.region_uvs = floats(a, "uvs");
                m.vertex_count = m.region_uvs.len() / 2;
                m.vertices = read_vertices(floats(a, "vertices"), m.vertex_count);
                m.triangles = floats(a, "triangles").into_iter().map(|t| t as u32).collect();
                m.hull_length = int(a, "hull", 0) as u32;
                m.edges = floats(a, "edges").into_iter().map(|t| t as u32).collect();
                m.bind_region(None);
            }
            AttachmentKind::Mesh(m)
        }
        "boundingbox" | "clipping" | "path" => {
            let vertex_count = int(a, "vertexCount", 0) as usize;
            let shape = VertexAttachment { vertices: read_vertices(floats(a, "vertices"), vertex_count), vertex_count, color: col };
            match kind_name {
                "boundingbox" => AttachmentKind::BoundingBox(shape),
                "clipping" => {
                    cx.warn("clipping attachments are not rendered yet (M1)");
                    let end_slot = string(a, "end").and_then(|s| cx.data.find_slot(s));
                    AttachmentKind::Clipping(ClippingAttachment { shape, end_slot })
                }
                _ => AttachmentKind::Path(PathAttachment {
                    shape,
                    closed: boolean(a, "closed", false),
                    constant_speed: boolean(a, "constantSpeed", true),
                    lengths: floats(a, "lengths"),
                }),
            }
        }
        "point" => AttachmentKind::Point(PointAttachment {
            x: num(a, "x", 0.0),
            y: num(a, "y", 0.0),
            rotation: num(a, "rotation", 0.0),
            color: col,
        }),
        other => {
            cx.warn(format!("unknown attachment type '{other}'"));
            return Ok(None);
        }
    };
    let id = cx.next_attachment_id;
    cx.next_attachment_id += 1;
    Ok(Some(Attachment { id, deform_id: id, name, kind }))
}

fn read_events(cx: &mut Ctx, root: &Value) {
    if let Some(events) = obj(root, "events") {
        for (name, e) in events {
            cx.data.events.push(EventData {
                name: name.clone(),
                int: int(e, "int", 0) as i32,
                float: num(e, "float", 0.0),
                string: string(e, "string").unwrap_or_default().to_string(),
                audio: string(e, "audio").map(str::to_string),
                volume: num(e, "volume", 1.0),
                balance: num(e, "balance", 0.0),
            });
        }
    }
}

fn read_curves(frame: &Value, count: usize) -> Vec<Curve> {
    match frame.get("curve") {
        Some(Value::String(s)) if s == "stepped" => vec![Curve::Stepped; count],
        Some(Value::Array(a)) => {
            let n: Vec<f32> = a.iter().filter_map(Value::as_f64).map(|x| x as f32).collect();
            (0..count)
                .map(|j| match n.get(j * 4..j * 4 + 4) {
                    Some(c) => Curve::Bezier { cx1: c[0], cy1: c[1], cx2: c[2], cy2: c[3] },
                    None => Curve::Linear,
                })
                .collect()
        }
        _ => vec![Curve::Linear; count],
    }
}

fn curve_channel(property: Property, frames: &[Value], values: impl Fn(&Value) -> Vec<f32>) -> CurveChannel {
    let mut ch = CurveChannel::new(property);
    for f in frames {
        let curves = read_curves(f, ch.curve_stride);
        ch.push(num(f, "time", 0.0), &values(f), &curves, 0);
    }
    ch
}

fn hex(f: &Value, key: &str, default: Color) -> Color {
    color(f, key).unwrap_or(default)
}

fn read_animation(cx: &mut Ctx, name: &str, a: &Value) -> Result<Animation, String> {
    let mut anim = Animation::new(name);
    let ctx = format!("animation '{name}'");

    if let Some(slots) = obj(a, "slots") {
        for (slot_name, timelines) in slots {
            let slot = cx.slot(slot_name, &ctx)?;
            let Some(timelines) = timelines.as_object() else { continue };
            for (tl, frames) in timelines {
                let frames = frames.as_array().map_or(&[][..], |v| v.as_slice());
                match tl.as_str() {
                    "attachment" => anim.discrete.push(DiscreteChannel::Attachment {
                        slot,
                        times: frames.iter().map(|f| num(f, "time", 0.0)).collect(),
                        names: frames.iter().map(|f| string(f, "name").map(str::to_string)).collect(),
                    }),
                    "rgba" => anim.curves.push(curve_channel(Property::SlotRgba(slot), frames, |f| {
                        let c = hex(f, "color", Color::WHITE);
                        vec![c.r, c.g, c.b, c.a]
                    })),
                    "rgb" => anim.curves.push(curve_channel(Property::SlotRgb(slot), frames, |f| {
                        let c = hex(f, "color", Color::WHITE);
                        vec![c.r, c.g, c.b]
                    })),
                    "alpha" => anim.curves.push(curve_channel(Property::SlotAlpha(slot), frames, |f| vec![num(f, "value", 1.0)])),
                    "rgba2" => anim.curves.push(curve_channel(Property::SlotRgba2(slot), frames, |f| {
                        let l = hex(f, "light", Color::WHITE);
                        let d = hex(f, "dark", Color::BLACK);
                        vec![l.r, l.g, l.b, l.a, d.r, d.g, d.b]
                    })),
                    "rgb2" => anim.curves.push(curve_channel(Property::SlotRgb2(slot), frames, |f| {
                        let l = hex(f, "light", Color::WHITE);
                        let d = hex(f, "dark", Color::BLACK);
                        vec![l.r, l.g, l.b, d.r, d.g, d.b]
                    })),
                    other => cx.warn(format!("slot timeline '{other}' is not supported yet")),
                }
            }
        }
    }

    if let Some(bones) = obj(a, "bones") {
        for (bone_name, timelines) in bones {
            let bone = cx.bone(bone_name, &ctx)?;
            let Some(timelines) = timelines.as_object() else { continue };
            for (tl, frames) in timelines {
                let frames = frames.as_array().map_or(&[][..], |v| v.as_slice());
                let ch = match tl.as_str() {
                    "rotate" => curve_channel(Property::BoneRotate(bone), frames, |f| vec![num(f, "value", 0.0)]),
                    "translate" => curve_channel(Property::BoneTranslate(bone), frames, |f| vec![num(f, "x", 0.0), num(f, "y", 0.0)]),
                    "translatex" => curve_channel(Property::BoneTranslateX(bone), frames, |f| vec![num(f, "value", 0.0)]),
                    "translatey" => curve_channel(Property::BoneTranslateY(bone), frames, |f| vec![num(f, "value", 0.0)]),
                    "scale" => curve_channel(Property::BoneScale(bone), frames, |f| vec![num(f, "x", 1.0), num(f, "y", 1.0)]),
                    "scalex" => curve_channel(Property::BoneScaleX(bone), frames, |f| vec![num(f, "value", 1.0)]),
                    "scaley" => curve_channel(Property::BoneScaleY(bone), frames, |f| vec![num(f, "value", 1.0)]),
                    "shear" => curve_channel(Property::BoneShear(bone), frames, |f| vec![num(f, "x", 0.0), num(f, "y", 0.0)]),
                    "shearx" => curve_channel(Property::BoneShearX(bone), frames, |f| vec![num(f, "value", 0.0)]),
                    "sheary" => curve_channel(Property::BoneShearY(bone), frames, |f| vec![num(f, "value", 0.0)]),
                    "inherit" => {
                        anim.discrete.push(DiscreteChannel::Inherit {
                            bone,
                            times: frames.iter().map(|f| num(f, "time", 0.0)).collect(),
                            values: frames.iter().map(|f| string(f, "inherit").and_then(Inherit::parse).unwrap_or_default()).collect(),
                        });
                        continue;
                    }
                    other => {
                        cx.warn(format!("bone timeline '{other}' is not supported yet"));
                        continue;
                    }
                };
                anim.curves.push(ch);
            }
        }
    }

    if let Some(iks) = obj(a, "ik") {
        for (cname, frames) in iks {
            let Some(i) = cx.data.find_ik(cname) else {
                cx.warn(format!("{ctx}: unknown ik constraint '{cname}'"));
                continue;
            };
            let frames = frames.as_array().map_or(&[][..], |v| v.as_slice());
            let mut ch = CurveChannel::new(Property::Ik(i));
            for f in frames {
                let mut flags = 0;
                if boolean(f, "bendPositive", true) {
                    flags |= ik_flags::BEND_POSITIVE;
                }
                if boolean(f, "compress", false) {
                    flags |= ik_flags::COMPRESS;
                }
                if boolean(f, "stretch", false) {
                    flags |= ik_flags::STRETCH;
                }
                ch.push(num(f, "time", 0.0), &[num(f, "mix", 1.0), num(f, "softness", 0.0)], &read_curves(f, 2), flags);
            }
            anim.curves.push(ch);
        }
    }

    if let Some(tcs) = obj(a, "transform") {
        for (cname, frames) in tcs {
            let Some(i) = cx.data.find_transform(cname) else {
                cx.warn(format!("{ctx}: unknown transform constraint '{cname}'"));
                continue;
            };
            let frames = frames.as_array().map_or(&[][..], |v| v.as_slice());
            anim.curves.push(curve_channel(Property::Transform(i), frames, |f| {
                let mx = num(f, "mixX", 1.0);
                let msx = num(f, "mixScaleX", 1.0);
                vec![num(f, "mixRotate", 1.0), mx, num(f, "mixY", mx), msx, num(f, "mixScaleY", msx), num(f, "mixShearY", 1.0)]
            }));
        }
    }

    if obj(a, "path").is_some_and(|o| !o.is_empty()) {
        cx.warn("path timelines are not supported yet (M1)");
    }
    if let Some(phys) = obj(a, "physics") {
        for (cname, timelines) in phys {
            let constraint = if cname.is_empty() {
                crate::animation::PHYSICS_GLOBAL
            } else {
                match cx.data.find_physics(cname) {
                    Some(i) => i,
                    None => {
                        cx.warn(format!("{ctx}: unknown physics constraint '{cname}'"));
                        continue;
                    }
                }
            };
            for (tl, frames) in timelines.as_object().into_iter().flatten() {
                let param = match tl.as_str() {
                    "inertia" => 0,
                    "strength" => 1,
                    "damping" => 2,
                    "mass" => 3,
                    "wind" => 4,
                    "gravity" => 5,
                    "mix" => 6,
                    "reset" => continue,
                    other => {
                        cx.warn(format!("physics timeline '{other}' is not supported yet"));
                        continue;
                    }
                };
                let default = if param == 6 || param == 3 { 1.0 } else { 0.0 };
                let frames = frames.as_array().map_or(&[][..], |v| v.as_slice());
                anim.curves.push(curve_channel(Property::Physics { constraint, param }, frames, |f| vec![num(f, "value", default)]));
            }
        }
    }

    // 4.1+: attachments/<skin>/<slot>/<attachment>/{deform, sequence}; 4.0: deform/<skin>/<slot>/<attachment>
    let mut deforms: Vec<(String, String, String, Vec<Value>)> = Vec::new();
    if let Some(skins) = obj(a, "attachments") {
        for (skin, slots) in skins {
            for (slot, atts) in slots.as_object().into_iter().flatten() {
                for (att, tls) in atts.as_object().into_iter().flatten() {
                    if let Some(f) = tls.get("deform").and_then(Value::as_array) {
                        deforms.push((skin.clone(), slot.clone(), att.clone(), f.clone()));
                    }
                    if tls.get("sequence").is_some() {
                        cx.warn("sequence timelines are not supported yet (M1)");
                    }
                }
            }
        }
    }
    if let Some(skins) = obj(a, "deform") {
        for (skin, slots) in skins {
            for (slot, atts) in slots.as_object().into_iter().flatten() {
                for (att, f) in atts.as_object().into_iter().flatten() {
                    if let Some(f) = f.as_array() {
                        deforms.push((skin.clone(), slot.clone(), att.clone(), f.clone()));
                    }
                }
            }
        }
    }
    for (skin_name, slot_name, att_name, frames) in deforms {
        let slot = cx.slot(&slot_name, &ctx)?;
        let Some(skin) = cx.data.find_skin(&skin_name) else {
            cx.warn(format!("{ctx}: deform for unknown skin '{skin_name}'"));
            continue;
        };
        let Some(att) = cx.data.skins[skin].get(slot, &att_name) else {
            cx.warn(format!("{ctx}: deform for unknown attachment '{att_name}'"));
            continue;
        };
        let Some(verts) = att.vertices() else { continue };
        let setup = verts.deform_setup();
        let len = setup.len();
        let mut ch = CurveChannel::new_deform(slot, att.deform_id, len);
        for f in &frames {
            let mut values = setup.clone();
            let deltas = floats(f, "vertices");
            let offset = int(f, "offset", 0).max(0) as usize;
            for (i, d) in deltas.iter().enumerate() {
                if let Some(v) = values.get_mut(offset + i) {
                    *v += d;
                }
            }
            ch.push(num(f, "time", 0.0), &values, &read_curves(f, 1), 0);
        }
        anim.curves.push(ch);
    }

    let draw_order = a.get("drawOrder").or_else(|| a.get("draworder"));
    if let Some(frames) = draw_order.and_then(Value::as_array) {
        let n = cx.data.slots.len();
        let mut times = Vec::new();
        let mut orders = Vec::new();
        for f in frames {
            times.push(num(f, "time", 0.0));
            let offsets = arr(f, "offsets");
            if offsets.is_empty() {
                orders.push(None);
                continue;
            }
            let mut order = vec![usize::MAX; n];
            let mut unchanged = Vec::with_capacity(n);
            let mut original = 0usize;
            for o in offsets {
                let s = cx.slot(string(o, "slot").unwrap_or_default(), &ctx)?;
                while original < s {
                    unchanged.push(original);
                    original += 1;
                }
                let pos = original as i64 + int(o, "offset", 0);
                if pos < 0 || pos as usize >= n {
                    return Err(format!("{ctx}: draw order offset out of range"));
                }
                order[pos as usize] = original;
                original += 1;
            }
            while original < n {
                unchanged.push(original);
                original += 1;
            }
            for i in (0..n).rev() {
                if order[i] == usize::MAX {
                    order[i] = unchanged.pop().unwrap_or(i);
                }
            }
            orders.push(Some(order));
        }
        anim.discrete.push(DiscreteChannel::DrawOrder { times, orders });
    }

    for e in arr(a, "events") {
        let ename = string(e, "name").unwrap_or_default();
        let Some(ei) = cx.data.find_event(ename) else {
            cx.warn(format!("{ctx}: unknown event '{ename}'"));
            continue;
        };
        let d = &cx.data.events[ei];
        anim.events.push(EventKey {
            time: num(e, "time", 0.0),
            event: ei,
            int: int(e, "int", d.int as i64) as i32,
            float: num(e, "float", d.float),
            string: string(e, "string").unwrap_or(&d.string).to_string(),
            volume: num(e, "volume", d.volume),
            balance: num(e, "balance", d.balance),
        });
    }

    anim.finalize();
    Ok(anim)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skin_entries_keyed_by_placeholder() {
        let json = r#"{
          "skeleton": {"spine": "4.2.0"},
          "bones": [{"name": "root"}],
          "slots": [{"name": "s", "bone": "root", "attachment": "body"}],
          "skins": [
            {"name": "default", "attachments": {"s": {"body": {"type": "mesh", "name": "base/body", "uvs": [0,0,1,0,1,1], "triangles": [0,1,2], "vertices": [0,0,10,0,10,10], "hull": 3}}}},
            {"name": "girl", "attachments": {"s": {"body": {"type": "linkedmesh", "name": "girl/body", "parent": "body"}}}}
          ],
          "animations": {"a": {"attachments": {"default": {"s": {"body": {"deform": [{"time": 0}, {"time": 1, "vertices": [1, 1]}]}}}}}}
        }"#;
        let d = load_spine_json(json).unwrap();
        assert!(d.warnings.is_empty(), "{:?}", d.warnings);
        let girl = &d.skins[d.find_skin("girl").unwrap()];
        let linked = girl.get(0, "body").expect("linked mesh found by key");
        assert_eq!(linked.name, "girl/body");
        let parent = d.skins[0].get(0, "body").unwrap();
        assert_eq!(linked.deform_id, parent.deform_id);
        let AttachmentKind::Mesh(m) = &linked.kind else { panic!() };
        assert_eq!(m.vertex_count, 3);
        assert_eq!(d.animations[0].curves.len(), 1);
    }
}
