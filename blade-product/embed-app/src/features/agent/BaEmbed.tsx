import { useEffect, useRef, useState } from "react";
import { baOrigin } from "../../data/site";
import { currentPortalSession, whenPortalSession } from "../../lib/portal-session";
import { AgentWorkbench } from "./AgentWorkbench";

const origin = baOrigin();

type EmbedMode = "loading" | "live" | "fallback";

type BaEmbedProps = {
  /** 站内路径。门户首页用 /，控制台分模块用 /skills 这类路由。 */
  path?: string;
  title?: string;
  /** home：打不开时回到本地工作台。module：右侧始终留着 iframe。 */
  variant?: "home" | "module";
  /** 覆盖默认 8020。8010 的能力中心页面传自己的源站。 */
  frameOrigin?: string;
  /** 详情里的对话区不要藏导航。缺省仍只在控制台模块上隐藏。 */
  hideNav?: boolean;
};

/** 对话只用当前用户的平台票。未登录时不回落到超级管理员票。 */
function requiresUserTicket(path: string) {
  const normalized = (path.startsWith("/") ? path : `/${path}`).split("?")[0];
  return normalized === "/" || normalized === "/chat" || normalized.startsWith("/chat/");
}

export function BaEmbed({ path = "/", title = "Blade Agent", variant = "home", frameOrigin, hideNav }: BaEmbedProps) {
  const targetOrigin = (frameOrigin || origin).replace(/\/$/, "");
  const requiresUser = requiresUserTicket(path);
  const initial = currentPortalSession();
  const initialUser = initial?.mode === "user" ? initial.token : "";
  const [mode, setMode] = useState<EmbedMode>(targetOrigin ? "loading" : "fallback");
  const [chatTicket, setChatTicket] = useState(requiresUser ? initialUser : "");
  const [chatKnown, setChatKnown] = useState(!requiresUser || initial !== null);
  const tokenRef = useRef(initialUser);
  const pendingRef = useRef<Set<Window>>(new Set());
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!targetOrigin) {
      if (requiresUser) setChatKnown(true);
      return;
    }
    let cancelled = false;

    const deliver = (frame: Window, token: string) => {
      try {
        frame.postMessage({ type: "blade-embed-token", token }, targetOrigin);
      } catch {
        pendingRef.current.delete(frame);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      const data = event.data as { type?: string; mode?: string; height?: number } | null;
      if (!data) return;
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      if (data.type === "blade-embed-ready" || data.type === "blade-embed-resize") {
        applyEmbedHeight(frameRef.current, data.mode, data.height, variant);
      }
      if (data.type !== "blade-embed-ready") return;
      const source = frameFrom(event.source);
      if (!source) return;
      const token = tokenRef.current;
      if (!token) {
        pendingRef.current.add(source);
        return;
      }
      deliver(source, token);
    };

    window.addEventListener("message", onMessage);
    void whenPortalSession().then((session) => {
      if (cancelled) return;
      if (session.mode === "user") {
        tokenRef.current = session.token;
        if (requiresUser) {
          setChatTicket(session.token);
          setChatKnown(true);
        }
        for (const source of pendingRef.current) deliver(source, session.token);
        pendingRef.current.clear();
        return;
      }
      if (requiresUser) {
        tokenRef.current = "";
        setChatTicket("");
        setChatKnown(true);
        return;
      }
      fetch("/embed-auth", { cache: "no-store", credentials: "same-origin" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { token?: unknown } | null) => {
          if (cancelled) return;
          const token = typeof data?.token === "string" ? data.token.trim() : "";
          if (!token) return;
          tokenRef.current = token;
          for (const source of pendingRef.current) deliver(source, token);
          pendingRef.current.clear();
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      pendingRef.current.clear();
      window.removeEventListener("message", onMessage);
    };
  }, [targetOrigin, variant, requiresUser]);

  if (requiresUser && !chatKnown) {
    return <div className={variant === "home" ? "ba-embed ba-embed-home" : "ba-embed"} />;
  }
  if (requiresUser && !chatTicket) {
    return (
      <div className={variant === "home" ? "ba-embed ba-embed-home" : "ba-embed"}>
        <p>请先在门户登录后再进入对话。</p>
      </div>
    );
  }

  if (!targetOrigin || (variant === "home" && mode === "fallback")) {
    return <AgentWorkbench />;
  }

  // 内层页面只接受直接父页面传来的票，embed_parent 必须是本嵌入页自己的源站。
  const parentOrigin = window.location.origin;
  // mode=embed 会把整个 BA 换成无侧栏的会话页，分模块页面打不开。
  // iframe=1 只打开鉴权桥。hide_nav=1 只加在 8020 的控制台模块上，门户首页和 8010 不加。
  const hideNavFlag = hideNav ?? (variant === "module" && Boolean(origin) && targetOrigin === origin);
  const src = embedSrc(path, parentOrigin, hideNavFlag, targetOrigin);

  return (
    <div className={variant === "home" ? "ba-embed ba-embed-home" : "ba-embed"}>
      <iframe
        ref={frameRef}
        className="ba-frame"
        key={src}
        title={title}
        src={src}
        scrolling="no"
        onLoad={(event) => {
          const frame = event.currentTarget;
          const child = frame.contentWindow;
          const token = tokenRef.current;
          if (child && token) {
            try {
              child.postMessage({ type: "blade-embed-token", token }, targetOrigin);
            } catch {
              pendingRef.current.delete(child);
            }
          }
          try {
            const href = child?.location.href ?? "";
            if (!href || href === "about:blank") {
              setMode("fallback");
              return;
            }
          } catch {
            setMode("live");
            return;
          }
          setMode("live");
        }}
        onError={() => {
          if (variant === "home") setMode("fallback");
        }}
      />
    </div>
  );
}

function applyEmbedHeight(frame: HTMLIFrameElement | null, mode: string | undefined, height: number | undefined, variant: "home" | "module") {
  if (!frame) return;
  const content = mode === "grow" || mode === "content";
  if (variant === "home" || !content) {
    frame.style.height = "";
    delete frame.dataset.embedSize;
    return;
  }
  if (typeof height !== "number" || height < 320) return;
  frame.dataset.embedSize = "grow";
  frame.style.height = `${Math.ceil(height)}px`;
  frame.setAttribute("scrolling", "no");
  frame.style.overflow = "hidden";
}

function frameFrom(source: MessageEventSource | null): Window | null {
  if (!source || source === window) return null;
  try {
    if (typeof (source as Window).postMessage !== "function") return null;
  } catch {
    return null;
  }
  return source as Window;
}

function embedSrc(path: string, parentOrigin: string, hideNav: boolean, frameOrigin: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = normalized === "/" ? `${frameOrigin}/` : `${frameOrigin}${normalized}`;
  const joiner = normalized.includes("?") ? "&" : "?";
  const nav = hideNav ? "&hide_nav=1" : "";
  return `${base}${joiner}iframe=1&embed_parent=${encodeURIComponent(parentOrigin)}${nav}`;
}
