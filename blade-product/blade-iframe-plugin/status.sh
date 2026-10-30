#!/usr/bin/env sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/common.sh"

need_cmd docker

# check_http URL [js|html]
# 只看 HTTP 200 会假阳性：BH 是 SPA，对不存在的静态路径也兜底返回 index.html（内容
# 是 text/html 而非脚本）。所以这里顺带看一眼响应体首个非空白字符：
#   脚本应为 / (注释) 或 ( / { ，HTML 应为 < 。对不上就标注出来。
check_http() {
  url=$1
  expect=${2:-}
  if ! command -v curl >/dev/null 2>&1; then
    printf 'skip'
    return
  fi
  tmp=$(mktemp 2>/dev/null || printf '%s' "$STATE_DIR/http.$$")
  code=$(curl -sS -o "$tmp" -w "%{http_code}" "$url" 2>/dev/null || printf 'down')
  if [ "$code" != "200" ]; then
    rm -f "$tmp"
    printf '%s' "$code"
    return
  fi
  first=$(head -c 1 "$tmp" 2>/dev/null | tr -d ' \t\r\n')
  rm -f "$tmp"
  case "$expect" in
    js)
      case "$first" in
        /|\(|\{) printf '200 ok' ;;
        *) printf '200 BUT-html(SPA-fallback?)' ;;
      esac
      ;;
    html)
      case "$first" in
        \<) printf '200 ok' ;;
        *) printf '200 BUT-not-html' ;;
      esac
      ;;
    *) printf '200' ;;
  esac
}

status_one() {
  role=$1
  container=$2
  port=$3
  printf '== %s ==\n' "$role"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    log "container missing: $container"
    return 1
  fi
  running=no
  container_running "$container" && running=yes
  log "container: $container  running=$running"
  if [ "$running" != yes ]; then
    return 1
  fi

  dist=$(find_dist "$container") || {
    log "dist/index.html not found"
    return 1
  }
  log "static dir: $dist"

  if docker exec "$container" test -f "$dist/iframe-auth-bridge.js"; then
    log "bridge file: present"
    if docker exec "$container" grep -q "BLADE_LOGO_FREE_V3_BEGIN" "$dist/blade-ui-slim.js" 2>/dev/null; then
      log "slim-ui file: present"
    else
      log "slim-ui file: missing"
    fi
  else
    log "bridge file: missing"
  fi

  work="$STATE_DIR/work/$role-status"
  mkdir -p "$work"
  docker cp "$container:$dist/index.html" "$work/index.html"
  if grep -q "iframe-auth-bridge.js" "$work/index.html"; then
    log "index.html: injected"
  else
    log "index.html: not injected"
  fi
  if grep -q "url-token-auth.js" "$work/index.html"; then
    log "index.html: url-token injected"
    code=$(check_http "http://127.0.0.1:$port/url-token-auth.js" js)
    log "HTTP url-token script: $code"
  fi
  if grep -q "blade-ui-slim.js" "$work/index.html"; then
    log "index.html: slim-ui injected"
    code=$(check_http "http://127.0.0.1:$port/blade-ui-slim.js" js)
    log "HTTP slim-ui script: $code"
  fi
  if grep -q 'src="/theme.js' "$work/index.html"; then
    log "index.html: leftover theme.js tag"
  fi

  code=$(check_http "http://127.0.0.1:$port/iframe-auth-bridge.js" js)
  log "HTTP bridge script: $code"
  if docker exec "$container" test -f "$dist/$AUTOLOGIN_NAME"; then
    log "autologin page: present"
    code=$(check_http "http://127.0.0.1:$port/$AUTOLOGIN_NAME" html)
    log "HTTP autologin page: $code"
  else
    log "autologin page: missing"
  fi
  echo
}

failed=0
status_one ba "$BA_CONTAINER" "$BA_PORT" || failed=1
status_one bh "$BH_CONTAINER" "$BH_PORT" || failed=1
log "plugin version: $VERSION"
log "plugin dir: $PLUGIN_ROOT"
exit "$failed"
