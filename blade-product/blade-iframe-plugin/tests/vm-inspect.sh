#!/bin/sh
set -eu
echo '--- EXISTING PLUGIN ---'
ls -ld /opt/blade-iframe-plugin /opt/box-deploy-kty/iframe-patch 2>/dev/null || true
echo '--- BA INDEX ---'
docker exec box-ba sh -c 'ls -l /app/web/apps/web/dist/index.html /app/web/apps/web/dist/iframe-auth-bridge.js 2>/dev/null || true'
echo '--- BA GREP ---'
docker exec box-ba sh -c 'grep iframe-auth-bridge /app/web/apps/web/dist/index.html || true'
echo '--- BA HEAD ---'
docker exec box-ba sh -c 'sed -n 1,18p /app/web/apps/web/dist/index.html'
echo '--- BH INDEX ---'
docker exec box-bh sh -c 'ls -l /app/web/dist/index.html /app/web/dist/iframe-auth-bridge.js 2>/dev/null || true'
echo '--- BH GREP ---'
docker exec box-bh sh -c 'grep iframe-auth-bridge /app/web/dist/index.html || true'
echo '--- BH HEAD ---'
docker exec box-bh sh -c 'sed -n 1,18p /app/web/dist/index.html'
echo '--- TOOLS ---'
command -v awk
command -v curl
