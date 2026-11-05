#!/usr/bin/env bash
# Builds the native core into the Unity package's Plugins folder for the
# targets this machine can produce (Linux; Windows via mingw-w64 when
# installed). CI (.github/workflows/unity.yml) builds every platform.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
plugins="$root/unity/com.rabbit.runtime/Plugins"
cd "$root"
case "$(uname -s)" in
  Linux)
    cargo build --release -p sinew-ffi
    install -D target/release/libsinew_ffi.so "$plugins/Linux/x86_64/libsinew_ffi.so"
    if command -v x86_64-w64-mingw32-gcc >/dev/null; then
      rustup target add x86_64-pc-windows-gnu >/dev/null
      CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc cargo build --release -p sinew-ffi --target x86_64-pc-windows-gnu
      install -D target/x86_64-pc-windows-gnu/release/sinew_ffi.dll "$plugins/Windows/x86_64/sinew_ffi.dll"
    fi
    ;;
  Darwin)
    rustup target add x86_64-apple-darwin aarch64-apple-darwin aarch64-apple-ios >/dev/null
    cargo build --release -p sinew-ffi --target x86_64-apple-darwin
    cargo build --release -p sinew-ffi --target aarch64-apple-darwin
    mkdir -p "$plugins/macOS" "$plugins/iOS"
    lipo -create target/x86_64-apple-darwin/release/libsinew_ffi.dylib target/aarch64-apple-darwin/release/libsinew_ffi.dylib -output "$plugins/macOS/libsinew_ffi.dylib"
    cargo build --release -p sinew-ffi --target aarch64-apple-ios
    cp target/aarch64-apple-ios/release/libsinew_ffi.a "$plugins/iOS/libsinew_ffi.a"
    ;;
esac
python3 "$root/tools/unity-metas.py"
find "$plugins" -type f ! -name '*.meta' -exec ls -la {} \;
