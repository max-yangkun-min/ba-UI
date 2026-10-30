import { useEffect, useRef, useState } from "react";
import { LAB_USERS, useLabAuth } from "../lib/lab-auth";

const BA_ORIGIN = "http://192.168.171.128:8020";
const PARENT_ORIGIN = "http://127.0.0.1:5173";
const CHAT_SRC = `${BA_ORIGIN}/chat?iframe=1&embed_parent=${encodeURIComponent(PARENT_ORIGIN)}`;
const PLATFORM_AUTH = "http://127.0.0.1:5174/embed-auth";

export function ChatEmbed() {
  const { session, logout } = useLabAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [embedAuth, setEmbedAuth] = useState<"waiting" | "ok">("waiting");
  const [token, setToken] = useState("");
  const [ticketError, setTicketError] = useState("");

  useEffect(() => {
    document.title = "对话 · 智能模型公共服务平台";
  }, []);

  useEffect(() => {
    if (!session) return;
    if (!(LAB_USERS as readonly string[]).includes(session.username)) return;
    logout();
  }, [session, logout]);

  useEffect(() => {
    let cancelled = false;
    fetch(PLATFORM_AUTH, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { token?: unknown } | null) => {
        if (cancelled) return;
        const value = typeof data?.token === "string" ? data.token.trim() : "";
        if (!value) {
          setTicketError("没有拿到平台嵌入票，对话页打不开。");
          return;
        }
        setToken(value);
      })
      .catch(() => {
        if (!cancelled) setTicketError("没有拿到平台嵌入票，对话页打不开。");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !token) return;

    const send = () => {
      const child = frame.contentWindow;
      if (!child) return;
      child.postMessage({ type: "blade-embed-token", token }, BA_ORIGIN);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== BA_ORIGIN) return;
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (!data) return;
      if (data.type === "blade-embed-ready") send();
      if (data.type === "blade-embed-authenticated") setEmbedAuth("ok");
    };

    window.addEventListener("message", onMessage);
    send();
    return () => window.removeEventListener("message", onMessage);
  }, [token]);

  if (ticketError) {
    return (
      <div className="shell-embed">
        <p className="login-test-error">{ticketError}</p>
      </div>
    );
  }

  if (!token) return <div className="shell-embed" />;

  return (
    <div className="shell-embed" data-embed-auth={embedAuth}>
      <iframe ref={frameRef} className="shell-embed-frame" title="对话" src={CHAT_SRC} scrolling="no" />
    </div>
  );
}
