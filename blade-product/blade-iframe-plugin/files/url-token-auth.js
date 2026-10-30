/* BLADE_URL_TOKEN_AUTH_BEGIN
 * 让 http://<BA>:8020/chat?token=<JWT> / http://<BH>:8010/skills?mode=embed&token=<JWT>
 * 这种直链免登录进工作台 / 能力中心。
 *
 * 背景：BA 与 BH 前端都只认会话 Cookie，启动时调 /api/auth/me 且不带 Authorization，
 * 拿到 401 就跳 OAuth。两者后端都支持 ?token= 与 Bearer（实测 /api/auth/me
 * 两种都返回 200），但前端不读。本脚本在页面最早期注入，做三件事：
 *   1. 从 URL 取 token（?token= / ?access_token= 查询参数，或 #token= 片段）
 *   2. 给同源 /api、/socket.io 请求补 Authorization: Bearer
 *   3. 用 replaceState 把 token 从地址栏抹掉
 *
 * 安全边界：
 *   - 没带 token 时完全不接管 fetch/XHR，线上行为零变化
 *   - 只有"鉴权类"接口（/api/auth/*、/api/users/me*）返回 401 才判定 token
 *     不被接受并停止注入，让 BA 回到它原本的跳登录流程
 *   - 403 不等于凭证失效：BA 对个别接口会返回 403（权限不足 / 功能未开启），
 *     把它当成 token 失效会把整个会话废掉。实测 /api/users/me/profile 返回
 *     403，若据此停注入，后续 /api/chat-groups、/api/sessions 全部 401，
 *     工作台就会显示"分组加载失败"
 *   - 不写 Cookie / localStorage，token 只在内存
 *   - 显式开关：URL 上带 token 即视为同意注入
 */
(function () {
  "use strict";

  // 已是 iframe 嵌入态时交给 embed 桥接逻辑，避免两套注入叠加。
  try {
    if (window.parent !== window) return;
  } catch (_) {
    return;
  }

  function readQueryToken() {
    var search = String(window.location.search || "").replace(/^\?/, "");
    if (search) {
      var pairs = search.split("&");
      for (var i = 0; i < pairs.length; i += 1) {
        var index = pairs[i].indexOf("=");
        if (index < 0) continue;
        var key = pairs[i].slice(0, index);
        if (key !== "token" && key !== "access_token") continue;
        try {
          return decodeURIComponent(pairs[i].slice(index + 1).replace(/\+/g, " "));
        } catch (_) {
          return pairs[i].slice(index + 1);
        }
      }
    }
    var hash = String(window.location.hash || "").replace(/^#/, "");
    if (!hash) return "";
    try {
      return new URLSearchParams(hash).get("token") || "";
    } catch (_) {
      return "";
    }
  }

  function normalizeToken(raw) {
    var value = String(raw || "").trim().replace(/^Bearer\s+/i, "");
    if (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.slice(1, -1).trim();
    }
    if (!value || !/^[\x21-\x7e]+$/.test(value)) return "";
    return value;
  }

  var TOKEN = normalizeToken(readQueryToken());
  if (!TOKEN) return;

  // token 已被判定无效后置为 true，此后不再注入。
  var rejected = false;

  function isAuthUrl(value) {
    try {
      var url = new URL(value, window.location.href);
      if (url.origin !== window.location.origin) return false;
      return (
        url.pathname === "/api/auth" ||
        url.pathname.indexOf("/api/auth/") === 0 ||
        url.pathname.indexOf("/api/users/me") === 0
      );
    } catch (_) {
      return false;
    }
  }

  function noteStatus(value, requestUrl) {
    if (Number(value) !== 401) return;
    if (isAuthUrl(requestUrl)) rejected = true;
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

  function addBearer(headers) {
    var next = new Headers(headers || undefined);
    next.set("Authorization", "Bearer " + TOKEN);
    return next;
  }

  function stripToken() {
    try {
      var url = new URL(window.location.href);
      if (!url.searchParams.has("token") && !url.searchParams.has("access_token")) return;
      url.searchParams.delete("token");
      url.searchParams.delete("access_token");
      var next = url.pathname + (url.search === "?" ? "" : url.search) + url.hash;
      window.history.replaceState(window.history.state, "", next);
    } catch (_) {}
  }

  var nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") {
    var boundFetch = nativeFetch.bind(window);
    window.fetch = function (input, init) {
      var requestUrl = input instanceof Request ? input.url : String(input);
      if (rejected || !isApiUrl(requestUrl)) return boundFetch(input, init);
      var called;
      if (input instanceof Request) {
        var merged = new Request(input, init);
        called = boundFetch(new Request(merged, { headers: addBearer(merged.headers) }));
      } else {
        var next = Object.assign({}, init || {}, { headers: addBearer(init && init.headers) });
        called = boundFetch(input, next);
      }
      return called.then(
        function (response) {
          noteStatus(response && response.status, requestUrl);
          return response;
        },
        function (error) {
          throw error;
        }
      );
    };
  }

  function wrapOpen(XMLHttpRequest) {
    if (!XMLHttpRequest || !XMLHttpRequest.prototype) return;
    var nativeOpen = XMLHttpRequest.prototype.open;
    var nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function () {
      var args = arguments;
      var url = String(args[1] || "");
      var instrument = !rejected && isApiUrl(url);
      var result = nativeOpen.apply(this, args);
      if (instrument) {
        try {
          this.setRequestHeader("Authorization", "Bearer " + TOKEN);
        } catch (_) {}
      }
      this.__bladeUrlToken = instrument ? url : "";
      return result;
    };
    XMLHttpRequest.prototype.send = function (body) {
      var xhr = this;
      if (xhr.__bladeUrlToken) {
        var url = xhr.__bladeUrlToken;
        xhr.addEventListener("loadend", function () {
          noteStatus(xhr.status, url);
        });
      }
      return nativeSend.call(xhr, body);
    };
  }
  wrapOpen(window.XMLHttpRequest);

  // 必须放在最后：replaceState 会改变 document.readyState 并触发
  // DOMContentLoaded，要等所有钩子装完再执行。
  stripToken();
})();
/* BLADE_URL_TOKEN_AUTH_END */
