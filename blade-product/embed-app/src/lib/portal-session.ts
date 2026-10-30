import { setPromptOwner } from "../features/prompts/storage";

/**
 * 门户（另一源站）说明当前是超级管理员视角，还是已登录用户的平台票。
 * 票只走 postMessage，不进地址栏。未收到用户票时，接口仍由开发代理附上整站票。
 */
export type PortalSession =
  | { mode: "admin" }
  | { mode: "user"; token: string; owner: string };

const PROXIED = ["/api-ba/", "/api-bh/", "/api-llm/", "/api-bos/", "/api/catalog-counts"];

let settled: PortalSession | null = null;
let resolveReady: (session: PortalSession) => void = () => {};
const ready = new Promise<PortalSession>((resolve) => {
  resolveReady = resolve;
});

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function decodePayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function ownerFromToken(token: string) {
  const payload = decodePayload(token);
  const raw =
    text(payload?.preferred_username) ||
    text(payload?.username) ||
    text(payload?.sub) ||
    text(payload?.user_id);
  const cleaned = raw.replace(/[^a-zA-Z0-9._@-]/g, "_").slice(0, 96);
  if (cleaned) return cleaned;
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `u${(hash >>> 0).toString(16)}`;
}

function finish(session: PortalSession) {
  if (settled) {
    if (settled.mode === "admin" && session.mode === "user") {
      settled = session;
      setPromptOwner(session.owner);
      window.location.reload();
    }
    return;
  }
  settled = session;
  setPromptOwner(session.mode === "user" ? session.owner : "");
  resolveReady(session);
}

function hintedParent() {
  try {
    const hinted = new URLSearchParams(window.location.search).get("embed_parent") ?? "";
    if (hinted) return new URL(hinted).origin;
  } catch {
    // 地址里的父页面来源无法解析时，改看引荐来源。
  }
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    return "";
  }
  return "";
}

function isProxied(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return false;
    return PROXIED.some((prefix) => url.pathname === prefix.replace(/\/$/, "") || url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function installFetchBridge() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isProxied(input)) return nativeFetch(input, init);
    return ready.then((session) => {
      if (session.mode !== "user") return nativeFetch(input, init);
      const headers = new Headers(init?.headers);
      if (input instanceof Request && !init?.headers) {
        input.headers.forEach((value, key) => headers.set(key, value));
      }
      if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${session.token}`);
      return nativeFetch(input, { ...init, headers });
    });
  };
}

function armHandshake() {
  if (window.parent === window) {
    finish({ mode: "admin" });
    return;
  }
  const parentOrigin = hintedParent();
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    const data = event.data as { type?: string; token?: unknown; admin?: unknown } | null;
    if (!data || data.type !== "blade-embed-token") return;
    if (typeof data.token === "string" && data.token.trim()) {
      const token = data.token.trim();
      finish({ mode: "user", token, owner: ownerFromToken(token) });
      return;
    }
    if (data.admin === true) finish({ mode: "admin" });
  };
  window.addEventListener("message", onMessage);
  const announce = () => {
    if (settled) return;
    window.parent.postMessage({ type: "blade-embed-ready", service: "shell" }, parentOrigin || "*");
  };
  announce();
  const timer = window.setInterval(() => {
    if (settled) {
      window.clearInterval(timer);
      return;
    }
    announce();
  }, 250);
  window.setTimeout(() => {
    window.clearInterval(timer);
    if (!settled) finish({ mode: "admin" });
  }, 4000);
}

const INSTALLED = "__bladePortalSession";

/** 在渲染页面前完成。嵌在门户里时先问父页面要票；单独打开则维持超级管理员视角。 */
export function installPortalSession(): Promise<PortalSession> {
  const holder = window as Window & { [INSTALLED]?: Promise<PortalSession> };
  if (!holder[INSTALLED]) {
    installFetchBridge();
    armHandshake();
    holder[INSTALLED] = ready;
  }
  return holder[INSTALLED];
}

export function whenPortalSession(): Promise<PortalSession> {
  return ready;
}

/** 页面开始渲染时会话通常已经确定。没有确定时返回 null。 */
export function currentPortalSession(): PortalSession | null {
  return settled;
}
