#!/usr/bin/env sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/common.sh"

TARGETS="ba,bh"

usage() {
  cat <<EOF
blade-ui-plugin $VERSION

Inject the UI-spec stylesheet into running box-ba / box-bh.
Does not rebuild images and does not remove the iframe plugin.

Usage:
  sh install.sh [--ba-only|--bh-only] [--ba NAME] [--bh NAME]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ba-only) TARGETS="ba" ;;
    --bh-only) TARGETS="bh" ;;
    --ba) BA_CONTAINER=$2; shift ;;
    --bh) BH_CONTAINER=$2; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown argument: $1"; usage; exit 2 ;;
  esac
  shift
done

need_cmd docker
need_cmd awk
ensure_state

install_one() {
  role=$1
  container=$2
  css="$PLUGIN_ROOT/files/blade-ui-theme-$role.css"
  if [ ! -f "$css" ]; then
    err "missing stylesheet: $css"
    return 1
  fi
  if ! container_running "$container"; then
    err "$role container is not running: $container"
    return 1
  fi
  dist=$(find_dist "$container") || {
    err "frontend dist/index.html not found in $container"
    return 1
  }

  work="$STATE_DIR/work/$role"
  mkdir -p "$work" "$BACKUP_DIR/$role"
  docker cp "$container:$dist/index.html" "$work/index.html"
  if [ ! -f "$BACKUP_DIR/$role/index.html" ]; then
    cp "$work/index.html" "$BACKUP_DIR/$role/index.html"
    log "backed up original $role/index.html"
  fi
  cp "$work/index.html" "$BACKUP_DIR/$role/index.html.last"

  awk -f "$PLUGIN_ROOT/scripts/strip-index.awk" "$work/index.html" > "$work/index.plain.html"
  awk -v ver="$VERSION" -f "$PLUGIN_ROOT/scripts/inject-index.awk" "$work/index.plain.html" > "$work/index.patched.html"

  docker exec "$container" mkdir -p "$dist/blade-ui-fonts"
  docker cp "$css" "$container:$dist/blade-ui-theme.css"
  docker cp "$PLUGIN_ROOT/files/blade-ui-theme.js" "$container:$dist/blade-ui-theme.js"
  docker cp "$PLUGIN_ROOT/files/fonts/AlimamaShuHeiTi.ttf" "$container:$dist/blade-ui-fonts/AlimamaShuHeiTi.ttf"
  docker cp "$PLUGIN_ROOT/files/fonts/DINAlternate-Bold.ttf" "$container:$dist/blade-ui-fonts/DINAlternate-Bold.ttf"
  docker cp "$work/index.patched.html" "$container:$dist/index.html"

  printf '%s\n' "$dist" > "$STATE_DIR/work/$role.dist"
  printf '%s\n' "$container" > "$STATE_DIR/work/$role.container"
  log "installed $role  $container:$dist"
}

failed=0
case ",$TARGETS," in
  *,ba,*) install_one ba "$BA_CONTAINER" || failed=1 ;;
esac
case ",$TARGETS," in
  *,bh,*) install_one bh "$BH_CONTAINER" || failed=1 ;;
esac

if [ "$failed" -ne 0 ]; then
  err "install did not complete. run: sh status.sh"
  exit 1
fi

log "Installed blade-ui-plugin $VERSION"
log "Status:    sh $PLUGIN_ROOT/status.sh"
log "Uninstall: sh $PLUGIN_ROOT/uninstall.sh"
