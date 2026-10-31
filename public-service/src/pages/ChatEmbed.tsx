import { useEffect, useRef, useState } from "react";
import { EMBED_ORIGIN } from "../data/embed-origin";

/** 开发时对话页连实验室。生产包只用安装时写入的嵌入页地址，不保留实验室地址。 */
function bladeOrigin(): string {
  if (import.meta.env.DEV) return "http://192.168.171.128:8020";
  try {
    const host = new URL(EMBED_ORIGIN, window.location.href).hostname;
    return host ? `http://${host}:8020` : "";
  } catch {
    return "";
  }
}

function platformAuthUrl(): string {
  if (import.meta.env.DEV) return "http://127.0.0.1:5174/embed-auth";
  return EMBED_ORIGIN ? `${EMBED_ORIGIN}/embed-auth` : "";
}

export function ChatEmbed() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [embedAuth, setEmbedAuth] = useState<"waiting" | "ok">("waiting");
  const [token, setToken] = useState("");
  const [ticketError, setTicketError] = useState("");
  const blade = bladeOrigin();

  useEffect(() => {
    document.title = "对话 · 智能模型公共服务平台";
  }, []);

  useEffect(() => {
    const authUrl = platformAuthUrl();
    if (!authUrl) {
      setTicketError("没有拿到平台嵌入票，对话页打不开。");
      return;
    }
    let cancelled = false;
    fetch(authUrl, { cache: "no-store" })
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
    if (!frame || !token || !blade) return;

    const send = () => {
      const child = frame.contentWindow;
      if (!child) return;
      child.postMessage({ type: "blade-embed-token", token }, blade);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== blade) return;
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: string } | null;
      if (!data) return;
      if (data.type === "blade-embed-ready") send();
      if (data.type === "blade-embed-authenticated") setEmbedAuth("ok");
    };

    window.addEventListener("message", onMessage);
    send();
    return () => window.removeEventListener("message", onMessage);
  }, [token, blade]);

  if (ticketError) {
    return (
      <div className="shell-embed">
        <p className="login-test-error">{ticketError}</p>
      </div>
    );
  }

  if (!token || !blade) return <div className="shell-embed" />;

  const src = `${blade}/chat?iframe=1&embed_parent=${encodeURIComponent(window.location.origin)}`;

  return (
    <div className="shell-embed" data-embed-auth={embedAuth}>
      <iframe ref={frameRef} className="shell-embed-frame" title="对话" src={src} scrolling="no" />
    </div>
  );
}
