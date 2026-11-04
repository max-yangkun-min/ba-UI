#!/bin/bash
# 在已运行 Blade 的 ARM 机器上安装嵌入页、可选集成壳，并把插件注入现有容器。
# 用法: sudo bash install.sh <生产IP>
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IP=""
WITH_SHELL=1
BA_CONTAINER="${BA_CONTAINER:-box-ba}"
BH_CONTAINER="${BH_CONTAINER:-box-bh}"

usage() {
  cat <<'EOF'
用法:
  sudo bash install.sh <生产IP>
  sudo bash install.sh --no-shell <生产IP>
  sudo env BA_CONTAINER=box-ba BH_CONTAINER=box-bh bash install.sh <生产IP>

示例:
  sudo bash install.sh 10.1.2.3

会安装:
  嵌入页        http://<生产IP>:5174
  集成壳        http://<生产IP>:5173   （--no-shell 时跳过）
  iframe / UI 插件注入已有容器，默认 box-ba、box-bh

不下载镜像，不执行 npm。凭据不在本脚本里。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-shell) WITH_SHELL=0 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*)
      echo "未知参数: $1" >&2
      usage
      exit 2
      ;;
    *)
      if [[ -n "$IP" ]]; then
        echo "只能填写一个生产 IP。" >&2
        exit 2
      fi
      IP=$1
      ;;
  esac
  shift
done

if [[ -z "$IP" ]]; then
  usage
  exit 2
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行: sudo bash install.sh $IP" >&2
  exit 1
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

need python3
need docker
need awk
need systemctl

if ! python3 -c 'import re,sys; ip=sys.argv[1]; sys.exit(0 if re.fullmatch(r"(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}", ip) else 1)' "$IP"; then
  echo "生产 IP 格式不正确: $IP" >&2
  exit 2
fi
if [[ "$IP" == 127.* || "$IP" == "0.0.0.0" ]]; then
  echo "请填写生产机对外 IP，不要使用 $IP" >&2
  exit 2
fi

arch=$(uname -m || true)
if [[ "$arch" != "aarch64" && "$arch" != "arm64" ]]; then
  echo "提示: 当前架构是 ${arch:-未知}。本包按 ARM 现场准备，里面没有需要编译的二进制，安装会继续。"
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker 不可用。请在已经部署 Blade 的机器上执行。" >&2
  exit 1
fi

container_up() {
  local name=$1
  local running
  running=$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)
  if [[ "$running" != "true" ]]; then
    echo "容器未在运行: $name" >&2
    echo "默认容器名是 box-ba 和 box-bh。若现场名称不同，用环境变量覆盖后重试。" >&2
    exit 1
  fi
}

container_up "$BA_CONTAINER"
container_up "$BH_CONTAINER"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "离线包不完整，缺少 $1" >&2
    exit 1
  fi
}

require_file "$ROOT/embed-app/dist/index.html"
require_file "$ROOT/embed-app/dist/blade-site.js"
require_file "$ROOT/embed-app/serve.py"
require_file "$ROOT/proxy.env.example"
require_file "$ROOT/embed-app/space-urls.json.example"
require_file "$ROOT/blade-iframe-plugin/install.sh"
require_file "$ROOT/blade-ui-plugin/install.sh"
if [[ "$WITH_SHELL" -eq 1 ]]; then
  require_file "$ROOT/public-service/dist/index.html"
  require_file "$ROOT/public-service/dist/shell-site.js"
  require_file "$ROOT/public-service/serve.py"
fi

PY=$(command -v python3)

write_unit() {
  local name="$1"
  local desc="$2"
  local work="$3"
  local exec="$4"
  cat > "/etc/systemd/system/${name}.service" <<EOF
[Unit]
Description=${desc}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${work}
${exec}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
}

EMBED_DIST=/opt/embed-app/dist
echo "安装嵌入页到 /opt/embed-app"
rm -rf "$EMBED_DIST"
mkdir -p /opt/embed-app
cp -a "$ROOT/embed-app/dist" "$EMBED_DIST"
cp -a "$ROOT/embed-app/serve.py" /opt/embed-app/serve.py
cp -a "$ROOT/proxy.env.example" /opt/embed-app/proxy.env.example
cp -a "$ROOT/embed-app/space-urls.json.example" /opt/embed-app/space-urls.json.example
if [[ ! -f /opt/embed-app/space-urls.json ]]; then
  cp -a "$ROOT/embed-app/space-urls.json.example" /opt/embed-app/space-urls.json
