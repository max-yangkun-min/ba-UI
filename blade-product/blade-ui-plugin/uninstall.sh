#!/usr/bin/env sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/common.sh"

TARGETS="ba,bh"
RESTORE_BACKUP=0

usage() {
  cat <<EOF
Uninstall blade-ui-plugin $VERSION

Removes only this plugin's stylesheet, script, fonts, and index.html markers.
The iframe plugin (blade-ui-slim.js / iframe-auth-bridge.js) is left in place.

Usage:
  sh uninstall.sh [--ba-only|--bh-only] [--restore-backup]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ba-only) TARGETS="ba" ;;
    --bh-only) TARGETS="bh" ;;
    --ba) BA_CONTAINER=$2; shift ;;
    --bh) BH_CONTAINER=$2; shift ;;
    --restore-backup) RESTORE_BACKUP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown argument: $1"; usage; exit 2 ;;
  esac
  shift
done

need_cmd docker
need_cmd awk
ensure_state

uninstall_one() {
  role=$1
  container=$2
  if ! container_running "$container"; then
    err "$role container is not running: $container"
    return 1
  fi
  dist=$(find_dist "$container") || {
    err "frontend dist/index.html not found in $container"
    return 1
  }
  work="$STATE_DIR/work/$role"
  mkdir -p "$work"
  if [ "$RESTORE_BACKUP" -eq 1 ] && [ -f "$BACKUP_DIR/$role/index.html" ]; then
    docker cp "$BACKUP_DIR/$role/index.html" "$container:$dist/index.html"
    log "restored original $role/index.html"
  else
    docker cp "$container:$dist/index.html" "$work/index.html"
    awk -f "$PLUGIN_ROOT/scripts/strip-index.awk" "$work/index.html" > "$work/index.plain.html"
    docker cp "$work/index.plain.html" "$container:$dist/index.html"
    log "stripped blade-ui-plugin tags from $role"
  fi
  docker exec "$container" rm -f \
    "$dist/blade-ui-theme.css" \
    "$dist/blade-ui-theme.js" \
    "$dist/blade-ui-fonts/AlimamaShuHeiTi.ttf" \
    "$dist/blade-ui-fonts/DINAlternate-Bold.ttf" || true
  log "uninstalled $role  $container:$dist"
}

failed=0
case ",$TARGETS," in
  *,ba,*) uninstall_one ba "$BA_CONTAINER" || failed=1 ;;
esac
case ",$TARGETS," in
  *,bh,*) uninstall_one bh "$BH_CONTAINER" || failed=1 ;;
esac

if [ "$failed" -ne 0 ]; then
  exit 1
fi
