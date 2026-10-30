const GROW_PAGE = ".resource-page, .agent-catalog, .agent-portal-detail, .detail-page";

/** 嵌在外壳 iframe 里时，把文档高度告诉父页面，让父页面拉高 iframe。 */
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
    let height = mode === "grow" ? contentHeight() : 0;
    const view = window.innerHeight || 800;
    if (mode === "grow" && lastHeight > 640 && height > lastHeight + Math.max(view, 640)) height = lastHeight;
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
    const mutation = new MutationObserver(schedule);
    mutation.observe(document.body, { childList: true, subtree: true });
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

function contentHeight() {
  const app = document.querySelector(".embed-app");
  if (!app) return Math.ceil(document.documentElement.scrollHeight);
  const box = app.getBoundingClientRect().height;
  return Math.ceil(Math.max(box, app.scrollHeight));
}

function parentOrigin() {
  try {
    return document.referrer ? new URL(document.referrer).origin : "*";
  } catch {
    return "*";
  }
}
