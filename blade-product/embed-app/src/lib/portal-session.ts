import { setPromptOwner } from "../features/prompts/storage";
import { pageAuthPolicy } from "./page-auth";

/**
 * 宿主先 POST /exchange，再等本页发出 blade-embed-ready，回 { type: "blade-embed-token", token }。
 * 票只走 postMessage，不进地址栏。本页不验签。对话页和门户页收的是同一条消息。
 * 任何页面收下非空平台 JWT，都写进本标签 sessionStorage（blade-portal-user-ticket），只存票字符串。
 * 同一标签里的门户启动时若还没有父页面的票，就读这张票，不必等父页面再发一次。
 * 有这张票时，目录和详情带用户 Authorization；安装和立即体验也只用它。
 * 没有父页面票、也没有这份存储时，目录和详情立刻带 X-Blade-Portal-Catalog，不等父页面回票。
 * 服务端因此用超级管理员，页面先把资产列出来，不停在未授权空白页。
 * 父页面后来又发来新票（换人）时，覆盖 sessionStorage，门户改用新票。
 * 已经用另一张票或超级管理员发出的目录请求会刷新一次。没有票才算未登录。
 * 对话和后台应用开发只接受父页面传来的平台 JWT。父页面明确回 { admin: true } 时才用超级管理员。
 * 单独打开对话页，或约 4 秒内没有票，停在未授权，不用超级管理员去写对话数据。
 * 单独打开门户页、且没有这份用户票时，直接用超级管理员。
 */
export type PortalSession =
  | { mode: "admin" }
  | { mode: "user"; token: string; owner: string }
  | { mode: "unauthorized" };

const AUTH_WAIT_MS = 4000;
/** 同一标签、5174 同源页面共用的平台 JWT。只存票字符串，不存超级管理员口令。 */
const USER_TICKET_KEY = "blade-portal-user-ticket";

const PROXIED = ["/api-ba/", "/api-bh/", "/api-llm/", "/api-bos/", "/api/catalog-counts"];
const PORTAL_CATALOG_HEADER = "X-Blade-Portal-Catalog";

let settled: PortalSession | null = null;
let installToken = "";
let catalogReadsSent = false;
const installTokenListeners = new Set<(token: string) => void>();
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
  if (session.mode === "user") requestUserProvision();
}

/**
 * Hub GET /api/kb 经 kb_reader 进入 provision_user，预装钩子在那里跑。
 * 这条不在门户目录里，不会换成超级管理员票。失败不阻断页面。
 */
function requestUserProvision() {
  void fetch("/api-bh/api/kb?scope=installed", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  }).catch(() => undefined);
}

function fromChildFrame(source: MessageEventSource | null) {
  if (!source || source === window) return false;
  const frames = window.frames;
  for (let index = 0; index < frames.length; index += 1) {
    try {
      if (frames[index] === source) return true;
    } catch {
      // 跨源窗口对不上时，不当成我们的内层页面。
    }
  }
  return false;
}

let hostLogoutSent = false;

/** 内层 Blade 退出后通知外层。没有父页面时不发，也不改本地登录页。 */
export function relayHostLogout() {
  if (hostLogoutSent || window.parent === window) return;
  hostLogoutSent = true;
  window.parent.postMessage({ type: "blade-embed-logout", service: "shell" }, liveParentOrigin() || hintedParent() || "*");
}

function installHostLogoutRelay() {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string } | null;
    if (!data || data.type !== "blade-embed-logout") return;
    const fromParent = window.parent !== window && event.source === window.parent;
    const fromChild = fromChildFrame(event.source);
    if (!fromParent && !fromChild) return;
    if (fromParent && !parentOriginAllowed(event.origin, hintedParent())) return;
    // 内层 Blade 退出时继续通知外层。父页面自己退出时只清本页的票，不再往上抛。
    if (fromChild) relayHostLogout();
    releasePortalUser();
  });
}

/** 退出后丢掉同一标签的用户票。门户目录正在用这张票时，刷新回超级管理员目录。 */
function releasePortalUser() {
  const hadUser = Boolean(installToken || readStoredUserTicket());
  forgetUserTicket();
  setInstallToken("");
  if (!hadUser) return;
  if (pageAuthPolicy(window.location.pathname) !== "portal") return;
  window.location.reload();
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

/** 真正包住本页的窗口。embed_parent 可能指向更外层，不能单靠它拒绝直接父页面的退出和票。 */
function liveParentOrigin() {
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0 && ancestors[0]) return ancestors[0];
  } catch {
    // 老浏览器没有 ancestorOrigins 时改看引荐来源。
  }
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    return "";
  }
  return "";
}

function parentOriginAllowed(eventOrigin: string, hinted: string) {
  const live = liveParentOrigin();
  if (!hinted && !live) return true;
  if (hinted && eventOrigin === hinted) return true;
  if (live && eventOrigin === live) return true;
  return false;
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

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request && input.method) return input.method.toUpperCase();
  return "GET";
}

