# RABBIT for Godot 4.4+

GDExtension (Rust, `crates/sinew-godot`) running the RABBIT core: Spine 4.2 JSON skeletons exported by RABBIT Studio (or Spine), with animation mixing, IK / transform / path / physics constraints, meshes and clipping.

## Build

```bash
./tools/build-godot.sh        # cargo build --release -p sinew-godot → godot/example/bin/
```

Run it on each OS you ship (Linux `.so`, Windows `.dll`, macOS `.dylib`). Copy `rabbit.gdextension` and `bin/` into your project.

## Use

Add a `RabbitSkeleton2D` node, set `skeleton_file` (`.json`) and `atlas_file` (`.atlas`, pages next to it) and an `animation`.

| Method | |
|---|---|
| `play(track, name, loop) -> bool` | play now, crossfading (`default_mix` seconds) |
| `add_animation(track, name, loop, delay) -> bool` | queue after the current one (`delay <= 0`: when it completes) |
| `set_empty_animation(track, mix)` | fade a track out |
| `set_mix(from, to, seconds)` · `set_skin_name(name)` · `reset_physics()` | |
| `get_animation_names()` · `get_skin_names()` · `get_current_animation(track)` · `get_bone_position(bone)` | |

Signal: `animation_event(name, int_value, float_value, string_value)`.

Godot's y axis points down; skeleton y-up coordinates are flipped by the node. PMA atlases switch the node's material to premultiplied blending.

## Example and test

`godot/example` plays a character exported from RABBIT Studio (keys 1/2/3, space, H, A).

```bash
godot --headless --path godot/example --import
godot --headless --path godot/example --script res://test.gd   # prints RABBIT_TEST PASS
```

Known gaps: slot blend modes other than normal, two-color tint (dark color).
