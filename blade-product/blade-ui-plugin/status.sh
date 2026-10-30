#!/usr/bin/env sh
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scripts/common.sh"

need_cmd docker

check_one() {
  role=$1
  container=$2
  printf '== %s ==\n' "$role"
  if container_running "$container"; then
    printf 'container: %s  running=yes\n' "$container"
  else
    printf 'container: %s  running=no\n' "$container"
    return 1
  fi
  dist=$(find_dist "$container") || {
    printf 'dist: missing\n'
    return 1
  }
  printf 'dist: %s\n' "$dist"
  if docker exec "$container" test -f "$dist/blade-ui-theme.css"; then
    printf 'theme css: present\n'
  else
    printf 'theme css: missing\n'
  fi
  if docker exec "$container" test -f "$dist/blade-ui-theme.js"; then
    printf 'theme js: present\n'
  else
    printf 'theme js: missing\n'
  fi
  if docker exec "$container" test -f "$dist/blade-ui-fonts/AlimamaShuHeiTi.ttf"; then
    printf 'font: present\n'
  else
    printf 'font: missing\n'
  fi
  if docker exec "$container" grep -q 'blade-ui-plugin:start' "$dist/index.html"; then
    printf 'index.html: injected\n'
    docker exec "$container" grep -o 'blade-ui-theme.css?v=[^" ]*' "$dist/index.html" | head -n 1 | sed 's/^/theme version: /'
  else
    printf 'index.html: not injected\n'
  fi
  if docker exec "$container" grep -q 'iframe-auth-bridge.js' "$dist/index.html"; then
    printf 'iframe plugin: still present\n'
  else
    printf 'iframe plugin: not in index.html\n'
  fi
}

failed=0
check_one ba "$BA_CONTAINER" || failed=1
check_one bh "$BH_CONTAINER" || failed=1
exit "$failed"
