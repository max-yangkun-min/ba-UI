#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VERSION=$(tr -d " \t\r\n" < "$ROOT/VERSION")
OUT=${1:-"$ROOT/../blade-iframe-plugin-$VERSION.zip"}
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing command: $1" >&2; exit 1; }; }
need zip
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/blade-iframe-plugin"
tar -C "$ROOT" --exclude=state --exclude='*.zip' --exclude='_rewrite_zh.py' --exclude='_rewrite_zh2.py' -cf - . | tar -C "$tmp/blade-iframe-plugin" -xf -
mkdir -p "$(dirname -- "$OUT")"
rm -f "$OUT"
( cd "$tmp" && zip -qr "$OUT" blade-iframe-plugin )
echo "packed $OUT"
