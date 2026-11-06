(function () {
  "use strict";

  var PLUGIN_VERSION = "1.1.29";
  var params = new URLSearchParams(window.location.search);
  var embedMode =
    params.get("mode") === "embed" ||
    params.get("iframe") === "1" ||
    params.get("embed") === "1";
  var inFrame = false;
  try {
    inFrame = window.parent !== window;
  } catch (_) {
    inFrame = true;
  }
  // 独立打开的页面不改。嵌在父页面里时，即使地址丢掉 iframe=1，也要继续向父页面要令牌。
  if (!inFrame) return;

  function originFrom(value) {
    try {
      return new URL(value, window.location.href).origin;
    } catch (_) {
      return "";
    }
  }

  function detectService() {
    var hinted = String(params.get("embed_service") || params.get("service") || "").toLowerCase();
    if (hinted === "ba" || hinted === "bh") return hinted;
    var path = window.location.pathname || "";
    if (/^\/(skills|solutions|apps|stores)(\/|$)/.test(path)) return "bh";
    var title = String(document.title || "").toLowerCase();
    if (title.indexOf("hub") !== -1) return "bh";
    if (title.indexOf("agent") !== -1) return "ba";
    if (window.location.port === "8010") return "bh";
    return "ba";
  }

  function detectParentOrigin() {
    var hinted = params.get("embed_parent") || params.get("parent");
    if (hinted) {
      var fromQuery = originFrom(hinted);
      if (fromQuery) return fromQuery;
    }
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        var fromAncestor = originFrom(window.location.ancestorOrigins[0]);
        if (fromAncestor) return fromAncestor;
      }
    } catch (_) {}
    try {
      if (document.referrer) {
        var fromReferrer = originFrom(document.referrer);
        if (fromReferrer) return fromReferrer;
      }
    } catch (_) {}
    return "";
  }

  function allowedOrigins() {
    var configured = window.__BLADE_EMBED_ALLOWED_ORIGINS;
    if (!configured) return null;
    if (typeof configured === "string") {
      configured = configured.split(",");
    }
    if (!configured || !configured.length) return null;
    var set = {};
    for (var i = 0; i < configured.length; i += 1) {
      var origin = String(configured[i] || "").trim();
      if (origin) set[origin] = true;
    }
    return Object.keys(set).length ? set : null;
  }

  var service = detectService();
  var parentOrigin = detectParentOrigin();
  var originAllow = allowedOrigins();
  if (originAllow) {
    var allowedKeys = Object.keys(originAllow);
    if (!parentOrigin || !originAllow[parentOrigin]) {
      parentOrigin = allowedKeys.length === 1 ? allowedKeys[0] : "";
    }
  }

  // 嵌入态去掉文档最外层的框，并隐掉对话侧栏里的运营中心整行（含「仅管理员可见」）。
  function installEmbedChrome() {
    if (document.getElementById("blade-embed-chrome-style")) return;
    var style = document.createElement("style");
    style.id = "blade-embed-chrome-style";
    style.setAttribute("data-blade-iframe-plugin", PLUGIN_VERSION);
    style.textContent =
      "html,body{border:0!important;outline:none!important;box-shadow:none!important}" +
      "html.blade-embed-grow,html.blade-embed-grow body{height:auto!important;min-height:0!important;max-height:none!important;max-width:100%!important;overflow-x:hidden!important;overflow-y:hidden!important}" +
      "html.blade-embed-grow #root,html.blade-embed-grow #root>div,html.blade-embed-grow main,html.blade-embed-grow .studio,html.blade-embed-grow #unified-shell-main,html.blade-embed-grow .h-screen,html.blade-embed-grow .min-h-screen,html.blade-embed-grow .h-full,html.blade-embed-grow .min-h-full,html.blade-embed-grow .h-dvh,html.blade-embed-grow .min-h-dvh,html.blade-embed-grow [class*='h-screen'],html.blade-embed-grow [class*='min-h-screen'],html.blade-embed-grow [class*='h-full'],html.blade-embed-grow [class*='min-h-full'],html.blade-embed-grow [class*='h-dvh'],html.blade-embed-grow [class*='100vh'],html.blade-embed-grow [class*='100dvh']{height:auto!important;min-height:0!important;max-height:none!important;max-width:100%!important;overflow-x:auto!important;overflow-y:visible!important}" +
      "html.blade-embed-grow [data-blade-embed-release='1']{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important}" +
      "html.blade-embed-frame,html.blade-embed-frame body{height:100%!important;overflow:hidden!important;margin:0!important}" +
      "html.blade-embed-scroll,html.blade-embed-scroll body{height:100%!important;overflow:hidden!important;margin:0!important}" +
      "html.blade-embed-scroll #root[data-blade-page-scroll='1']{height:100%!important;max-height:100%!important;min-height:0!important}" +
      "html.blade-embed-scroll [data-blade-page-scroll='1']{overflow-x:hidden!important;overflow-y:auto!important;scrollbar-width:auto!important;scrollbar-color:#5c6570 #e6ebf2!important}" +
      "html.blade-embed-scroll [data-blade-page-scroll='1']::-webkit-scrollbar{width:12px!important;height:12px!important}" +
      "html.blade-embed-scroll [data-blade-page-scroll='1']::-webkit-scrollbar-thumb{background:#5c6570!important;border-radius:6px!important}" +
      "html.blade-embed-scroll [data-blade-page-scroll='1']::-webkit-scrollbar-track{background:#e6ebf2!important}" +
      "html body #unified-shell-sidebar a[href='/admin']," +
      "html body #unified-shell-sidebar a[href^='/admin?']," +
      "html body #unified-shell-sidebar a[href^='/admin#']," +
      "html body #unified-shell-sidebar [data-blade-hide-ops='1']," +
      "html body aside [data-blade-hide-ops='1']," +
      "html body nav [data-blade-hide-ops='1']," +
      "html body [role='dialog'] [data-blade-hide-ops='1']" +
      "{display:none!important;visibility:hidden!important;height:0!important;overflow:hidden!important}";
    (document.head || document.documentElement).appendChild(style);
  }

  function isOpsCenter(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag !== "A" && tag !== "BUTTON") return false;
    var href = el.getAttribute("href") || "";
    if (href) {
      try {
        var path = new URL(href, window.location.href).pathname.replace(/\/+$/, "") || "/";
        if (path === "/admin") return true;
      } catch (_) {}
    }
    var label = ((el.getAttribute("aria-label") || "") + (el.getAttribute("title") || "") + (el.textContent || "")).replace(/\s+/g, "");
    if (label.indexOf("\u8fd0\u8425\u4e2d\u5fc3") === -1) return false;
    return !!(el.closest && el.closest("aside, nav, [role='dialog']"));
  }

  function hideOpsCenter() {
    var nodes = document.querySelectorAll("a,button");
    for (var i = 0; i < nodes.length; i += 1) {
      if (!isOpsCenter(nodes[i])) continue;
      nodes[i].setAttribute("data-blade-hide-ops", "1");
      nodes[i].style.setProperty("display", "none", "important");
    }
  }

  // 父页面的「AI对话 / 开发空间 / 管理空间」只盖住左列。侧栏内容下移同样的高度，主列保持贴顶。
  function spaceTabPadPx() {
    var raw = parseInt(params.get("space_tabs") || "", 10);
    if (raw >= 24 && raw <= 200) return raw;
    return 0;
  }

  function applySpaceTabPad(px) {
    var value = Math.round(Number(px));
    if (!(value >= 24 && value <= 200)) return;
    var root = document.documentElement;
    if (!root) return;
    root.style.setProperty("--blade-space-tab-pad", value + "px");
    root.setAttribute("data-blade-space-tabs", "1");
  }

  function installSpaceTabPad() {
    if (!document.getElementById("blade-space-tab-pad")) {
      var style = document.createElement("style");
      style.id = "blade-space-tab-pad";
      style.setAttribute("data-blade-iframe-plugin", PLUGIN_VERSION);
      style.textContent =
        "html[data-blade-space-tabs='1'] body #unified-shell-sidebar:not(:has(#factory-sidebar-projects-heading)){" +
        "box-sizing:border-box!important;padding-top:var(--blade-space-tab-pad,0px)!important}";
      (document.head || document.documentElement).appendChild(style);
    }
    applySpaceTabPad(spaceTabPadPx());
  }

  function preserveSpaceTabHref(event) {
    var pad = spaceTabPadPx();
    if (!pad || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var node = event.target;
    if (!node || !node.closest) return;
    var anchor = node.closest("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    var url = sameOriginHttp(anchor.href);
    if (!url) return;
    withEmbedQuery(url);
    if (!url.searchParams.has("space_tabs")) url.searchParams.set("space_tabs", String(pad));
    var next = url.pathname + url.search + url.hash;
    if ((anchor.getAttribute("href") || "") !== next) anchor.setAttribute("href", next);
  }

  function keepSpaceTabQuery() {
    var pad = spaceTabPadPx();
    if (!pad) return;
    ["pushState", "replaceState"].forEach(function (name) {
      var orig = history[name];
      if (typeof orig !== "function") return;
      history[name] = function (state, title, url) {
        if (typeof url === "string" && url) {
          try {
            var parsed = sameOriginHttp(url);
            if (parsed) {
              withEmbedQuery(parsed);
              if (!parsed.searchParams.has("space_tabs")) parsed.searchParams.set("space_tabs", String(pad));
              var next = parsed.pathname + parsed.search + parsed.hash;
              if (next !== url) return orig.call(history, state, title, next);
            }
          } catch (_) {}
        }
        return orig.apply(history, arguments);
      };
    });
  }

  installEmbedChrome();
  installSpaceTabPad();
  hideOpsCenter();

  var EMBED_QUERY_KEYS = ["iframe", "embed", "mode", "embed_parent", "parent", "hide_nav", "embed_service", "service", "space_tabs"];

  function sameOriginHttp(href) {
    try {
      var url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  function withEmbedQuery(url) {
    var current = new URLSearchParams(window.location.search);
    for (var i = 0; i < EMBED_QUERY_KEYS.length; i += 1) {
      var key = EMBED_QUERY_KEYS[i];
      if (!url.searchParams.has(key) && current.has(key)) url.searchParams.set(key, current.get(key));
    }
    if (url.searchParams.get("iframe") !== "1" && url.searchParams.get("embed") !== "1" && url.searchParams.get("mode") !== "embed") {
      url.searchParams.set("iframe", "1");
    }
    return url;
  }

  function breaksOut(target) {
    var value = String(target || "").toLowerCase();
    return value === "_blank" || value === "_top" || value === "_parent" || value === "_unfencedtop";
  }

  function stayInEmbed(url) {
    if (takeSessionFile(url, "")) return;
    withEmbedQuery(url);
    window.location.assign(url.toString());
  }

  keepSpaceTabQuery();

  // 软件工厂默认新开标签（target=_blank）。那样会离开已登录的 iframe，新页面没有令牌，随即跳到统一身份认证。
  document.addEventListener("click", function (event) {
    try {
      preserveSpaceTabHref(event);
    } catch (_) {}
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var node = event.target;
    if (!node || !node.closest) return;
    var anchor = node.closest("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    if (!breaksOut(anchor.target || anchor.getAttribute("target"))) return;
    var url = sameOriginHttp(anchor.href);
    if (!url) return;
    event.preventDefault();
    stayInEmbed(url);
  }, true);

  // 已经在页面里的文件链接。捕获阶段不拦，留给页面自己的点击处理先 preventDefault。
  // 页面没拦住时，再用内存令牌下载，避免浏览器直接打开这条地址。
  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    var node = event.target;
    if (!node || !node.closest) return;
    var anchor = node.closest("a[href]");
    if (!anchor) return;
    if (!takeSessionFile(anchor.href, anchor.getAttribute("download") || "")) return;
    event.preventDefault();
  }, false);

  var nativeWindowOpen = window.open;
  window.open = function (url, target) {
    if (url && takeSessionFile(url, "")) return window;
    if (url && breaksOut(target || "_blank")) {
      var parsed = sameOriginHttp(String(url));
      if (parsed) {
        stayInEmbed(parsed);
        return window;
      }
    }
    return nativeWindowOpen.apply(window, arguments);
  };

  if (embedMode) {
  // BH 嵌入态只做布局适配（隐藏侧栏、主区拉满），不再改配色。
  if (service === "bh") {
    var embedStyle = document.createElement("style");
    embedStyle.setAttribute("data-blade-iframe-plugin", PLUGIN_VERSION);
    embedStyle.textContent =
      "body>div#root>div>aside{display:none!important}" +
      "body>div#root>div>main{width:100%!important;max-width:none!important}";
    document.head.appendChild(embedStyle);
  }

  var hideNav = params.get("hide_nav") === "1";

  function installHideNavStyle() {
    if (document.getElementById("blade-hide-nav-style")) return;
    var style = document.createElement("style");
    style.id = "blade-hide-nav-style";
    style.setAttribute("data-blade-iframe-plugin", PLUGIN_VERSION);
    style.textContent =
      "[data-blade-hide-nav='column'],[data-blade-hide-nav='handle'],[data-blade-hide-nav='overlay']{" +
      "display:none!important;width:0!important;min-width:0!important;max-width:0!important;" +
      "flex:0 0 0px!important;overflow:hidden!important;pointer-events:none!important}" +
      "[data-blade-hide-nav='main']{flex:1 1 auto!important;width:100%!important;max-width:none!important;min-width:0!important}";
    (document.head || document.documentElement).appendChild(style);
  }

  function isGlobalSidebar(aside) {
    var nodes = aside.querySelectorAll("a,button");
    var hasNew = false;
    var hasModule = false;
    for (var i = 0; i < nodes.length; i += 1) {
      var name = ((nodes[i].getAttribute("aria-label") || "") + " " + (nodes[i].textContent || "")).replace(/\s+/g, " ");
      if (name.indexOf("\u65b0\u5efa\u5bf9\u8bdd") !== -1) hasNew = true;
      if (name.indexOf("\u6280\u80fd") !== -1 || name.indexOf("\u77e5\u8bc6\u5e93") !== -1) hasModule = true;
    }
    return hasNew && hasModule;
  }

  function isHandle(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.getAttribute("role") === "separator") return true;
    if (node.hasAttribute("data-panel-resize-handle-id") || node.hasAttribute("data-separator") || node.hasAttribute("data-resize-handle")) return true;
    var rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.width <= 20 && rect.height > 80;
  }

  function columnFor(aside) {
    var node = aside;
    while (node.parentElement && node.parentElement !== document.body) {
      var parent = node.parentElement;
      var style = window.getComputedStyle(parent);
      var row = style.display === "flex" && style.flexDirection !== "column" && style.flexDirection !== "column-reverse";
      if (row && parent.children.length >= 2) return node;
      node = parent;
    }
    return aside;
  }

  function hideGlobalNav() {
    // /skills 会被 detectService 当成 Hub，不能用 service === "ba" 做开关。
    // 8020 上 hide_nav=1 才藏全局壳；8010 不走这条。
    if (!hideNav || String(window.location.port) === "8010") return;
    installHideNavStyle();
    var column = document.getElementById("unified-shell-sidebar");
    var main = document.getElementById("unified-shell-main");
    if (column) {
      column.setAttribute("data-blade-hide-nav", "column");
      var handle = column.nextElementSibling;
      if (handle && handle !== main) handle.setAttribute("data-blade-hide-nav", "handle");
    }
    if (main) main.setAttribute("data-blade-hide-nav", "main");
    var asides = document.querySelectorAll("aside");
    for (var i = 0; i < asides.length; i += 1) {
      var aside = asides[i];
      if (column && column.contains(aside)) continue;
      if (!isGlobalSidebar(aside)) continue;
      var overlay = columnFor(aside);
      var position = window.getComputedStyle(overlay).position;
      if (position === "absolute" || position === "fixed") {
        overlay.setAttribute("data-blade-hide-nav", "overlay");
      }
    }
  }

  var renameScheduled = false;
  function simplifyBaSidebar() {
    if (service !== "ba") return;
    var logo = document.querySelector('img[alt="Blade AI"], img[alt="\u54c1\u724c\u6807\u8bc6"], a[aria-label="\u54c1\u724c\u6807\u8bc6"]');
    var logoGroup = logo && logo.closest ? (logo.closest("a") || logo).parentElement : (logo && logo.parentElement);
    if (!logoGroup) {
      var links = document.querySelectorAll('a[href="/chat"]');
      for (var i = 0; i < links.length; i += 1) {
        var label = (links[i].getAttribute("aria-label") || links[i].textContent || "").trim();
        if (label === "\u54c1\u724c\u6807\u8bc6" || links[i].querySelector("img")) {
          logoGroup = links[i].parentElement;
          break;
        }
      }
    }
    if (logoGroup) logoGroup.style.display = "none";
    // 底部账号行是「设置」入口（齿轮按钮）。不要 display:none，否则高度变成 0，
    // 嵌入页看起来像底部设置按钮被裁掉。用户名仍由 theme.js 隐藏。
    var account = document.querySelector('button[aria-label^="\u8d26\u53f7\u8be6\u60c5"], button[aria-label^="\u7528\u6237\u83dc\u5355"]');
    if (!account) return;
    account.style.removeProperty("display");
    account.style.removeProperty("visibility");
    var accountRow = account.parentElement;
    if (accountRow && accountRow !== document.body) {
      accountRow.style.removeProperty("display");
      accountRow.style.removeProperty("visibility");
      accountRow.style.removeProperty("height");
      accountRow.style.removeProperty("overflow");
    }
  }
  function renameSolutionLabels() {
    renameScheduled = false;
    simplifyBaSidebar();
    hideGlobalNav();
    hideOpsCenter();
    var nodes = document.querySelectorAll("a,button,span,div,h1,h2,h3");
    for (var i = 0; i < nodes.length; i += 1) {
      var element = nodes[i];
      if (element.children.length !== 0) continue;
      var text = (element.textContent || "").trim();
      if (text === "\u89e3\u51b3\u65b9\u6848") element.textContent = "\u9886\u57df\u667a\u80fd\u4f53";
      if (text === "\u4e0a\u4f20\u89e3\u51b3\u65b9\u6848") element.textContent = "\u4e0a\u4f20\u9886\u57df\u667a\u80fd\u4f53";
    }
  }
  var renameAgain = false;
  function scheduleRename() {
    if (renameScheduled) {
      renameAgain = true;
      return;
    }
    renameScheduled = true;
    window.requestAnimationFrame(function () {
      renameScheduled = false;
      var follow = renameAgain;
      renameAgain = false;
      renameSolutionLabels();
      if (follow || renameAgain) scheduleRename();
    });
  }
  if (hideNav && String(window.location.port) !== "8010") {
    [0, 300, 900, 1800].forEach(function (delay) {
      window.setTimeout(hideGlobalNav, delay);
    });
  }
  if (document.documentElement) {
    new MutationObserver(scheduleRename).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
  document.addEventListener("DOMContentLoaded", scheduleRename, { once: true });
  }

  if (document.documentElement) {
    new MutationObserver(hideOpsCenter).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  var token = "";
  var resolveToken;
  var tokenReady = new Promise(function (resolve) {
    resolveToken = resolve;
  });

  function waitToken() {
    return token ? Promise.resolve(token) : tokenReady;
  }
  function isApiUrl(value) {
    try {
      var url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return false;
      return (
        url.pathname === "/api" ||
        url.pathname.indexOf("/api/") === 0 ||
        url.pathname === "/socket.io" ||
        url.pathname.indexOf("/socket.io/") === 0
      );
    } catch (_) {
      return false;
    }
  }
  function addBearer(headers, value) {
    var next = new Headers(headers || undefined);
    next.set("Authorization", "Bearer " + value);
    return next;
  }
  function originAllowed(origin) {
    if (!origin) return false;
    if (originAllow && !originAllow[origin]) return false;
    if (parentOrigin && origin !== parentOrigin) return false;
    return true;
  }
  function barePath() {
    var path = String(window.location.pathname || "/");
    return path.replace(/\/+$/, "") || "/";
  }

  // 对话页（/ 与 /chat）保持栏内滚动。
  function isConversation() {
    var bare = barePath();
    return bare === "/" || bare === "/chat" || bare.indexOf("/chat/") === 0;
  }

  // 分栏工作台（对话、项目、技能编辑器）只占满 iframe。
  // 不要给它们加 blade-embed-grow：那会把 h-screen / h-full 改成自动高度，
  // /projects 会从约 1056 涨到 3588，技能编辑器同样被拉高，分割线跟着坏掉。
  function hasWorkspaceSplit() {
    var handles = document.querySelectorAll("[data-resize-handle], [data-panel-resize-handle-id]");
    for (var i = 0; i < handles.length; i += 1) {
      var handle = handles[i];
      if (handle.getAttribute("data-blade-hide-nav") === "handle") continue;
      var controls = handle.getAttribute("aria-controls") || "";
      if (controls === "unified-shell-sidebar") continue;
      var rect = handle.getBoundingClientRect();
      if (rect.height > 80 && rect.left > 24) return true;
    }
    return false;
  }

  function isViewportApp() {
    if (isConversation()) return true;
    var bare = barePath();
    if (bare === "/projects" || bare.indexOf("/projects/") === 0) return true;
    if (bare.indexOf("/p/") === 0) return true;
    if (bare.indexOf("/studio/") === 0) return true;
    if (bare.indexOf("/sol/") === 0) return true;
    if (hasWorkspaceSplit()) return true;
    return false;
  }

  var lastEmbedMode = "";
  var lastEmbedHeight = -1;
  var layoutStamp = 0;
  var publishedStamp = -1;

  // 只量被裁掉的内容高度。不改 h-screen，避免分栏页跟着文档一起变高。
  function contentExtent() {
    var view = window.innerHeight || 800;
    var max = 0;
    var clipped = false;
    var nodes = document.querySelectorAll(
      "#root, #root > div, main, section, article, .h-screen, .min-h-screen, .overflow-y-auto, .overflow-auto, .overflow-hidden, .overflow-y-hidden",
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest && node.closest("aside, [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]")) continue;
      var style = window.getComputedStyle(node);
      if (style.display === "none" || style.position === "fixed") continue;
      var rect = node.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 20) continue;
      var extra = node.scrollHeight - node.clientHeight;
      var bottom = rect.bottom + (window.scrollY || 0);
      if (extra > 12 && rect.width > window.innerWidth * 0.45) {
        clipped = true;
        bottom = rect.top + (window.scrollY || 0) + node.scrollHeight;
      }
      if (bottom > max) max = bottom;
    }
    if (!clipped) return Math.ceil(view);
    return Math.ceil(Math.max(max + 8, view));
  }

  function clearPageScroll() {
    var nodes = document.querySelectorAll("[data-blade-page-scroll]");
    for (var i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute("data-blade-page-scroll");
  }

  // 目录页只给一个视口内的容器打开滚动。不改 h-screen / h-full 的高度，避免分栏被拉高。
  function pickScrollTarget() {
    var root = document.getElementById("root");
    var best = root;
    var bestExtra = root ? root.scrollHeight - root.clientHeight : 0;
    var nodes = document.querySelectorAll(
      "#root, #root > div, main, section, article, .h-screen, .min-h-screen, .overflow-hidden, .overflow-y-hidden, .overflow-auto, .overflow-y-auto",
    );
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node === document.documentElement || node === document.body) continue;
      if (node.closest && node.closest("aside, [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]")) continue;
      var style = window.getComputedStyle(node);
      if (style.display === "none" || style.position === "fixed") continue;
      var rect = node.getBoundingClientRect();
      if (rect.width < Math.max(80, window.innerWidth * 0.45) || rect.height < 40) continue;
      var extra = node.scrollHeight - node.clientHeight;
      if (extra > bestExtra + 8) {
        best = node;
        bestExtra = extra;
      }
    }
    return best || root;
  }

  function armPageScroll(viewport) {
    if (!document.documentElement) return;
    if (viewport) {
      document.documentElement.classList.remove("blade-embed-scroll");
      clearPageScroll();
      return;
    }
    document.documentElement.classList.add("blade-embed-scroll");
    var target = pickScrollTarget();
    var nodes = document.querySelectorAll("[data-blade-page-scroll]");
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i] !== target) nodes[i].removeAttribute("data-blade-page-scroll");
    }
    if (target && target.getAttribute("data-blade-page-scroll") !== "1") {
      target.setAttribute("data-blade-page-scroll", "1");
    }
  }

  function measureEmbed() {
    var viewport = isViewportApp();
    if (document.documentElement) {
      document.documentElement.classList.add("is-embedded");
      document.documentElement.classList.add("blade-embed-frame");
      document.documentElement.classList.remove("blade-embed-grow");
    }
    armPageScroll(viewport);
    if (viewport) return { mode: "fill", fit: "viewport", height: 0 };
    return { mode: "content", fit: "content", height: contentExtent() };
  }

  function postEmbed(type, size) {
    var target = parentOrigin || "*";
    window.parent.postMessage(
      {
        type: type,
        service: service,
        plugin: PLUGIN_VERSION,
        mode: size.mode,
        fit: size.fit,
        height: size.height,
      },
      target,
    );
  }

  function announceReady() {
    postEmbed("blade-embed-ready", measureEmbed());
  }

  function publishResize() {
    var size = measureEmbed();
    var view = window.innerHeight || 0;
    // 父页面已经按上次高度拉过 iframe，而 DOM 没变却又变高，是布局回灌，停在上次高度。
    var feedback = size.mode !== "fill"
      && lastEmbedHeight > 0
      && size.height > lastEmbedHeight + 64
      && Math.abs(view - lastEmbedHeight) < 48
      && layoutStamp === publishedStamp;
    if (feedback) size = { mode: size.mode, fit: size.fit, height: lastEmbedHeight };
    if (size.mode === lastEmbedMode && Math.abs(size.height - lastEmbedHeight) <= 1) return;
    lastEmbedMode = size.mode;
    lastEmbedHeight = size.height;
    publishedStamp = layoutStamp;
    postEmbed("blade-embed-resize", size);
  }

  var resizeTimer = 0;
  function scheduleResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(publishResize, 60);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    if (!originAllowed(event.origin) && parentOrigin) return;
    if (originAllow && !originAllow[event.origin]) return;
    var data = event.data || {};
    if (data.type === "blade-embed-sidebar-pad") {
      applySpaceTabPad(data.px);
      return;
    }
    if (data.type !== "blade-embed-token" || typeof data.token !== "string") return;
    var value = data.token.trim().replace(/^Bearer\s+/i, "");
    if (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.slice(1, -1).trim();
    }
    if (!value || !/^[\x21-\x7e]+$/.test(value)) return;
    if (!parentOrigin) parentOrigin = event.origin;
    token = value;
    resolveToken(value);
    retargetMediaTree(document);
    window.dispatchEvent(new CustomEvent("blade-embed-token-ready", { detail: { service: service } }));
    window.parent.postMessage(
      { type: "blade-embed-authenticated", service: service, plugin: PLUGIN_VERSION },
      parentOrigin,
    );
  });

  // 技能目录一次大约几十 KB。React Query 只放内存，iframe 重挂就丢，每次回来都是骨架屏。
  // 有上次成功的 JSON 时立刻交回，后台再拉一份刷新，下次进来不用等网络。
  var SKILL_CATALOG_CACHE_KEY = "blade-skill-catalog-v1";
  var SKILL_CATALOG_MAX_CHARS = 2 * 1024 * 1024;

  function isSkillCatalogGet(input, init) {
    var method = "GET";
    if (init && init.method) method = String(init.method).toUpperCase();
    else if (input instanceof Request && input.method) method = String(input.method).toUpperCase();
    if (method !== "GET") return false;
    var requestUrl = input instanceof Request ? input.url : String(input || "");
    try {
      var url = new URL(requestUrl, window.location.href);
      var path = url.pathname || "";
      var suffix = "/api/skill-store/catalog";
      return path.length >= suffix.length && path.slice(-suffix.length) === suffix;
    } catch (_) {
      return false;
    }
  }

  function readSkillCatalogCache() {
    try {
      var text = window.localStorage.getItem(SKILL_CATALOG_CACHE_KEY);
      if (!text || text.length > SKILL_CATALOG_MAX_CHARS) return "";
      JSON.parse(text);
      return text;
    } catch (_) {
      return "";
    }
  }

  function isJsonCatalogResponse(response) {
    if (!response || !response.ok) return false;
    var type = "";
    try {
      type = String(response.headers.get("content-type") || "").toLowerCase();
    } catch (_) {}
    if (!type) return true;
    return type.indexOf("json") !== -1;
  }

  function storeSkillCatalogResponse(response) {
    if (!isJsonCatalogResponse(response)) return;
    var clone;
    try {
      clone = response.clone();
    } catch (_) {
      return;
    }
    clone.text().then(function (body) {
      if (!body || body.length > SKILL_CATALOG_MAX_CHARS) return;
      if (body.charCodeAt(0) === 0xfeff) body = body.slice(1);
      try {
        JSON.parse(body);
        if (window.localStorage.getItem(SKILL_CATALOG_CACHE_KEY) === body) return;
        window.localStorage.setItem(SKILL_CATALOG_CACHE_KEY, body);
      } catch (_) {}
    }).catch(function () {});
  }

  // 后台只更新本地目录，不把这次响应交回页面。不沿用页面的 AbortSignal，避免和当次渲染绑在一起。
  function refreshSkillCatalog(input, init, value) {
    var requestUrl = input instanceof Request ? input.url : String(input || "");
    var headers = input instanceof Request ? input.headers : init && init.headers;
    authorizedFetch(requestUrl, { method: "GET", headers: headers, credentials: "include" })
      .then(storeSkillCatalogResponse)
      .catch(function () {});
  }

  function authorizedFetch(input, init, value) {
    if (input instanceof Request) {
      var merged = new Request(input, init);
      return nativeFetch(new Request(merged, { headers: addBearer(merged.headers, value) }));
    }
    var next = Object.assign({}, init || {}, { headers: addBearer(init && init.headers, value) });
    return nativeFetch(input, next);
  }

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var requestUrl = input instanceof Request ? input.url : String(input);
    if (!isApiUrl(requestUrl)) return nativeFetch(input, init);
    var catalog = isSkillCatalogGet(input, init);
    if (catalog) {
      var cachedText = readSkillCatalogCache();
      if (cachedText) {
        waitToken().then(function (value) {
          refreshSkillCatalog(input, init, value);
        });
        return Promise.resolve(new Response(cachedText, { status: 200, headers: { "Content-Type": "application/json" } }));
      }
    }
    return waitToken().then(function (value) {
      var pending = authorizedFetch(input, init, value);
      if (!catalog) return pending;
      return pending.then(function (response) {
        storeSkillCatalogResponse(response);
        return response;
      });
    });
  };

  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__bladeEmbedApi = isApiUrl(url);
    return nativeOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    if (!xhr.__bladeEmbedApi) return nativeSend.call(xhr, body);
    waitToken().then(function (value) {
      xhr.setRequestHeader("Authorization", "Bearer " + value);
      nativeSend.call(xhr, body);
    });
  };

  // 工作空间下载不走 fetch/XHR。文件树会临时造一个带 download 的 <a> 再 click()，
  // 这个节点不在文档里，document 上的点击监听看不到。这里只认会话文件地址，
  // 用内存里的令牌发请求。令牌不写进 URL。没有令牌时保持原来的跳转。
  function sessionFileUrl(href) {
    var url = sameOriginHttp(href);
    if (!url) return null;
    var path = url.pathname || "";
    if (/^\/api\/sessions\/[^/]+\/files\/.+/.test(path)) return url;
    if (/^\/api\/sessions\/[^/]+\/download-dir\/.+/.test(path)) return url;
    return null;
  }

  function filenameFromDisposition(header) {
    var text = String(header || "");
    var star = /filename\*\s*=\s*([^;]+)/i.exec(text);
    if (star) {
      var raw = star[1].trim().replace(/^"(.*)"$/, "$1");
      var encoded = raw;
      var splitAt = raw.indexOf("''");
      if (splitAt !== -1) encoded = raw.slice(splitAt + 2);
      try {
        encoded = decodeURIComponent(encoded);
      } catch (_) {}
      if (encoded) return encoded;
    }
    var plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(text);
    if (!plain) return "";
    if (plain[2] != null) return plain[2];
    return String(plain[1] || "").trim().replace(/^"(.*)"$/, "$1");
  }

  function downloadBasename(name) {
    var text = String(name || "").replace(/[\u0000-\u001f]/g, " ").trim();
    var parts = text.split(/[/\\]/);
    text = parts[parts.length - 1] || "";
    if (!text || text === "." || text === "..") return "";
    return text;
  }

  function saveName(disposition, hintedName, url) {
    var fromHeader = downloadBasename(filenameFromDisposition(disposition));
    if (fromHeader) return fromHeader;
    var fromHint = downloadBasename(hintedName);
    if (fromHint) return fromHint;
    var segment = "";
    try {
      segment = decodeURIComponent((url.pathname || "").split("/").pop() || "");
    } catch (_) {
      segment = (url.pathname || "").split("/").pop() || "";
    }
    return downloadBasename(segment) || "download";
  }

  function triggerBrowserSave(blob, name) {
    var objectUrl = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = name;
    if (document.body) document.body.appendChild(anchor);
    try {
      nativeAnchorClick.call(anchor);
    } finally {
      if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
      window.setTimeout(function () {
        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      }, 1500);
    }
  }

  function saveSessionFile(url, hintedName) {
    var value = token;
    if (!value) return;
    nativeFetch(url.toString(), {
      method: "GET",
      headers: { Authorization: "Bearer " + value },
      credentials: "omit",
    }).then(function (response) {
      if (!response || !response.ok) return;
      var disposition = "";
      try { disposition = response.headers.get("Content-Disposition") || ""; } catch (_) {}
      var name = saveName(disposition, hintedName, url);
      return response.blob().then(function (blob) {
        triggerBrowserSave(blob, name);
      });
    }).catch(function () {});
  }

  function takeSessionFile(href, hintedName) {
    try {
      if (!token || typeof nativeFetch !== "function") return false;
      var url = sessionFileUrl(href);
      if (!url) return false;
      saveSessionFile(url, hintedName || "");
      return true;
    } catch (_) {
      return false;
    }
  }

  var nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var hinted = "";
    var href = "";
    try {
      if (this.getAttribute) hinted = this.getAttribute("download") || "";
      href = this.href;
    } catch (_) {}
    if (takeSessionFile(href, hinted)) return;
    return nativeAnchorClick.apply(this, arguments);
  };

  function installLocationFileGuard() {
    var proto = window.Location && window.Location.prototype;
    if (!proto) return;
    ["assign", "replace"].forEach(function (name) {
      var orig = proto[name];
      if (typeof orig !== "function") return;
      try {
        proto[name] = function (nextUrl) {
          if (takeSessionFile(nextUrl, "")) return;
          return orig.call(this, nextUrl);
        };
      } catch (_) {}
    });
    try {
      var desc = Object.getOwnPropertyDescriptor(proto, "href");
      if (!desc || !desc.configurable || typeof desc.set !== "function" || typeof desc.get !== "function") return;
      Object.defineProperty(proto, "href", {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { return desc.get.call(this); },
        set: function (nextUrl) {
          if (takeSessionFile(nextUrl, "")) return;
          desc.set.call(this, nextUrl);
        },
      });
    } catch (_) {}
  }
  installLocationFileGuard();

  // <img>/<video> 不走 fetch，嵌进别的站点时也带不上 8020 的会话 Cookie。
  // 素材接口只认地址上的令牌，这里把已有的嵌入令牌补到同源 /api 图片上。
  function mediaUrlWithToken(raw) {
    if (!token || !raw) return "";
    var text = String(raw);
    if (text.indexOf("blob:") === 0 || text.indexOf("data:") === 0) return "";
    try {
      var url = new URL(text, window.location.href);
      if (url.origin !== window.location.origin) return "";
      if (url.pathname !== "/api" && url.pathname.indexOf("/api/") !== 0) return "";
      if (url.searchParams.has("token")) return "";
      url.searchParams.set("token", token);
      return url.toString();
    } catch (_) {
      return "";
    }
  }
  function deferSkillGridImage(node) {
    var path = window.location.pathname || "";
    if (path !== "/skills" && path.indexOf("/skills/") !== 0) return;
    var parent = node.parentElement;
    while (parent && parent !== document.documentElement) {
      var cls = String(parent.className || "");
      if (cls.indexOf("grid-cols-1") !== -1 && cls.indexOf("lg:grid-cols-3") !== -1) {
        node.loading = "lazy";
        node.decoding = "async";
        return;
      }
      parent = parent.parentElement;
    }
  }
  function retargetMedia(node) {
    if (!node || node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === "IMG") deferSkillGridImage(node);
    if (tag !== "IMG" && tag !== "VIDEO" && tag !== "AUDIO" && tag !== "SOURCE") return;
    var attr = node.getAttribute("src");
    var next = mediaUrlWithToken(attr);
    if (!next || next === node.src) return;
    node.src = next;
  }
  function retargetMediaTree(root) {
    if (!token || !root) return;
    if (root.nodeType === 1) retargetMedia(root);
    if (!root.querySelectorAll) return;
    var nodes = root.querySelectorAll("img[src], video[src], audio[src], source[src]");
    for (var i = 0; i < nodes.length; i += 1) retargetMedia(nodes[i]);
  }
  if (document.documentElement) {
    new MutationObserver(function (records) {
      if (!token) return;
      for (var i = 0; i < records.length; i += 1) {
        var record = records[i];
        if (record.type === "attributes") {
          retargetMedia(record.target);
          continue;
        }
        var added = record.addedNodes;
        for (var j = 0; j < added.length; j += 1) retargetMediaTree(added[j]);
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  window.__bladeEmbedAuth = {
    version: PLUGIN_VERSION,
    getToken: function () {
      return token;
    },
    getService: function () {
      return service;
    },
    getParentOrigin: function () {
      return parentOrigin;
    },
  };

  announceReady();
  var readyTimer = window.setInterval(function () {
    if (token) window.clearInterval(readyTimer);
    else announceReady();
  }, 1000);
  if (window.ResizeObserver && document.documentElement) {
    new ResizeObserver(scheduleResize).observe(document.documentElement);
    if (document.body) new ResizeObserver(scheduleResize).observe(document.body);
  }
  if (document.documentElement) {
    new MutationObserver(function () {
      layoutStamp += 1;
      scheduleResize();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener("load", scheduleResize);
  scheduleResize();
})();
