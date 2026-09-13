#!/bin/sh
# 文件作用：Xiaoyu Linux/macOS 独立一键安装/升级 bootstrap，可通过 curl | sh 运行。
# 关联模块：GitHub Releases、scripts/release、portable xiaoyu bundle。
# 当前实现：检测 OS/CPU、下载预构建 tar.gz 与 checksums、SHA-256 校验、每用户原子安装并创建 ~/.local/bin 命令。
# 职责边界：普通用户安装不得 clone 源码或要求 pnpm/cargo；macOS/Linux 发行资产必须分别在对应系统构建。
set -eu

BASE_URL="${XIAOYU_RELEASE_BASE:-https://github.com/yubboo/xma/releases/latest/download}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
INSTALL_ROOT="${XIAOYU_INSTALL_DIR:-$DATA_HOME/xiaoyu}"

os_raw="$(uname -s)"
case "$os_raw" in
  Linux) os='linux' ;;
  Darwin) os='macos' ;;
  *) echo "Xiaoyu 暂不支持此系统：$os_raw" >&2; exit 2 ;;
esac

arch_raw="$(uname -m)"
case "$arch_raw" in
  x86_64|amd64) arch='x64' ;;
  arm64|aarch64) arch='arm64' ;;
  *) echo "Xiaoyu 暂不支持此 CPU 架构：$arch_raw" >&2; exit 2 ;;
esac

artifact="xiaoyu-$os-$arch.tar.gz"
tmp="${TMPDIR:-/tmp}/xiaoyu-install-$$"
archive="$tmp/$artifact"
expanded="$tmp/expanded"
backup="$INSTALL_ROOT.old-$$"
mkdir -p "$tmp" "$expanded" "$BIN_HOME" "$(dirname "$INSTALL_ROOT")"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

echo ''
echo '  XIAOYU · Xiaoyu Management Agent'
echo '  Model is replaceable. Agent is ours.'
echo ''
echo "[检查] $os / $arch"
echo '[下载] 正在下载 Xiaoyu 预构建发行包...'
curl -fL --retry 3 --connect-timeout 15 "$BASE_URL/$artifact" -o "$archive"
curl -fsSL --retry 3 --connect-timeout 15 "$BASE_URL/checksums.txt" -o "$tmp/checksums.txt"
expected="$(awk -v file="$artifact" '$2 == file { print $1 }' "$tmp/checksums.txt" | head -n 1)"
[ -n "$expected" ] || { echo 'checksums.txt 中找不到当前资产。' >&2; exit 3; }

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$archive" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
else
  echo '系统缺少 sha256sum/shasum，无法安全校验 Xiaoyu 安装包。' >&2
  exit 3
fi
[ "$actual" = "$expected" ] || { echo "SHA-256 校验失败：$artifact" >&2; exit 3; }
echo '[通过] SHA-256 校验通过。'

tar -xzf "$archive" -C "$expanded"
for required in VERSION bin/xiaoyu runtime/node app/cli.js native/xma-native-runtime; do
  [ -e "$expanded/$required" ] || { echo "安装包缺少文件：$required" >&2; exit 4; }
done

rm -rf "$backup"
if [ -e "$INSTALL_ROOT" ]; then mv "$INSTALL_ROOT" "$backup"; fi
if ! mv "$expanded" "$INSTALL_ROOT"; then
  rm -rf "$INSTALL_ROOT"
  if [ -e "$backup" ]; then mv "$backup" "$INSTALL_ROOT"; fi
  exit 5
fi
rm -rf "$backup"
ln -sfn "$INSTALL_ROOT/bin/xiaoyu" "$BIN_HOME/xiaoyu"
ln -sfn "$INSTALL_ROOT/bin/xma" "$BIN_HOME/xma"

version="$(cat "$INSTALL_ROOT/VERSION")"
echo ''
echo "[完成] Xiaoyu $version 已安装：$INSTALL_ROOT"
case ":$PATH:" in
  *":$BIN_HOME:"*) echo '[下一步] 在任意项目目录运行：xiaoyu' ;;
  *)
    echo "[提示] $BIN_HOME 尚未在 PATH。将下面一行加入你的 shell profile 后重新打开终端："
    echo "  export PATH=\"$BIN_HOME:\$PATH\""
    ;;
esac
echo ''
