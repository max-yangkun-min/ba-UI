import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const LAB_USERS = ["lab1028-a", "lab1028-b"] as const;

type LabSession = {
  username: string;
  token: string;
};

type LabAuthValue = {
  ready: boolean;
  session: LabSession | null;
  busy: boolean;
  error: string;
  enterAs: (username: string) => Promise<boolean>;
  loginWithPassword: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
};

const STORAGE_KEY = "portal-session";
const CUSTOMER = "/login-test-api/customer";
const BRIDGE = "/login-test-api/bridge";

const LabAuthContext = createContext<LabAuthValue | null>(null);

function readStored(): LabSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { username?: unknown; token?: unknown };
    if (typeof data.username !== "string" || typeof data.token !== "string" || !data.token) return null;
    return { username: data.username, token: data.token };
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    const data = JSON.parse(text) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function tokenOf(body: Record<string, unknown> | null): string {
  const value = body?.access_token;
  return typeof value === "string" ? value : "";
}

export function LabAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<LabSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSession(readStored());
    setReady(true);
  }, []);

  function writeSession(next: LabSession | null) {
    setSession(next);
    if (!next) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function enterAs(username: string): Promise<boolean> {
    if (!import.meta.env.DEV) return false;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/login-test-api/lab-enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = await readJson(response);
      const token = tokenOf(body);
      if (!response.ok || !token) {
        setError(`登录未成功（HTTP ${response.status}）。`);
        return false;
      }
      writeSession({ username, token });
      return true;
    } catch {
      setError("无法连接登录服务。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function loginWithPassword(username: string, password: string): Promise<boolean> {
    const name = username.trim();
    if (!name || !password) return false;
    setBusy(true);
    setError("");
    try {
      const login = await fetch(`${CUSTOMER}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, password }),
      });
      const loginBody = await readJson(login);
      const customerToken = tokenOf(loginBody);
      if (!login.ok || !customerToken) {
        setError(`登录未成功（HTTP ${login.status}）。`);
        return false;
      }
      const exchange = await fetch(`${BRIDGE}/exchange`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      const exchangeBody = await readJson(exchange);
      const token = tokenOf(exchangeBody);
      if (!exchange.ok || !token) {
        setError(`换票未成功（HTTP ${exchange.status}）。`);
        return false;
      }
      writeSession({ username: name, token });
      return true;
    } catch {
      setError("无法连接登录或换票服务。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setError("");
    writeSession(null);
  }

  return (
    <LabAuthContext.Provider value={{ ready, session, busy, error, enterAs, loginWithPassword, logout }}>
      {children}
    </LabAuthContext.Provider>
  );
}

export function useLabAuth(): LabAuthValue {
  const value = useContext(LabAuthContext);
  if (!value) throw new Error("useLabAuth outside provider");
  return value;
}
