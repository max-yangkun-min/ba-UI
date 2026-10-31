import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { EMBED_ORIGIN } from "../data/embed-origin";

/** 开发时浏览页和控制台应用开发都走本机嵌入页。嵌入页自己向 /embed-auth 要平台票。生产包用 shell-site.js 里的地址。 */
const LOCAL_EMBED = import.meta.env.DEV ? "http://127.0.0.1:5174" : EMBED_ORIGIN;

function embedSrc(pathname: string, search: string, hash: string) {
  const localResource =
    pathname === "/resources/agents" ||
    pathname.startsWith("/resources/agents/") ||
    pathname === "/resources/skills" ||
    pathname.startsWith("/resources/skills/") ||
    pathname === "/resources/knowledge" ||
    pathname.startsWith("/resources/knowledge/") ||
    pathname === "/resources/tools" ||
    pathname.startsWith("/resources/tools/") ||
    pathname === "/resources/plugins" ||
    pathname.startsWith("/resources/plugins/") ||
    pathname === "/resources/prompt-templates" ||
    pathname.startsWith("/resources/prompt-templates/");
  if (localResource || pathname.startsWith("/console/app-dev/")) {
    return `${LOCAL_EMBED}${pathname}${search}${hash}`;
  }
  return `${EMBED_ORIGIN}${pathname}${search}${hash}`;
}

/** 只告诉嵌入页父页面是谁。平台票由嵌入页自己向 /embed-auth 领取，不放进地址。 */
function withPortalParent(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    if (!parsed.searchParams.has("embed_parent")) parsed.searchParams.set("embed_parent", window.location.origin);
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

export function ShellEmbed() {
  const location = useLocation();
  const src = withPortalParent(embedSrc(location.pathname, location.search, location.hash));
  const clip = clipsHubBar(src);
  const frameRef = useRef<HTMLIFrameElement>(null);

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
  }, [src]);

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
      const content = contentMode();
      let target = "*";
      try {
        if (document.referrer) target = new URL(document.referrer).origin;
      } catch {
        target = "*";
      }
      window.parent.postMessage(
        {
          type: "blade-embed-resize",
          service: "shell",
          mode: content ? "content" : "fill",
          fit: content ? "content" : "viewport",
          height: content ? Math.ceil(reported + chrome) : 0,
        },
        target,
      );
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as { type?: string; service?: string; mode?: string; fit?: string; height?: number } | null;
      if (!data || (data.type !== "blade-embed-resize" && data.type !== "blade-embed-ready")) return;
      if (data.service === "shell") return;
      const content = data.mode === "grow" || data.mode === "content" || data.fit === "content";
      mode = content ? "content" : "fill";
      reported = typeof data.height === "number" && Number.isFinite(data.height) ? data.height : 0;
      apply();
      postOutward();
    };

    const onResize = () => {
      if (contentMode()) apply();
      postOutward();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onResize);
    postOutward();
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", onResize);
    };
  }, [src, clip]);

  return (
    <div className={clip ? "shell-embed shell-embed-clip" : "shell-embed"}>
      <iframe ref={frameRef} className="shell-embed-frame" title="嵌入页" src={src} scrolling="no" />
    </div>
  );
}