function queryIs(params: URLSearchParams, key: string, expected: string) {
  return params.get(key) === expected;
}

function setInstallToken(value: string) {
  const next = normalizeToken(value);
  if (next === installToken) return;
  installToken = next;
  installTokenListeners.forEach((listener) => listener(next));
}

/** 读同一标签里已经收下的平台 JWT。旧数据若只是 "1"，那不是票。 */
function readStoredUserTicket() {
  try {
    const token = normalizeToken(sessionStorage.getItem(USER_TICKET_KEY) ?? "");
    if (!token || token === "1") return "";
    return token;
  } catch {
    return "";
  }
}

function userTicketExpected() {
  return Boolean(readStoredUserTicket());
}

function rememberUserTicket(token: string) {
  const next = normalizeToken(token);
  if (!next) return;
  try {
    sessionStorage.setItem(USER_TICKET_KEY, next);
  } catch {
    // 隐私模式写不进时，这一页仍然用已经拿到的票。
  }
}

function forgetUserTicket() {
  try {
    sessionStorage.removeItem(USER_TICKET_KEY);
  } catch {
    // 清不掉就留到这个标签关闭。换人靠后来的新票覆盖。
  }
}

/** 父页面交来的平台 JWT。有这张票时，目录读取、安装、添加和立即体验都用它。 */
export function portalInstallToken() {
  return installToken;
}

export function watchPortalInstallToken(listener: (token: string) => void) {
  installTokenListeners.add(listener);
  return () => {
    installTokenListeners.delete(listener);
  };
}

/**
 * 没登录时才标成门户目录，让开发代理和 serve.py 换成超级管理员。
 * 只含列表、详情、截图、已添加/已发布读取，以及工具测试连接。
 * 安装和添加不在这里。已经有用户票时，这些读取改走用户 Authorization。
 */
