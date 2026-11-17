/** 大系统登录主页。生产环境由 /portal-login.js 在页面脚本之前写入，部署后直接改这个文件。 */
const DEV_LOGIN_KEY = "__bladeDevPortalLogin";

function configuredPortalLoginUrl(): string {
  const raw = (window.__BLADE_PORTAL_LOGIN_URL__ ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

/**
 * 本地测试壳把登录页放在 iframe 地址的 portal_login 上。
 * 详情页内部跳转会丢掉查询参数，所以在脚本加载时记住。只接受本机 /login-test。
 * 生产构建不读这个参数。portal-login.js 的默认空字符串保持不变，离线包不会带上本机地址。
 */
function devShellLoginUrl(): string {
  if (!import.meta.env.DEV) return "";
  const holder = window as Window & { [DEV_LOGIN_KEY]?: string };
  try {
    const raw = new URLSearchParams(window.location.search).get("portal_login")?.trim() ?? "";
    if (raw) {
      const url = new URL(raw);
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
      const path = url.pathname.replace(/\/+$/, "") || "/";
      if ((url.protocol === "http:" || url.protocol === "https:") && loopback && path === "/login-test") {
        holder[DEV_LOGIN_KEY] = `${url.origin}/login-test`;
      }
    }
  } catch {
    /* 地址不完整时继续用已经记住的测试登录页。 */
  }
  return holder[DEV_LOGIN_KEY] ?? "";
}

if (import.meta.env.DEV) devShellLoginUrl();

export function portalLoginUrl(): string {
  const configured = configuredPortalLoginUrl();
  if (configured) return configured;
  return devShellLoginUrl();
}

/** 没登录时离开 iframe，打开配置里的登录主页。地址为空或不是 http(s) 时不跳转。 */
export function redirectToPortalLogin(): boolean {
  const url = portalLoginUrl();
  if (!url) return false;
  const topWindow = window.top;
  if (topWindow && topWindow !== window) {
    try {
      topWindow.location.href = url;
    } catch {
      window.open(url, "_top");
    }
    return true;
  }
  window.location.href = url;
  return true;
}
