#!/usr/bin/env bash
# Builds the RABBIT Godot extension for this platform and copies it into the
# example project (godot/example/bin). Run on each target OS.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
cargo build --release -p sinew-godot
mkdir -p godot/example/bin
for f in target/release/libsinew_godot.so target/release/libsinew_godot.dylib target/release/sinew_godot.dll; do
  [ -f "$f" ] && cp "$f" godot/example/bin/ && echo "copied $f"
done
