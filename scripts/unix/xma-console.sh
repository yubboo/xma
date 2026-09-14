#!/bin/sh
# 文件作用：XMA Linux/macOS 源码开发控制台，对应根 `xma-dev`。
# 关联模块：package.json、Cargo.toml、apps/cli、apps/web、apps/desktop。
# 职责边界：只服务源码开发；普通用户应使用 xma-install.sh 安装预构建产品，再运行 `xiaoyu` / `xma`。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"

BUN_VERSION="1.3.14"
OPENTUI_VERSION="0.1.101"

say_header() {
  version="$(node -p "require('./package.json').version" 2>/dev/null || printf '0.1.0')"
  printf '%s\n' '===================================================================='
  printf '  XMA %s · Xiaoyu Management Agent · Development Console\n' "$version"
  printf '%s\n' '  TypeScript Agent Platform + Rust Native/Security Kernel'
  printf '%s\n' '===================================================================='
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf '[ERROR] Missing required command: %s\n' "$1" >&2
    return 1
  }
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version 2>/dev/null || true)" = '11.17.0' ]; then
    return 0
  fi
  require_command npm
  printf '%s\n' '[安装] Installing pnpm 11.17.0...'
  npm install --global pnpm@11.17.0
}

ensure_bun() {
  target="$ROOT/.xma/tools/bun/$BUN_VERSION/bun"
  if [ -x "$target" ] && [ "$($target --version 2>/dev/null || true)" = "$BUN_VERSION" ]; then
    printf '[通过] Bun %s · Xiaoyu OpenTUI Runtime\n' "$BUN_VERSION"
    return 0
  fi
  require_command curl
  require_command unzip
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os:$arch" in
    Linux:x86_64) asset='bun-linux-x64' ;;
    Linux:aarch64|Linux:arm64) asset='bun-linux-aarch64' ;;
    Darwin:x86_64) asset='bun-darwin-x64' ;;
    Darwin:arm64) asset='bun-darwin-aarch64' ;;
    *) printf '[ERROR] Unsupported Bun platform: %s/%s\n' "$os" "$arch" >&2; return 1 ;;
  esac
  cache="$ROOT/.cache/bun"
  zip="$cache/$asset-$BUN_VERSION.zip"
  extract="$cache/extract-$BUN_VERSION-$asset"
  mkdir -p "$cache" "$ROOT/.xma/tools/bun/$BUN_VERSION"
  rm -rf "$extract"
  mkdir -p "$extract"
  printf '[下载] Bun %s · %s\n' "$BUN_VERSION" "$asset"
  curl -fL "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/$asset.zip" -o "$zip"
  unzip -q -o "$zip" -d "$extract"
  downloaded="$(find "$extract" -type f -name bun -perm -u+x | head -n 1)"
  [ -n "$downloaded" ] || { printf '%s\n' '[ERROR] bun executable not found in downloaded archive.' >&2; return 1; }
  cp "$downloaded" "$target"
  chmod +x "$target"
  [ "$($target --version)" = "$BUN_VERSION" ] || { printf '%s\n' '[ERROR] Bun version verification failed.' >&2; return 1; }
  printf '[通过] Bun %s · Xiaoyu OpenTUI Runtime\n' "$BUN_VERSION"
}

ensure_rust() {
  if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
    return 0
  fi
  require_command curl
  printf '%s\n' '[安装] Installing Rust stable with rustup...'
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  PATH="$HOME/.cargo/bin:$PATH"
  export PATH
  require_command cargo
  require_command rustc
}

assert_linker() {
  if command -v cc >/dev/null 2>&1 || command -v clang >/dev/null 2>&1; then
    return 0
  fi
  os="$(uname -s)"
  printf '%s\n' '[ERROR] Missing C/C++ linker required by Rust.' >&2
  case "$os" in
    Darwin) printf '%s\n' 'Run: xcode-select --install' >&2 ;;
    Linux) printf '%s\n' 'Install your distribution build toolchain, e.g. build-essential / gcc / clang.' >&2 ;;
  esac
  return 1
}

