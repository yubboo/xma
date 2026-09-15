#!/bin/sh
# 文件作用：XMA Linux/macOS 源码开发控制台，对应根 `xma-dev`。
# 关联模块：package.json、pnpm-workspace.yaml、Cargo.toml、apps/cli、apps/web、apps/desktop。
# 当前实现：Bun/OpenTUI/Solid 统一由 pnpm Workspace 管理并存放在 node_modules；prepare 通过唯一 Runtime updater 刷新 registry latest 并事务式同步 lockfile/node_modules，运行/检查阶段只复用现有依赖，不偷偷联网更新；Rust/Cargo 继续作为 Native Toolchain 独立准备。
# 职责边界：只服务源码开发；普通用户应使用 xma-install.sh 安装预构建产品，再运行 `xiaoyu` / `xma`。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$ROOT"
RUNTIME_ROOT="$ROOT/apps/cli/opentui-runtime"

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

package_version() {
  file="$1"
  [ -f "$file" ] || return 1
  node -e "const p=require(process.argv[1]); process.stdout.write(String(p.version||''))" "$file"
}

resolve_workspace_bun() {
  package_json="$ROOT/node_modules/bun/package.json"
  bun_bin="$ROOT/node_modules/.bin/bun"
  [ -f "$package_json" ] || return 1
  [ -x "$bun_bin" ] || return 1
  expected="$(package_version "$package_json")"
  [ -n "$expected" ] || return 1
  actual="$($bun_bin --version 2>/dev/null || true)"
  [ "$actual" = "$expected" ] || return 1
  printf '%s\n' "$bun_bin"
}

assert_workspace_js_runtime() {
  assert_core_dependencies
  bun="$(resolve_workspace_bun 2>/dev/null || true)"
  [ -n "$bun" ] || { printf '%s\n' '[ERROR] Workspace Bun Runtime is not ready. Run ./xma-dev prepare.' >&2; exit 1; }
  for package in \
    "$RUNTIME_ROOT/node_modules/@opentui/core/package.json" \
    "$RUNTIME_ROOT/node_modules/@opentui/solid/package.json" \
    "$RUNTIME_ROOT/node_modules/solid-js/package.json" \
    "$RUNTIME_ROOT/node_modules/@types/bun/package.json"; do
    [ -f "$package" ] || { printf '[ERROR] Missing Workspace runtime package: %s\n' "$package" >&2; exit 1; }
  done
}

install_workspace_js_dependencies() {
  printf '%s\n' '[安装] Installing current XMA Workspace JavaScript dependencies once...'
  pnpm install --no-frozen-lockfile --prefer-offline --reporter=append-only
  assert_workspace_js_runtime
  bun_version="$(package_version "$ROOT/node_modules/bun/package.json")"
  opentui_version="$(package_version "$RUNTIME_ROOT/node_modules/@opentui/core/package.json")"
  solid_version="$(package_version "$RUNTIME_ROOT/node_modules/solid-js/package.json")"
  printf '[通过] Workspace JS Runtime · Bun %s · OpenTUI %s · Solid %s\n' "$bun_version" "$opentui_version" "$solid_version"
}

refresh_workspace_js_runtime() {
  printf '%s\n' '[更新] Refreshing only managed Bun / OpenTUI / Solid latest versions...'
  node scripts/runtime/update.mjs
  assert_workspace_js_runtime
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
  printf '%s\n' '[1/5] Node.js 22+'
  require_command node
  major="$(node -p "Number(process.versions.node.split('.')[0])")"
  [ "$major" -ge 22 ] || { printf '[ERROR] Node.js 22+ required; current: %s\n' "$(node --version)" >&2; exit 1; }
  printf '[通过] %s\n' "$(node --version)"

  printf '%s\n' '[2/5] pnpm 11.17.0'
  ensure_pnpm
  printf '[通过] pnpm %s\n' "$(pnpm --version)"

  printf '%s\n' '[3/5] Workspace JavaScript Runtime · Bun / OpenTUI / Toolchain'
  install_workspace_js_dependencies

  printf '%s\n' '[4/5] Rust / Cargo'
  ensure_rust
  assert_linker
  printf '[通过] %s\n' "$(rustc --version)"
  printf '[通过] %s\n' "$(cargo --version)"

  printf '%s\n' '[5/5] XMA Native Rust crates'
  cargo fetch --locked
  printf '%s\n' '[完成] XMA source-development environment is ready.'
}

assert_core_dependencies() {
  require_command node
  require_command pnpm
  [ -x "$ROOT/node_modules/.bin/tsx" ] || { printf '%s\n' '[ERROR] Workspace dependencies are not ready. Run ./xma-dev prepare.' >&2; exit 1; }
}

start_web() {
  assert_core_dependencies
  pnpm run dev:web
}

start_cli() {
  assert_workspace_js_runtime
  require_command cargo
  target="$ROOT/.cache/cargo-target"
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
  assert_workspace_js_runtime
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
