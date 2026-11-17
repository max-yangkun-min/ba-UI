import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EMBED_ORIGIN } from "../data/embed-origin";
import { portalEmbedPath, useEmbedGrant } from "../lib/embed-grant";
import { useLabAuth } from "../lib/lab-auth";

/** 开发时控制台应用开发走本机嵌入页。嵌入页自己向 /embed-auth 要平台票。生产包用 shell-site.js 里的地址。 */
const LOCAL_EMBED = import.meta.env.DEV ? "http://127.0.0.1:5174" : EMBED_ORIGIN;

function embedSrc(pathname: string, search: string, hash: string) {
  if (pathname.startsWith("/console/app-dev/")) {
    return `${LOCAL_EMBED}${pathname}${search}${hash}`;
  }
  return `${EMBED_ORIGIN}${pathname}${search}${hash}`;
}

/** 只告诉嵌入页父页面是谁。票走 postMessage，不放进地址。 */
function withPortalParent(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set("embed_parent", window.location.origin);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** 开发时虚拟机嵌入页自带 48px 顶栏才裁。生产包不保留这台机器的地址。 */
function clipsHubBar(src: string) {
  if (!import.meta.env.DEV) return false;
  try {
    return new URL(src, window.location.href).hostname === "192.168.171.128";
  } catch {
    return false;
  }
}

function safeChatResourceId(value: string) {
  const id = value.trim();
  if (!id || id.length > 200 || id.includes("..") || /[\s?#\\]/.test(id)) return "";
  return id;
}

function outerOrigin() {
  try {
    const hinted = new URLSearchParams(window.location.search).get("embed_parent");
    if (hinted) return new URL(hinted).origin;
  } catch {
    /* 父页面地址不完整时改用引用页 */
  }
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    return "*";
  }
  return "*";
}

export function ShellEmbed() {
  const location = useLocation();
  const navigate = useNavigate();
  const src = withPortalParent(embedSrc(location.pathname, location.search, location.hash));
  const clip = clipsHubBar(src);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { session } = useLabAuth();
  const portal = portalEmbedPath(location.pathname);
  const frameKey = portal ? "portal" : session?.token || "admin";
  useEmbedGrant(frameRef, src, location.pathname);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || clip) return;
    frame.setAttribute("scrolling", "no");
    frame.style.overflow = "hidden";
    frame.style.height = "";
    delete frame.dataset.embedSize;

    let reported = 0;
    let mode = "fill";

    const contentMode = () => (mode === "grow" || mode === "content") && reported >= 320;

    const apply = () => {
      frame.setAttribute("scrolling", "no");
      frame.style.overflow = "hidden";
      if (portal) {
        if (!(reported > 0)) {
          frame.style.height = "";
          delete frame.dataset.embedSize;
          return;
        }
        frame.dataset.embedSize = "grow";
        frame.style.height = `${Math.ceil(reported)}px`;
        return;
      }
      if (!contentMode() || reported < 320) {
        frame.style.height = "";
        delete frame.dataset.embedSize;
        return;
      }
      const header = document.querySelector(".app-header");
      const chrome = header instanceof HTMLElement ? header.offsetHeight : 0;
      const inFrame = window.parent !== window;
      const floor = inFrame ? 0 : Math.max(0, window.innerHeight - chrome);
      const next = Math.max(Math.ceil(reported), floor);
      frame.dataset.embedSize = "grow";
      frame.style.height = `${next}px`;
    };

    const postOutward = () => {
      if (window.parent === window) return;
      const header = document.querySelector(".app-header");
      const chrome = header instanceof HTMLElement ? header.offsetHeight : 0;
      const portalGrow = portal && reported > 0;
      const content = portalGrow || contentMode();
      const shellBox = document.querySelector(".app-shell");
      const portalHeight = shellBox instanceof HTMLElement ? shellBox.offsetHeight : reported;
      const grown = portalGrow ? Math.ceil(portalHeight) : Math.ceil(reported + chrome);
      window.parent.postMessage(
        {
          type: "blade-embed-resize",
          service: "shell",
          mode: content ? "content" : "fill",
          fit: content ? "content" : "viewport",
          height: content ? grown : 0,
        },
        outerOrigin(),
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: string; service?: string; mode?: string; fit?: string; height?: number; kb?: string; target?: string; id?: string; name?: string } | null;
      if (!data) return;
      if (data.type === "blade-embed-open-chat") {
        if (data.target === "agents") {
          if (window.parent !== window) {
            window.parent.postMessage({ type: "blade-embed-open-chat", service: "shell", target: "agents" }, outerOrigin());
          }
          navigate("/");
          return;
        }
        const target = data.target === "skills" || data.target === "knowledge" || data.target === "plugins" ? data.target : typeof data.kb === "string" && data.kb.trim() ? "knowledge" : "";
        const raw = typeof data.id === "string" ? data.id : typeof data.kb === "string" ? data.kb : "";
        const id = safeChatResourceId(raw);
        if (!target || !id) return;
        const name = typeof data.name === "string" ? data.name.trim() : "";
        if (window.parent !== window) {
          window.parent.postMessage({ type: "blade-embed-open-chat", service: "shell", target, id, name }, outerOrigin());
        }
        const query = new URLSearchParams();
        query.set("chat", target);
        query.set("id", id);
        if (name) query.set("name", name);
        navigate(`/?${query.toString()}`);
        return;
      }
      if (data.type !== "blade-embed-resize" && data.type !== "blade-embed-ready") return;
      if (data.service === "shell") return;
      const content = data.mode === "grow" || data.mode === "content" || data.fit === "content";
      mode = content ? "content" : "fill";
      reported = typeof data.height === "number" && Number.isFinite(data.height) ? data.height : 0;
      apply();
      postOutward();
    };

    const onResize = () => {
      if (portal || contentMode()) apply();
      postOutward();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onResize);
    postOutward();
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", onResize);
    };
  }, [src, clip, frameKey, portal, navigate]);

  return (
    <div className={clip ? "shell-embed shell-embed-clip" : "shell-embed"} data-portal-flow={portal ? "1" : undefined}>
      <iframe key={frameKey} ref={frameRef} className="shell-embed-frame" title="嵌入页" src={src} scrolling="no" />
    </div>
  );
}
