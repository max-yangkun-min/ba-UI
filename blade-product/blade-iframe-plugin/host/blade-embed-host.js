(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BladeEmbedHost = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function normalizeToken(token) {
    var value = String(token || "").trim().replace(/^Bearer\s+/i, "");
    if (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
      value = value.slice(1, -1).trim();
    }
    if (!value || !/^[\x21-\x7e]+$/.test(value)) return "";
    return value;
  }

  function frameOrigin(frame) {
    return new URL(frame.getAttribute("src") || frame.src, window.location.href).origin;
  }

  function bind(frame, options) {
    options = options || {};
    function getToken() {
      return normalizeToken(typeof options.getToken === "function" ? options.getToken() : options.token);
    }
    function sendToken() {
      var token = getToken();
      if (!token || !frame.contentWindow) return false;
      frame.contentWindow.postMessage({ type: "blade-embed-token", token: token }, frameOrigin(frame));
      if (options.onStatus) options.onStatus("sent");
      return true;
    }
    var lastSize = null;
    function applySize(data) {
      if (!data) return;
      lastSize = data;
      frame.setAttribute("scrolling", "no");
      frame.style.overflow = "hidden";
      var content = data.mode === "content" || data.mode === "grow" || data.fit === "content";
      var height = typeof data.height === "number" ? data.height : 0;
      if (content && height >= 320) {
        frame.style.height = Math.ceil(height) + "px";
        return;
      }
      var top = frame.getBoundingClientRect().top;
      frame.style.height = Math.max(320, Math.round(window.innerHeight - Math.max(0, top))) + "px";
    }
    function onResize() {
      if (!lastSize) return;
      var content = lastSize.mode === "content" || lastSize.mode === "grow" || lastSize.fit === "content";
      if (!content) applySize(lastSize);
    }
    function onMessage(event) {
      if (event.source !== frame.contentWindow) return;
      if (event.origin !== frameOrigin(frame)) return;
      var type = event.data && event.data.type;
      if (type === "blade-embed-ready" || type === "blade-embed-resize") applySize(event.data);
      if (type === "blade-embed-ready") {
        if (options.onStatus) options.onStatus("ready", event.data);
        sendToken();
      }
      if (type === "blade-embed-authenticated" && options.onStatus) {
        options.onStatus("authenticated", event.data);
      }
    }
    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onResize);
    return {
      sendToken: sendToken,
      destroy: function () {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("resize", onResize);
      },
    };
  }

  function urls(base) {
    base = base || {};
    var ba = String(base.ba || "").replace(/\/$/, "");
    var bh = String(base.bh || "").replace(/\/$/, "");
    return {
      ba: ba + "/?iframe=1",
      skills: bh + "/skills?mode=embed",
      solutions: bh + "/solutions?mode=embed",
    };
  }

  // Direct no-login link (server-side session cookie via autologin.html).
  // Works for both BA (:8020) and BH (:8010) because the cookie is shared
  // per host, not per port. Same token, same link shape.
  function autologinUrl(base, token, options) {
    options = options || {};
    var root = String(base || "").replace(/\/$/, "");
    var link = root + "/autologin.html?token=" + encodeURIComponent(normalizeToken(token));
    if (options.refreshToken) {
      link += "&refresh_token=" + encodeURIComponent(normalizeToken(options.refreshToken));
    }
    if (options.next) link += "&next=" + encodeURIComponent(options.next);
    return link;
  }

  // Direct URL token (token appended to the page URL, stripped on load).
  function urlToken(page, token) {
    var link = String(page || "");
    var sep = link.indexOf("?") === -1 ? "?" : "&";
    return link + sep + "token=" + encodeURIComponent(normalizeToken(token));
  }

  return {
    bind: bind,
    normalizeToken: normalizeToken,
    urls: urls,
    autologinUrl: autologinUrl,
    urlToken: urlToken,
  };
});
