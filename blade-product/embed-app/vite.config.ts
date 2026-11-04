import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const embedDir = dirname(fileURLToPath(import.meta.url));

const BLADE_AGENT = "http://192.168.171.128:8020";
const BLADE_HUB = "http://192.168.171.128:8010";
const BLADE_OS = "http://192.168.171.128";
const LLM_GATEWAY = "http://192.168.171.128:30000";

/**
 * 开发时代理把令牌放进 Authorization，前端地址里不出现令牌，这里也不打印。
 * 浏览器已经带了当前用户的票时，沿用那张票；否则仍用整站超级管理员票。
 */
function proxyTo(target: string, token: string, strip: RegExp): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(strip, ""),
    configure(proxy) {
      proxy.on("proxyReq", (proxyReq, req) => {
        const incoming = callerBearer(headerValue(req.headers.authorization));
        const use = incoming || token;
        if (use) proxyReq.setHeader("Authorization", `Bearer ${use}`);
      });
    },
  };
}

/** 允许被外层页面用 iframe 打开。不设置 X-Frame-Options，也不使用 frame-ancestors 'none'。 */
const embedHeaders = {
  "Content-Security-Policy": "frame-ancestors *",
};

/** 本地开发时按 VITE_BA_ORIGIN 下发主机名。生产包不读取该变量，由安装脚本写 blade-site.js。 */
function hostFromOrigin(origin: string): string {
  const match = origin.trim().match(/^https?:\/\/([^/:]+)/i);
  return match ? match[1] : "";
}

function bladeSiteDev(origin: string) {
  const host = hostFromOrigin(origin);
  const body = `window.__BLADE_PUBLIC_HOST__ = ${JSON.stringify(host)};\n`;
  return {
    name: "blade-site-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use("/blade-site.js", (req: { method?: string }, res: {
        statusCode: number;
        setHeader: (name: string, value: string) => void;
        end: (body?: string) => void;
      }, next: () => void) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(req.method === "HEAD" ? undefined : body);
      });
    },
  };
}

const AGENT_IDENTITY_KEYS = [
  "id",
  "listing_id",
  "service_id",
  "session_id",
  "os_app_id",
  "analytics_app_id",
  "app_id",
];

/** 与 serve.py GET /api/catalog-counts 同一口径。调用方不需要带令牌。 */
function catalogCountsDev(token: string) {
  return {
    name: "catalog-counts-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use("/api/catalog-counts", (req: { method?: string; headers?: Record<string, string | string[] | undefined> }, res: {
        statusCode: number;
        setHeader: (name: string, value: string) => void;
        end: (body?: string) => void;
      }) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Accept, Authorization");
          res.end();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(req.method === "HEAD" ? undefined : "method not allowed");
          return;
        }
        const bearer = callerBearer(headerValue(req.headers?.authorization));
        void writeCatalogCounts(bearer || token, req.method, res);
      });
    },
  };
}

async function writeCatalogCounts(
  token: string,
  method: string | undefined,
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body?: string) => void;
  },
) {
  const send = (status: number, payload: unknown) => {
    const body = JSON.stringify(payload);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Length", String(Buffer.byteLength(body)));
    res.end(method === "HEAD" ? undefined : body);
  };
  if (!token) {
    send(503, { error: "catalog unavailable" });
    return;
  }
  try {
    const [skills, plugins, agents] = await Promise.all([
      readUpstreamJson(`${BLADE_AGENT}/api/skill-store/catalog`, token),
      readUpstreamJson(`${BLADE_HUB}/api/plugins`, token),
      readUpstreamJson(`${BLADE_OS}/api/v1/market/listings?sort=recent`, token),
    ]);
    send(200, {
      skills: countPublicSkills(skills),
      plugins: countPublicPlugins(plugins),
      agents: countPublicAgents(agents),
    });
  } catch {
    send(502, { error: "catalog unavailable" });
  }
}

async function readUpstreamJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok || /<html|<!doctype/i.test(text)) throw new Error("upstream");
  return JSON.parse(text) as unknown;
}

