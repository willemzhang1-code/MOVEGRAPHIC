//! Integration tests against the generated demo character (Spine 4.2 JSON).

use std::sync::Arc;

use sinew_core::import::load_spine_json;
use sinew_core::{AnimationState, Atlas, RenderBuffers, Skeleton, SkeletonData, StateEventKind, Vec2};

fn load() -> SkeletonData {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/demo/public/assets/critter.json");
    let text = std::fs::read_to_string(path).expect("run `node tools/gen-demo.mjs` first");
    let mut data = load_spine_json(&text).expect("load");
    // Synthetic atlas: one page, every part in its own cell.
    let parts = [
        ("body_green", 100, 140),
        ("body_purple", 100, 140),
        ("head_green", 112, 100),
        ("head_purple", 112, 100),
        ("eye_open", 20, 24),
        ("eye_closed", 20, 24),
        ("upper_arm", 56, 24),
        ("forearm", 50, 20),
        ("hand", 26, 26),
        ("thigh", 70, 30),
        ("shin", 66, 26),
        ("foot", 48, 22),
        ("tail", 40, 160),
    ];
    let mut atlas = String::from("critter.png\nsize: 1024, 256\npma: true\n");
    let mut x = 0;
    for (name, w, h) in parts {
        atlas += &format!("{name}\n  bounds: {x}, 0, {w}, {h}\n");
        x += w + 2;
    }
    let atlas = Atlas::parse(&atlas).unwrap();
    let missing = data.bind_atlas(&atlas);
    assert!(missing.is_empty(), "missing regions: {missing:?}");
    data
}

fn setup() -> (Skeleton, AnimationState) {
    let data = Arc::new(load());
    let mut sk = Skeleton::new(data.clone());
    assert!(sk.set_skin(Some("green")));
    (sk, AnimationState::new(data))
}

fn step(sk: &mut Skeleton, st: &mut AnimationState, dt: f32) {
    st.update(dt);
    st.apply(sk);
    sk.update_world();
}

#[test]
fn imports_everything() {
    let d = load();
    assert!(d.warnings.is_empty(), "{:?}", d.warnings);
    assert_eq!(d.bones.len(), 19);
    assert_eq!(d.slots.len(), 16);
    assert_eq!(d.ik.len(), 2);
    assert_eq!(d.skins.len(), 3);
    let names: Vec<_> = d.animations.iter().map(|a| a.name.as_str()).collect();
    assert_eq!(names, ["idle", "walk", "wave", "jump", "hit"]);
    let walk = &d.animations[d.find_animation("walk").unwrap()];
    assert!((walk.duration - 0.8).abs() < 1e-4);
    assert_eq!(walk.events.len(), 2);
}

#[test]
fn feet_follow_ik_targets() {
    let (mut sk, mut st) = setup();
    st.set_animation(0, "walk", true).unwrap();
    for frame in 0..60 {
        step(&mut sk, &mut st, 1.0 / 60.0);
        for side in ["far", "near"] {
            let shin = sk.find_bone(&format!("leg_{side}_shin")).unwrap();
            let foot = sk.find_bone(&format!("leg_{side}_foot")).unwrap();
            let tip = sk.bone_tip(shin);
            let target = sk.bones[foot].world.position();
            let hip = sk.bones[sk.find_bone(&format!("leg_{side}_thigh")).unwrap()].world.position();
            if target.sub(hip).len() < 113.0 {
                assert!(tip.sub(target).len() < 0.05, "frame {frame} {side}: tip {tip:?} target {target:?}");
            }
            // Knees point forward (+x) relative to the hip-ankle line.
            let knee = sk.bones[shin].world.position();
            let line = target.sub(hip);
            let rel = knee.sub(hip);
            let cross = line.x * rel.y - line.y * rel.x;
            assert!(cross > -1e-3, "frame {frame} {side}: knee bends backward");
        }
    }
}

#[test]
fn renders_with_skin_and_mesh() {
    let (mut sk, mut st) = setup();
    st.set_animation(0, "idle", true).unwrap();
    step(&mut sk, &mut st, 0.1);
    let mut out = RenderBuffers::default();
    sk.render(&mut out);
    // 15 region quads + tail mesh (20 vertices).
    assert_eq!(out.vertex_count(), 15 * 4 + 20);
    assert_eq!(out.batches.len(), 1);
    let b = out.bounds().unwrap();
    assert!(b[0] > -200.0 && b[2] < 150.0 && b[1] > -20.0 && b[3] < 330.0, "bounds {b:?}");
    // UVs inside the page.
    for v in out.vertices.chunks_exact(6) {
        let (u, w) = (f32::from_bits(v[2]), f32::from_bits(v[3]));
        assert!((0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&w));
    }
    // Without a skin, body and head have no attachment.
    sk.set_skin(None);
    st.apply(&mut sk);
    sk.update_world();
    sk.render(&mut out);
    assert_eq!(out.vertex_count(), 13 * 4 + 20);
}

