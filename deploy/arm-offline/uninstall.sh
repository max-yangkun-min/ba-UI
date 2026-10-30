#!/bin/bash
# 停止嵌入页和集成壳，并卸载已注入容器的插件。
# 用法: sudo bash uninstall.sh [--restore-backup] [--purge]
set -euo pipefail

RESTORE=0
PURGE=0

usage() {
  cat <<'EOF'
用法:
  sudo bash uninstall.sh
  sudo bash uninstall.sh --restore-backup
  sudo bash uninstall.sh --purge

默认停止 5174/5173 服务，并去掉两个插件写进容器的标记和文件。
不删除 /opt/embed-app/proxy.env。

--restore-backup  用安装前备份的 index.html 覆盖容器里的前端。
                  仅当容器仍是安装前那一版前端时使用。产品升级后不要加这个参数。
--purge           另外删除 /opt/embed-app、/opt/public-service、插件目录和插件状态。
                  这会删掉 proxy.env。
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore-backup) RESTORE=1 ;;
    --purge) PURGE=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 执行: sudo bash uninstall.sh" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "缺少命令: systemctl" >&2
  exit 1
fi

stop_unit() {
  local name="$1"
  systemctl disable --now "${name}.service" || true
  rm -f "/etc/systemd/system/${name}.service"
}

echo "停止嵌入页和集成壳"
stop_unit embed-app
stop_unit public-service
systemctl daemon-reload

if [[ "$RESTORE" -eq 1 ]]; then
  echo "将尝试恢复安装前的 index.html。若 Blade 已经升级，不要使用这份恢复结果。"
fi

run_plugin_uninstall() {
  local dir="$1"
  if [[ ! -f "$dir/uninstall.sh" ]]; then
    echo "跳过，未找到 $dir/uninstall.sh"
    return 0
  fi
  if [[ "$RESTORE" -eq 1 ]]; then
    sh "$dir/uninstall.sh" --restore-backup
  else
    sh "$dir/uninstall.sh"
  fi
}

if command -v docker >/dev/null 2>&1; then
  run_plugin_uninstall /opt/blade-ui-plugin || echo "UI 插件卸载未完成"
  run_plugin_uninstall /opt/blade-iframe-plugin || echo "iframe 插件卸载未完成"
else
  echo "未找到 docker，跳过容器内插件卸载。"
fi

if [[ "$PURGE" -eq 1 ]]; then
  echo "删除 /opt 下的嵌入页、集成壳、插件目录，以及插件状态目录。"
  echo "其中包含 /opt/embed-app/proxy.env。"
  rm -rf /opt/embed-app /opt/public-service /opt/blade-iframe-plugin /opt/blade-ui-plugin
  rm -rf /var/lib/blade-iframe-plugin /var/lib/blade-ui-plugin
fi

echo "卸载步骤已执行。"
if [[ "$PURGE" -eq 0 ]]; then
  echo "服务已停止。/opt/embed-app 仍保留，proxy.env 未删除。"
  echo "只想去掉某一个插件时，也可以单独执行:"
  echo "  sh /opt/blade-ui-plugin/uninstall.sh"
  echo "  sh /opt/blade-iframe-plugin/uninstall.sh"
  echo "UI 插件的卸载不会删除 iframe 插件的文件。"
fi
