# Shared helpers for blade-ui-plugin.
# shellcheck shell=sh

_THIS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$_THIS_DIR/plugin.json" ]; then
  PLUGIN_ROOT=$_THIS_DIR
elif [ -f "$_THIS_DIR/../plugin.json" ]; then
  PLUGIN_ROOT=$(CDPATH= cd -- "$_THIS_DIR/.." && pwd)
else
  printf 'ERROR: plugin.json not found. Run scripts from the plugin directory.\n' >&2
  exit 1
fi

VERSION=$(tr -d " \t\r\n" < "$PLUGIN_ROOT/VERSION")
if [ -n "${BLADE_UI_STATE_DIR:-}" ]; then
  STATE_DIR=$BLADE_UI_STATE_DIR
elif mkdir -p /var/lib/blade-ui-plugin 2>/dev/null; then
  STATE_DIR=/var/lib/blade-ui-plugin
else
  STATE_DIR="$PLUGIN_ROOT/state"
fi
BACKUP_DIR="$STATE_DIR/backups"
BA_CONTAINER="${BA_CONTAINER:-box-ba}"
BH_CONTAINER="${BH_CONTAINER:-box-bh}"

log() { printf '%s\n' "$*"; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing command: $1"
    exit 1
  fi
}

container_running() {
  docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | grep -qx true
}

find_dist() {
  container=$1
  for path in /app/web/apps/web/dist /app/web/dist /usr/share/nginx/html; do
    if docker exec "$container" test -f "$path/index.html" 2>/dev/null; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  return 1
}

ensure_state() {
  mkdir -p "$BACKUP_DIR/ba" "$BACKUP_DIR/bh" "$STATE_DIR/work"
}
