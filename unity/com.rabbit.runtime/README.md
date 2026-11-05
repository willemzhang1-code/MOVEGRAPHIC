# RABBIT Runtime for Unity

Plays skeletons exported by RABBIT Studio and Spine 4.2 JSON exports (meshes,
weights, IK, transform / path / physics constraints, clipping, sequences,
two-color tint) with the native RABBIT core — the same code as the web and
Godot runtimes.

Unity 2021.3+. Built-in render pipeline and URP (unlit shader).

## Install

- **Package tarball**: download `com.rabbit.runtime-<version>.tgz` from the
  repository's Actions artifacts / Releases, then *Package Manager → + → Add
  package from tarball*. It contains native libraries for Windows x64, macOS
  (Intel + Apple silicon), Linux x64, Android (arm64-v8a, armeabi-v7a, x86_64)
  and iOS.
- **From source**: run `tools/build-unity-plugins.sh` (builds the natives your
  machine can produce into `Plugins/`), then *Add package from disk* →
  `unity/com.rabbit.runtime/package.json`.

## Use

1. Drop the export folder (`character.json`, `character.atlas`,
   `character.png`) into `Assets/`. A `character_Skeleton` asset is created
   next to it (or *Create → RABBIT → Skeleton Asset* and assign the files).
2. Select that asset and choose *GameObject → RABBIT → Skeleton*.
3. Pick the animation / skin on the **RabbitSkeleton** component. It previews
   in edit mode.

```csharp
var sk = GetComponent<Rabbit.RabbitSkeleton>();
sk.Play("walk");                 // crossfades (asset's default mix)
sk.Queue("jump", loop: false);   // after the current one
sk.Instance.SetMix("walk", "run", 0.1f);
sk.AnimationEvent += (s, e) => { if (e.Kind == Rabbit.RabbitEventKind.Event) Debug.Log(e.Name); };
Vector3? hand = sk.BonePosition("hand");
```

`RabbitBoneFollower` keeps a transform on a bone (weapons, effects).

Scale: the asset's `scale` (default 0.01) maps skeleton pixels to Unity units.
Teleporting a character with physics: call `sk.Instance.ResetPhysics()`.

## Layout

- `Runtime/Core` — engine-independent C# API over the C ABI (`RabbitSkeletonData`,
  `RabbitInstance`, render buffers). Tested with plain .NET in
  `unity/tests/CoreTests`.
- `Runtime` — `RabbitSkeleton` (MeshRenderer, one submesh per atlas page /
  blend mode), `RabbitSkeletonAsset`, `RabbitBoneFollower`, `RABBIT/Skeleton`
  shader (premultiplied, two-color tint).
- `Editor` — `.atlas` importer, automatic skeleton asset creation, menu item.
