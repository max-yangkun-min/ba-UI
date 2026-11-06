import { setPromptOwner } from "../features/prompts/storage";
import { pageAuthPolicy } from "./page-auth";

/**
 * 宿主先 POST /exchange，再等本页发出 blade-embed-ready，回 { type: "blade-embed-token", token }。
 * 票只走 postMessage，不进地址栏。本页不验签，原样交给内层 Blade。
 * 门户展示页始终是超级管理员，用户票到了也不换身份。
 * 对话和后台应用开发只接受父页面传来的平台 JWT。父页面明确回 { admin: true } 时才用超级管理员。
 * 单独打开，或约 4 秒内没有票，停在未授权，不用超级管理员去写对话数据。
 */
export type PortalSession =
  | { mode: "admin" }
  | { mode: "user"; token: string; owner: string }
  | { mode: "unauthorized" };

const AUTH_WAIT_MS = 4000;

const PROXIED = ["/api-ba/", "/api-bh/", "/api-llm/", "/api-bos/", "/api/catalog-counts"];

let settled: PortalSession | null = null;
let resolveReady: (session: PortalSession) => void = () => {};
const ready = new Promise<PortalSession>((resolve) => {
  resolveReady = resolve;
});

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value: string) {
  return value.trim().replace(/^Bearer\s+/i, "");
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
    const lateUser = settled.mode !== "user" && session.mode === "user";
    const lateAdmin = settled.mode === "unauthorized" && session.mode === "admin";
    if (lateUser || lateAdmin) {
      settled = session;
      setPromptOwner(session.mode === "user" ? session.owner : "");
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
      if (session.mode === "unauthorized") {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
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
  if (pageAuthPolicy(window.location.pathname) === "portal") {
    finish({ mode: "admin" });
    return;
  }
  if (window.parent === window) {
    finish({ mode: "unauthorized" });
    return;
  }
  const parentOrigin = hintedParent();
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (parentOrigin && event.origin !== parentOrigin) return;
    const data = event.data as { type?: string; token?: unknown; admin?: unknown } | null;
    if (!data || data.type !== "blade-embed-token") return;
    if (typeof data.token === "string") {
      const token = normalizeToken(data.token);
      if (!token) return;
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
    if (!settled) finish({ mode: "unauthorized" });
  }, AUTH_WAIT_MS);
}

const INSTALLED = "__bladePortalSession";

/** 按当前地址决定向父页面要票，还是直接用超级管理员。走代理的接口会等到票确定后再发出。 */
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

/** 宿主交来的平台 JWT。门户页、未授权、以及父页面明确要求超级管理员时返回空串。 */
export function portalUserToken(): Promise<string> {
  return ready.then((session) => (session.mode === "user" ? session.token : ""));
}

/** 票还没到时返回 null。 */
export function currentPortalSession(): PortalSession | null {
  return settled;
}
