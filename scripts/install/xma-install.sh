#!/bin/sh
# 文件作用：Xiaoyu Linux/macOS 独立一键安装/升级/卸载器；正式 Release 资产名固定为 xma-install.sh。
# 关联模块：GitHub Releases、scripts/release、portable xiaoyu bundle。
# 当前实现：检测 OS/CPU、下载预构建 tar.gz 与 checksums、SHA-256 校验、每用户原子安装、创建 ~/.local/bin 命令并安全卸载。
# 职责边界：普通用户安装不得 clone 源码或要求 pnpm/cargo；macOS/Linux 发行资产必须分别在对应系统构建。
set -eu

BASE_URL="${XIAOYU_RELEASE_BASE:-https://github.com/yubboo/xma/releases/latest/download}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
INSTALL_ROOT="${XIAOYU_INSTALL_DIR:-$DATA_HOME/xiaoyu}"

assert_safe_paths() {
  case "$INSTALL_ROOT" in
    /*) ;;
    *) echo "Xiaoyu 安装目录必须是绝对路径：$INSTALL_ROOT" >&2; exit 2 ;;
  esac
  case "$BIN_HOME" in
    /*) ;;
    *) echo "Xiaoyu 命令目录必须是绝对路径：$BIN_HOME" >&2; exit 2 ;;
  esac
  case "$INSTALL_ROOT" in
    /|"$HOME"|"$DATA_HOME"|"$BIN_HOME")
      echo "拒绝使用高风险 Xiaoyu 安装目录：$INSTALL_ROOT" >&2
      exit 2
      ;;
  esac
}

assert_release_transport() {
  case "$BASE_URL" in
    https://*) ;;
    http://127.0.0.1:*|http://localhost:*)
      [ "${XIAOYU_ALLOW_INSECURE_TEST_BASE:-}" = '1' ] || {
        echo 'Xiaoyu Release 下载必须使用 HTTPS。' >&2
        exit 3
      }
      ;;
    *)
      echo 'Xiaoyu Release 下载必须使用 HTTPS。' >&2
      exit 3
      ;;
  esac
}

assert_safe_paths

usage() {
  cat <<'USAGE'
用法：
  xma-install.sh                 安装或升级 Xiaoyu
  xma-install.sh --uninstall     卸载 Xiaoyu 程序与命令入口
  xma-install.sh --help          查看帮助

卸载只删除当前安装目录与由安装器创建的 xiaoyu/xma 命令入口；用户配置、凭据和 Session 数据不会被删除。
USAGE
}

managed_link_target() {
  command_name="$1"
  printf '%s/bin/%s' "$INSTALL_ROOT" "$command_name"
}

remove_managed_link() {
  command_name="$1"
  command_path="$BIN_HOME/$command_name"
  expected_target="$(managed_link_target "$command_name")"
  if [ -L "$command_path" ]; then
    current_target="$(readlink "$command_path" 2>/dev/null || true)"
    if [ "$current_target" = "$expected_target" ]; then
      rm -f "$command_path"
    else
      echo "[保留] $command_path 不是当前 Xiaoyu 安装器管理的链接。"
    fi
  elif [ -e "$command_path" ]; then
    echo "[保留] $command_path 是已有文件/目录，不属于 Xiaoyu 安装器。"
  fi
}

uninstall_xiaoyu() {
  remove_managed_link xiaoyu
  remove_managed_link xma
  if [ -e "$INSTALL_ROOT" ]; then rm -rf "$INSTALL_ROOT"; fi
  echo ''
  echo '[完成] Xiaoyu 已从当前用户卸载。'
  echo '[保留] 用户配置、凭据与 Session 数据未删除。'
  echo ''
}

assert_command_slot() {
  command_name="$1"
  command_path="$BIN_HOME/$command_name"
  expected_target="$(managed_link_target "$command_name")"
  if [ -L "$command_path" ]; then
    current_target="$(readlink "$command_path" 2>/dev/null || true)"
    [ "$current_target" = "$expected_target" ] || {
      echo "命令入口已被其他程序占用：$command_path -> $current_target" >&2
      exit 6
    }
  elif [ -e "$command_path" ]; then
    echo "命令入口已被已有文件/目录占用：$command_path" >&2
    exit 6
  fi
}

case "${1:-}" in
  '') assert_release_transport ;;
  --uninstall|-u)
    [ "$#" -eq 1 ] || { usage >&2; exit 2; }
    uninstall_xiaoyu
    exit 0
    ;;
  --help|-h)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

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
assert_command_slot xiaoyu
assert_command_slot xma
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
for required in VERSION bin/xiaoyu bin/xma runtime/node app/xiaoyu native/xma-native-runtime; do
  [ -e "$expanded/$required" ] || { echo "安装包缺少文件：$required" >&2; exit 4; }
done

rm -rf "$backup"
if [ -e "$INSTALL_ROOT" ]; then mv "$INSTALL_ROOT" "$backup"; fi
if ! mv "$expanded" "$INSTALL_ROOT"; then
  rm -rf "$INSTALL_ROOT"
  if [ -e "$backup" ]; then mv "$backup" "$INSTALL_ROOT"; fi
  exit 5
fi

if ! ln -sfn "$INSTALL_ROOT/bin/xiaoyu" "$BIN_HOME/xiaoyu" || ! ln -sfn "$INSTALL_ROOT/bin/xma" "$BIN_HOME/xma"; then
  rm -f "$BIN_HOME/xiaoyu" "$BIN_HOME/xma"
  rm -rf "$INSTALL_ROOT"
  if [ -e "$backup" ]; then mv "$backup" "$INSTALL_ROOT"; fi
  echo 'Xiaoyu 命令入口创建失败，已回滚程序目录。' >&2
  exit 6
fi
rm -rf "$backup"

version="$(cat "$INSTALL_ROOT/VERSION")"
echo ''
echo "[完成] Xiaoyu $version 已安装：$INSTALL_ROOT"
case ":$PATH:" in
  *":$BIN_HOME:"*) echo '[下一步] 在任意项目目录运行：xiaoyu（兼容短别名：xma）' ;;
  *)
    echo "[提示] $BIN_HOME 尚未在 PATH。将下面一行加入你的 shell profile 后重新打开终端："
    echo "  export PATH=\"$BIN_HOME:\$PATH\""
    ;;
esac
echo ''
