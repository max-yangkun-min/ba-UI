/**
 * 门户展示用服务端访问票，不沿用浏览器带来的用户票。
 * 含目录、详情、截图、已添加/已发布读取。安装和添加改走调用方自己的票，不在这里换超级管理员。
 * 访问票缺失、快过期或上游 401 时，用固定账号向认证服务重新登录。
 * 账号密码只留在本文件（Node 插件进程）和进程环境里，不打进前端包。
 * 登录换到的访问票写回 .env.local。没有新的刷新票就不改原来那一行。
 * 下一次失效仍然用账号再登，不靠刚写下的刷新票。
 */
import { constants, publicEncrypt } from "node:crypto";
import { chmodSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const REFRESH_WITHIN_MS = 3600 * 1000;
const COOLDOWN_MS = 60 * 1000;
const DEFAULT_USERNAME = "superadmin";
const DEFAULT_PASSWORD = "superadmin123";

type PortalStore = { ensure: (force: boolean) => Promise<string> };

type PortalResponse = {
  statusCode: number;
  headersSent?: boolean;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Buffer) => void;
};

type PortalRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  portalService?: boolean;
  on?(event: "data", listener: (chunk: Buffer) => void): void;
  on?(event: "end", listener: () => void): void;
  on?(event: "error", listener: (error: Error) => void): void;
};

export function isPortalCatalogPath(method: string | undefined, rawUrl: string | undefined) {
  const verb = String(method || "GET").toUpperCase();
  const full = String(rawUrl || "");
  const splitAt = full.indexOf("?");
  const path = (splitAt >= 0 ? full.slice(0, splitAt) : full).replace(/\/+$/, "") || "/";
  const query = splitAt >= 0 ? full.slice(splitAt + 1) : "";
  if (verb === "POST") {
    if (path === "/api-bh/api/resources/test") return true;
    return false;
  }
  if (verb !== "GET" && verb !== "HEAD") return false;
  if (path === "/api-ba/api/skill-store/catalog") return true;
  if (path === "/api-ba/api/registry/kb") return queryValue(query, "scope") === "market";
  if (/^\/api-ba\/api\/registry\/kb\/[^/]+$/.test(path)) return true;
  if (path === "/api-ba/api/market-publish/listings") return true;
  if (path === "/api-ba/api/published-apps") return true;
  if (/^\/api-ba\/api\/published-apps\/[^/]+$/.test(path)) return true;
  if (path === "/api-bh/api/resources") return queryValue(query, "type") === "tool";
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

function queryValue(query: string, key: string) {
  const params = new URLSearchParams(query);
  return params.get(key) ?? "";
}

function tokenExpMs(token: string) {
  const part = String(token || "").split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const data = JSON.parse(Buffer.from(padded + pad, "base64").toString("utf8")) as { exp?: unknown };
    const exp = data?.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

function needsRefresh(token: string, now = Date.now()) {
  const exp = tokenExpMs(token);
  if (exp == null) return false;
  return exp - now < REFRESH_WITHIN_MS;
}

function accessExpired(token: string, now = Date.now()) {
  const exp = tokenExpMs(token);
  if (exp == null) return false;
  return exp <= now;
}

function acceptableSecret(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\s;,]/.test(value);
}

function cookieValue(chunks: string[], name: string) {
  const marker = `${name}=`;
  const text = chunks.join("\n");
  let start = 0;
  while (start <= text.length) {
    const index = text.indexOf(marker, start);
    if (index < 0) return "";
    const previous = index > 0 ? text[index - 1] : "";
    if (previous && !/[\n;, ]/.test(previous)) {
      start = index + marker.length;
      continue;
    }
    let raw = text.slice(index + marker.length).split(";")[0]?.split("\n")[0]?.trim() ?? "";
    if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[0] === raw[raw.length - 1]) {
      raw = raw.slice(1, -1);
    }
    return raw;
  }
  return "";
}

function upsertLine(lines: string[], key: string, value: string) {
  let found = false;
  const output: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped && !stripped.startsWith("#") && stripped.includes("=")) {
      const name = stripped.split("=", 1)[0]?.trim() ?? "";
      if (name === key) {
        if (!found) output.push(`${key}=${value}`);
        found = true;
        continue;
      }
    }
    output.push(line);
  }
  if (!found) output.push(`${key}=${value}`);
  return output;
}

function writeTokens(path: string, access: string, refresh: string, expiresAtSec = 0) {
  let mode = 0o600;
  let original = "";
  try {
    mode = statSync(path).mode & 0o777;
    original = readFileSync(path, "utf8");
  } catch {
    return;
  }
  let lines = upsertLine(original.split(/\r?\n/), "VITE_BA_EMBED_TOKEN", access);
  if (refresh) lines = upsertLine(lines, "EMBED_REFRESH_TOKEN", refresh);
  if (expiresAtSec > 0) lines = upsertLine(lines, "EMBED_ACCESS_EXPIRES_AT", String(Math.floor(expiresAtSec)));
  let text = lines.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, text, { encoding: "utf8", mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // 临时文件清不掉也不把票打进日志。
    }
    throw error;
  }
}

