import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const BLADE_AGENT = "http://192.168.171.128:8020";
const BLADE_HUB = "http://192.168.171.128:8010";
const AUTH_BRIDGE = "http://192.168.171.128:9000";
const TEST_CUSTOMER = "http://192.168.171.128:9101";

/** 本地开发时按 VITE_EMBED_ORIGIN 下发嵌入页地址。生产包不读取该变量。 */
function shellSiteDev(origin: string) {
  const body = `window.__EMBED_ORIGIN__ = ${JSON.stringify(origin.replace(/\/$/, ""))};\n`;
  return {
    name: "shell-site-dev",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use("/shell-site.js", (req: { method?: string }, res: {
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const embedOrigin = (env.VITE_EMBED_ORIGIN ?? "").trim();
  return {
  plugins: [react(), shellSiteDev(embedOrigin), labEnterPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/login-test-api/customer": {
        target: TEST_CUSTOMER,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/login-test-api\/customer/, ""),
      },
      "/login-test-api/bridge": {
        target: AUTH_BRIDGE,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/login-test-api\/bridge/, ""),
      },
      "/login-test-api/blade-auth": {
        target: BLADE_AGENT,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/login-test-api\/blade-auth/, ""),
      },
      "/login-test-api/blade-skills": {
        target: BLADE_HUB,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/login-test-api\/blade-skills/, ""),
      },
    },
  },
  };
});

function labPasswords(): Record<string, string> {
  const file = path.resolve(".lab-login.local.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as { users?: { username?: string; password?: string }[] };
  const out: Record<string, string> = {};
  for (const item of data.users ?? []) {
    if (item.username && item.password) out[item.username] = item.password;
  }
  return out;
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function postJson(url: string, payload: unknown, headers?: Record<string, string>): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

/** 开发服务代实验室账号登录并换票。口令只留在本机 gitignore 文件里，不进前端包。 */
function labEnterPlugin() {
  return {
    name: "lab-enter",
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use("/login-test-api/lab-enter", async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        let username = "";
        try {
          const raw = await readBody(req);
          const body = raw ? (JSON.parse(raw) as { username?: unknown }) : {};
          username = typeof body.username === "string" ? body.username.trim() : "";
        } catch {
          sendJson(res, 400, { detail: "body must be JSON" });
          return;
        }
        let password = "";
        try {
          password = labPasswords()[username] ?? "";
        } catch {
          sendJson(res, 503, { detail: "lab accounts are not ready" });
          return;
        }
        if (!username || !password) {
          sendJson(res, 404, { detail: "unknown lab user" });
          return;
        }
        try {
          let login = await postJson(`${TEST_CUSTOMER}/api/login`, { username, password });
          if (login.status === 401) {
            const created = await postJson(`${TEST_CUSTOMER}/api/users`, { username, password, role: "user" });
            if (created.status !== 201 && created.status !== 409) {
              sendJson(res, created.status, { detail: "register failed" });
              return;
            }
            login = await postJson(`${TEST_CUSTOMER}/api/login`, { username, password });
          }
          const customerToken = typeof login.data?.access_token === "string" ? login.data.access_token : "";
          if (login.status !== 200 || !customerToken) {
            sendJson(res, login.status || 401, { detail: "login failed" });
            return;
          }
          const exchange = await fetch(`${AUTH_BRIDGE}/exchange`, {
            method: "POST",
            headers: { Authorization: `Bearer ${customerToken}` },
          });
          const text = await exchange.text();
          let data: Record<string, unknown> | null = null;
          try {
            const parsed = text ? (JSON.parse(text) as unknown) : null;
            if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
          } catch {
            data = null;
          }
          const accessToken = typeof data?.access_token === "string" ? data.access_token : "";
          if (!exchange.ok || !accessToken) {
            sendJson(res, exchange.status, { detail: "exchange failed" });
            return;
          }
          sendJson(res, 200, { username, access_token: accessToken, token_type: "Bearer" });
        } catch {
          sendJson(res, 502, { detail: "lab login unreachable" });
        }
      });
    },
  };
}
