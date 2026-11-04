//! Compatibility scan over a directory of Spine exports (see
//! tools/fetch-spine-examples.mjs): import, bind atlas, play every animation,
//! check output sanity.
//!
//!   cargo run --release -p sinew-core --example compat -- web/public/examples/4.2

use std::sync::Arc;

use sinew_core::import::load_spine_json;
use sinew_core::{AnimationState, Atlas, RenderBuffers, Skeleton};

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| "web/public/examples/4.2".into());
    let index: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/index.json")).expect("index.json")).unwrap();
    let mut failures = 0;
    for e in index.as_array().unwrap() {
        let name = e["name"].as_str().unwrap();
        let base = format!("{dir}/{name}");
        let json = std::fs::read_to_string(format!("{base}/{}", e["skeleton"].as_str().unwrap())).unwrap();
        let atlas = Atlas::parse(&std::fs::read_to_string(format!("{base}/{}", e["atlas"].as_str().unwrap())).unwrap()).unwrap();
        let mut data = match load_spine_json(&json) {
            Ok(d) => d,
            Err(err) => {
                failures += 1;
                println!("✗ {name}: LOAD ERROR {err}");
                continue;
            }
        };
        let missing = data.bind_atlas(&atlas);
        let data = Arc::new(data);
        let mut bad = Vec::new();
        let mut verts = 0;
        for (ai, anim) in data.animations.iter().enumerate() {
            for skin in std::iter::once(None).chain((0..data.skins.len()).map(Some)) {
                let mut sk = Skeleton::new(data.clone());
                if let Some(s) = skin {
                    sk.set_skin(Some(&data.skins[s].name));
                }
                let mut st = AnimationState::new(data.clone());
                st.set_animation_index(0, ai, true);
                let mut out = RenderBuffers::default();
                let steps = ((anim.duration.max(0.5) * 30.0) as usize).min(300);
                for _ in 0..steps {
                    st.update(1.0 / 30.0);
                    st.apply(&mut sk);
                    sk.update_world_with_physics(1.0 / 30.0);
                    sk.render(&mut out);
                    let nan = out.vertices.chunks_exact(6).any(|v| (0..4).any(|i| !f32::from_bits(v[i]).is_finite()));
                    if nan {
                        bad.push(format!("NaN in '{}'", anim.name));
                        break;
                    }
                }
                verts = verts.max(out.vertex_count());
            }
        }
        bad.dedup();
        let ok = bad.is_empty() && missing.is_empty();
        if !ok {
            failures += 1;
        }
        println!(
            "{} {name}: {} bones, {} slots, {} skins, {} anims, max {} verts{}{}",
            if ok { "✓" } else { "✗" },
            data.bones.len(),
            data.slots.len(),
            data.skins.len(),
            data.animations.len(),
            verts,
            if missing.is_empty() { String::new() } else { format!(", missing regions {:?}", &missing[..missing.len().min(5)]) },
            if bad.is_empty() { String::new() } else { format!(", {}", bad.join("; ")) },
        );
        for w in &data.warnings {
            println!("    · {w}");
        }
    }
    println!("{failures} failing");
}