async function exchangeRefresh(refreshToken: string, refreshUrl: string) {
  const response = await fetch(refreshUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Cookie: `blade_refresh_token=${refreshToken}`,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("refresh failed");
  const chunks = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const access = cookieValue(chunks, "blade_token");
  const rotated = cookieValue(chunks, "blade_refresh_token");
  if (!acceptableSecret(access) || !acceptableSecret(rotated)) throw new Error("refresh incomplete");
  await response.arrayBuffer().catch(() => undefined);
  return { access, refresh: rotated };
}

function encryptPassword(publicKey: string, password: string) {
  const plaintext = Buffer.from(JSON.stringify({ p: password }), "utf8");
  return publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    plaintext,
  ).toString("base64url");
}

function originOf(location: string, base: string) {
  try {
    const url = new URL(location, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

async function discoverAuthOrigin(agentOrigin: string) {
  const configured = (process.env.EMBED_AUTH_BASE ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const next = `${agentOrigin}/`;
  const response = await fetch(`${agentOrigin}/api/auth/login?next=${encodeURIComponent(next)}`, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const location = response.headers.get("location") ?? "";
  await response.arrayBuffer().catch(() => undefined);
  const origin = originOf(location, agentOrigin);
  if (!origin) throw new Error("login origin missing");
  return origin;
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 现场 8020 的 POST /api/auth/login 只在 mock 登录页挂用，表单字段是 state、username、password，当前返回 404。
 * 8020 的 GET /api/auth/login 会 302 到认证服务。认证服务先 GET /api/v1/crypto/pubkey，
 * 再 POST /api/v1/auth/login，JSON 字段是 username、password_enc、enc_kid。
 * password_enc 是对 {"p":"<口令>"} 做 RSA-OAEP-SHA256 后的 base64url。
 * 成功正文是 access_token、expires_in、token_type。有刷新票才一并带回。
 */
async function exchangeLogin(agentOrigin: string, username: string, password: string) {
  const origin = await discoverAuthOrigin(agentOrigin);
  const pubkey = await fetch(`${origin}/api/v1/crypto/pubkey`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const keyBody = await readJson(pubkey);
  const publicKey = typeof keyBody?.public_key === "string" ? keyBody.public_key : "";
  const kid = typeof keyBody?.kid === "string" ? keyBody.kid : "";
  if (!pubkey.ok || !publicKey || !kid) throw new Error("login pubkey failed");
  const response = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      username,
      password_enc: encryptPassword(publicKey, password),
      enc_kid: kid,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await readJson(response);
  const chunks = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const fromBody = typeof data?.access_token === "string" ? data.access_token : "";
  const access = fromBody || cookieValue(chunks, "blade_token");
  const fromRefresh = typeof data?.refresh_token === "string" ? data.refresh_token : "";
  const refresh = fromRefresh || cookieValue(chunks, "blade_refresh_token");
  const expiresIn = typeof data?.expires_in === "number" ? data.expires_in : Number(data?.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;
  if (!response.ok || !acceptableSecret(access)) throw new Error("login failed");
  return { access, refresh: acceptableSecret(refresh) ? refresh : "", expiresAt };
}

export function createPortalAccess(options: {
  access: string;
  refresh: string;
  envFile: string;
  refreshUrl: string;
  agentOrigin?: string;
  username?: string;
  password?: string;
  accountLogin?: boolean;
  accessExpiresAt?: number | null;
}): PortalStore {
  let currentAccess = options.access.trim();
  let currentRefresh = options.refresh.trim();
  let currentExpiresAt = options.accessExpiresAt && options.accessExpiresAt > 0 ? options.accessExpiresAt : 0;
  let lastAttempt = 0;
  let lastFailure = "";
  let dirty = false;
  let pending: Promise<string> | null = null;
  const accountLogin = options.accountLogin === true;
  const username = (options.username ?? "").trim() || DEFAULT_USERNAME;
  const password = options.password || DEFAULT_PASSWORD;
  const agentOrigin = (options.agentOrigin ?? "").trim().replace(/\/+$/, "");

  function due(now = Date.now()) {
    if (!currentAccess) return true;
    const exp = tokenExpMs(currentAccess) ?? (currentExpiresAt > 0 ? currentExpiresAt : null);
    if (exp == null) return false;
    return exp - now < REFRESH_WITHIN_MS;
  }

  function expired(now = Date.now()) {
    const exp = tokenExpMs(currentAccess) ?? (currentExpiresAt > 0 ? currentExpiresAt : null);
    if (exp == null) return false;
    return exp <= now;
  }

  function persist() {
    if (!dirty || !options.envFile) return;
    writeTokens(options.envFile, currentAccess, currentRefresh, currentExpiresAt > 0 ? currentExpiresAt / 1000 : 0);
    dirty = false;
  }

  function remember(next: { access: string; refresh: string; expiresAt?: number }) {
    currentAccess = next.access;
    if (next.refresh) currentRefresh = next.refresh;
    if (next.expiresAt && next.expiresAt > 0) currentExpiresAt = next.expiresAt;
    else if (tokenExpMs(next.access) == null) currentExpiresAt = 0;
    lastFailure = "";
    dirty = true;
    try {
      persist();
    } catch {
      dirty = true;
    }
    return currentAccess;
  }

  async function rotate(force: boolean) {
    try {
      persist();
    } catch {
      // 新票已经在内存里。写回失败下次再试，不再拿旧刷新票轮换一次。
    }
    const stale = accountLogin ? due() : needsRefresh(currentAccess);
    if (!force && currentAccess && !stale) return currentAccess;
    if (lastFailure && Date.now() - lastAttempt < COOLDOWN_MS) return currentAccess;
    lastAttempt = Date.now();
    if (accountLogin) {
      if (!agentOrigin || !username || !password) {
        lastFailure = "login failed";
        return currentAccess;
      }
      try {
        return remember(await exchangeLogin(agentOrigin, username, password));
      } catch {
        lastFailure = "login failed";
        if (currentAccess && (force || !expired())) return currentAccess;
        return currentAccess;
      }
    }
    if (!acceptableSecret(currentRefresh)) return currentAccess;
    try {
      return remember(await exchangeRefresh(currentRefresh, options.refreshUrl));
    } catch {
      lastFailure = "refresh failed";
      if (currentAccess && (force || !accessExpired(currentAccess))) return currentAccess;
      return currentAccess;
    }
  }

  return {
    ensure(force: boolean) {
      const stale = accountLogin ? due() : needsRefresh(currentAccess);
      if (!force && currentAccess && !stale && !dirty) {
        return Promise.resolve(currentAccess);
      }
      if (!pending) {
        pending = rotate(force).finally(() => {
          pending = null;
        });
      }
      return pending;
    },
  };
}

function routeOf(rawUrl: string | undefined, targets: Record<string, string>) {
  const full = String(rawUrl || "/");
  const splitAt = full.indexOf("?");
  const path = splitAt >= 0 ? full.slice(0, splitAt) : full;
  const query = splitAt >= 0 ? full.slice(splitAt) : "";
  for (const prefix of Object.keys(targets)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      const rest = path.slice(prefix.length) || "/";
      return `${targets[prefix]}${rest}${query}`;
    }
  }
  return "";
}

function headerText(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function readRequestBody(req: PortalRequest) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || !req.on) return Promise.resolve(Buffer.alloc(0));
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error, body?: Buffer) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(body ?? Buffer.alloc(0));
    };
    req.on?.("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        finish(new Error("too large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on?.("end", () => finish(undefined, Buffer.concat(chunks)));
    req.on?.("error", () => finish(new Error("read failed")));
  });
}

async function upstream(url: string, method: string, token: string, body: Buffer, contentType: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (contentType && method !== "GET" && method !== "HEAD") headers["Content-Type"] = contentType;
  const payload = method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body;
  return fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(60000) });
}

async function forwardPortalCatalog(req: PortalRequest, res: PortalResponse, store: PortalStore, targets: Record<string, string>) {
  const url = routeOf(req.url, targets);
  if (!url) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(req.method === "HEAD" ? undefined : "not found");
    return;
  }
  const method = req.method || "GET";
  const contentType = headerText(req.headers["content-type"]);
  const body = await readRequestBody(req);
  let token = await store.ensure(false);
  let response = await upstream(url, method, token, body, contentType);
  if (response.status === 401) {
    const refreshed = await store.ensure(true);
    if (refreshed && refreshed !== token) {
      await response.arrayBuffer().catch(() => undefined);
      token = refreshed;
      response = await upstream(url, method, token, body, contentType);
    }
  }
  const payload = Buffer.from(await response.arrayBuffer());
  res.statusCode = response.status;
  const type = response.headers.get("content-type");
  if (type) res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(payload.length));
  res.end(req.method === "HEAD" ? undefined : payload);
}

export function portalCatalogDev(store: PortalStore, targets: Record<string, string>) {
  return {
    name: "portal-catalog-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use((req: PortalRequest, res: PortalResponse, next: () => void) => {
        const marked = req.headers["x-blade-portal-catalog"];
        if (marked !== "1" || !isPortalCatalogPath(req.method, req.url)) {
          next();
          return;
        }
        delete req.headers["x-blade-portal-catalog"];
        const path = String(req.url || "").split("?")[0]?.replace(/\/+$/, "") || "/";
        if (path === "/api/catalog-counts") {
          req.portalService = true;
          void store
            .ensure(false)
            .then((token) => {
              if (token) req.headers.authorization = `Bearer ${token}`;
              else delete req.headers.authorization;
              next();
            })
            .catch(() => next());
          return;
        }
        void forwardPortalCatalog(req, res, store, targets).catch(() => {
          if (res.headersSent) return;
          res.statusCode = 502;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(req.method === "HEAD" ? undefined : "bad gateway");
        });
      });
    },
  };
}
