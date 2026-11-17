import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LAB_USERS, useLabAuth } from "../lib/lab-auth";

type StepLog = {
  key: string;
  title: string;
  status: number;
  ok: boolean;
  summary: string;
};

const CUSTOMER = "/login-test-api/customer";
const BRIDGE = "/login-test-api/bridge";
const BLADE_AUTH = "/login-test-api/blade-auth";
const BLADE_SKILLS = "/login-test-api/blade-skills";

const STEP_ORDER = ["register", "login", "exchange", "me", "skills"];

function maskToken(token: string): string {
  if (!token) return "";
  return `${token.slice(0, 8)}…${token.slice(-8)}`;
}

function isTokenField(key: string): boolean {
  const name = key.toLowerCase();
  if (name === "token_type") return false;
  return name === "token" || name === "access_token" || name === "refresh_token" || name === "id_token" || name.endsWith("_token");
}

function redact(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") {
    let next = value;
    for (const secret of secrets) {
      if (secret && next.includes(secret)) next = next.split(secret).join(maskToken(secret));
    }
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isTokenField(key) && typeof item === "string") out[key] = maskToken(item);
      else out[key] = redact(item, secrets);
    }
    return out;
  }
  return value;
}

function summarize(body: unknown, secrets: string[]): string {
  const safe = redact(body, secrets);
  const text = typeof safe === "string" ? safe : JSON.stringify(safe, null, 2);
  if (!text) return "（空响应）";
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function tokenFrom(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as { access_token?: unknown }).access_token;
  return typeof value === "string" ? value : "";
}

function upsert(logs: StepLog[], next: StepLog): StepLog[] {
  const rest = logs.filter((item) => item.key !== next.key);
  return [...rest, next].sort((a, b) => STEP_ORDER.indexOf(a.key) - STEP_ORDER.indexOf(b.key));
}

