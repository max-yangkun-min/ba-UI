import { useEffect, useRef, useState, type RefObject } from "react";
import { useLabAuth } from "./lab-auth";

/** 门户目录已移交。外壳不再把资源路径当成门户页。 */
export function portalEmbedPath(_pathname: string) {
  return false;
}

function outerOrigin() {
  try {
    const hinted = new URLSearchParams(window.location.search).get("embed_parent");
    if (hinted) return new URL(hinted).origin;
  } catch {
    // 父页面地址不完整时改用引用页。
  }
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
  return "*";
}

let shellLogoutSent = false;

function relayShellLogout() {
  if (shellLogoutSent || window.parent === window) return;
  shellLogoutSent = true;
  window.parent.postMessage({ type: "blade-embed-logout", service: "shell" }, outerOrigin());
}

/**
 * 外壳应答嵌入页的 blade-embed-ready。
 * 对话页和应用开发发的是同一条 { type: "blade-embed-token", token }。
 * 票来自实验室登录，或来自再外层父页面已经换好的单点登录票。
 * 没有用户票时才回 { admin: true }。对话和应用开发没有用户票时不拿超级管理员去写数据。
 */
export function useEmbedGrant(frameRef: RefObject<HTMLIFrameElement | null>, src: string, _pathname: string) {
  const { ready, session, logout } = useLabAuth();
  const [hostToken, setHostToken] = useState("");
  const actorToken = (ready && session?.token) || hostToken;
  const signedInChild = useRef(false);

  useEffect(() => {
    if (window.parent === window) return;
    const origin = outerOrigin();
    let stopped = false;
    const onHost = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (origin !== "*" && event.origin !== origin) return;
      const data = event.data as { type?: string; token?: unknown } | null;
      if (!data || data.type !== "blade-embed-token" || typeof data.token !== "string") return;
      const token = data.token.trim().replace(/^Bearer\s+/i, "");
      if (!token) return;
      stopped = true;
      setHostToken(token);
    };
    const announce = () => {
      if (stopped) return;
      window.parent.postMessage({ type: "blade-embed-ready", service: "shell" }, origin);
    };
    announce();
    const timer = window.setInterval(announce, 250);
    const stopTimer = window.setTimeout(() => window.clearInterval(timer), 4000);
    window.addEventListener("message", onHost);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearTimeout(stopTimer);
      window.removeEventListener("message", onHost);
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let targetOrigin = "";
    try {
      targetOrigin = new URL(frame.src, window.location.href).origin;
    } catch {
      return;
    }
    const send = () => {
      const child = frame.contentWindow;
      if (!child) return;
      if (actorToken) {
        signedInChild.current = true;
        child.postMessage({ type: "blade-embed-token", token: actorToken }, targetOrigin);
        return;
      }
      if (!ready) return;
      if (signedInChild.current) {
        signedInChild.current = false;
        child.postMessage({ type: "blade-embed-logout", service: "shell" }, targetOrigin);
      }
      child.postMessage({ type: "blade-embed-token", admin: true }, targetOrigin);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; service?: string } | null;
      if (!data) return;
      if (window.parent !== window && event.source === window.parent && data.type === "blade-embed-logout") {
        const child = frame.contentWindow;
        signedInChild.current = false;
        if (child) child.postMessage({ type: "blade-embed-logout", service: "shell" }, targetOrigin);
        setHostToken("");
        if (session) logout();
        return;
      }
      if (event.source !== frame.contentWindow) return;
      if (event.origin !== targetOrigin) return;
      if (data.type === "blade-embed-logout" && data.service === "shell") {
        relayShellLogout();
        return;
      }
      if (data.type !== "blade-embed-ready" || data.service !== "shell") return;
      send();
    };
    window.addEventListener("message", onMessage);
    send();
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, src, ready, actorToken, session, logout]);
}