function countPublicSkills(payload: unknown) {
  const data = asRecord(payload);
  if (!data || data.ok === false || !Array.isArray(data.skills)) throw new Error("skills");
  return data.skills.filter((item) => {
    const row = asRecord(item);
    return row?.is_preset === true || row?.is_owner === false;
  }).length;
}

function countPublicPlugins(payload: unknown) {
  const data = asRecord(payload);
  if (!data) throw new Error("plugins");
  if (data.builtin == null) return 0;
  if (!Array.isArray(data.builtin)) throw new Error("plugins");
  return data.builtin.length;
}

function countPublicAgents(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : asRecord(payload)?.items;
  if (!Array.isArray(rows)) throw new Error("agents");
  const kept: Array<{ id: string; ids: string[]; name: string }> = [];
  for (const item of rows) {
    const row = asRecord(item);
    if (!row || !isPublicAgent(row)) continue;
    const id = plainText(row.id);
    const ids = identityIds(row);
    const name = canonicalName(plainText(row.name));
    const duplicate = kept.some(
      (other) =>
        (id !== "" && other.id === id) ||
        ids.some((value) => other.ids.includes(value)) ||
        (name !== "" && name === other.name),
    );
    if (!duplicate) kept.push({ id, ids, name });
  }
  return kept.length;
}

function isPublicAgent(row: Record<string, unknown>) {
  if (row.is_preset === true) return true;
  const status = plainText(row.status).toLowerCase();
  return status === "" || status === "published";
}

function identityIds(row: Record<string, unknown>) {
  const ids: string[] = [];
  for (const key of AGENT_IDENTITY_KEYS) {
    const value = plainText(row[key]);
    if (value && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

function canonicalName(name: string) {
  return name.trim().replace(/[\s\u3000]+/g, "").toLocaleLowerCase("zh-CN");
}

function plainText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const BATCH_DELETE_PATH = "/api/sessions/batch-delete";
const BATCH_DELETE_LIMIT = 100;
const BATCH_DELETE_BODY_LIMIT = 32 * 1024;

type BatchRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

type BatchReq = {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Buffer) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
};

class BatchDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchDeleteError";
  }
}

/**
 * 与 serve.py POST /api/sessions/batch-delete 同一口径。
 * 只使用调用方的 Authorization: Bearer，不改用 VITE_BA_EMBED_TOKEN。
 */
function batchDeleteDev() {
  return {
    name: "batch-delete-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use(
        BATCH_DELETE_PATH,
        (req: BatchReq, res: BatchRes, next: () => void) => {
          if (!isExactBatchPath(req)) {
            next();
            return;
          }
          void handleBatchDelete(req, res).catch(() => {
            try {
              sendBatchJson(res, 500, { error: "batch delete failed" });
            } catch {
              // 响应已经开始写出。
            }
          });
        },
      );
    },
  };
}

function isExactBatchPath(req: { url?: string; originalUrl?: string }) {
  const full = (req.originalUrl || "").split("#")[0].split("?")[0];
  if (full) return full === BATCH_DELETE_PATH;
  const rest = (req.url || "").split("#")[0].split("?")[0];
  return rest === "" || rest === "/";
}

