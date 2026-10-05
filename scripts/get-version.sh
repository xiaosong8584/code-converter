#!/usr/bin/env sh
# scripts/get-version.sh — 提取 Code Converter 版本号
#
# manifest.json 是版本唯一事实源（Obsidian 插件标准）。本脚本以它为默认。
#
# 用法：
#   ./scripts/get-version.sh                  从 manifest.json 读版本号（默认）
#   ./scripts/get-version.sh <file.json>      从指定 JSON 文件的 "version" 字段读
#   ./scripts/get-version.sh --all            打印所有文件的版本对比
#   ./scripts/get-version.sh --check          校验 package.json / manifest.json / versions.json 版本一致
#   ./scripts/get-version.sh --min-app        打印最低 Obsidian 版本（minAppVersion）
#
# 兼容 Windows git-bash（自动转换路径给 node）。
#
# 退出码：
#   0   成功
#   1   版本不一致（仅 --check 模式）
#   2   文件不存在或 JSON 解析失败

set -eu

# 定位仓库根（脚本所在目录的上一级）
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname "$HERE")

# 转 Windows 路径（git-bash 上 $ROOT 是 /c/...，node 需要 C:/...）
win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    echo "$1"
  fi
}

# 用 node 读 JSON 字段（避免 shell 解析 JSON 的坑）
# 参数：文件（相对 ROOT 的路径），字段路径（用 . 分隔，只支持一层）
read_json_field() {
  if [ ! -f "$ROOT/$1" ]; then
    echo "ERROR: $1 not found" >&2
    return 2
  fi

  _gv_path=$(win_path "$ROOT/$1")
  _gv_field="$2"
  export _gv_path _gv_field

  node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(process.env._gv_path,'utf8'));
      let v = process.env._gv_field.split('.').reduce((o,k) => o ? o[k] : undefined, j);
      if (v === undefined || v === null) { process.exit(2); }
      console.log(v);
    } catch (e) { process.exit(2); }
  " 2>/dev/null || {
    echo "ERROR: cannot read '$2' from $1 (missing or invalid JSON)" >&2
    return 2
  }
}

# 读 versions.json 中某个 key 对应的值
read_versions_entry() {
  if [ ! -f "$ROOT/versions.json" ]; then
    echo "MISSING_FILE"
    return 0
  fi

  _gv_path=$(win_path "$ROOT/versions.json")
  _gv_key="$1"
  export _gv_path _gv_key

  node -e "
    try {
      const j = JSON.parse(require('fs').readFileSync(process.env._gv_path,'utf8'));
      const v = j[process.env._gv_key];
      console.log(v !== undefined ? v : 'MISSING');
    } catch (e) { console.log('PARSE_FAIL'); }
  " 2>/dev/null
}

do_check() {
  _m=$(read_json_field manifest.json version)
  _p=$(read_json_field package.json version)
  _v=$(read_versions_entry "$_m")

  echo "manifest.json  : $_m"
  echo "package.json   : $_p"
  echo "versions.json  : $_v  (key: \"$_m\")"

  if [ "$_m" != "$_p" ]; then
    echo "ERROR: manifest.json.version ($_m) != package.json.version ($_p)" >&2
    return 1
  fi
  if [ "$_v" = "MISSING" ]; then
    echo "ERROR: versions.json missing entry for \"$_m\"" >&2
    return 1
  fi
  if [ "$_v" = "PARSE_FAIL" ]; then
    echo "ERROR: versions.json not valid JSON" >&2
    return 2
  fi
  echo ""
  echo "OK: all versions consistent at $_m"
  return 0
}

do_all() {
  do_check || return $?
  echo "minAppVersion  : $(read_json_field manifest.json minAppVersion)"
}

# --- 主入口 ---
case "${1:-}" in
  --check)
    do_check
    ;;
  --all)
    do_all
    ;;
  --min-app)
    read_json_field manifest.json minAppVersion
    ;;
  "")
    read_json_field manifest.json version
    ;;
  --help|-h)
    sed -n '2,18p' "$0"
    ;;
  *)
    read_json_field "$1" version
    ;;
esac