fi
printf 'window.__BLADE_PUBLIC_HOST__ = "%s";\n' "$IP" > "$EMBED_DIST/blade-site.js"
chmod 755 /opt/embed-app "$EMBED_DIST"
chmod 644 "$EMBED_DIST/blade-site.js" /opt/embed-app/serve.py /opt/embed-app/proxy.env.example /opt/embed-app/space-urls.json.example
if [[ -f /opt/embed-app/space-urls.json ]]; then
  chmod 644 /opt/embed-app/space-urls.json
fi
if ! grep -F -q -- "$IP" "$EMBED_DIST/blade-site.js"; then
  echo "blade-site.js 已写入 $EMBED_DIST/blade-site.js，但正文没有生产 IP。" >&2
  exit 1
fi

write_unit embed-app "Blade embed-app" /opt/embed-app "$(cat <<EOF
Environment=EMBED_ROOT=${EMBED_DIST}
Environment=EMBED_PORT=5174
Environment=EMBED_PROXY_ENV=/opt/embed-app/proxy.env
Environment=EMBED_FRAME_ANCESTORS=*
# 应用市场端口在 /opt/embed-app/proxy.env 的 BOS_PORT。留空为 80。现场写 BOS_PORT=8099 后重启本服务。
# 开发空间、管理空间地址在 /opt/embed-app/space-urls.json，或 proxy.env 的 DEV_SPACE_URL、ADMIN_SPACE_URL。
ExecStart=${PY} -u /opt/embed-app/serve.py
EOF
)"

if [[ "$WITH_SHELL" -eq 1 ]]; then
  SHELL_DIST=/opt/public-service/dist
  echo "安装集成壳到 /opt/public-service"
  rm -rf "$SHELL_DIST"
  mkdir -p /opt/public-service
  cp -a "$ROOT/public-service/dist" "$SHELL_DIST"
  cp -a "$ROOT/public-service/serve.py" /opt/public-service/serve.py
  printf 'window.__EMBED_ORIGIN__ = "http://%s:5174";\n' "$IP" > "$SHELL_DIST/shell-site.js"
  chmod 755 /opt/public-service "$SHELL_DIST"
  chmod 644 "$SHELL_DIST/shell-site.js" /opt/public-service/serve.py
  if ! grep -F -q -- "http://${IP}:5174" "$SHELL_DIST/shell-site.js"; then
    echo "shell-site.js 已写入 $SHELL_DIST/shell-site.js，但没有指向嵌入页。" >&2
    exit 1
  fi
  write_unit public-service "Blade public-service shell" /opt/public-service "$(cat <<EOF
Environment=SHELL_ROOT=${SHELL_DIST}
Environment=SHELL_PORT=5173
ExecStart=${PY} -u /opt/public-service/serve.py
EOF
)"
fi

systemctl daemon-reload
systemctl enable embed-app.service
systemctl reset-failed embed-app.service || true
systemctl restart embed-app.service
if [[ "$WITH_SHELL" -eq 1 ]]; then
  systemctl enable public-service.service
  systemctl reset-failed public-service.service || true
  systemctl restart public-service.service
fi

if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port=5174/tcp || true
  if [[ "$WITH_SHELL" -eq 1 ]]; then
    firewall-cmd --permanent --add-port=5173/tcp || true
  fi
  firewall-cmd --reload || true
fi

