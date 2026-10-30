/** 浏览器里打开 Blade 用的主机。生产环境由 /blade-site.js 在页面脚本之前写入。 */

export function publicHost(): string {
  const runtime = (window.__BLADE_PUBLIC_HOST__ ?? "").trim();
  return runtime.replace(/\/$/, "");
}

export function baOrigin(): string {
  const host = publicHost();
  return host ? `http://${host}:8020` : "";
}

export function hubOrigin(): string {
  const host = publicHost();
  return host ? `http://${host}:8010` : "";
}
