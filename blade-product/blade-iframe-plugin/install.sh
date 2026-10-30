#!/usr/bin/env sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/common.sh"

TARGETS="ba,bh"
DO_RESTART=0
ALLOW_ORIGINS=""

usage() {
  cat <<EOF
blade-iframe-plugin $VERSION

Install the cross-origin iframe token bridge onto an already deployed
Blade core (running box-ba / box-bh). This does not change the deployer
package and does not rebuild images.

Usage:
  sh install.sh [options]

Options:
  --ba-only              install Blade Agent only
  --bh-only              install Blade Hub only
  --ba NAME              BA container name, default box-ba
  --bh NAME              BH container name, default box-bh
  --allow-origin ORIGIN  allowlisted parent origin, repeatable
  --restart              restart target containers after install
  --no-restart           default: do not restart
  -h, --help             show help

Examples:
  scp -r blade-iframe-plugin root@SERVER:/opt/
  ssh root@SERVER 'sh /opt/blade-iframe-plugin/install.sh'
  sh install.sh --allow-origin http://10.0.0.8:8080
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ba-only) TARGETS="ba" ;;
    --bh-only) TARGETS="bh" ;;
    --ba) BA_CONTAINER=$2; shift ;;
    --bh) BH_CONTAINER=$2; shift ;;
    --allow-origin) ALLOW_ORIGINS="$ALLOW_ORIGINS $2"; shift ;;
    --restart) DO_RESTART=1 ;;
    --no-restart) DO_RESTART=0 ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown argument: $1"; usage; exit 2 ;;
  esac
  shift
done

need_cmd docker
need_cmd awk
test -f "$BRIDGE_JS"
ensure_state

# shellcheck disable=SC2086
set -- $ALLOW_ORIGINS
write_allow_origins "$STATE_DIR/iframe-auth-bridge.config.js" "$@"
CONFIG_JS="$STATE_DIR/iframe-auth-bridge.config.js"

install_one() {
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
  mkdir -p "$work" "$BACKUP_DIR/$role"
  docker cp "$container:$dist/index.html" "$work/index.html"

  if [ ! -f "$BACKUP_DIR/$role/index.html" ]; then
    cp "$work/index.html" "$BACKUP_DIR/$role/index.html"
    log "backed up original $role/index.html"
  fi
  cp "$work/index.html" "$BACKUP_DIR/$role/index.html.last"

  awk -f "$PLUGIN_ROOT/scripts/strip-index.awk" "$work/index.html" > "$work/index.plain.html"
  awk -v ver="$VERSION" -f "$PLUGIN_ROOT/scripts/inject-index.awk" \
    "$work/index.plain.html" > "$work/index.patched.html"

  # 把 url-token-auth.js 注入到最早的 module script 之前：让 ?token= 直链在启动时
  # 就补上 Authorization 头。BA 和 BH 都要——BH 前端同样只认会话 Cookie，后端同样
  # 接受 Bearer（已实测），所以 BH 也需要这段。
  awk -v ver="$VERSION" -f "$PLUGIN_ROOT/scripts/inject-url-token.awk" \
    "$work/index.patched.html" > "$work/index.urltoken.html"
  mv "$work/index.urltoken.html" "$work/index.patched.html"

  # logo / 左下角账号隐藏：BA、BH 都注入，且不受 embed 模式限制。
  awk -v ver="$VERSION" -f "$PLUGIN_ROOT/scripts/inject-slim-ui.awk" \
    "$work/index.patched.html" > "$work/index.slim.html"
  mv "$work/index.slim.html" "$work/index.patched.html"

  if [ -f "$CONFIG_JS" ]; then
    awk -v ver="$VERSION" '
      BEGIN { done = 0 }
      {
        if (!done && $0 ~ /iframe-auth-bridge\.js/) {
          print "    <script src=\"/iframe-auth-bridge.config.js?v=" ver "\"></script>"
          done = 1
        }
        print
      }
    ' "$work/index.patched.html" > "$work/index.with-config.html"
    mv "$work/index.with-config.html" "$work/index.patched.html"
    docker cp "$CONFIG_JS" "$container:$dist/iframe-auth-bridge.config.js"
  else
    docker exec "$container" rm -f "$dist/iframe-auth-bridge.config.js" || true
  fi

  cp "$BRIDGE_JS" "$work/iframe-auth-bridge.js"
  # logo / 左下角账号隐藏做成独立脚本，直链访问（不带 iframe/mode 参数）时也要生效，
  # 所以不能拼进只在嵌入态运行的 iframe-auth-bridge.js。
  if [ -f "$PLUGIN_ROOT/files/theme.js" ]; then
    docker cp "$PLUGIN_ROOT/files/theme.js" "$container:$dist/blade-ui-slim.js"
  fi
  if [ -f "$URL_TOKEN_JS" ]; then
    docker cp "$URL_TOKEN_JS" "$container:$dist/url-token-auth.js"
  fi
  docker cp "$work/iframe-auth-bridge.js" "$container:$dist/iframe-auth-bridge.js"
  # 只删旧文件名 theme.js。样式脚本是 blade-ui-theme.js，不能一起删。
  docker exec "$container" rm -f "$dist/theme.js" || true
  docker cp "$work/index.patched.html" "$container:$dist/index.html"

  # 一键免登录入口：BA / BH 都放。纯静态页：token 种成同源 Cookie 后跳转；
  # Cookie 按主机共享、不分端口，所以 :8020 与 :8010 都能认。
  if [ -f "$AUTOLOGIN_HTML" ]; then
    docker cp "$AUTOLOGIN_HTML" "$container:$dist/$AUTOLOGIN_NAME"
  fi

  printf '%s\n' "$dist" > "$STATE_DIR/work/$role.dist"
  printf '%s\n' "$container" > "$STATE_DIR/work/$role.container"

  if [ "$DO_RESTART" -eq 1 ]; then
    docker restart "$container" >/dev/null
    log "restarted $container"
  fi

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

cat <<EOF

Installed blade-iframe-plugin $VERSION

Embed URLs:
  BA workbench     http://<SERVER>:$BA_PORT/?iframe=1
  BH skill store   http://<SERVER>:$BH_PORT/skills?mode=embed
  domain agents    http://<SERVER>:$BH_PORT/solutions?mode=embed

One-click login link (no login page, server-side session cookie).
BA workbench and BH capability center share the same host cookie:
  http://<SERVER>:$BA_PORT/$AUTOLOGIN_NAME?token=<BO Access Token>
  http://<SERVER>:$BH_PORT/$AUTOLOGIN_NAME?token=<BO Access Token>&next=/skills
  add &refresh_token=<refresh> for front-end session renewal;
  default next: BA=/chat, BH=/

Direct URL token (also no login page, token stripped from the address bar):
  http://<SERVER>:$BA_PORT/chat?token=<BO Access Token>
  http://<SERVER>:$BH_PORT/skills?mode=embed&token=<BO Access Token>

Host should reply to blade-embed-ready with:
  { "type": "blade-embed-token", "token": "<BO Access Token>" }

After container recreate or product upgrade, re-run:
  sh $PLUGIN_ROOT/install.sh

Status:     sh $PLUGIN_ROOT/status.sh
Uninstall:  sh $PLUGIN_ROOT/uninstall.sh
EOF
