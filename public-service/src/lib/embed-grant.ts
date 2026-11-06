import { useEffect, type RefObject } from "react";
import { useLabAuth } from "./lab-auth";

const PORTAL_PREFIXES = [
  "/resources/skills",
  "/resources/knowledge",
  "/resources/agents",
  "/resources/tools",
  "/resources/plugins",
  "/resources/prompt-templates",
];

/** 与嵌入页 page-auth 同一份门户路径。这些页只回管理员标记，用户票留给授权页。 */
export function portalEmbedPath(pathname: string) {
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/resources/prompts" || path.startsWith("/resources/prompts/")) return false;
  return PORTAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * 测试外壳应答嵌入页的 blade-embed-ready。
 * 门户展示页明确走超级管理员。授权页在实验室登录后转交平台 JWT，否则明确回 admin。
 */
export function useEmbedGrant(frameRef: RefObject<HTMLIFrameElement | null>, src: string, pathname: string) {
  const { ready, session } = useLabAuth();
  const portal = portalEmbedPath(pathname);

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
      if (portal) {
        child.postMessage({ type: "blade-embed-token", admin: true }, targetOrigin);
        return;
      }
      if (!ready) return;
      if (session?.token) {
        child.postMessage({ type: "blade-embed-token", token: session.token }, targetOrigin);
        return;
      }
      child.postMessage({ type: "blade-embed-token", admin: true }, targetOrigin);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      if (event.origin !== targetOrigin) return;
      const data = event.data as { type?: string; service?: string } | null;
      if (!data || data.type !== "blade-embed-ready" || data.service !== "shell") return;
      send();
    };
    window.addEventListener("message", onMessage);
    send();
    return () => window.removeEventListener("message", onMessage);
  }, [frameRef, src, portal, ready, session?.token]);
}
