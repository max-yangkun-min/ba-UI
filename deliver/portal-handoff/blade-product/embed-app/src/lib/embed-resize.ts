const GROW_PAGE = ".resource-page, .agent-catalog, .agent-portal-detail, .detail-page";

/** 嵌在外壳 iframe 里时，把门户目录的内容高度告诉父页面，让父页面拉高 iframe。 */
export function installEmbedResize() {
  if (window.parent === window) return;
  const flag = "__bladeEmbedResize";
  if ((window as Window & { [flag]?: boolean })[flag]) return;
  (window as Window & { [flag]?: boolean })[flag] = true;

  let lastMode = "";
  let lastHeight = -1;
  let timer = 0;

  const targetOrigin = parentOrigin();

  const measure = () => {
    const mode = embedMode();
    const height = mode === "grow" ? contentHeight() : 0;
    const fit = mode === "grow" ? "content" : "viewport";
    if (mode === lastMode && Math.abs(height - lastHeight) <= 1) return;
    lastMode = mode;
    lastHeight = height;
    window.parent.postMessage({ type: "blade-embed-resize", mode, fit, height }, targetOrigin);
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(measure, 50);
  };

  const watch = () => {
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    const app = document.querySelector(".embed-app");
    if (app) observer.observe(app);
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    schedule();
  };

  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch);
  window.addEventListener("load", schedule);
}

function embedMode() {
  if (document.querySelector(".ba-embed-home, .workbench, .prompt-studio")) return "fill";
  if (document.querySelector(GROW_PAGE) || document.querySelector(".ba-frame[data-embed-size='grow']")) return "grow";
  return "fill";
}

/** 只量目录自身的边框盒。不用被视口撑高的 scrollHeight，避免和 iframe 高度来回放大。 */
function contentHeight() {
  const pages = document.querySelectorAll<HTMLElement>(GROW_PAGE);
  let bottom = 0;
  pages.forEach((node) => {
    const rect = node.getBoundingClientRect();
    bottom = Math.max(bottom, rect.bottom + window.scrollY);
  });
  if (bottom > 0) return Math.ceil(bottom);
  return Math.ceil(document.documentElement.scrollHeight);
}

function parentOrigin() {
  try {
    const hinted = new URLSearchParams(window.location.search).get("embed_parent");
    if (hinted) return new URL(hinted).origin;
  } catch {
    /* 父页面地址不完整时改用引用页 */
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : "*";
  } catch {
    return "*";
  }
}