function isPortalCatalogRead(input: RequestInfo | URL, init?: RequestInit) {
  if (pageAuthPolicy(window.location.pathname) !== "portal") return false;
  const method = requestMethod(input, init);
  let url: URL;
  try {
    url = new URL(requestUrl(input), window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (method === "POST") return path === "/api-bh/api/resources/test";
  if (method !== "GET" && method !== "HEAD") return false;
  if (path === "/api-ba/api/skill-store/catalog") return true;
  if (path === "/api-ba/api/registry/kb") return queryIs(url.searchParams, "scope", "market");
  if (/^\/api-ba\/api\/registry\/kb\/[^/]+$/.test(path)) return true;
  if (path === "/api-ba/api/market-publish/listings") return true;
  if (path === "/api-ba/api/published-apps") return true;
  if (/^\/api-ba\/api\/published-apps\/[^/]+$/.test(path)) return true;
  if (path === "/api-bh/api/resources") return queryIs(url.searchParams, "type", "tool");
  if (/^\/api-bh\/api\/resources\/[^/]+$/.test(path)) return true;
  if (path === "/api-bh/api/plugins") return true;
  if (/^\/api-bh\/api\/plugins\/[^/]+$/.test(path)) return true;
  if (/^\/api-bh\/api\/skills\/[^/]+\/[^/]+$/.test(path)) return true;
  if (path === "/api-bos/api/v1/market/listings") return true;
  if (/^\/api-bos\/api\/v1\/market\/listings\/[^/]+$/.test(path)) return true;
  if (/^\/api-bos\/api\/v1\/market\/listings\/[^/]+\/screenshots\/[^/]+\/image$/.test(path)) return true;
  if (path === "/api-bos/api/v1/market/installed") return true;
  if (path === "/api/catalog-counts") return true;
  return false;
}

function isAccountInstall(input: RequestInfo | URL, init?: RequestInit) {
  if (pageAuthPolicy(window.location.pathname) !== "portal") return false;
  const method = requestMethod(input, init);
  if (method !== "POST" && method !== "DELETE") return false;
  let url: URL;
  try {
    url = new URL(requestUrl(input), window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (method === "POST" && path === "/api-ba/api/skill-store/install") return true;
  if (method === "DELETE" && /^\/api-bh\/api\/me\/skills\/[^/]+\/[^/]+\/install$/.test(path)) return true;
  if (/^\/api-bos\/api\/v1\/market\/listings\/[^/]+\/install$/.test(path)) return true;
  if (/^\/api-bh\/api\/kb\/[^/]+\/install$/.test(path)) return true;
  if (/^\/api-bh\/api\/plugins\/[^/]+\/install$/.test(path)) return true;
  return false;
}

function accountInstallFetch(nativeFetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  if (!installToken) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  const headers = new Headers(init?.headers);
  if (input instanceof Request && !init?.headers) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  headers.delete(PORTAL_CATALOG_HEADER);
  headers.set("Authorization", `Bearer ${installToken}`);
  return nativeFetch(input, { ...init, headers });
}

function portalCatalogFetch(nativeFetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  catalogReadsSent = true;
  const headers = new Headers(init?.headers);
  if (input instanceof Request && !init?.headers) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  headers.delete("Authorization");
  headers.set(PORTAL_CATALOG_HEADER, "1");
  return nativeFetch(input, { ...init, headers });
}

/** 门户已登录：目录读取、安装都带这张用户票，并去掉超级管理员标记。 */
function portalUserFetch(nativeFetch: typeof fetch, input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (input instanceof Request && !init?.headers) {
    input.headers.forEach((value, key) => headers.set(key, value));
  }
  headers.delete(PORTAL_CATALOG_HEADER);
  headers.set("Authorization", `Bearer ${installToken}`);
  return nativeFetch(input, { ...init, headers });
}

function installFetchBridge() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isProxied(input)) return nativeFetch(input, init);
    if (isAccountInstall(input, init)) return accountInstallFetch(nativeFetch, input, init);
    if (pageAuthPolicy(window.location.pathname) === "portal") {
      const run = () => {
        if (installToken) return portalUserFetch(nativeFetch, input, init);
        if (isPortalCatalogRead(input, init)) return portalCatalogFetch(nativeFetch, input, init);
        return nativeFetch(input, init);
      };
      const catalog = isPortalCatalogRead(input, init);
      const waitForKnownUser =
        catalog && !installToken && !settled && window.parent !== window && userTicketExpected();
      if (waitForKnownUser) return ready.then(run);
      if (catalog || installToken || settled || window.parent === window) return run();
      return ready.then(run);
    }
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

/** 门户收下和对话页同一条用户票。目录若已用别的身份发出，刷新后改走这张票。同一张票不重复刷新。 */
function acceptPortalUser(token: string) {
  const next = normalizeToken(token);
  if (!next) return;
  const previous = installToken;
  rememberUserTicket(next);
  if (next === previous) {
    if (!settled) {
      finish({ mode: "admin" });
      requestUserProvision();
    }
    return;
  }
  setInstallToken(next);
  const refreshCatalog = catalogReadsSent || Boolean(settled);
  if (!settled) {
    finish({ mode: "admin" });
    requestUserProvision();
  }
  if (refreshCatalog) window.location.reload();
}

/** 门户还没收到父页面的票时，先用同一标签里对话页写下的票。 */
function adoptStoredPortalTicket() {
  if (pageAuthPolicy(window.location.pathname) !== "portal") return;
  if (installToken) return;
  const token = readStoredUserTicket();
  if (!token) return;
  acceptPortalUser(token);
}

function armHandshake() {
  const portal = pageAuthPolicy(window.location.pathname) === "portal";
  const parentOrigin = hintedParent();
  if (window.parent !== window) {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!parentOriginAllowed(event.origin, parentOrigin)) return;
      const data = event.data as { type?: string; token?: unknown; admin?: unknown } | null;
      if (!data || data.type !== "blade-embed-token") return;
      if (typeof data.token === "string") {
        const token = normalizeToken(data.token);
        if (token && token !== "1") {
          // 对话页和门户页收的是同一条消息。先落盘，父页面稍后换票时覆盖。
          rememberUserTicket(token);
          if (portal) {
            acceptPortalUser(token);
            return;
          }
          finish({ mode: "user", token, owner: ownerFromToken(token) });
          return;
        }
      }
      if (data.admin === true) {
        // 父页面明确没有用户票。已经收下的票是上一次登录留下的，退出后必须丢掉。
        if (installToken || readStoredUserTicket()) {
          releasePortalUser();
          return;
        }
        if (!settled) finish({ mode: "admin" });
      }
    };
    window.addEventListener("message", onMessage);
  }
  // 父页面没再发票时，门户用同一标签里已经写下的用户票，不必空等回信。
  adoptStoredPortalTicket();
  if (window.parent === window) {
    if (!settled) finish(portal ? { mode: "admin" } : { mode: "unauthorized" });
    return;
  }
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
    if (settled) return;
    // 父页面没回票时不删 sessionStorage。门户下次启动还要读这张用户票。
    finish(portal ? { mode: "admin" } : { mode: "unauthorized" });
  }, AUTH_WAIT_MS);
}

const INSTALLED = "__bladePortalSession";

/** 对话页向父页面要平台 JWT。门户页同样要这张票；没有父页面或没有票时用超级管理员。 */
export function installPortalSession(): Promise<PortalSession> {
  const holder = window as Window & { [INSTALLED]?: Promise<PortalSession> };
  if (!holder[INSTALLED]) {
    installFetchBridge();
    installHostLogoutRelay();
    armHandshake();
    holder[INSTALLED] = ready;
  }
  return holder[INSTALLED];
}

export function whenPortalSession(): Promise<PortalSession> {
  return ready;
}

/** 宿主交来的平台 JWT。门户上是安装和目录要用的那张票；对话页是会话票。没有则返回空串。 */
export function portalUserToken(): Promise<string> {
  return ready.then((session) => installToken || (session.mode === "user" ? session.token : ""));
}

/** 票还没到时返回 null。 */
export function currentPortalSession(): PortalSession | null {
  return settled;
}
