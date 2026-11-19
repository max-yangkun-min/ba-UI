import { useEffect, useRef, useState } from "react";
import { baOrigin } from "../../data/site";
import { currentPortalSession, whenPortalSession } from "../../lib/portal-session";
import { AgentWorkbench } from "./AgentWorkbench";

const origin = baOrigin();

type SpaceLink = { label: string; href: string };

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
  /** 传了就让内层把「AI对话」和这些标签画进对话侧栏头部。不传表示这页没有工作空间切换。 */
  spaceLinks?: SpaceLink[];
  /** 指定这张票交给内层。门户智能体体验用当前用户的票，不再去要超级管理员。 */
  accessToken?: string;
};

export function BaEmbed({ path = "/", title = "Blade Agent", variant = "home", frameOrigin, hideNav, onReady, spaceLinks, accessToken = "" }: BaEmbedProps) {
  const targetOrigin = (frameOrigin || origin).replace(/\/$/, "");
  const pinnedToken = accessToken.trim();
  const [mode, setMode] = useState<EmbedMode>(targetOrigin ? "loading" : "fallback");
  const openedAs = currentPortalSession();
  const tokenRef = useRef(pinnedToken || (openedAs?.mode === "user" ? openedAs.token : ""));
  const pendingRef = useRef<Set<Window>>(new Set());
  const [frameNonce, setFrameNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onReadyRef = useRef(onReady);
  const shellWatch = useRef<MutationObserver | null>(null);
  const shellTicket = useRef(0);
  const spaceLinksRef = useRef(spaceLinks);
  spaceLinksRef.current = spaceLinks;
  const spaceKey = spaceLinks ? spaceLinks.map((link) => `${link.label}\u0000${link.href}`).join("\u0001") : null;
  onReadyRef.current = onReady;
  // 只藏画面，地址在首屏就设上。标签跟着内层对话侧栏：能看到「新建对话」才出现，离开后再藏。
  const quiet = variant === "home";
  const [shown, setShown] = useState(!quiet);
  const [shellOn, setShellOn] = useState(false);
  const [modalOn, setModalOn] = useState(false);

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
      const data = event.data as { type?: string; mode?: string; height?: number; ready?: boolean; open?: boolean } | null;
      if (!data) return;
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      if (data.type === "blade-embed-shell") {
        const ready = data.ready === true;
        setShellOn(ready);
        if (ready) setShown(true);
      }
      if (data.type === "blade-embed-modal") {
        setModalOn(data.open === true);
      }
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

    if (pinnedToken) {
      publish(pinnedToken);
    } else {
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
    }

    return () => {
      cancelled = true;
      pendingRef.current.clear();
      shellTicket.current += 1;
      shellWatch.current?.disconnect();
      shellWatch.current = null;
      window.removeEventListener("message", onMessage);
    };
  }, [targetOrigin, variant, pinnedToken]);

  useEffect(() => {
    if (!targetOrigin || mode === "fallback") onReadyRef.current?.();
  }, [targetOrigin, mode]);

  useEffect(() => {
    if (spaceKey === null) return;
    postSpaceTabs(frameRef.current, spaceLinksRef.current, targetOrigin);
  }, [spaceKey, targetOrigin, mode, frameNonce]);

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
    const sync = () => {
      if (shellTicket.current !== ticket) return;
      const on = visibleNewChat(live);
      setShellOn(on);
      if (on) setShown(true);
      setModalOn(visibleEmbedModal(live));
    };
    sync();
    const root = live.documentElement;
    if (!root) return;
    const obs = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        sync();
      });
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    shellWatch.current = obs;
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
        key={`${src}#${frameNonce}`}
        title={title}
        src={src}
        scrolling="no"
        data-quiet={quiet && !shown ? "1" : undefined}
        data-shell={spaceLinks ? (shellOn ? "1" : "0") : undefined}
        data-modal={modalOn ? "1" : undefined}
        onLoad={(event) => {
          onReadyRef.current?.();
          const frame = event.currentTarget;
          if (quiet) watchSameOriginShell(frame);
          postSpaceTabs(frame, spaceLinksRef.current, targetOrigin);
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

function shownBox(node: Element, view: Window) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return false;
  const style = view.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number.parseFloat(style.opacity || "1") === 0) return false;
  const rect = node.getBoundingClientRect();
  return rect.width >= 8 && rect.height >= 8;
}

/** 和内层插件同一套判断：对话框，或铺满视口的半透明遮罩。同源时父页面自己也能看见。 */
function visibleEmbedModal(doc: Document) {
  const view = doc.defaultView;
  if (!view) return false;
  const dialogs = doc.querySelectorAll("[role='dialog'], [role='alertdialog']");
  for (const node of dialogs) {
    if (shownBox(node, view)) return true;
  }
  const named = doc.querySelectorAll("[data-radix-dialog-overlay], [data-vaul-overlay]");
  for (const node of named) {
    if (shownBox(node, view)) return true;
  }
  const opens = doc.querySelectorAll("[data-state='open']");
  for (const node of opens) {
    if (!(node instanceof HTMLElement) || !node.className.includes("inset-0")) continue;
    if (!shownBox(node, view)) continue;
    const style = view.getComputedStyle(node);
    if (style.position !== "fixed" && style.position !== "absolute") continue;
    const rect = node.getBoundingClientRect();
    if (view.innerWidth < 240 || view.innerHeight < 240) continue;
    if (rect.width < view.innerWidth * 0.72 || rect.height < view.innerHeight * 0.72) continue;
    const bg = style.backgroundColor;
    if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") continue;
    return true;
  }
  return false;
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

function embedSrc(path: string, parentOrigin: string, hideNav: boolean, frameOrigin: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = normalized === "/" ? `${frameOrigin}/` : `${frameOrigin}${normalized}`;
  const joiner = normalized.includes("?") ? "&" : "?";
  const nav = hideNav ? "&hide_nav=1" : "";
  return `${base}${joiner}iframe=1&embed_parent=${encodeURIComponent(parentOrigin)}${nav}`;
}

function postSpaceTabs(frame: HTMLIFrameElement | null, links: SpaceLink[] | undefined, targetOrigin: string) {
  if (!frame || !links || !targetOrigin) return;
  const child = frame.contentWindow;
  if (!child) return;
  try {
    child.postMessage(
      {
        type: "blade-embed-space-tabs",
        tabs: links.map((link) => ({ label: link.label, href: link.href })),
      },
      targetOrigin,
    );
  } catch {
    // 子页面还没落到目标源站时，加载完成会再发一次。
  }
}