export function LoginTestPage() {
  const navigate = useNavigate();
  const lab = useLabAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [customerToken, setCustomerToken] = useState("");
  const [platformToken, setPlatformToken] = useState("");
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [skillsStatus, setSkillsStatus] = useState<number | null>(null);
  const [authMeOk, setAuthMeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "用户登录测试 · 智能模型公共服务平台";
  }, []);

  const secrets = [customerToken, platformToken].filter(Boolean);
  const canSubmit = username.trim().length > 0 && password.length > 0;

  function pushLog(next: StepLog) {
    setLogs((current) => upsert(current, next));
  }

  async function registerUser() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${CUSTOMER}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, role: role.trim() || "user" }),
      });
      const body = await readBody(response);
      pushLog({
        key: "register",
        title: "注册用户",
        status: response.status,
        ok: response.status === 201,
        summary: summarize(body, secrets),
      });
      if (response.status !== 201) setError("注册未成功，请看下方状态码。");
    } catch (err) {
      pushLog({
        key: "register",
        title: "注册用户",
        status: 0,
        ok: false,
        summary: err instanceof Error ? err.message : "网络错误",
      });
      setError("无法连接用户系统。");
    } finally {
      setBusy(false);
    }
  }

  async function loginUser() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    setCustomerToken("");
    setPlatformToken("");
    setAuthMeOk(false);
    setSkillsStatus(null);
    try {
      const response = await fetch(`${CUSTOMER}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await readBody(response);
      const token = tokenFrom(body);
      if (response.ok && token) setCustomerToken(token);
      pushLog({
        key: "login",
        title: "登录",
        status: response.status,
        ok: response.ok && Boolean(token),
        summary: summarize(body, token ? [token] : []),
      });
      if (!response.ok || !token) setError("登录未成功，请看下方状态码。");
    } catch (err) {
      pushLog({
        key: "login",
        title: "登录",
        status: 0,
        ok: false,
        summary: err instanceof Error ? err.message : "网络错误",
      });
      setError("无法连接用户系统。");
    } finally {
      setBusy(false);
    }
  }

  async function exchangeToken() {
    if (!customerToken || busy) return;
    setBusy(true);
    setError("");
    setPlatformToken("");
    setAuthMeOk(false);
    setSkillsStatus(null);
    try {
      const response = await fetch(`${BRIDGE}/exchange`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      const body = await readBody(response);
      const token = tokenFrom(body);
      if (response.ok && token) setPlatformToken(token);
      pushLog({
        key: "exchange",
        title: "换取平台令牌",
        status: response.status,
        ok: response.ok && Boolean(token),
        summary: summarize(body, [customerToken, token].filter(Boolean)),
      });
      if (!response.ok || !token) setError("换票未成功，请看下方状态码。");
    } catch (err) {
      pushLog({
        key: "exchange",
        title: "换取平台令牌",
        status: 0,
        ok: false,
        summary: err instanceof Error ? err.message : "网络错误",
      });
      setError("无法连接鉴权桥。");
    } finally {
      setBusy(false);
    }
  }

  async function queryPlatform() {
    if (!platformToken || busy) return;
    setBusy(true);
    setError("");
    setAuthMeOk(false);
    setSkillsStatus(null);
    try {
      const meResponse = await fetch(`${BLADE_AUTH}/api/auth/me`, {
        headers: { Authorization: `Bearer ${platformToken}` },
      });
      const meBody = await readBody(meResponse);
      pushLog({
        key: "me",
        title: "查询平台身份",
        status: meResponse.status,
        ok: meResponse.ok,
        summary: summarize(meBody, secrets),
      });
      setAuthMeOk(meResponse.ok);
      if (!meResponse.ok) setError("平台身份查询未成功，请看下方状态码。");

      try {
        const skillsResponse = await fetch(`${BLADE_SKILLS}/api/me/skills`, {
          headers: { Authorization: `Bearer ${platformToken}` },
        });
        const skillsBody = await readBody(skillsResponse);
        setSkillsStatus(skillsResponse.status);
        pushLog({
          key: "skills",
          title: "查询技能列表",
          status: skillsResponse.status,
          ok: skillsResponse.ok,
          summary: summarize(skillsBody, secrets),
        });
      } catch (err) {
        pushLog({
          key: "skills",
          title: "查询技能列表",
          status: 0,
          ok: false,
          summary: err instanceof Error ? err.message : "网络错误",
        });
      }
    } catch (err) {
      pushLog({
        key: "me",
        title: "查询平台身份",
        status: 0,
        ok: false,
        summary: err instanceof Error ? err.message : "网络错误",
      });
      setError("无法连接 Blade 服务。");
    } finally {
      setBusy(false);
    }
  }

  const showShadowLine = authMeOk && skillsStatus === 503;
  const held = busy || lab.busy;

  async function enterLab(name: string) {
    const ok = await lab.enterAs(name);
    if (ok) navigate("/");
  }

  async function loginAndOpen() {
    const ok = await lab.loginWithPassword(username, password);
    if (ok) navigate("/");
  }

  return (
    <div className="login-test-page">
      <div className="page-head">
        <div>
          <h1>用户登录测试</h1>
          <p>注册大系统用户、登录、换成平台令牌，再查询智能体服务上的身份。令牌只显示首尾各 8 位。进入对话后，嵌入页沿用同一张平台 JWT。</p>
        </div>
      </div>

      <section className="panel">
        <h2>账号</h2>
        <div className="login-test-form">
          <div className="form-row">
            <label htmlFor="login-test-username">用户名</label>
            <input
              id="login-test-username"
              className="field"
              value={username}
              autoComplete="off"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="login-test-password">密码</label>
            <input
              id="login-test-password"
              className="field"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="login-test-role">角色</label>
            <input
              id="login-test-role"
              className="field"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" type="button" disabled={!canSubmit || held} onClick={() => void registerUser()}>
            注册
          </button>
          <button className="btn" type="button" disabled={!canSubmit || held} onClick={() => void loginUser()}>
            登录
          </button>
          <button className="btn" type="button" disabled={!customerToken || held} onClick={() => void exchangeToken()}>
            换票
          </button>
          <button className="btn" type="button" disabled={!platformToken || held} onClick={() => void queryPlatform()}>
            查询平台身份
          </button>
          <button className="btn btn-primary" type="button" disabled={!canSubmit || held} onClick={() => void loginAndOpen()}>
            登录并进入对话
          </button>
        </div>
        {error ? <p className="login-test-error">{error}</p> : null}
        {lab.error ? <p className="login-test-error">{lab.error}</p> : null}
      </section>

      <section className="panel">
        <h2>实验室账号</h2>
        <p>换成带 bo 用户 id 的平台 JWT，再用和正式集成一样的 postMessage 交给嵌入页。</p>
        <div className="page-actions">
          {LAB_USERS.map((name) => (
            <button key={name} className="btn" type="button" disabled={held} onClick={() => void enterLab(name)}>
              {name} 进入对话
            </button>
          ))}
          {lab.session ? (
            <button className="btn" type="button" onClick={() => navigate("/")}>
              打开当前对话（{lab.session.username}）
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel" aria-live="polite">
        <h2>调用结果</h2>
        {logs.length === 0 ? <p className="login-test-empty">还没有调用。按上面的按钮依次执行。</p> : null}
        {logs.map((item) => (
          <article className="login-test-step" key={item.key}>
            <header>
              <b>{item.title}</b>
              <span className={item.ok ? "is-ok" : "is-bad"}>HTTP {item.status}</span>
            </header>
            <pre>{item.summary}</pre>
          </article>
        ))}
        {showShadowLine ? (
          <p className="login-test-alert">
            技能接口返回 503：当前没有影子用户。平台 JWT 的 sub 仍是大系统用户 id，还不是 bo 用户 id。因此
            GET /api/me/skills 与 POST /api/sessions 都会是 503，直到在 bo 中建好影子用户，并且令牌 sub 与该用户 id 一致。
          </p>
        ) : null}
      </section>
    </div>
  );
}