#[test]
fn crossfade_is_continuous() {
    let (mut sk, mut st) = setup();
    st.default_mix = 0.3;
    st.set_animation(0, "idle", true).unwrap();
    step(&mut sk, &mut st, 0.5);
    let arm = sk.find_bone("arm_near_upper").unwrap();
    let mut prev = sk.bones[arm].world.rotation_deg();
    st.set_animation(0, "walk", true).unwrap();
    for _ in 0..40 {
        step(&mut sk, &mut st, 1.0 / 60.0);
        let r = sk.bones[arm].world.rotation_deg();
        let d = sinew_core::math::wrap_deg(r - prev).abs();
        assert!(d < 6.0, "arm jumped {d} degrees");
        prev = r;
    }
}

#[test]
fn layered_track_overrides_only_its_bones() {
    let (mut sk, mut st) = setup();
    st.set_animation(0, "walk", true).unwrap();
    step(&mut sk, &mut st, 0.2);
    let far = sk.find_bone("arm_far_upper").unwrap();
    let near = sk.find_bone("arm_near_upper").unwrap();
    let (far_before, near_before) = (sk.bones[far].world.rotation_deg(), sk.bones[near].world.rotation_deg());

    let (mut sk2, mut st2) = setup();
    st2.set_animation(0, "walk", true).unwrap();
    st2.set_animation(1, "wave", true).unwrap();
    step(&mut sk2, &mut st2, 0.2);
    assert!((sk2.bones[far].world.rotation_deg() - far_before).abs() < 1e-3);
    assert!((sk2.bones[near].world.rotation_deg() - near_before).abs() > 30.0);
}

#[test]
fn events_draw_order_and_queue() {
    let (mut sk, mut st) = setup();
    st.set_animation(0, "walk", true).unwrap();
    let mut steps = 0;
    for _ in 0..100 {
        step(&mut sk, &mut st, 1.0 / 60.0);
        for e in st.drain_events() {
            if let StateEventKind::Event(k) = e.kind {
                assert_eq!(sk.data.events[k.event].name, "footstep");
                steps += 1;
            }
        }
    }
    // 100 frames ≈ 1.67 s ≈ 2 cycles → 4 footsteps (+1 at t=0 boundary tolerance).
    assert!((4..=5).contains(&steps), "steps {steps}");

    st.set_animation(0, "jump", false).unwrap();
    st.add_animation(0, "idle", true, 0.0).unwrap();
    let tail = sk.data.find_slot("tail").unwrap();
    let mut saw_front = false;
    let mut landed = false;
    for _ in 0..90 {
        step(&mut sk, &mut st, 1.0 / 60.0);
        saw_front |= *sk.draw_order.last().unwrap() == tail;
        landed |= st.drain_events().iter().any(|e| matches!(&e.kind, StateEventKind::Event(k) if sk.data.events[k.event].name == "land"));
    }
    assert!(saw_front, "tail never drawn in front");
    assert!(landed, "land event missing");
    let cur = st.current(0).unwrap();
    assert_eq!(sk.data.animations[cur.animation].name, "idle");
}

#[test]
fn weighted_deform_moves_tail() {
    let (mut sk, mut st) = setup();
    let tail = sk.data.find_slot("tail").unwrap();
    let mut out = RenderBuffers::default();
    sk.update_world();
    sk.render(&mut out);
    let rest: Vec<u32> = out.vertices.clone();
    st.set_animation(0, "hit", false).unwrap();
    step(&mut sk, &mut st, 0.1);
    assert!(!sk.slots[tail].deform.is_empty());
    sk.render(&mut out);
    // Tail vertices are the 20 vertices after the first 6 quads (tail is slot 6).
    let moved = (0..20).any(|i| {
        let o = (6 * 4 + i) * 6;
        let a = Vec2::new(f32::from_bits(rest[o]), f32::from_bits(rest[o + 1]));
        let b = Vec2::new(f32::from_bits(out.vertices[o]), f32::from_bits(out.vertices[o + 1]));
        a.sub(b).len() > 3.0
    });
    assert!(moved);
}
