/* BLADE_LOGO_FREE_V3_BEGIN
 * 只做两件事：隐藏品牌 logo、隐藏左下角账号（用户名）区域。
 *
 * V3 移除了 V2 及之前所有的配色/主题改动（青黑主题、暗色 class、mermaid 重绘等），
 * 界面颜色完全交还给产品自身。
 *
 * 账号按钮定位：BA 用 aria-label“账号详情…”前缀；BH 无 aria-label，
 * 改为「侧栏内最后一个含圆形头像的按钮」。两种定位都只拔掉名字、保留按钮
 * 本身——它打开的菜单里有设置/我的记忆/深色模式/退出登录，必须保留。
 */
(function () {
  "use strict";

  var BRANDING_ATTR = "data-blade-branding-hidden";
  var GEAR_ATTR = "data-blade-gear";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var observer;
  var scheduled = false;

  function markHidden(element) {
    if (!element || element === document.body || element === document.documentElement) return;
    element.setAttribute(BRANDING_ATTR, "true");
  }

  function firstMatch(list) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i]) return list[i];
    }
    return null;
  }

  // 齿轮图标（lucide "settings" 的路径），stroke 用 currentColor 继承圆圈前景色。
  function buildGear(size) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute(GEAR_ATTR, "true");

    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute(
      "d",
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0" +
        "l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72" +
        "v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08" +
        "a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18" +
        "a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39" +
        "a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09" +
        "a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25" +
        "a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
    );
    svg.appendChild(path);

    var circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "3");
    svg.appendChild(circle);
    return svg;
  }

  // \u5706\u5f62\u5934\u50cf\u5bb9\u5668\uff1aBA \u7528 <span>\uff0cBH \u7528 <div>\uff0c\u4e24\u8005\u90fd\u5e26
  // rounded-full\uff0c\u4e14\u90fd\u4e0d\u542b <img>\uff08\u81ea\u5b9a\u4e49\u5934\u50cf\u65f6\u662f <img>\uff0c\u4e0d\u52a8\uff09\u3002
  function isAvatarUnit(node) {
    if (node.tagName !== "SPAN" && node.tagName !== "DIV") return false;
    if (node.querySelector("img, svg")) return false;
    return String(node.className || "").indexOf("rounded-full") !== -1;
  }

  function hasAvatarUnit(button) {
    var kids = button.children;
    for (var i = 0; i < kids.length; i += 1) {
      if (isAvatarUnit(kids[i])) return true;
    }
    return false;
  }

  // \u8d26\u53f7\u6309\u94ae\u5b9a\u4f4d\uff1a
  //  1) BA\uff1a\u5e26 aria-label \u201c\u8d26\u53f7\u8be6\u60c5\u2026\u201d \u7684\u6309\u94ae\uff08\u6700\u7a33\uff09
  //  2) BH\uff1a\u65e0 aria-label\uff0c\u9760\u201c\u4fa7\u680f\u5185\u6700\u540e\u4e00\u4e2a\u542b\u5706\u5f62\u5934\u50cf\u7684\u6309\u94ae\u201d\u5b9a\u4f4d\u3002
  //     \u4ece aside/nav \u5f00\u59cb\u626b\uff0c\u907f\u514d\u628a\u804a\u5929\u6d88\u606f\u91cc\u7684\u5934\u50cf\u8bef\u5224\u6210\u8d26\u53f7\u6309\u94ae\u3002
  function accountButton() {
    var titled = firstMatch([
      document.querySelector('button[aria-label^="\u8d26\u53f7\u8be6\u60c5"]'),
      document.querySelector('a[aria-label^="\u8d26\u53f7\u8be6\u60c5"]'),
    ]);
    if (titled) return titled;

    var scopes = [];
    var aside = document.querySelector("aside");
    if (aside) scopes.push(aside);
    var nav = document.querySelector("nav");
    if (nav) scopes.push(nav);
    scopes.push(document);
    for (var s = 0; s < scopes.length; s += 1) {
      var buttons = scopes[s].querySelectorAll("button");
      for (var i = buttons.length - 1; i >= 0; i -= 1) {
        if (hasAvatarUnit(buttons[i])) return buttons[i];
      }
    }
    return null;
  }

  // 把圆圈里的首字母换成齿轮图标。用户已上传头像（img）时不动。
  function gearifyAvatar() {
    var button = accountButton();
    if (!button) return;
    if (button.querySelector("[" + GEAR_ATTR + "]")) return;

    var kids = button.children;
    var avatar = null;
    var i;

    for (i = 0; i < kids.length; i += 1) {
      var kid = kids[i];
      if (!isAvatarUnit(kid)) continue;
      avatar = kid;
      break;
    }
    if (!avatar) {
      for (i = 0; i < kids.length; i += 1) {
        var node = kids[i];
        if (node.tagName !== "SPAN" && node.tagName !== "DIV") continue;
        if (node.querySelector("img, svg")) continue;
        if ((node.textContent || "").trim().length === 1) {
          avatar = node;
          break;
        }
      }
    }
    if (!avatar) return;

    while (avatar.firstChild) avatar.removeChild(avatar.firstChild);
    avatar.appendChild(buildGear(15));
  }

  // 隐藏左下角的“用户名文本”，但保留账号按钮本身。
  // 账号按钮的弹层里有：设置 / 我的记忆 / 切换到深色模式 / 退出登录，
  // 藏掉整个按钮会连设置入口一起藏掉，所以这里只抹掉名字。
  function hideAccountName() {
    var button = accountButton();
    if (!button) return;

    var name = button.querySelector('[class*="truncate"]');
    if (name) {
      markHidden(name);
      return;
    }

    // 兜底：保留下第一个子元素（头像），隐藏其余子元素。
    var children = button.children;
    for (var i = 1; i < children.length; i += 1) markHidden(children[i]);
  }

  function hideBranding() {
    scheduled = false;

    var logos = document.querySelectorAll(
      'img[alt="Blade AI"], img[alt="Blade Hub"], img[alt="Blade Agent"], ' +
      'img[alt="Blade OS"], aside img[src*="logo" i], header img[src*="logo" i], ' +
      '[data-testid="logo"], [data-testid*="brand-logo" i]'
    );

    for (var i = 0; i < logos.length; i += 1) {
      var logo = logos[i];
      var alt = (logo.getAttribute("alt") || "").trim().toLowerCase();
      var wrapper;

      if (alt === "blade ai" || alt === "blade agent") {
        var link = logo.closest("a");
        wrapper = link && link.parentElement ? link.parentElement : logo.parentElement;
        markHidden(wrapper);
        if (wrapper && wrapper.parentElement) {
          wrapper.parentElement.setAttribute("data-blade-brand-row", "true");
        }
      } else if (alt === "blade hub" || alt === "blade os") {
        wrapper = logo.parentElement;
        markHidden(wrapper);
      } else {
        wrapper = logo.closest("a") || logo;
        markHidden(wrapper);
      }
    }

    var icons = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    for (var j = 0; j < icons.length; j += 1) icons[j].remove();

    hideAccountName();
    gearifyAvatar();
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(hideBranding);
  }

  function installStyle() {
    if (document.getElementById("blade-logo-free-style")) return;
    var style = document.createElement("style");
    style.id = "blade-logo-free-style";
    style.textContent =
      "[" + BRANDING_ATTR + '="true"] { display: none !important; }\n' +
      '[data-blade-brand-row="true"] { justify-content: flex-end !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function start() {
    installStyle();
    scheduleScan();
    if (document.documentElement) {
      observer = new MutationObserver(scheduleScan);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
/* BLADE_LOGO_FREE_V3_END */
