#!/usr/bin/env sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/common.sh"

TARGETS="ba,bh"
RESTORE_BACKUP=0

usage() {
  cat <<EOF
Uninstall blade-iframe-plugin $VERSION

By default this only strips the injected script tags and deletes the
bridge files. Do not restore the old index.html after a product upgrade.

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
  default_container=$2
  container=$default_container
  if [ -f "$STATE_DIR/work/$role.container" ]; then
    container=$(tr -d "\r\n" < "$STATE_DIR/work/$role.container")
  fi
  if ! container_running "$container"; then
    err "$role container is not running: $container"
    return 1
  fi

  dist=""
  if [ -f "$STATE_DIR/work/$role.dist" ]; then
    dist=$(tr -d "\r\n" < "$STATE_DIR/work/$role.dist")
  fi
  if [ -z "$dist" ] || ! docker exec "$container" test -f "$dist/index.html"; then
    dist=$(find_dist "$container") || {
      err "frontend dist/index.html not found in $container"
      return 1
    }
  fi

  work="$STATE_DIR/work/$role-uninstall"
  mkdir -p "$work"
  docker cp "$container:$dist/index.html" "$work/index.html"

  if [ "$RESTORE_BACKUP" -eq 1 ] && [ -f "$BACKUP_DIR/$role/index.html" ]; then
    docker cp "$BACKUP_DIR/$role/index.html" "$container:$dist/index.html"
    log "restored pre-install $role/index.html"
  else
    awk -f "$PLUGIN_ROOT/scripts/strip-index.awk" "$work/index.html" > "$work/index.clean.html"
    docker cp "$work/index.clean.html" "$container:$dist/index.html"
    log "removed plugin scripts from $role/index.html"
  fi

  # theme.js 是旧文件名。blade-ui-theme.js 和 blade-ui-theme.css 属于 UI 插件，这里不删。
  docker exec "$container" rm -f "$dist/iframe-auth-bridge.js" "$dist/iframe-auth-bridge.config.js" "$dist/url-token-auth.js" "$dist/blade-ui-slim.js" "$dist/theme.js" "$dist/$AUTOLOGIN_NAME" || true
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

log "uninstall complete"