prepare_environment() {
  printf '%s\n' '[1/6] Node.js 22+'
  require_command node
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  [ "$major" -ge 22 ] || { printf '[ERROR] Node.js 22+ required; current: %s\n' "$(node --version)" >&2; exit 1; }
  printf '[通过] %s\n' "$(node --version)"

  printf '%s\n' '[2/6] pnpm 11.17.0'
  ensure_pnpm
  printf '[通过] pnpm %s\n' "$(pnpm --version)"

  printf '%s\n' '[3/6] Bun 1.3.14 / OpenTUI Runtime'
  ensure_bun

  printf '%s\n' '[4/6] Rust / Cargo'
  ensure_rust
  assert_linker
  printf '[通过] %s\n' "$(rustc --version)"
  printf '[通过] %s\n' "$(cargo --version)"

  printf '%s\n' '[5/6] Workspace JavaScript dependencies + OpenTUI frontend'
  pnpm install --ignore-scripts
  pnpm rebuild esbuild
  (cd "$ROOT/apps/cli/opentui-runtime" && "$ROOT/.xma/tools/bun/$BUN_VERSION/bun" install --no-save)

  printf '%s\n' '[6/6] XMA Native Rust crates'
  cargo fetch
  printf '%s\n' '[完成] XMA source-development environment is ready.'
}

assert_core_dependencies() {
  require_command node
  require_command pnpm
  [ -x "$ROOT/node_modules/.bin/tsx" ] || { printf '%s\n' '[ERROR] Workspace dependencies are not ready. Run ./xma-dev and choose [1].' >&2; exit 1; }
}

assert_cli_dependencies() {
  assert_core_dependencies
  bun="$ROOT/.xma/tools/bun/$BUN_VERSION/bun"
  [ -x "$bun" ] || { printf '%s\n' '[ERROR] Bun/OpenTUI runtime is not ready. Run ./xma-dev and choose [1].' >&2; exit 1; }
  [ "$($bun --version)" = "$BUN_VERSION" ] || { printf '%s\n' '[ERROR] Bun version mismatch.' >&2; exit 1; }
  for package in "$ROOT/apps/cli/opentui-runtime/node_modules/@opentui/core/package.json" "$ROOT/apps/cli/opentui-runtime/node_modules/@opentui/solid/package.json"; do
    [ -f "$package" ] || { printf '[ERROR] Missing OpenTUI package: %s\n' "$package" >&2; exit 1; }
  done
}

start_web() {
  assert_core_dependencies
  pnpm run dev:web
}

start_cli() {
  assert_cli_dependencies
  require_command cargo
  target="$ROOT/.cache/cargo-target/cli"
  printf '%s\n' '[Native] Building current XMA Native Runtime (offline incremental build)...'
  CARGO_TARGET_DIR="$target" cargo build --package xma-native-runtime --offline
  native="$target/debug/xma-native-runtime"
  [ -x "$native" ] || { printf '[ERROR] Native runtime not found: %s\n' "$native" >&2; exit 1; }
  XIAOYU_NATIVE_RUNTIME="$native" pnpm run dev:cli
}

start_desktop() {
  assert_core_dependencies
  printf '%s\n' '[Desktop] Preparing Electron runtime for the current platform if needed...'
  pnpm exec tsx apps/desktop/scripts/electron/install-runtime.ts
  pnpm run dev:desktop:electron
}

full_check() {
  assert_core_dependencies
  require_command cargo
  pnpm run check
  printf '%s\n' '[check] Building and smoke-testing Bun/OpenTUI Xiaoyu CLI...'
  pnpm run build:cli
  pnpm run smoke:cli
  cargo fmt --all -- --check
  cargo check --workspace --offline
  cargo test --workspace --offline
}

run_command() {
  case "${1:-}" in
    prepare) prepare_environment ;;
    web) start_web ;;
    desktop) start_desktop ;;
    cli) start_cli ;;
    check) full_check ;;
    '') return 2 ;;
    *) printf '[ERROR] Unknown xma-dev command: %s\n' "$1" >&2; printf '%s\n' 'Usage: ./xma-dev [prepare|web|desktop|cli|check]' >&2; exit 2 ;;
  esac
}

if [ "$#" -gt 0 ]; then
  run_command "$1"
  exit 0
fi

while :; do
  say_header
  cat <<'MENU'
  [1] Prepare development environment
  [2] Development run · Web
  [3] Development run · Desktop (Electron)
  [4] Run · Xiaoyu CLI
  [7] Full check
  [0] Exit
MENU
  printf '\nChoose: '
  IFS= read -r choice
  case "$choice" in
    1) prepare_environment ;;
    2) start_web ;;
    3) start_desktop ;;
    4) start_cli ;;
    7) full_check ;;
    0) exit 0 ;;
    *) printf '%s\n' 'Invalid option.' ;;
  esac
  printf '\nPress Enter to return to menu...'
  IFS= read -r _
done