function validSessionId(value: string) {
  if (!value || value.length > 128 || value === "." || value === "..") return false;
  return !/[\u0000-\u0020/\\?#%]/.test(value);
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function callerBearer(header: string) {
  const trimmed = header.trim();
  const space = trimmed.search(/\s/);
  if (space <= 0) return "";
  const scheme = trimmed.slice(0, space);
  const token = trimmed.slice(space).trim();
  if (scheme.toLowerCase() !== "bearer") return "";
  if (!token || token.length > 8192 || /[\s;,]/.test(token)) return "";
  return token;
}

function contentLength(header: string) {
  if (!header) return 0;
  if (!/^\d+$/.test(header)) return null;
  const length = Number(header);
  if (!Number.isSafeInteger(length)) return null;
  return length;
}

function readLimitedBody(req: BatchReq, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(Buffer.concat(chunks));
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        finish(new Error("too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish());
    req.on("error", () => finish(new Error("read failed")));
  });
}

function parseBatchDeleteBody(raw: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch {
    throw new BatchDeleteError("invalid json");
  }
  const data = asRecord(payload);
  if (!data) throw new BatchDeleteError("invalid json");
  const sessionIds = data.session_ids;
  if (!Array.isArray(sessionIds)) throw new BatchDeleteError("session_ids required");
  if (sessionIds.length === 0) throw new BatchDeleteError("session_ids required");
  if (sessionIds.length > BATCH_DELETE_LIMIT) throw new BatchDeleteError("too many session ids");
  const cleaned: string[] = [];
  for (const item of sessionIds) {
    if (typeof item !== "string" || !validSessionId(item)) {
      throw new BatchDeleteError("invalid session id");
    }
    cleaned.push(item);
  }
  let deleteWorkspace = false;
  if ("delete_workspace" in data && data.delete_workspace != null) {
    if (typeof data.delete_workspace !== "boolean") {
      throw new BatchDeleteError("invalid delete_workspace");
    }
    deleteWorkspace = data.delete_workspace;
  }
  return { sessionIds: cleaned, deleteWorkspace };
}

function sendBatchJson(res: BatchRes, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.end(body);
}

function upstreamErrorText(status: number, text: string) {
  const fallback = `upstream ${status}`;
  try {
    const record = asRecord(JSON.parse(text) as unknown);
    if (!record) return fallback;
    for (const key of ["error", "detail", "message"]) {
      const value = record[key];
      if (typeof value !== "string") continue;
      const message = value.trim().replace(/\s+/g, " ");
      if (!message || message.length > 180) return fallback;
      if (message.toLowerCase().includes("bearer ") || message.split(".").length > 2) {
        return fallback;
      }
      return message;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

async function upstreamFailure(response: Response, status: number) {
  let text = "";
  try {
    const reader = response.body?.getReader();
    if (reader) {
      const first = await reader.read();
      await reader.cancel().catch(() => undefined);
      if (first.value) text = new TextDecoder().decode(first.value.subarray(0, 512));
    }
  } catch {
    return `upstream ${status}`;
  }
  return upstreamErrorText(status, text);
}

async function deleteUpstreamSession(sessionId: string, deleteWorkspace: boolean, token: string) {
  const url = new URL(`/api/sessions/${encodeURIComponent(sessionId)}`, BLADE_AGENT);
  url.searchParams.set("delete_workspace", deleteWorkspace ? "true" : "false");
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: true as const };
    }
    return {
      ok: false as const,
      status: response.status,
      error: await upstreamFailure(response, response.status),
    };
  } catch {
    return { ok: false as const, status: 502, error: "upstream unavailable" };
  }
}

async function handleBatchDelete(req: BatchReq, res: BatchRes) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("method not allowed");
    return;
  }
  const token = callerBearer(headerValue(req.headers.authorization));
  const length = contentLength(headerValue(req.headers["content-length"]));
  if (length === null || length > BATCH_DELETE_BODY_LIMIT) {
    sendBatchJson(res, token ? 400 : 401, { error: token ? "invalid body" : "unauthorized" });
    return;
  }
  let raw: Buffer;
  try {
    raw = await readLimitedBody(req, BATCH_DELETE_BODY_LIMIT);
  } catch {
    sendBatchJson(res, token ? 400 : 401, { error: token ? "invalid body" : "unauthorized" });
    return;
  }
  if (!token) {
    sendBatchJson(res, 401, { error: "unauthorized" });
    return;
  }
  let parsed: { sessionIds: string[]; deleteWorkspace: boolean };
  try {
    parsed = parseBatchDeleteBody(raw.toString("utf8"));
  } catch (error) {
    const message = error instanceof BatchDeleteError ? error.message : "invalid json";
    sendBatchJson(res, 400, { error: message });
    return;
  }
  const deleted: string[] = [];
  const failed: Array<{ id: string; status: number; error: string }> = [];
  for (const id of parsed.sessionIds) {
    const result = await deleteUpstreamSession(id, parsed.deleteWorkspace, token);
    if (result.ok) deleted.push(id);
    else failed.push({ id, status: result.status, error: result.error });
  }
  sendBatchJson(res, 200, { deleted, failed });
}

function cleanSpaceUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 2048) return "";
  if (/[\u0000-\u0020<>"'`]/.test(text)) return "";
  const lower = text.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) return "";
  return text;
}

function readSpaceFile(path: string): { dev: string; admin: string } | null {
  if (!existsSync(path)) return null;
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const body = raw
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("//");
    })
    .join("\n");
  try {
    const data = JSON.parse(body) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const record = data as Record<string, unknown>;
    return { dev: cleanSpaceUrl(record.dev), admin: cleanSpaceUrl(record.admin) };
  } catch {
    return null;
  }
}

/** 每次请求重读 JSON。进程环境里的 DEV_SPACE_URL、ADMIN_SPACE_URL 优先。 */
function currentSpaceUrls(): { dev: string; admin: string } {
  const primary = join(embedDir, "space-urls.json");
  const example = join(embedDir, "space-urls.json.example");
  const fromFile = readSpaceFile(primary) ?? readSpaceFile(example) ?? { dev: "", admin: "" };
  const dev = Object.prototype.hasOwnProperty.call(process.env, "DEV_SPACE_URL")
    ? cleanSpaceUrl(process.env.DEV_SPACE_URL)
    : fromFile.dev;
  const admin = Object.prototype.hasOwnProperty.call(process.env, "ADMIN_SPACE_URL")
    ? cleanSpaceUrl(process.env.ADMIN_SPACE_URL)
    : fromFile.admin;
  return { dev, admin };
}

function isSpaceUrlsRequest(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0];
  return path === "/" || path === "" || path === "/api/space-urls";
}

/** 开发服务每次请求读取示例地址。不把地址打进前端包。 */
function spaceUrlsDev() {
  return {
    name: "space-urls-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use("/api/space-urls", (req: { method?: string; url?: string }, res: {
        statusCode: number;
        setHeader: (name: string, value: string) => void;
        end: (body?: string) => void;
      }, next: () => void) => {
        if (!isSpaceUrlsRequest(req.url)) {
          next();
          return;
        }
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Accept");
          res.end();
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const body = JSON.stringify(currentSpaceUrls());
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(req.method === "HEAD" ? undefined : body);
      });
    },
  };
}

/** 开发服务同源下发令牌。值只留在 Node 进程里，不打进前端包。 */
function embedAuthDev(token: string) {
  return {
    name: "embed-auth-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use("/embed-auth", (req: { method?: string }, res: {
        statusCode: number;
        setHeader: (name: string, value: string) => void;
        end: (body?: string) => void;
      }, next: () => void) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const body = JSON.stringify({ token });
        res.statusCode = token ? 200 : 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(req.method === "HEAD" ? undefined : body);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const token = (env.VITE_BA_EMBED_TOKEN ?? "").trim();

  return {
    plugins: [
      react(),
      embedAuthDev(token),
      catalogCountsDev(token),
      batchDeleteDev(),
      bladeSiteDev(env.VITE_BA_ORIGIN ?? ""),
      spaceUrlsDev(),
    ],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      headers: embedHeaders,
      proxy: {
        "/api-ba": proxyTo(BLADE_AGENT, token, /^\/api-ba/),
        "/api-llm": proxyTo(LLM_GATEWAY, token, /^\/api-llm/),
        "/api-bh": proxyTo(BLADE_HUB, token, /^\/api-bh/),
        "/api-bos": proxyTo(BLADE_OS, token, /^\/api-bos/),
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      headers: embedHeaders,
    },
  };
});
