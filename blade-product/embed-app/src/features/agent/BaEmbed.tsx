import { useEffect, useRef, useState } from "react";
import { baOrigin } from "../../data/site";
import { currentPortalSession, whenPortalSession } from "../../lib/portal-session";
import { AgentWorkbench } from "./AgentWorkbench";

const origin = baOrigin();

/** 和 embed-space.css 的 --space-tab-band 同一高度。只下移 Blade 侧栏，主列仍贴顶。 */
const SPACE_TAB_BAND = 65;

function readEmbedAuth() {
  return fetch("/embed-auth", { cache: "no-store", credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data: { token?: unknown } | null) => (typeof data?.token === "string" ? data.token.trim() : ""))
    .catch(() => "");
}

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
  /** 内层对话可以露出来时通知外层标签。首页不传。 */
  onReady?: () => void;
  /** 左列跳转标签盖住侧栏顶部时，让内层只把侧栏内容下移。 */
  spaceTabs?: boolean;
};

export function BaEmbed({ path = "/", title = "Blade Agent", variant = "home", frameOrigin, hideNav, onReady, spaceTabs = false }: BaEmbedProps) {
  const targetOrigin = (frameOrigin || origin).replace(/\/$/, "");
  const [mode, setMode] = useState<EmbedMode>(targetOrigin ? "loading" : "fallback");
  const openedAs = currentPortalSession();
  const tokenRef = useRef(openedAs?.mode === "user" ? openedAs.token : "");
  const pendingRef = useRef<Set<Window>>(new Set());
  const [frameNonce, setFrameNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onReadyRef = useRef(onReady);
  const shellWatch = useRef<MutationObserver | null>(null);
  const shellTicket = useRef(0);
  onReadyRef.current = onReady;
  // 只藏画面，地址在首屏就设上。标签等侧栏「新建对话」画出来再一起出现。
  const quiet = variant === "home";
  const [shown, setShown] = useState(!quiet);

  useEffect(() => {
    if (!targetOrigin) return;
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
      const data = event.data as { type?: string; mode?: string; height?: number; ready?: boolean } | null;
      if (!data) return;
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      if (data.type === "blade-embed-shell" && data.ready === true) setShown(true);
      if (data.type === "blade-embed-ready" || data.type === "blade-embed-resize") {
        applyEmbedHeight(frameRef.current, data.mode, data.height, variant);
        onReadyRef.current?.();
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

    const publish = (token: string) => {
      const previous = tokenRef.current;
      if (!token || token === previous) return;
      tokenRef.current = token;
      if (previous) {
        pendingRef.current.clear();
        setFrameNonce((nonce) => nonce + 1);
        return;
      }
      for (const source of pendingRef.current) deliver(source, token);
      pendingRef.current.clear();
      const child = frameRef.current?.contentWindow;
      if (child) deliver(child, token);
    };

    whenPortalSession()
      .then((session) => {
        if (cancelled) return;
        if (session.mode === "user") {
          if (tokenRef.current === session.token) {
            const child = frameRef.current?.contentWindow;
            if (child) deliver(child, session.token);
          } else {
            publish(session.token);
          }
          return;
        }
        if (session.mode !== "admin") return;
        return readEmbedAuth().then((token) => {
          if (cancelled) return;
          publish(token);
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      pendingRef.current.clear();
      shellTicket.current += 1;
      shellWatch.current?.disconnect();
      shellWatch.current = null;
      window.removeEventListener("message", onMessage);
    };
  }, [targetOrigin, variant]);

  useEffect(() => {
    if (!targetOrigin || mode === "fallback") onReadyRef.current?.();
  }, [targetOrigin, mode]);

  useEffect(() => {
    if (!spaceTabs) return;
    const frame = frameRef.current;
    if (!frame) return;
    const space = frame.closest(".embed-chat-space");
    const head = space?.querySelector(".embed-chat-space-head");
    if (!(head instanceof HTMLElement)) return;

    const post = () => {
      if (!bladeFrameReady(frame)) return;
      const px = Math.round(head.getBoundingClientRect().height);
      if (px < 24 || px > 200) return;
      applySpaceTabPad(frame, px);
    };

    post();
    const obs = new ResizeObserver(post);
    obs.observe(head);
    frame.addEventListener("load", post);
    return () => {
      obs.disconnect();
      frame.removeEventListener("load", post);
    };
  }, [spaceTabs, targetOrigin, mode]);

  const grant = currentPortalSession();
  const frameAllowed = grant?.mode === "admin" || grant?.mode === "user";

  if (!targetOrigin || (variant === "home" && mode === "fallback")) {
    return <AgentWorkbench />;
  }

  if (!frameAllowed) {
    return (
      <div className={variant === "home" ? "ba-embed ba-embed-home" : "ba-embed"}>
        <div className="ba-embed-hold" role="status">
          {grant?.mode === "unauthorized" ? "未收到授权，页面未打开。" : "正在等待授权…"}
        </div>
      </div>
    );
  }

  function watchSameOriginShell(frame: HTMLIFrameElement) {
    const ticket = ++shellTicket.current;
    shellWatch.current?.disconnect();
    shellWatch.current = null;
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      return;
    }
    if (!doc) return;
    const live = doc;
    const reveal = () => {
      if (shellTicket.current !== ticket) return true;
      if (!visibleNewChat(live)) return false;
      setShown(true);
      shellWatch.current?.disconnect();
      shellWatch.current = null;
      return true;
    };
    if (reveal()) return;
    const root = live.documentElement;
    if (!root) return;
    const obs = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        reveal();
      });
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    shellWatch.current = obs;
    window.requestAnimationFrame(() => {
      reveal();
    });
  }

  // 内层页面只接受直接父页面传来的票，embed_parent 必须是本嵌入页自己的源站。
  const parentOrigin = window.location.origin;
  // mode=embed 会把整个 BA 换成无侧栏的会话页，分模块页面打不开。
  // iframe=1 只打开鉴权桥。hide_nav=1 只加在 8020 的控制台模块上，门户首页和 8010 不加。
  const hideNavFlag = hideNav ?? (variant === "module" && Boolean(origin) && targetOrigin === origin);
  const src = embedSrc(path, parentOrigin, hideNavFlag, targetOrigin, spaceTabs);

  return (
    <div className={variant === "home" ? "ba-embed ba-embed-home" : "ba-embed"}>
      <iframe
        ref={frameRef}
        className="ba-frame"
        key={`${src}#${frameNonce}`}
        title={title}
        src={src}
        scrolling="no"
        data-quiet={quiet && !shown ? "1" : undefined}
        onLoad={(event) => {
          onReadyRef.current?.();
          const frame = event.currentTarget;
          if (quiet) watchSameOriginShell(frame);
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
              shellTicket.current += 1;
              shellWatch.current?.disconnect();
              shellWatch.current = null;
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
          onReadyRef.current?.();
          setShown(true);
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

function visibleNewChat(doc: Document): boolean {
  const sidebar = doc.getElementById("unified-shell-sidebar");
  if (!sidebar) return false;
  const side = sidebar.getBoundingClientRect();
  if (side.width < 8 || side.height < 8) return false;
  const clicks = sidebar.querySelectorAll("button, a, [role='button']");
  for (const node of clicks) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.querySelector("button, a")) continue;
    const text = (node.innerText || "").replace(/\s+/g, "");
    if (!text.includes("新建对话") || text.length > 20) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    return true;
  }
  return false;
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

function embedSrc(path: string, parentOrigin: string, hideNav: boolean, frameOrigin: string, spaceTabs: boolean) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = normalized === "/" ? `${frameOrigin}/` : `${frameOrigin}${normalized}`;
  const joiner = normalized.includes("?") ? "&" : "?";
  const nav = hideNav ? "&hide_nav=1" : "";
  const tabs = spaceTabs ? `&space_tabs=${SPACE_TAB_BAND}` : "";
  return `${base}${joiner}iframe=1&embed_parent=${encodeURIComponent(parentOrigin)}${nav}${tabs}`;
}

const SPACE_TAB_PAD_CSS =
  "html[data-blade-space-tabs='1'] body #unified-shell-sidebar:not(:has(#factory-sidebar-projects-heading)){" +
  "box-sizing:border-box!important;padding-top:var(--blade-space-tab-pad,0px)!important}";

function bladeFrameReady(frame: HTMLIFrameElement) {
  try {
    const href = frame.contentWindow?.location.href ?? "";
    return href.startsWith("http:");
  } catch {
    return true;
  }
}

function applySpaceTabPad(frame: HTMLIFrameElement, px: number) {
  try {
    const doc = frame.contentDocument;
    const root = doc?.documentElement;
    if (doc && root) {
      root.style.setProperty("--blade-space-tab-pad", `${px}px`);
      root.setAttribute("data-blade-space-tabs", "1");
      if (!doc.getElementById("blade-space-tab-pad")) {
        const style = doc.createElement("style");
        style.id = "blade-space-tab-pad";
        style.textContent = SPACE_TAB_PAD_CSS;
        (doc.head || root).appendChild(style);
      }
    }
  } catch {
    // 跨源时改由内层桥接收消息。
  }
  const child = frame.contentWindow;
  if (!child) return;
  let target = "*";
  try {
    target = new URL(frame.src, window.location.href).origin;
  } catch {
    target = "*";
  }
  try {
    child.postMessage({ type: "blade-embed-sidebar-pad", px }, target);
  } catch {
    // 子页面还没落到目标源站时，加载完成会再发一次。
  }
}