echo "注入插件到 ${BA_CONTAINER} 和 ${BH_CONTAINER}"
rm -rf /opt/blade-iframe-plugin /opt/blade-ui-plugin
cp -a "$ROOT/blade-iframe-plugin" /opt/blade-iframe-plugin
cp -a "$ROOT/blade-ui-plugin" /opt/blade-ui-plugin
chmod a+rx /opt/blade-iframe-plugin/*.sh /opt/blade-ui-plugin/*.sh || true

plugin_failed=0
allow_origin_args=(--allow-origin "http://${IP}:5174")
if [[ "$WITH_SHELL" -eq 1 ]]; then
  allow_origin_args+=(--allow-origin "http://${IP}:5173")
fi
sh /opt/blade-iframe-plugin/install.sh \
  --ba "$BA_CONTAINER" \
  --bh "$BH_CONTAINER" \
  "${allow_origin_args[@]}" || plugin_failed=1
if [[ "$plugin_failed" -eq 0 ]]; then
  sh /opt/blade-ui-plugin/install.sh \
    --ba "$BA_CONTAINER" \
    --bh "$BH_CONTAINER" || plugin_failed=1
fi

verify_theme_files() {
  container=$1
  dist=""
  for path in /app/web/apps/web/dist /app/web/dist; do
    if docker exec "$container" test -f "$path/index.html" 2>/dev/null; then
      dist=$path
      break
    fi
  done
  if [[ -z "$dist" ]]; then
    echo "$container 找不到前端 dist" >&2
    return 1
  fi
  if ! docker exec "$container" test -f "$dist/blade-ui-theme.js"; then
    echo "$container 缺少 $dist/blade-ui-theme.js" >&2
    return 1
  fi
  if ! docker exec "$container" test -f "$dist/blade-ui-theme.css"; then
    echo "$container 缺少 $dist/blade-ui-theme.css" >&2
    return 1
  fi
  if ! docker exec "$container" grep -q 'blade-ui-theme.js' "$dist/index.html"; then
    echo "$container 的 index.html 没有引用 blade-ui-theme.js" >&2
    return 1
  fi
  if ! docker exec "$container" grep -q 'blade-ui-theme.css' "$dist/index.html"; then
    echo "$container 的 index.html 没有引用 blade-ui-theme.css" >&2
    return 1
  fi
}

if [[ "$plugin_failed" -eq 0 ]]; then
  verify_theme_files "$BA_CONTAINER" || plugin_failed=1
  verify_theme_files "$BH_CONTAINER" || plugin_failed=1
fi

if ! systemctl is-active --quiet embed-app.service; then
  echo "embed-app 没有在运行。检测还没有请求 blade-site.js。" >&2
  systemctl status embed-app --no-pager >&2 || true
  exit 1
fi
if [[ "$WITH_SHELL" -eq 1 ]] && ! systemctl is-active --quiet public-service.service; then
  echo "public-service 没有在运行。检测还没有请求 shell-site.js。" >&2
  systemctl status public-service --no-pager >&2 || true
  exit 1
fi

echo "检查本机页面"
python3 - "$IP" "$WITH_SHELL" <<'PY'
import os
import sys
import time
import urllib.error
import urllib.request

ip = sys.argv[1]
with_shell = sys.argv[2] == "1"
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def read_disk(path):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return handle.read()

def looks_html(body, content_type):
    ctype = (content_type or "").lower()
    if "html" in ctype:
        return True
    sample = (body or "").lstrip().lower()
    return sample.startswith("<!doctype") or sample.startswith("<html")

def fetch(url):
    last = ""
    for _ in range(20):
        try:
            response = opener.open(url, timeout=2)
            body = response.read().decode("utf-8", "replace")
            status = getattr(response, "status", None) or getattr(response, "code", None)
            return status, body, response.headers, ""
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            return exc.code, raw, exc.headers, ""
        except Exception as exc:
            last = str(exc)
            time.sleep(0.5)
    return None, None, None, last

def check_script(label, url, disk_path, expect):
    disk = read_disk(disk_path)
    status, body, headers, err = fetch(url)
    if status is None:
        sys.stderr.write("打不开 %s\n%s\n" % (url, err))
        if disk is None:
            sys.stderr.write("%s 文件不存在：%s\n" % (label, disk_path))
        elif expect not in disk:
            sys.stderr.write("%s 正文没有生产 IP：%s\n" % (label, disk_path))
        return False
    ctype = (headers.get("Content-Type") if headers is not None else "") or ""
    if looks_html(body, ctype):
        sys.stderr.write("%s 被回退成首页 HTML（HTTP %s，Content-Type: %s）。\n" % (label, status, ctype or "无"))
        if disk is None:
            sys.stderr.write("%s 文件不存在：%s\n" % (label, disk_path))
        return False
    if disk is None:
        sys.stderr.write("%s 文件不存在：%s\n" % (label, disk_path))
        sys.stderr.write("服务返回 HTTP %s，Content-Type: %s。\n" % (status, ctype or "无"))
        return False
    if expect not in disk:
        sys.stderr.write("%s 正文没有生产 IP：%s\n" % (label, disk_path))
        return False
    if status != 200:
        sys.stderr.write("%s 返回 HTTP %s，不是未写入 IP。磁盘文件在 %s。\n" % (label, status, disk_path))
        return False
    if expect not in (body or ""):
        sys.stderr.write("%s 正文没有生产 IP（HTTP 200，Content-Type: %s）。\n" % (label, ctype or "无"))
        return False
    if not (body or "").lstrip().startswith("window."):
        sys.stderr.write("%s 返回的不是配置脚本（Content-Type: %s）。\n" % (label, ctype or "无"))
        return False
    sys.stdout.write((body or "").strip() + "\n")
    return True

ok = check_script(
    "blade-site.js",
    "http://127.0.0.1:5174/blade-site.js",
    "/opt/embed-app/dist/blade-site.js",
    'window.__BLADE_PUBLIC_HOST__ = "%s";' % ip,
)
if not ok:
    sys.exit(1)
status, page, page_headers, err = fetch("http://127.0.0.1:5174/")
if status is None:
    sys.stderr.write("打不开 http://127.0.0.1:5174/\n%s\n" % err)
    sys.exit(1)
csp = (page_headers.get("Content-Security-Policy") if page_headers is not None else "") or ""
if "frame-ancestors" not in csp:
    sys.stderr.write("嵌入页响应没有 frame-ancestors。\n")
    sys.exit(1)
if page_headers is not None and page_headers.get("X-Frame-Options"):
    sys.stderr.write("嵌入页设置了 X-Frame-Options，iframe 可能被拒绝。\n")
    sys.exit(1)
if with_shell:
    shell_ok = check_script(
        "shell-site.js",
        "http://127.0.0.1:5173/shell-site.js",
        "/opt/public-service/dist/shell-site.js",
        'window.__EMBED_ORIGIN__ = "http://%s:5174";' % ip,
    )
    if not shell_ok:
        sys.exit(1)
PY

echo
echo "安装结果"
echo "  嵌入页      http://${IP}:5174/"
echo "  Blade Agent http://${IP}:8020"
echo "  Blade Hub   http://${IP}:8010"
if [[ "$WITH_SHELL" -eq 1 ]]; then
  echo "  集成壳      http://${IP}:5173/"
else
  echo "  集成壳      未安装（使用了 --no-shell）"
fi
echo "门户里的 Blade 地址应为 http://${IP}:8020/?iframe=1"
echo "控制台嵌 8020 时另带 hide_nav=1。8010 为 http://${IP}:8010 ，带 iframe=1，不带 hide_nav。"

token_ready=0
refresh_ready=0
if [[ -f /opt/embed-app/proxy.env ]] && grep -Eq '^[[:space:]]*EMBED_TOKEN=[^[:space:]#]+' /opt/embed-app/proxy.env; then
  token_ready=1
fi
if [[ -f /opt/embed-app/proxy.env ]] && grep -Eq '^[[:space:]]*EMBED_REFRESH_TOKEN=[^[:space:]#]+' /opt/embed-app/proxy.env; then
  refresh_ready=1
fi

echo
if [[ "$token_ready" -eq 1 && "$refresh_ready" -eq 1 ]]; then
  echo "已检测到 /opt/embed-app/proxy.env 里的访问票和刷新票，脚本没有读取或打印其中的凭据。"
  echo "服务会在访问票距过期不足 1 小时时自动续期，并把新票写回该文件。不要手改旧的刷新票。"
elif [[ "$token_ready" -eq 1 ]]; then
  echo "已检测到 EMBED_TOKEN，但没有 EMBED_REFRESH_TOKEN。脚本没有读取或打印凭据。"
  echo "自动续期还不可用。请从已登录 BA 的 Cookie 复制 blade_refresh_token，写入 EMBED_REFRESH_TOKEN 后执行:"
  echo "  systemctl restart embed-app"
else
  echo "还差一步: 页面和插件已经装好，但没有可用的访问票。"
  echo "从已登录 BA 的 Cookie 复制 blade_token 到 EMBED_TOKEN，blade_refresh_token 到 EMBED_REFRESH_TOKEN。"
  echo "格式见 /opt/embed-app/proxy.env.example，写好后执行:"
  echo "  systemctl restart embed-app"
  echo "完成这一步之前，嵌入页里的 Blade 页面可能会弹出登录。之后由服务自动续期，不必每天再粘贴。"
fi

if [[ "$plugin_failed" -ne 0 ]]; then
  echo "插件注入没有完成。请查看上面的 docker 输出后重新执行本脚本。" >&2
  exit 1
fi

echo
echo "查看服务: systemctl status embed-app --no-pager"
echo "卸载说明见同目录 部署说明.md"
