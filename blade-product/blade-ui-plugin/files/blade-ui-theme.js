/* blade-ui-plugin: mark real chrome so CSS can follow the UI spec without rewriting pages. */
(function () {
  "use strict";

  var scheduled = false;
  var observer = null;
  var sidebarExpandTries = 0;

  // 嵌入态对话侧栏只保留展开后的固定宽度。写在脚本开头，React 读偏好之前就生效。
  // 不写 expandedSize：应用自己的默认是约 280px 的百分比。写成 280 会被当成百分比，顶到最大宽度。
  function lockChatSidebarPref() {
    var embedded = false;
    try {
      embedded = window.parent !== window;
    } catch (err) {
      embedded = true;
    }
    if (!embedded && !/(?:^|[?&])iframe=1(?:&|$)/.test(window.location.search || "")) return;
    if ((window.location.pathname || "").indexOf("/projects") === 0) return;
    try {
      var next = JSON.stringify({ sidebarMode: "expanded", modeAdjusted: true });
      if (localStorage.getItem("blade-sidebar-pref") !== next) {
        localStorage.setItem("blade-sidebar-pref", next);
      }
    } catch (err) {}
  }
  lockChatSidebarPref();

  function conversationRoot() {
    return document.getElementById("unified-shell-main") || document.querySelector("main");
  }

  function chatIsLive() {
    var path = window.location.pathname || "";
    if (!/^\/chat(\/|$)/.test(path)) return false;
    // 分组详情也在 /chat/ 下，但不是会话正文。套上对话列会把指令、输入框和会话收成一条。
    if (/^\/chat\/groups(\/|$)/.test(path)) return false;
    if (/^\/chat\/.+/.test(path)) return true;
    if (/[?&]kb=/.test(window.location.search || "")) return true;
    var root = conversationRoot();
    return !!root && !root.querySelector("h1.home-greeting-in");
  }

  function clearConversationSkin(root) {
    if (!root) return;
    var marked = root.querySelectorAll("[data-blade-ui-card], [data-blade-ui-card-title], [data-blade-ui-card-desc], [data-blade-ui-card-icon], [data-blade-ui-btn], [data-blade-ui-field]");
    for (var i = 0; i < marked.length; i += 1) {
      marked[i].removeAttribute("data-blade-ui-card");
      marked[i].removeAttribute("data-blade-ui-card-title");
      marked[i].removeAttribute("data-blade-ui-card-desc");
      marked[i].removeAttribute("data-blade-ui-card-icon");
      marked[i].removeAttribute("data-blade-ui-btn");
      marked[i].removeAttribute("data-blade-ui-field");
    }
  }

  function inLiveConversation(node) {
    if (!node) return false;
    var column = document.querySelector("[data-blade-ui-chat-column]");
    return !!column && column.contains(node);
  }

  function markChatColumn() {
    var existing = document.querySelectorAll("[data-blade-ui-chat-column]");
    for (var i = 0; i < existing.length; i += 1) existing[i].removeAttribute("data-blade-ui-chat-column");
    if (!chatIsLive()) return null;
    var composer = document.querySelector(".home-input-card");
    if (!composer) return null;
    var workspace = null;
    var labels = document.querySelectorAll("button, [role='tab'], a, span");
    for (var n = 0; n < labels.length; n += 1) {
      var label = (labels[n].textContent || "").replace(/\s+/g, "");
      if (label === "工作空间") {
        workspace = labels[n];
        break;
      }
    }
    var column = composer;
    if (workspace) {
      var parent = composer.parentElement;
      while (parent && parent !== document.body && !parent.contains(workspace)) parent = parent.parentElement;
      if (parent && parent.contains(workspace)) {
        column = composer;
        while (column.parentElement && column.parentElement !== parent) column = column.parentElement;
      }
    } else {
      var main = document.getElementById("unified-shell-main");
      if (main && main.contains(composer)) column = main;
    }
    if (column.id === "unified-shell-sidebar") return null;
    column.setAttribute("data-blade-ui-chat-column", "true");
    return column;
  }

  function isChromeHeader(node) {
    if (!node || node.tagName !== "HEADER") return false;
    if (node.closest("[data-blade-ui-chat-column], [role='dialog'], [data-radix-popper-content-wrapper], [role='menu']")) return false;
    if (chatIsLive() && node.closest("#unified-shell-main")) return false;
    var rect = node.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.55) return false;
    if (rect.top > 6 || rect.height < 32 || rect.height > 88) return false;
    return true;
  }

  function compactText(node) {
    return (node.textContent || "").replace(/\s+/g, "");
  }

  function markBrand() {
    var nodes = document.querySelectorAll("a, span, div, p, strong, h1");
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.closest("[role='dialog'], [role='menu']")) continue;
      if (node.querySelector("a, button, input, textarea")) continue;
      var text = compactText(node);
      if (!text || text.length > 24) {
        node.removeAttribute("data-blade-ui-brand");
        continue;
      }
      var hit = text.indexOf("领铄") !== -1 || text.indexOf("BladeHub") !== -1 || text.indexOf("BladeAgent") !== -1 || text === "BladeAI";
      if (hit) node.setAttribute("data-blade-ui-brand", "true");
      else node.removeAttribute("data-blade-ui-brand");
    }
  }

  function isSkillStoreCard(el) {
    if (!el || el.tagName !== "BUTTON") return false;
    var path = window.location.pathname || "";
    if (path !== "/skills" && path.indexOf("/skills/") !== 0) return false;
    var cls = String(el.className || "");
    if (cls.indexOf("rounded-xl") === -1 || cls.indexOf("flex-col") === -1) return false;
    var parent = el.parentElement;
    if (!parent) return false;
    var parentCls = String(parent.className || "");
    return parentCls.indexOf("grid-cols-1") !== -1 && parentCls.indexOf("lg:grid-cols-3") !== -1;
  }

  function markButtons() {
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      var el = buttons[i];
      if (el.closest("#blade-ui-skill-cats")) continue;
      if (isSkillStoreCard(el)) {
        el.removeAttribute("data-blade-ui-btn");
        el.setAttribute("data-blade-ui-card", "true");
        continue;
      }
      if (isHomeScenarioChip(el)) continue;
      var cls = String(el.className || "");
      var rect = el.getBoundingClientRect();
      var text = (el.innerText || "").replace(/\s+/g, " ").trim();
      el.removeAttribute("data-blade-ui-btn");
      if (inLiveConversation(el)) continue;
      if (chatIsLive() && el.closest("#unified-shell-main")) {
        el.removeAttribute("data-blade-ui-card");
        continue;
      }
      if (cls.indexOf("hover:border-[hsl(var(--ring)/0.4)]") !== -1) {
        el.removeAttribute("data-blade-ui-card");
        continue;
      }
      if (cls.indexOf("factory-template-card") !== -1) {
        el.removeAttribute("data-blade-ui-card");
        continue;
      }
      if (el.getAttribute("role") === "combobox" && el.closest(".factory-projects-toolbar")) {
        el.removeAttribute("data-blade-ui-btn");
        continue;
      }
      if (rect.height > 64 || (cls.indexOf("rounded-xl") !== -1 && rect.height > 48) || cls.indexOf("flex-col") !== -1) {
        if (rect.height > 48) el.setAttribute("data-blade-ui-card", "true");
        continue;
      }
      var kind = "";
      if (cls.indexOf("destructive") !== -1 || cls.indexOf("bg-red-") !== -1) kind = "danger";
      else if (cls.indexOf("bg-teal-") !== -1) kind = "primary-sm";
      else if (cls.indexOf("bg-[hsl(var(--primary))]") !== -1 || /(^|\s)bg-primary(\s|$)/.test(cls) || cls.indexOf("bg-blue-600") !== -1 || cls.indexOf("bg-blue-500") !== -1) {
        kind = cls.indexOf("text-xs") !== -1 || (rect.height > 0 && rect.height <= 28) ? "primary-sm" : "primary";
      } else if (cls.indexOf("text-[12.5px]") !== -1) {
        kind = cls.indexOf("font-medium") !== -1 ? "chip-on" : "chip";
      }
      if (!kind) continue;
      if (kind === "primary" && text.length > 12) continue;
      el.setAttribute("data-blade-ui-btn", kind);
    }
  }

  function markFields() {
    var path = window.location.pathname || "";
    if (/^\/chat\/groups(\/|$)/.test(path)) {
      var stale = document.querySelectorAll("#unified-shell-main [data-blade-ui-field]");
      for (var s = 0; s < stale.length; s += 1) stale[s].removeAttribute("data-blade-ui-field");
      return;
    }
    var inputs = document.querySelectorAll("input, select");
    for (var i = 0; i < inputs.length; i += 1) {
      var input = inputs[i];
      var type = (input.getAttribute("type") || "").toLowerCase();
      if (type === "checkbox" || type === "radio" || type === "file" || type === "hidden" || type === "range" || type === "color") continue;
      if (inLiveConversation(input)) continue;
      if (chatIsLive() && input.closest("#unified-shell-main")) continue;
      var box = input.parentElement;
      if (!box || box === document.body) continue;
      if (box.querySelectorAll("input, textarea, select").length !== 1) continue;
      if (box.tagName === "LABEL") continue;
      if (box.querySelector(":scope > span") && box.querySelector("input, textarea")) continue;
      var rect = box.getBoundingClientRect();
      if (rect.height >= 28 && rect.height <= 72 && rect.width >= 96) box.setAttribute("data-blade-ui-field", "true");
    }
  }

  function markNav(selector, test) {
    var links = document.querySelectorAll(selector);
    for (var i = 0; i < links.length; i += 1) {
      var el = links[i];
      var cls = String(el.className || "");
      if (!test(cls)) {
        if (el.getAttribute("data-blade-ui-nav")) el.removeAttribute("data-blade-ui-nav");
        continue;
      }
      var on = /(^|\s)bg-sidebar-item-active(\s|$)/.test(cls);
      el.setAttribute("data-blade-ui-nav", on ? "on" : "item");
    }
  }

  function markCardParts(card) {
    var title = card.querySelector("h1, h2, h3, h4");
    if (!title) {
      var nodes = card.querySelectorAll("div, span, p");
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        if (node.children.length > 0) continue;
        if (node.closest("[class*='rounded-full']")) continue;
        var text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length < 2 || text.length > 40) continue;
        title = node;
        break;
      }
    }
    if (title) title.setAttribute("data-blade-ui-card-title", "true");
    var descs = card.querySelectorAll("p, [class*='line-clamp']");
    for (var j = 0; j < descs.length; j += 1) {
      if (descs[j] !== title) descs[j].setAttribute("data-blade-ui-card-desc", "true");
    }
    var icon = card.querySelector("span[class*='grid'][class*='shrink-0'], div[class*='h-10'][class*='w-10'], div[class*='h-9'][class*='w-9']");
    if (icon) icon.setAttribute("data-blade-ui-card-icon", "true");
  }

  function markCards() {
    var nodes = document.querySelectorAll("main [class*='rounded-xl'], [class*='rounded-xl'][class*='border'], button[class*='rounded-xl']");
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (isSkillStoreCard(el)) {
        el.setAttribute("data-blade-ui-card", "true");
        markCardParts(el);
        continue;
      }
      if (el.closest("[role='dialog'], [role='menu']")) continue;
      if (el.closest("#factory-templates-section, .factory-template-card")) continue;
      if (el.closest(".resize-line") || el.querySelector(".resize-line")) continue;
      if (inLiveConversation(el)) continue;
      var cls = String(el.className || "");
      if (cls.indexOf("border-dashed") !== -1) continue;
      var rect = el.getBoundingClientRect();
      if (rect.height < 64 || rect.width < 160) continue;
      if (rect.width > window.innerWidth * 0.72 && rect.height > window.innerHeight * 0.55) continue;
      el.setAttribute("data-blade-ui-card", "true");
      markCardParts(el);
    }
  }

  function hideLogos() {
    var locks = document.querySelectorAll("[aria-label='品牌标识']");
    for (var i = 0; i < locks.length; i += 1) locks[i].setAttribute("data-blade-ui-logo", "hide");
    var imgs = document.querySelectorAll("img");
    for (var j = 0; j < imgs.length; j += 1) {
      var img = imgs[j];
      var hint = (img.getAttribute("src") || "") + " " + (img.getAttribute("alt") || "");
      if (!/logo|blade/i.test(hint)) continue;
      img.setAttribute("data-blade-ui-logo", "hide");
      var lock = img.closest("[aria-label='品牌标识'], [data-blade-branding-hidden='true']");
      if (lock) lock.setAttribute("data-blade-ui-logo", "hide");
    }
    var labels = document.querySelectorAll("span, div, a, p, h1, h2, h3");
    for (var k = 0; k < labels.length; k += 1) {
      var el = labels[k];
      if (el.children.length > 2) continue;
      if (el.closest("[data-blade-ui-card='true']")) continue;
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^(blade(\s+(ai|agent|hub))?)$/i.test(text)) el.setAttribute("data-blade-ui-logo", "hide");
    }
  }

  // 0.2.85 嵌入态侧栏宽度：展开时钉在 280px，收起成图标栏时让应用自己的宽度生效。
  // 侧栏是 react-resizable-panels 的面板，内联 flex-grow 就是它占容器的百分比。
  // 插件 CSS 覆盖的是计算值，内联值照样由应用写，所以能拿它判断收起没收起。
  function markSidebarMode() {
    var root = document.documentElement;
    if (!root) return;
    var aside = document.getElementById("unified-shell-sidebar");
    if (!aside || !document.getElementById("blade-embed-chrome-style")) {
      root.removeAttribute("data-blade-ui-sidebar");
      return;
    }
    // 收起态会换成 group/rail 那一栏。用它判断，避免 flex-grow 读不到时仍被钉成 280px。
    // 软件工厂的侧栏也带 group/rail，不能算成对话图标栏。
    var railAside = aside.querySelector('aside[class*="group/rail"]');
    if (railAside && !railAside.querySelector("#factory-sidebar-projects-heading")) {
      root.setAttribute("data-blade-ui-sidebar", "rail");
      return;
    }
    var grow = parseFloat(aside.style.flexGrow || "");
    var host = aside.parentElement;
    var hostWidth = host ? host.getBoundingClientRect().width : 0;
    if (!(grow > 0) || !(hostWidth > 0)) {
      root.setAttribute("data-blade-ui-sidebar", "expanded");
      return;
    }
    root.setAttribute("data-blade-ui-sidebar", (grow / 100) * hostWidth < 140 ? "rail" : "expanded");
  }

  // 图标栏和悬停拉出的中等宽度都不要。偏好已钉成展开；若运行中仍收成图标栏，点应用自己的展开按钮。
  function keepChatSidebarExpanded() {
    lockChatSidebarPref();
    if (!document.getElementById("blade-embed-chrome-style")) return;
    var aside = document.getElementById("unified-shell-sidebar");
    if (!aside || aside.querySelector("#factory-sidebar-projects-heading")) return;
    var rail = aside.querySelector('aside[class*="group/rail"]');
    if (!rail || sidebarExpandTries > 3) return;
    var opener = aside.querySelector('[aria-label="展开侧边栏"]');
    if (!opener || typeof opener.click !== "function") return;
    sidebarExpandTries += 1;
    opener.click();
  }

  // 0.2.89 技能分类。商店条目有 category 就用原字段；同 slug 已有原字段时，空的跟它。
  // 仍然空的不再请求，按 id 末段的固定表，对不上再看名称和描述里的关键词。
  // 分类条在 body 上的 #blade-ui-skill-cats，点击只改卡片属性，不调用 paint。
  var SKILL_CAT_GROUPS = {
    "作战推演": ["hang-mu-bian-dui-fan-qian-jing-jie-sou-suo", "hang-mu-bian-dui-duo-zhou-fan-jian-bao-he-da-ji", "hang-mu-bian-dui-fang-kong-fan-dao-zhen-xing-you-hua", "jian-li-mu-biao-yun-dong-bu-que-ding-xing-mo-xing", "sou-cha-qu-yu-hua-fen-lu-xian-she-ji", "wu-ren-qian-hang-qi-fu-ji-ren-wu-jue-ce-liu-cheng", "huan-jing-shu-ju-die-jia", "hang-du-gui-hua", "xiang-ding-sheng-cheng", "zhi-neng-lan-jun", "hui-shang-ping-gu", "sheng-cun-neng-li-fen-xi", "sheng-cheng-zuo-zhan-jue-xin", "hong-fang-xing-dong-sheng-cheng", "fu-zhu-xia-ding-jue-xin"],
    "文档处理": ["word-sheng-cheng-yu-bian-ji", "docx", "pdf", "ge-shi-xiu-fu", "ge-shi-zhuan-huan", "gong-wen-chu-li", "lun-wen-pai-ban", "shi-juan-pai-ban", "mu-ban-tao-da", "shuang-yu-wen-dang", "wen-dang-shui-yin", "wen-gao-jiao-dui", "yan-shi-zhuai-wen-gao", "dian-zi-yin-zhang", "zheng-shu-jiang-zhuang", "zhong-wen-jian-li"],
    "表格数据": ["xlsx", "biao-ge-gong-shi", "biao-ge-hong", "cha-zhao-yin-yong", "huashu-excel", "hui-gui-fen-xi", "echart-skill", "jupyter-notebook", "shu-ju-tou-shi", "shu-ju-zhi-jian", "tiao-jian-ge-shi", "mo-ni-shu-ju"],
    "写作沟通": ["chan-pin-xu-qiu", "chan-pin-yi-ye-zhi", "diao-yan-bao-gao", "doc-coauthoring", "feng-kong-zhou-bao", "gong-zuo-zhou-bao", "hui-bao-zhu-shou", "hui-yi-fu-pan", "hui-yi-ji-yao-zheng-li", "internal-comms", "ji-shu-fang-an", "jing-pin-jian-bao", "ke-hu-an-li", "nei-shen-bao-gao", "shang-wu-you-jian", "tou-biao-fang-an", "xin-wen-tong-gao"],
    "演示文稿": ["ppt-sheng-cheng-yu-bian-ji", "pptx", "yan-jiang-bei-zhu"],
    "视觉样式": ["theme-factory", "brand-guidelines"],
    "合同法务": ["he-tong-bi-dui", "he-tong-qi-cao", "he-tong-shen-cha", "que-lou-jian-cha", "tan-pan-yao-dian", "tiao-kuan-bai-hua"],
    "人事财务": ["fa-piao-zheng-li", "cai-wu-bao-biao", "gong-zi-he-suan", "kao-qin-tong-ji", "jie-jia-pai-ban", "yu-suan-bian-zhi"],
    "网页界面": ["web-artifacts-builder", "frontend-design"],
    "界面测试": ["webapp-testing", "playwright"],
    "截图录屏": ["screenshot", "lu-ping-jie-shuo"],
    "项目协作": ["ren-wu-an-pai", "ren-wu-gui-hua", "xiang-mu-bei-jing", "xiang-mu-gan-te", "sop-bian-xie-zhu-shou"],
    "安全检查": ["security-best-practices"]
  };
  var SKILL_CAT_SLUGS = {};
  var SKILL_CAT_ORDER = ["对海作战", "水下作战", "筹划方案", "日常办公", "作战推演", "写作沟通", "文档处理", "表格数据", "演示文稿", "合同法务", "人事财务", "项目协作", "网页界面", "界面测试", "截图录屏", "视觉样式", "安全检查", "其他"];
  var SKILL_CAT_RULES = [
    ["合同法务", /合同|条款|谈判|协议|缺漏/],
    ["人事财务", /工资|考勤|预算|发票|排班|财务|五险|薪酬/],
    ["截图录屏", /截图|录屏|屏幕/],
    ["界面测试", /playwright|功能测试|浏览器自动化|网页测试/i],
    ["网页界面", /网页|落地页|界面设计|前端|react|shadcn/i],
    ["安全检查", /安全实践|安全审查|安全报告/],
    ["项目协作", /甘特|任务安排|项目背景|任务规划|作业流程|SOP|流程/],
    ["演示文稿", /pptx|幻灯片|演示文稿|演讲/i],
    ["视觉样式", /主题|品牌|配色|字体/],
    ["表格数据", /表格|excel|xlsx|公式|透视|回归|图表|csv|质检|笔记本/i],
    ["文档处理", /word|pdf|docx|排版|公文|简历|水印|校对|印章|文档/i],
    ["写作沟通", /周报|纪要|邮件|通稿|简报|方案|需求|汇报|报告|沟通/]
  ];
  var skillCatGroupName;
  for (skillCatGroupName in SKILL_CAT_GROUPS) {
    if (!Object.prototype.hasOwnProperty.call(SKILL_CAT_GROUPS, skillCatGroupName)) continue;
    var skillCatSlugList = SKILL_CAT_GROUPS[skillCatGroupName];
    var skillCatSlugIndex;
    for (skillCatSlugIndex = 0; skillCatSlugIndex < skillCatSlugList.length; skillCatSlugIndex += 1) {
      SKILL_CAT_SLUGS[skillCatSlugList[skillCatSlugIndex]] = skillCatGroupName;
    }
  }
  var skillCatSelected = "";
  var skillCatSig = "";
  var skillCatSource = null;
  var skillCatById = {};
  var skillCatByName = {};
  var skillCatTabs = null;
  var skillCatScrollBound = false;
  var skillQueryClient = null;
  var skillCatCacheText = "";
  var skillCatCacheRows = null;

  function skillSlug(id) {
    if (!id) return "";
    var parts = String(id).split("/");
    return parts[parts.length - 1] || "";
  }

  function catalogCategory(row) {
    var value = row && row.category;
    if (typeof value !== "string") return "";
    return value.replace(/\s+/g, " ").trim();
  }

  function deriveSkillCategory(id, name, description) {
    var slug = skillSlug(id);
    if (slug && SKILL_CAT_SLUGS[slug]) return SKILL_CAT_SLUGS[slug];
    var text = (name || "") + "\n" + (description || "");
    var i;
    for (i = 0; i < SKILL_CAT_RULES.length; i += 1) {
      if (SKILL_CAT_RULES[i][1].test(text)) return SKILL_CAT_RULES[i][0];
    }
    return "其他";
  }

  function skillRowsFromPage() {
    if (!skillQueryClient || typeof skillQueryClient.getQueryData !== "function") {
      skillQueryClient = findQueryClient(document.getElementById("root"));
    }
    var data = null;
    if (skillQueryClient && typeof skillQueryClient.getQueryData === "function") {
      try {
        data = skillQueryClient.getQueryData(["bladehub-store-skills"]);
      } catch (err) {
        data = null;
      }
    }
    if (data && data.skills && data.skills.length) return data.skills;
    var text = "";
    try {
      text = window.localStorage.getItem("blade-skill-catalog-v1") || "";
    } catch (err) {
      text = "";
    }
    if (!text) return null;
    if (text === skillCatCacheText && skillCatCacheRows) return skillCatCacheRows;
    try {
      var parsed = JSON.parse(text);
      skillCatCacheText = text;
      skillCatCacheRows = parsed && parsed.skills && parsed.skills.length ? parsed.skills : null;
      return skillCatCacheRows;
    } catch (err) {
      return null;
    }
  }

  function indexSkillRows(rows) {
    var realBySlug = {};
    var i;
    var row;
    var slug;
    var cat;
    var id;
    var name;
    for (i = 0; i < rows.length; i += 1) {
      row = rows[i];
      if (!row) continue;
      cat = catalogCategory(row);
      slug = skillSlug(row.id || row.name || "");
      if (cat && slug && !realBySlug[slug]) realBySlug[slug] = cat;
    }
    for (i = 0; i < rows.length; i += 1) {
      row = rows[i];
      if (!row) continue;
      id = typeof row.id === "string" ? row.id : "";
      name = row.display_name || row.name || "";
      slug = skillSlug(id || row.name || "");
      cat = catalogCategory(row);
      if (!cat && slug && realBySlug[slug]) cat = realBySlug[slug];
      if (!cat) cat = deriveSkillCategory(id || row.name || "", name, row.description || "");
      if (id) skillCatById[id] = cat;
      if (name && !skillCatByName[name]) skillCatByName[name] = cat;
    }
  }

  function ensureSkillCatIndex() {
    var rows = skillRowsFromPage();
    if (!rows || !rows.length) return false;
    if (rows === skillCatSource) return false;
    skillCatSource = rows;
    skillCatById = {};
    skillCatByName = {};
    indexSkillRows(rows);
    return true;
  }

  function skillMetaFromCard(card) {
    var fiber = fiberOf(card);
    var depth = 0;
    while (fiber && depth < 10) {
      var props = fiber.memoizedProps || fiber.pendingProps;
      var skill = props && props.skill;
      if (skill && (skill.id || skill.name)) {
        return {
          id: typeof skill.id === "string" ? skill.id : "",
          name: typeof skill.name === "string" ? skill.name : "",
          description: typeof skill.description === "string" ? skill.description : ""
        };
      }
      fiber = fiber.return;
      depth += 1;
    }
    var title = card.getAttribute("title") || "";
    var match = /「([^」]+)」/.exec(title);
    return { id: "", name: match ? match[1] : "", description: "" };
  }

  function categoryForSkill(meta) {
    if (meta.id && skillCatById[meta.id]) return skillCatById[meta.id];
    if (meta.name && skillCatByName[meta.name]) return skillCatByName[meta.name];
    return deriveSkillCategory(meta.id, meta.name, meta.description);
  }

  function categoryOnCard(card) {
    var held = card.getAttribute("data-blade-ui-skill-cat-name");
    if (held && skillCatSource) return held;
    var meta = skillMetaFromCard(card);
    var cat = categoryForSkill(meta);
    if (skillCatSource && cat) {
      if (meta.id) card.setAttribute("data-blade-ui-skill-id", meta.id);
      card.setAttribute("data-blade-ui-skill-cat-name", cat);
    }
    return cat || "";
  }

  function skillStoreCards() {
    var grids = document.querySelectorAll("div[class*='grid-cols-1'][class*='lg:grid-cols-3']");
    var list = [];
    var i;
    var j;
    var kids;
    for (i = 0; i < grids.length; i += 1) {
      kids = grids[i].children;
      for (j = 0; j < kids.length; j += 1) {
        if (kids[j].tagName === "BUTTON") list.push(kids[j]);
      }
    }
    return list;
  }

  function skillTabRow() {
    var path = window.location.pathname || "";
    if (path !== "/skills" && path.indexOf("/skills/") !== 0) return null;
    if (skillCatTabs && skillCatTabs.isConnected) {
      var cached = (skillCatTabs.textContent || "").replace(/\s+/g, "");
      if (cached.indexOf("全部") !== -1 && cached.indexOf("已安装") !== -1 && cached.indexOf("未安装") !== -1 && cached.length < 20) return skillCatTabs;
    }
    var buttons = document.querySelectorAll("#unified-shell-main button, main button");
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      var el = buttons[i];
      if (isSkillStoreCard(el)) continue;
      var text = (el.textContent || "").replace(/\s+/g, "");
      if (text !== "全部") continue;
      var parent = el.parentElement;
      if (!parent) continue;
      var labels = parent.children;
      var hasInstalled = false;
      var hasNot = false;
      var j;
      for (j = 0; j < labels.length; j += 1) {
        if (labels[j].tagName !== "BUTTON") continue;
        var label = (labels[j].textContent || "").replace(/\s+/g, "");
        if (label === "已安装") hasInstalled = true;
        if (label === "未安装") hasNot = true;
      }
      if (hasInstalled && hasNot) return parent;
    }
    return null;
  }

  function orderedSkillCats(present) {
    var out = [];
    var seen = {};
    var i;
    for (i = 0; i < SKILL_CAT_ORDER.length; i += 1) {
      if (!present[SKILL_CAT_ORDER[i]]) continue;
      out.push(SKILL_CAT_ORDER[i]);
      seen[SKILL_CAT_ORDER[i]] = true;
    }
    var extra = [];
    var key;
    for (key in present) {
      if (!Object.prototype.hasOwnProperty.call(present, key) || seen[key]) continue;
      extra.push(key);
    }
    extra.sort(function (a, b) { return a.localeCompare(b, "zh-CN"); });
    return out.concat(extra);
  }

  function skillCatRoot() {
    var root = document.getElementById("blade-ui-skill-cats");
    if (root && root.parentElement !== document.body) root.remove();
    if (!root || !root.parentElement) {
      root = document.createElement("div");
      root.id = "blade-ui-skill-cats";
      root.setAttribute("data-blade-ui-skill-cats", "off");
      root.setAttribute("role", "toolbar");
      root.setAttribute("aria-label", "技能分类");
      document.body.appendChild(root);
    }
    return root;
  }

  function markSkillCatPressed(root) {
    var buttons = root.querySelectorAll("button");
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      var on = (buttons[i].getAttribute("data-blade-ui-skill-cat") || "") === skillCatSelected;
      var next = on ? "true" : "false";
      if (buttons[i].getAttribute("aria-pressed") !== next) buttons[i].setAttribute("aria-pressed", next);
    }
  }

  function renderSkillCatPills(names) {
    var sig = names.join("\u0001");
    var root = skillCatRoot();
    if (sig === skillCatSig && root.querySelector("button")) {
      markSkillCatPressed(root);
      return;
    }
    skillCatSig = sig;
    while (root.firstChild) root.removeChild(root.firstChild);
    var all = document.createElement("button");
    all.type = "button";
    all.textContent = "全部";
    all.setAttribute("data-blade-ui-skill-cat", "");
    all.addEventListener("click", onSkillCatClick);
    root.appendChild(all);
    var i;
    for (i = 0; i < names.length; i += 1) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = names[i];
      button.setAttribute("data-blade-ui-skill-cat", names[i]);
      button.addEventListener("click", onSkillCatClick);
      root.appendChild(button);
    }
    markSkillCatPressed(root);
  }

  function applySkillCatFilter(cards) {
    var selected = skillCatSelected;
    var i;
    for (i = 0; i < cards.length; i += 1) {
      var card = cards[i];
      var cat = categoryOnCard(card);
      var hide = !!(selected && cat !== selected);
      if (hide) {
        if (card.getAttribute("data-blade-ui-skill-hide") !== "1") card.setAttribute("data-blade-ui-skill-hide", "1");
      } else if (card.hasAttribute("data-blade-ui-skill-hide")) {
        card.removeAttribute("data-blade-ui-skill-hide");
      }
    }
  }

  function onSkillCatClick(event) {
    var value = event.currentTarget.getAttribute("data-blade-ui-skill-cat") || "";
    if (value === skillCatSelected) return;
    skillCatSelected = value;
    var root = document.getElementById("blade-ui-skill-cats");
    if (root) markSkillCatPressed(root);
    applySkillCatFilter(skillStoreCards());
  }

  function placeSkillCatBar(tabs) {
    var root = document.getElementById("blade-ui-skill-cats");
    if (!root || !tabs) return;
    var tabRect = tabs.getBoundingClientRect();
    var host = tabs.parentElement || tabs;
    var hostRect = host.getBoundingClientRect();
    var left = Math.round(tabRect.left);
    var top = Math.round(tabRect.bottom + 8);
    var width = Math.round(hostRect.width);
    if (width < 180) width = 180;
    var max = Math.round(window.innerWidth - left - 16);
    if (max > 0 && width > max) width = max;
    if (root.style.left !== left + "px") root.style.left = left + "px";
    if (root.style.top !== top + "px") root.style.top = top + "px";
    if (root.style.width !== width + "px") root.style.width = width + "px";
    var gap = root.offsetHeight + 8;
    var margin = gap > 8 ? gap + "px" : "";
    if (tabs.style.marginBottom !== margin) tabs.style.marginBottom = margin;
  }

  function onSkillCatScroll() {
    if (!skillCatTabs || !skillCatTabs.isConnected) return;
    var root = document.getElementById("blade-ui-skill-cats");
    if (!root || root.getAttribute("data-blade-ui-skill-cats") !== "on") return;
    placeSkillCatBar(skillCatTabs);
  }

  function bindSkillCatScroll() {
    if (skillCatScrollBound) return;
    skillCatScrollBound = true;
    window.addEventListener("scroll", onSkillCatScroll, true);
  }

  function clearSkillHides() {
    var hidden = document.querySelectorAll("[data-blade-ui-skill-hide]");
    var i;
    for (i = hidden.length - 1; i >= 0; i -= 1) hidden[i].removeAttribute("data-blade-ui-skill-hide");
  }

  function hideSkillCats() {
    var root = document.getElementById("blade-ui-skill-cats");
    var open = root && root.getAttribute("data-blade-ui-skill-cats") === "on";
    if (root && open) root.setAttribute("data-blade-ui-skill-cats", "off");
    if (skillCatTabs) {
      if (skillCatTabs.style.marginBottom) skillCatTabs.style.marginBottom = "";
      skillCatTabs = null;
    }
    if (open) clearSkillHides();
  }

  function syncSkillCategories() {
    var tabs = skillTabRow();
    if (!tabs) {
      hideSkillCats();
      return;
    }
    var cards = skillStoreCards();
    if (!cards.length) {
      hideSkillCats();
      return;
    }
    var sourceChanged = ensureSkillCatIndex();
    var i;
    if (sourceChanged) {
      for (i = 0; i < cards.length; i += 1) {
        cards[i].removeAttribute("data-blade-ui-skill-cat-name");
        cards[i].removeAttribute("data-blade-ui-skill-id");
      }
    }
    var present = {};
    for (i = 0; i < cards.length; i += 1) {
      var cat = categoryOnCard(cards[i]);
      if (cat) present[cat] = true;
    }
    var names = orderedSkillCats(present);
    var still = !skillCatSelected;
    for (i = 0; i < names.length; i += 1) {
      if (names[i] === skillCatSelected) still = true;
    }
    if (!still) skillCatSelected = "";
    var root = skillCatRoot();
    root.setAttribute("data-blade-ui-skill-cats", "on");
    renderSkillCatPills(names);
    skillCatTabs = tabs;
    placeSkillCatBar(tabs);
    applySkillCatFilter(cards);
    bindSkillCatScroll();
  }

  function paint() {
    scheduled = false;
    // 自己的改动不要再排进下一帧。观察器在子节点和 class 上听整棵文档，
    // paint 里换文本或改 class 会立刻再调度，技能页就一直空转。
    if (observer) observer.disconnect();
    try {
    var live = chatIsLive();
    if (live) document.documentElement.setAttribute("data-blade-ui-chat", "live");
    else document.documentElement.removeAttribute("data-blade-ui-chat");
    markSidebarMode();
    keepChatSidebarExpanded();
    var column = markChatColumn();
    var headers = document.querySelectorAll("header");
    for (var i = 0; i < headers.length; i += 1) {
      var node = headers[i];
      if (isChromeHeader(node)) node.setAttribute("data-blade-ui-topbar", "true");
      else node.removeAttribute("data-blade-ui-topbar");
    }
    markBrand();
    hideLogos();
    if (column) clearConversationSkin(column);
    markButtons();
    markFields();
    markNav("#unified-shell-sidebar a", function (cls) {
      return cls.indexOf("rounded-[9px]") !== -1 || cls.indexOf("gap-[11px]") !== -1;
    });
    if (String(window.location.port) === "8010") {
      markNav("aside a", function (cls) {
        return cls.indexOf("rounded-[10px]") !== -1;
      });
    }
    markCards();
    markHomeAccent();
    markRailTools();
    placeEmbedSearch();
    placeEmbedBatchDelete();
    hideEmbedChatNav();
    hideEmbedLogout();
    hideEmbedThemeToggle();
    hideEmbedHomeExtras();
    markFactoryHome();
    markFactorySidebar();
    markConsolePage();
    syncSkillCategories();
    document.documentElement.removeAttribute("data-blade-ui-error");
    } catch (err) {
      document.documentElement.setAttribute("data-blade-ui-error", String(err && err.message || err).slice(0, 200));
    } finally {
      if (observer && document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      }
    }
  }

  function markConsolePage() {
    var path = window.location.pathname || "";
    var page = "";
    if (/^\/chat\/groups(\/|$)/.test(path)) page = "chat-group";
    else if (path === "/" || path === "/chat" || path === "/chat/") page = "chat-home";
    else if (path.indexOf("/studio/skill-editor") === 0 || path.indexOf("/sol/skill_editor") === 0) page = "skill-editor";
    else if (path === "/skills" || path.indexOf("/skills/") === 0) page = "skills";
    else if (path.indexOf("/knowledge") === 0) page = "knowledge";
    else if (path === "/app-market" || path.indexOf("/app-market/") === 0) page = "market";
    else if (path === "/scheduled" || path.indexOf("/scheduled/") === 0) page = "scheduled";
    else if (path.indexOf("/workflows") === 0) page = "workflows";
    else if (path.indexOf("/data-sources") === 0) page = "data-sources";
    else if (path === "/tools" || path.indexOf("/tools/") === 0) page = "tools";
    else if (path === "/plugins" || path.indexOf("/plugins/") === 0) page = "plugins";
    if (page) document.documentElement.setAttribute("data-blade-ui-page", page);
    else document.documentElement.removeAttribute("data-blade-ui-page");
  }

  function inEmbedFrame() {
    if (document.getElementById("blade-embed-chrome-style")) return true;
    try {
      return window.parent !== window;
    } catch (error) {
      return true;
    }
  }

  // 不再把搜索按钮挪进 React 管理的会话区，也不改写标题文本。
  // 换掉或删掉 React 文本时，提交会 removeChild 失败，整页进错误边界。
  function placeEmbedSearch() {
    return;
  }

  function isBatchChrome(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.getAttribute("data-blade-ui-batch")) return true;
    return !!node.closest("[data-blade-ui-batch]");
  }

  function headingHasForeignControl(el) {
    var nested = el.querySelectorAll("[role='button'], button, a, svg, input, textarea");
    for (var i = 0; i < nested.length; i += 1) {
      if (isBatchChrome(nested[i])) continue;
      return true;
    }
    return false;
  }

  function headingLabel(el) {
    var text = "";
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i += 1) {
      if (kids[i].nodeType === 3) text += kids[i].nodeValue || "";
    }
    return text.replace(/\s+/g, "");
  }

  var batchSelectOn = false;
  var batchSelected = {};
  var batchBusy = false;
  var batchError = "";
  var batchFailed = {};
  var removedSessionIds = {};
  var batchScrollBound = false;
  var batchKeyBound = false;

  function usableSessionId(value) {
    return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value);
  }

  function fiberOf(node) {
    if (!node) return null;
    try {
      var names = Object.getOwnPropertyNames(node);
      var i;
      var key;
      for (i = 0; i < names.length; i += 1) {
        key = names[i];
        if (key.indexOf("__reactFiber$") === 0 || key.indexOf("__reactInternalInstance$") === 0) return node[key];
      }
      for (key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
        if (key.indexOf("__reactFiber$") === 0 || key.indexOf("__reactInternalInstance$") === 0) return node[key];
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  function sessionIdFromFiber(row) {
    var fiber = fiberOf(row);
    var depth = 0;
    while (fiber && depth < 16) {
      var props = fiber.memoizedProps || fiber.pendingProps;
      if (props && props.session && usableSessionId(props.session.id)) return props.session.id;
      fiber = fiber.return;
      depth += 1;
    }
    return "";
  }

  function sessionIdFromActiveRow(row) {
    var cls = String(row.className || "");
    if (cls.indexOf("sidebar-item-active") === -1 && cls.indexOf("bg-sidebar-item-active") === -1) return "";
    var path = window.location.pathname || "";
    var match = /^\/chat\/([^/]+)$/.exec(path);
    if (!match) return "";
    var id = match[1];
    try {
      id = decodeURIComponent(match[1]);
    } catch (err) {
      id = match[1];
    }
    return usableSessionId(id) ? id : "";
  }

  function sessionIdOf(row) {
    var id = sessionIdFromFiber(row) || sessionIdFromActiveRow(row);
    return usableSessionId(id) ? id : "";
  }

  function historySection() {
    var sidebar = document.getElementById("unified-shell-sidebar");
    if (!sidebar) return null;
    return sidebar.querySelector('section[class*="group/history"]');
  }

  function historyHeading(history) {
    var nodes = history.querySelectorAll('[class*="text-[11px]"]');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el.closest("[role='button'], button, a, input, textarea")) continue;
      if (headingHasForeignControl(el)) continue;
      var compact = headingLabel(el);
      if (compact === "历史" || compact === "最近") return el;
    }
    return null;
  }

  function stopRowOpen(event) {
    event.stopPropagation();
  }

  function bindToggle(button) {
    if (button.getAttribute("data-blade-ui-bound") === "1") return;
    button.setAttribute("data-blade-ui-bound", "1");
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (batchBusy) return;
      batchSelectOn = !batchSelectOn;
      if (!batchSelectOn) {
        batchSelected = {};
        batchError = "";
        batchFailed = {};
      }
      schedule();
    });
  }

  function bindConfirm(button) {
    if (button.getAttribute("data-blade-ui-bound") === "1") return;
    button.setAttribute("data-blade-ui-bound", "1");
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      confirmBatchDelete();
    });
  }

  function bindSelectAll(button, checked) {
    if (button.getAttribute("data-blade-ui-bound") === "1") return;
    button.setAttribute("data-blade-ui-bound", "1");
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      setAllSessionChecks(checked);
    });
  }

  function setAllSessionChecks(checked) {
    if (batchBusy) return;
    var history = visibleHistory() || historySection();
    if (!history) return;
    if (!checked) {
      batchSelected = {};
      schedule();
      return;
    }
    var rows = sessionRows(history);
    for (var i = 0; i < rows.length; i += 1) {
      var sessionId = sessionIdOf(rows[i]);
      if (usableSessionId(sessionId)) batchSelected[sessionId] = true;
    }
    schedule();
  }

  function bindCheck(box) {
    if (box.getAttribute("data-blade-ui-bound") === "1") return;
    box.setAttribute("data-blade-ui-bound", "1");
    box.addEventListener("click", stopRowOpen);
    box.addEventListener("mousedown", stopRowOpen);
    box.addEventListener("pointerdown", stopRowOpen);
    box.addEventListener("change", function (event) {
      event.stopPropagation();
      var input = event.currentTarget;
      var sessionId = input.getAttribute("data-session-id") || "";
      if (!usableSessionId(sessionId)) return;
      if (input.checked) batchSelected[sessionId] = true;
      else delete batchSelected[sessionId];
      schedule();
    });
  }

  function ensureBatchActions(heading) {
    var actions = heading.querySelector('[data-blade-ui-batch="actions"]');
    if (!actions) {
      actions = document.createElement("span");
      actions.setAttribute("data-blade-ui-batch", "actions");
    }
    if (actions.parentElement !== heading) heading.appendChild(actions);
    var toggle = actions.querySelector('[data-blade-ui-batch="toggle"]');
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.setAttribute("data-blade-ui-batch", "toggle");
      toggle.textContent = "批量删除";
      actions.insertBefore(toggle, actions.firstChild);
    }
    bindToggle(toggle);
    toggle.disabled = batchBusy;
    // 文本没变就不要写。textContent 会换掉子节点，整页 MutationObserver 会因此再次 paint。
    var toggleLabel = batchSelectOn ? "取消" : "批量删除";
    if (toggle.textContent !== toggleLabel) toggle.textContent = toggleLabel;
    if (toggle.getAttribute("aria-pressed") !== "false") toggle.setAttribute("aria-pressed", "false");
    var selectAll = actions.querySelector('[data-blade-ui-batch="all"]');
    var selectNone = actions.querySelector('[data-blade-ui-batch="none"]');
    var confirm = actions.querySelector('[data-blade-ui-batch="confirm"]');
    var error = actions.querySelector('[data-blade-ui-batch="error"]');
    if (!batchSelectOn) {
      if (selectAll) selectAll.remove();
      if (selectNone) selectNone.remove();
      if (confirm) confirm.remove();
      if (error) error.remove();
      return;
    }
    if (!confirm) {
      confirm = document.createElement("button");
      confirm.type = "button";
      confirm.setAttribute("data-blade-ui-batch", "confirm");
      confirm.textContent = "删除所选";
      actions.appendChild(confirm);
    }
    if (!selectAll) {
      selectAll = document.createElement("button");
      selectAll.type = "button";
      selectAll.setAttribute("data-blade-ui-batch", "all");
      selectAll.textContent = "全选";
      actions.insertBefore(selectAll, confirm);
    }
    if (!selectNone) {
      selectNone = document.createElement("button");
      selectNone.type = "button";
      selectNone.setAttribute("data-blade-ui-batch", "none");
      selectNone.textContent = "取消全选";
      actions.insertBefore(selectNone, confirm);
    }
    bindSelectAll(selectAll, true);
    bindSelectAll(selectNone, false);
    bindConfirm(confirm);
    selectAll.disabled = batchBusy;
    selectNone.disabled = batchBusy;
    confirm.disabled = batchBusy || selectedSessionIds().length === 0;
    if (batchError) {
      if (!error) {
        error = document.createElement("span");
        error.setAttribute("data-blade-ui-batch", "error");
        actions.appendChild(error);
      }
      if (error.textContent !== batchError) error.textContent = batchError;
    } else if (error) {
      error.remove();
    }
  }

  function sessionRows(history) {
    return history.querySelectorAll('[role="button"][class*="hover-row"]');
  }

  function historyListOpen(history) {
    if (!history) return false;
    var rect = history.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 48) return false;
    if (rect.left < -8 || rect.right < 200) return false;
    var host = history.closest("aside, #unified-shell-sidebar");
    if (host) {
      var hostRect = host.getBoundingClientRect();
      if (hostRect.width < 200 || hostRect.left < -8) return false;
    }
    var heading = historyHeading(history);
    if (!heading) return false;
    var headRect = heading.getBoundingClientRect();
    if (headRect.width < 24 || headRect.height < 8) return false;
    if (headRect.right < 80 || headRect.bottom < 8 || headRect.top > window.innerHeight) return false;
    return true;
  }

  function visibleHistory() {
    var nodes = document.querySelectorAll('section[class*="group/history"]');
    var found = null;
    for (var i = 0; i < nodes.length; i += 1) {
      if (!historyListOpen(nodes[i])) continue;
      found = nodes[i];
    }
    return found;
  }

  function batchRoot() {
    var root = document.getElementById("blade-ui-batch-root");
    if (root && root.parentElement !== document.body) root.remove();
    if (!root || !root.parentElement) {
      root = document.createElement("div");
      root.id = "blade-ui-batch-root";
      document.body.appendChild(root);
    }
    return root;
  }

  function bindBatchScroll() {
    if (batchScrollBound) return;
    batchScrollBound = true;
    window.addEventListener("scroll", schedule, true);
  }

  function bindBatchKeys() {
    if (batchKeyBound) return;
    batchKeyBound = true;
    window.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      if (!batchSelectOn || batchBusy) return;
      batchSelectOn = false;
      batchSelected = {};
      batchError = "";
      batchFailed = {};
      schedule();
    });
  }

  function syncBatchFlags(active) {
    var root = document.documentElement;
    if (!root) return;
    var selecting = !!(active && batchSelectOn);
    if (selecting) root.setAttribute("data-blade-ui-batch", "on");
    else root.removeAttribute("data-blade-ui-batch");
    var anyFailed = false;
    var id;
    for (id in batchFailed) {
      if (batchFailed[id]) anyFailed = true;
    }
    if (selecting && anyFailed) root.setAttribute("data-blade-ui-batch-failed", "1");
    else root.removeAttribute("data-blade-ui-batch-failed");
    if (selecting && batchError) root.setAttribute("data-blade-ui-batch-error", "1");
    else root.removeAttribute("data-blade-ui-batch-error");
  }

  function placeBatchBar(root, history) {
    var actions = root.querySelector('[data-blade-ui-batch="actions"]');
    if (!actions) return;
    var anchor = historyHeading(history);
    var panel = history.getBoundingClientRect();
    var side = document.getElementById("unified-shell-sidebar");
    var sideRect = side ? side.getBoundingClientRect() : panel;
    if (!anchor) {
      actions.style.display = "none";
      return;
    }
    var rect = anchor.getBoundingClientRect();
    var boundLeft = Math.max(panel.left, sideRect.left);
    var boundRight = Math.min(panel.right, sideRect.right);
    if (rect.width < 24 || rect.height < 8 || boundRight - boundLeft < 160) {
      actions.style.display = "none";
      return;
    }
    var buttonH = 28;
    var top = rect.top + (rect.height - buttonH) / 2;
    if (top < panel.top) top = panel.top;
    var search = document.querySelector('#unified-shell-sidebar button[aria-label="搜索对话"]');
    if (search) {
      var searchRect = search.getBoundingClientRect();
      if (searchRect.width > 8 && searchRect.bottom > 0 && top < searchRect.bottom) top = searchRect.bottom;
    }
    var minLeft = boundLeft + 48;
    var maxRight = boundRight - 8;
    var maxWidth = Math.floor(maxRight - minLeft);
    if (maxWidth < 72) {
      actions.style.display = "none";
      return;
    }
    actions.style.display = "flex";
    actions.style.top = Math.round(top) + "px";
    actions.style.right = Math.round(window.innerWidth - maxRight) + "px";
    actions.style.left = "auto";
    actions.style.width = "auto";
    actions.style.height = "auto";
    actions.style.maxWidth = maxWidth + "px";
  }

  function syncBatchChecks(root, history) {
    var rows = sessionRows(history);
    var seen = {};
    var i;
    var panel = history.getBoundingClientRect();
    var side = document.getElementById("unified-shell-sidebar");
    var sideRect = side ? side.getBoundingClientRect() : panel;
    var anchor = historyHeading(history);
    var headRect = anchor ? anchor.getBoundingClientRect() : null;
    if (!batchSelectOn) {
      var old = root.querySelectorAll('[data-blade-ui-batch="check"]');
      for (i = old.length - 1; i >= 0; i -= 1) old[i].remove();
      return;
    }
    for (i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      var sessionId = sessionIdOf(row);
      if (!usableSessionId(sessionId) || removedSessionIds[sessionId]) continue;
      seen[sessionId] = true;
      var box = root.querySelector('[data-blade-ui-batch="check"][data-session-id="' + sessionId + '"]');
      if (!box) {
        box = document.createElement("label");
        box.setAttribute("data-blade-ui-batch", "check");
        box.setAttribute("data-session-id", sessionId);
        var input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("data-session-id", sessionId);
        input.setAttribute("aria-label", "选择这条对话");
        bindCheck(input);
        box.appendChild(input);
        root.appendChild(box);
      }
      var inputEl = box.querySelector("input");
      inputEl.checked = !!batchSelected[sessionId];
      inputEl.disabled = batchBusy;
      var rect = row.getBoundingClientRect();
      var hidden = rect.width < 8 || rect.bottom < 8 || rect.top > window.innerHeight;
      if (!hidden && headRect && rect.top < headRect.bottom - 2) hidden = true;
      if (!hidden && (rect.bottom < panel.top || rect.top > panel.bottom)) hidden = true;
      if (!hidden && (rect.left < sideRect.left - 4 || rect.left > sideRect.right - 24)) hidden = true;
      if (hidden) {
        box.style.display = "none";
        continue;
      }
      box.style.display = "flex";
      box.style.width = "14px";
      box.style.height = "14px";
      box.style.top = Math.round(rect.top + Math.max(0, (rect.height - 14) / 2)) + "px";
      box.style.left = Math.round(rect.left + 10) + "px";
      var fail = box.querySelector('[data-blade-ui-batch="row-error"]');
      if (batchFailed[sessionId]) {
        box.setAttribute("data-failed", "1");
        if (!fail) {
          fail = document.createElement("span");
          fail.setAttribute("data-blade-ui-batch", "row-error");
          fail.textContent = "失败";
          box.appendChild(fail);
        }
        var failLeft = rect.width - 44;
        if (failLeft < 18) failLeft = 18;
        fail.style.left = Math.round(failLeft) + "px";
      } else {
        box.removeAttribute("data-failed");
        if (fail) fail.remove();
      }
    }
    var checks = root.querySelectorAll('[data-blade-ui-batch="check"]');
    for (i = checks.length - 1; i >= 0; i -= 1) {
      if (!seen[checks[i].getAttribute("data-session-id")]) checks[i].remove();
    }
  }

  function hideBatchRoot() {
    var root = document.getElementById("blade-ui-batch-root");
    if (root) root.style.display = "none";
  }

  // 按钮和复选框挂在 body 上插件自己的层里，不插入 React 的侧栏节点。
  function placeEmbedBatchDelete() {
    if (!inEmbedFrame()) {
      hideBatchRoot();
      syncBatchFlags(false);
      return;
    }
    var history = visibleHistory();
    if (!history) {
      hideBatchRoot();
      syncBatchFlags(false);
      return;
    }
    syncBatchFlags(true);
    var root = batchRoot();
    root.style.display = "block";
    ensureBatchActions(root);
    placeBatchBar(root, history);
    syncBatchChecks(root, history);
    bindBatchScroll();
    bindBatchKeys();
  }

  function findQueryClient(start) {
    var fiber = fiberOf(start);
    var depth = 0;
    while (fiber && depth < 80) {
      var props = fiber.memoizedProps || fiber.pendingProps;
      var client = props && (props.client || props.value);
      if (client && typeof client.setQueriesData === "function" && typeof client.getQueryCache === "function") return client;
      fiber = fiber.return;
      depth += 1;
    }
    return null;
  }

  function withoutSession(data, sessionId) {
    if (!data || !data.pages || !data.pages.length) return data;
    var changed = false;
    var pages = [];
    for (var i = 0; i < data.pages.length; i += 1) {
      var page = data.pages[i];
      var items = page && page.items;
      if (!items || !items.length) {
        pages.push(page);
        continue;
      }
      var next = [];
      var removed = 0;
      for (var j = 0; j < items.length; j += 1) {
        if (items[j] && items[j].id === sessionId) removed += 1;
        else next.push(items[j]);
      }
      if (!removed) {
        pages.push(page);
        continue;
      }
      changed = true;
      var copy = {};
      var key;
      for (key in page) copy[key] = page[key];
      copy.items = next;
      if (typeof copy.total === "number") copy.total = Math.max(0, copy.total - removed);
      pages.push(copy);
    }
    if (!changed) return data;
    return { pages: pages, pageParams: data.pageParams };
  }

  function dropSessionFromCache(sessionId) {
    try {
      var client = findQueryClient(document.getElementById("unified-shell-sidebar") || document.getElementById("root"));
      if (!client) return;
      client.setQueriesData({
        predicate: function (query) {
          return withoutSession(query && query.state && query.state.data, sessionId) !== (query && query.state && query.state.data);
        }
      }, function (old) {
        return withoutSession(old, sessionId);
      });
      if (typeof client.invalidateQueries === "function") {
        client.invalidateQueries({ queryKey: ["sessions"] });
        client.invalidateQueries({ queryKey: ["chat-groups"] });
      }
    } catch (err) {
      return;
    }
  }

  function removeSessionRow() {
    return;
  }

  function leaveDeletedChat(sessionId) {
    var path = window.location.pathname || "";
    if (path !== "/chat/" + sessionId) return;
    var link = document.querySelector('#unified-shell-sidebar a[href="/chat"]');
    if (link && typeof link.click === "function") link.click();
  }

  function selectedSessionIds() {
    var ids = [];
    var id;
    for (id in batchSelected) {
      if (batchSelected[id] && usableSessionId(id)) ids.push(id);
    }
    return ids;
  }

  function deleteOneSession(sessionId) {
    return fetch("/api/sessions/" + encodeURIComponent(sessionId) + "?delete_workspace=false", {
      method: "DELETE",
      credentials: "include"
    }).then(function (response) {
      return response.text().catch(function () { return ""; }).then(function () {
        if (!response.ok) throw new Error("delete failed");
      });
    });
  }

  function markRowFailed(sessionId) {
    batchFailed[sessionId] = true;
  }

  function clearRowFailed(sessionId) {
    delete batchFailed[sessionId];
  }

  function confirmBatchDelete() {
    if (batchBusy) return;
    var ids = selectedSessionIds();
    if (!ids.length) return;
    batchBusy = true;
    batchError = "";
    var failed = 0;
    var pending = ids.length;
    for (var i = 0; i < ids.length; i += 1) clearRowFailed(ids[i]);
    schedule();
    function finishOne() {
      pending -= 1;
      if (pending > 0) return;
      batchBusy = false;
      if (failed) batchError = "删除失败";
      else {
        batchError = "";
        batchSelectOn = false;
        batchSelected = {};
      }
      schedule();
    }
    for (var n = 0; n < ids.length; n += 1) {
      (function (sessionId) {
        deleteOneSession(sessionId).then(function () {
          delete batchSelected[sessionId];
          removedSessionIds[sessionId] = true;
          dropSessionFromCache(sessionId);
          removeSessionRow(sessionId);
          leaveDeletedChat(sessionId);
        }).catch(function () {
          failed += 1;
          markRowFailed(sessionId);
        }).then(finishOne);
      })(ids[n]);
    }
  }

  function hideEmbedChatNav() {
    var embed = inEmbedFrame();
    var roots = [];
    var sidebar = document.getElementById("unified-shell-sidebar");
    var asides = document.querySelectorAll("aside");
    var i;
    var j;
    if (sidebar) roots.push(sidebar);
    for (i = 0; i < asides.length; i += 1) {
      if (sidebar && sidebar.contains(asides[i])) continue;
      if (asides[i].querySelector('a[href="/chat"]')) roots.push(asides[i]);
    }
    var marked = document.querySelectorAll("[data-blade-ui-hide='nav-extra']");
    var keep = [];
    if (embed) {
      for (i = 0; i < roots.length; i += 1) {
        var links = roots[i].querySelectorAll("a");
        for (j = 0; j < links.length; j += 1) {
          var link = links[j];
          if (link.closest("[role='dialog'], .factory-home-section, aside[class*='group/rail']")) continue;
          var href = link.getAttribute("href") || "";
          var text = (link.textContent || "").replace(/\s+/g, "");
          var pathHit = href === "/projects" || href.indexOf("/projects?") === 0 || href.indexOf("/projects#") === 0 || href === "/scheduled" || href === "/scheduled/" || href.indexOf("/scheduled?") === 0 || href.indexOf("/scheduled#") === 0;
          var inMenu = !!link.closest("[role='menu'], [data-radix-popper-content-wrapper]");
          if (inMenu && text !== "软件工厂" && text !== "定时任务" && !pathHit) continue;
          if (!inMenu && !pathHit && text !== "软件工厂" && text !== "定时任务") continue;
          link.setAttribute("data-blade-ui-hide", "nav-extra");
          keep.push(link);
        }
      }
      var menuItems = document.querySelectorAll("[role='menu'] a, [role='menu'] button, [role='menuitem']");
      for (j = 0; j < menuItems.length; j += 1) {
        var item = menuItems[j];
        if (item.closest(".factory-home-section, aside[class*='group/rail']")) continue;
        var itemText = (item.textContent || "").replace(/\s+/g, "");
        var itemHref = item.getAttribute("href") || "";
        var menuHit = itemText === "软件工厂" || itemText === "定时任务" || itemHref === "/projects" || itemHref.indexOf("/projects?") === 0 || itemHref === "/scheduled" || itemHref.indexOf("/scheduled?") === 0;
        if (!menuHit) continue;
        item.setAttribute("data-blade-ui-hide", "nav-extra");
        keep.push(item);
      }
    }
    for (i = 0; i < marked.length; i += 1) {
      var still = false;
      for (j = 0; j < keep.length; j += 1) {
        if (marked[i] === keep[j]) still = true;
      }
      if (!still && marked[i].getAttribute("data-blade-ui-hide") === "nav-extra") marked[i].removeAttribute("data-blade-ui-hide");
    }
  }

  function hideEmbedLogout() {
    if (!inEmbedFrame()) return;
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      var text = (buttons[i].textContent || "").replace(/\s+/g, "");
      if (text === "\u9000\u51fa\u767b\u5f55") buttons[i].setAttribute("data-blade-ui-hide", "logout");
    }
  }

  // 账号菜单里的主题开关。浅色时文案是「切换到深色模式」，深色时是「切换到浅色模式」，是同一个按钮。
  // 只按整段文案打标记，不按月亮图标藏，避免其它月亮图标被带走。
  function hideEmbedThemeToggle() {
    if (!inEmbedFrame()) return;
    var buttons = document.querySelectorAll("button");
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      var text = (buttons[i].textContent || "").replace(/\s+/g, "");
      if (text === "切换到深色模式" || text === "切换到浅色模式") {
        buttons[i].setAttribute("data-blade-ui-hide", "theme");
      } else if (buttons[i].getAttribute("data-blade-ui-hide") === "theme") {
        buttons[i].removeAttribute("data-blade-ui-hide");
      }
    }
  }

  function compactLabel(node) {
    return ((node && (node.innerText || node.textContent)) || "").replace(/\s+/g, "");
  }

  // 嵌入态对话首页：只藏「更多场景」链接和「软件工厂」芯片。
  // 办公场景、自定义常用语，以及工厂页、弹层、菜单、目录里的同名文字不打这个标记。
  function hideEmbedHomeExtras() {
    var marked = document.querySelectorAll("[data-blade-ui-hide='more-scenes'], [data-blade-ui-hide='factory-chip']");
    var embed = document.getElementById("blade-embed-chrome-style");
    var stack = embed ? document.querySelector("[data-blade-ui-home-stack='true']") : null;
    var keep = [];
    var i;
    var outside = ".factory-home-section, [role='dialog'], [role='menu'], [data-radix-popper-content-wrapper]";
    if (embed && stack) {
      var links = stack.querySelectorAll("a[href='/solutions'], a[href='/solutions/'], a[href^='/solutions?'], a[href^='/solutions#']");
      for (i = 0; i < links.length; i += 1) {
        var link = links[i];
        if (link.closest(outside)) continue;
        var linkText = compactLabel(link);
        if (linkText !== "更多场景" && linkText !== "更多场景→" && linkText !== "更多场景->") continue;
        link.setAttribute("data-blade-ui-hide", "more-scenes");
        keep.push(link);
      }
      var chips = stack.querySelectorAll("button.home-scenario-in");
      for (i = 0; i < chips.length; i += 1) {
        var chip = chips[i];
        if (chip.closest(outside)) continue;
        if (compactLabel(chip) !== "软件工厂") continue;
        chip.setAttribute("data-blade-ui-hide", "factory-chip");
        keep.push(chip);
      }
    }
    for (i = 0; i < marked.length; i += 1) {
      var still = false;
      var k;
      for (k = 0; k < keep.length; k += 1) {
        if (marked[i] === keep[k]) still = true;
      }
      if (!still) marked[i].removeAttribute("data-blade-ui-hide");
    }
  }

  function markRailTools() {
    var sidebar = document.getElementById("unified-shell-sidebar");
    if (!sidebar) return;
    var marked = sidebar.querySelectorAll("[data-blade-ui-rail]");
    for (var i = 0; i < marked.length; i += 1) marked[i].removeAttribute("data-blade-ui-rail");
    var buttons = sidebar.querySelectorAll("button");
    var hosts = [];
    for (var b = 0; b < buttons.length; b += 1) {
      var el = buttons[b];
      var label = (el.getAttribute("aria-label") || "").replace(/\s+/g, "");
      if (label !== "搜索对话" && label !== "收起侧边栏") continue;
      el.setAttribute("data-blade-ui-rail", "item");
      hosts.push(el);
    }
    if (!hosts.length || !hosts[0].parentElement) return;
    var group = hosts[0].parentElement;
    var sameParent = true;
    for (var h = 1; h < hosts.length; h += 1) {
      if (hosts[h].parentElement !== group) sameParent = false;
    }
    if (!sameParent) return;
    group.setAttribute("data-blade-ui-rail", "group");
    var header = group.parentElement;
    if (header && sidebar.contains(header)) header.setAttribute("data-blade-ui-rail", "header");
  }

  function clearAttr(name) {
    var nodes = document.querySelectorAll("[" + name + "]");
    for (var i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute(name);
  }

  function setAttr(node, name, value) {
    if (!node || node.getAttribute(name) === value) return;
    node.setAttribute(name, value);
  }

  function syncTrueAttr(name, keepers) {
    var current = document.querySelectorAll("[" + name + "]");
    var i;
    var j;
    var keep;
    for (i = 0; i < current.length; i += 1) {
      keep = false;
      for (j = 0; j < keepers.length; j += 1) {
        if (current[i] === keepers[j]) keep = true;
      }
      if (!keep) current[i].removeAttribute(name);
    }
    for (j = 0; j < keepers.length; j += 1) setAttr(keepers[j], name, "true");
  }

  function isHomeScenarioChip(node) {
    if (!node || !node.closest) return false;
    if (String(node.className || "").indexOf("home-scenario-in") !== -1) return true;
    return !!node.closest(".home-scenario-in");
  }

  function markHomeAccent() {
    if (String(window.location.port) === "8010") {
      clearAttr("data-blade-ui-hero");
      clearAttr("data-blade-ui-stage");
      clearAttr("data-blade-ui-home-stack");
      clearAttr("data-blade-ui-newchat");
      clearAttr("data-blade-ui-scene");
      return;
    }

    var newchatNodes = [];
    var sidebar = document.getElementById("unified-shell-sidebar");
    if (sidebar) {
      var clicks = sidebar.querySelectorAll("button, a, [role='button']");
      for (var i = 0; i < clicks.length; i += 1) {
        var el = clicks[i];
        if (el.querySelector("button, a")) continue;
        var text = (el.innerText || "").replace(/\s+/g, "");
        if (text.indexOf("新建对话") === -1 || text.length > 20) continue;
        newchatNodes.push(el);
      }
    }

    var heroEl = null;
    var stageEl = null;
    var stackEl = null;
    var greet = document.querySelector("h1.home-greeting-in");
    var greetText = greet ? greet.textContent || "" : "";
    if (greet && greet.parentElement && greet.parentElement.tagName === "HEADER" && greetText.indexOf("你想搭建") === -1) {
      heroEl = greet.parentElement;
      var stage = null;
      var node = greet.parentElement;
      while (node && node !== document.body) {
        var rect = node.getBoundingClientRect();
        if (rect.width > 480 && rect.height > 320 && !node.querySelector("#unified-shell-sidebar")) stage = node;
        node = node.parentElement;
      }
      if (stage) stageEl = stage;
      var stack = greet.parentElement.parentElement;
      while (stack && stack.parentElement && stack.parentElement !== document.body && stack.parentElement.querySelector(".home-input-card") && !stack.parentElement.querySelector("#unified-shell-sidebar")) {
        var parentBox = stack.parentElement.getBoundingClientRect();
        if (parentBox.width > 860) break;
        stack = stack.parentElement;
      }
      if (stack && stack.querySelector(".home-input-card")) stackEl = stack;
    }

    // 0.2.88 没有首页问候时不扫 document.body。技能页每次 paint 对每个 div 读 innerText，
    // 再叠加上面的观察器回环，主线程被占满，页面只剩传送门里的上传按钮。
    var sceneRoot = stageEl || (greet ? document.body : null);
    var sceneTone = {
      "合同审查": "review",
      "数据分析": "analysis",
      "报告撰写": "report",
      "报告生成": "report",
      "信息检索": "search",
      "资料检索": "search",
      "软件工厂": "factory",
      "自定义常用语": "custom"
    };
    var sceneNames = ["合同审查", "数据分析", "报告撰写", "报告生成", "信息检索", "资料检索", "软件工厂", "自定义常用语"];
    function sceneToneFor(text) {
      var compact = (text || "").replace(/\s+/g, "");
      if (!compact || compact.length > 16 || compact.indexOf("更多") !== -1) return "";
      if (sceneTone[compact]) return sceneTone[compact];
      for (var i = 0; i < sceneNames.length; i += 1) {
        if (compact.indexOf(sceneNames[i]) !== -1) return sceneTone[sceneNames[i]];
      }
      return "";
    }
    var desired = [];
    function wantScene(host, tone) {
      if (!host || !tone) return;
      for (var i = 0; i < desired.length; i += 1) {
        if (desired[i].el === host) return;
      }
      desired.push({ el: host, tone: tone });
    }
    var candidates = sceneRoot ? sceneRoot.querySelectorAll("button, a, [role='button'], div, span") : [];
    for (var c = 0; c < candidates.length; c += 1) {
      var chip = candidates[c];
      if (chip.closest("#unified-shell-sidebar, aside[class*='group/rail'], .factory-project-card, .factory-project-grid, .factory-home-lead, .factory-recent-card, .factory-template-card, [role='dialog'], [role='menu']")) continue;
      var tone = sceneToneFor(chip.innerText);
      if (!tone) continue;
      var host = chip;
      var parent = chip.parentElement;
      while (parent && parent !== sceneRoot && parent !== document.body) {
        if (parent.closest("#unified-shell-sidebar, aside[class*='group/rail'], .factory-project-card, .factory-project-grid, .factory-home-lead, .factory-recent-card, .factory-template-card, [role='dialog'], [role='menu']")) break;
        if (sceneToneFor(parent.innerText) !== tone) break;
        var parentBox = parent.getBoundingClientRect();
        if (parentBox.height < 20 || parentBox.height > 64 || parentBox.width < 64 || parentBox.width > 320) break;
        host = parent;
        parent = parent.parentElement;
      }
      if (host.classList && String(host.className).indexOf("home-scenario-in") !== -1) {
        var chipButton = host.querySelector("button");
        if (chipButton) host = chipButton;
      }
      var box = host.getBoundingClientRect();
      if (box.height < 20 || box.height > 64 || box.width < 64 || box.width > 320) continue;
      var heldTone = host.getAttribute("data-blade-ui-scene");
      if (isHomeScenarioChip(host) && heldTone === tone) {
        wantScene(host, heldTone);
        continue;
      }
      wantScene(host, tone);
    }
    if (stackEl) {
      var userTones = ["user-1", "user-2", "user-3", "user-4", "user-5"];
      var userCount = 0;
      var scenarioRows = stackEl.querySelectorAll(".home-scenario-in");
      for (var s = 0; s < scenarioRows.length; s += 1) {
        var scenario = scenarioRows[s];
        var scenarioButtons = scenario.querySelectorAll("button");
        var mainButton = scenario.tagName === "BUTTON" ? scenario : null;
        if (!mainButton) {
          for (var bi = 0; bi < scenarioButtons.length; bi += 1) {
            var buttonTitle = scenarioButtons[bi].getAttribute("title") || "";
            if (buttonTitle.indexOf("删除") !== -1 || buttonTitle.indexOf("编辑") !== -1) continue;
            mainButton = scenarioButtons[bi];
            break;
          }
        }
        if (!mainButton) continue;
        var scenarioText = (mainButton.innerText || "").replace(/\s+/g, "");
        var listed = false;
        for (var li = 0; li < desired.length; li += 1) {
          if (desired[li].el === mainButton) listed = true;
        }
        var held = mainButton.getAttribute("data-blade-ui-scene") || "";
        if (listed) {
          if (held.indexOf("user-") === 0) userCount += 1;
          continue;
        }
        if (held.indexOf("user-") === 0 || (sceneToneFor(scenarioText) && held === sceneToneFor(scenarioText))) {
          wantScene(mainButton, held);
          if (held.indexOf("user-") === 0) userCount += 1;
          continue;
        }
        if (!scenarioText || scenarioText.indexOf("更多") !== -1) continue;
        if (sceneToneFor(scenarioText)) continue;
        var scenarioBox = mainButton.getBoundingClientRect();
        if (scenarioBox.height < 20 || scenarioBox.height > 64 || scenarioBox.width < 40 || scenarioBox.width > 320) continue;
        wantScene(mainButton, userTones[userCount % userTones.length]);
        userCount += 1;
      }
    }
    var sceneNodes = [];
    for (var m = 0; m < desired.length; m += 1) {
      var nested = false;
      for (var n = 0; n < desired.length; n += 1) {
        if (m !== n && desired[n].el.contains(desired[m].el)) nested = true;
      }
      if (!nested) sceneNodes.push(desired[m]);
    }
    for (var a = 0; a < sceneNodes.length; a += 1) setAttr(sceneNodes[a].el, "data-blade-ui-scene", sceneNodes[a].tone);
    var marked = document.querySelectorAll("[data-blade-ui-scene]");
    for (var r = 0; r < marked.length; r += 1) {
      var keepScene = false;
      for (var k = 0; k < sceneNodes.length; k += 1) {
        if (sceneNodes[k].el === marked[r]) keepScene = true;
      }
      if (keepScene) continue;
      var covered = false;
      for (var p = 0; p < sceneNodes.length; p += 1) {
        if (sceneNodes[p].el !== marked[r] && sceneNodes[p].el.contains(marked[r])) covered = true;
      }
      var currentTone = marked[r].getAttribute("data-blade-ui-scene") || "";
      var builtinTone = sceneToneFor(marked[r].innerText || "");
      if (!covered && isHomeScenarioChip(marked[r]) && ((builtinTone && currentTone === builtinTone) || /^user-[1-5]$/.test(currentTone))) continue;
      marked[r].removeAttribute("data-blade-ui-scene");
    }

    syncTrueAttr("data-blade-ui-hero", heroEl ? [heroEl] : []);
    syncTrueAttr("data-blade-ui-stage", stageEl ? [stageEl] : []);
    syncTrueAttr("data-blade-ui-home-stack", stackEl ? [stackEl] : []);
    syncTrueAttr("data-blade-ui-newchat", newchatNodes);
  }

  function markFactorySidebar() {
    var aside = document.querySelector("aside[class*='group/rail']");
    if (!aside || !aside.querySelector("#factory-sidebar-projects-heading")) return;
    var nav = aside.querySelector("nav");
    if (!nav) return;
    ensureFactoryHomeRow(nav);
    var path = window.location.pathname || "";
    var rows = nav.children;
    var pinOn = false;
    var index;
    for (index = 0; index < rows.length; index += 1) {
      var probe = rows[index];
      var probeText = (probe.getAttribute("title") || probe.textContent || "").replace(/\s+/g, "");
      if (probeText.indexOf("置顶") === 0 && String(probe.className || "").indexOf("bg-sidebar-item-active") !== -1) pinOn = true;
    }
    var homeOn = path === "/projects" || path === "/projects/";
    for (index = 0; index < rows.length; index += 1) {
      var item = rows[index];
      var text = (item.getAttribute("title") || item.textContent || "").replace(/\s+/g, "");
      var name = "";
      if (item.getAttribute("data-blade-ui-factory-home") === "true" || text.indexOf("首页") === 0) name = "首页";
      else if (text.indexOf("模板") === 0) name = "模板";
      else if (text.indexOf("置顶") === 0) name = "置顶";
      else if (text.indexOf("项目") === 0) name = "项目";
      var on = String(item.className || "").indexOf("bg-sidebar-item-active") !== -1;
      if (!on && !pinOn && name === "首页" && homeOn) on = true;
      if (!on && !pinOn && name === "项目" && path.indexOf("/projects/list") === 0) on = true;
      if (!on && name === "模板" && path.indexOf("/projects/templates") === 0) on = true;
      if (on) item.setAttribute("data-blade-ui-factory-nav", "on");
      else item.removeAttribute("data-blade-ui-factory-nav");
    }
  }

  function factoryNavRow(nav, label) {
    var kids = nav.children;
    for (var i = 0; i < kids.length; i += 1) {
      if (kids[i].getAttribute("data-blade-ui-factory-home") === "true") continue;
      var text = (kids[i].getAttribute("title") || kids[i].textContent || "").replace(/\s+/g, "");
      if (text.indexOf(label) === 0) return kids[i];
    }
    return null;
  }

  function ensureFactoryHomeRow(nav) {
    var projectRow = factoryNavRow(nav, "项目");
    if (!projectRow) return;
    var home = nav.querySelector("[data-blade-ui-factory-home='true']");
    if (!home) {
      home = document.createElement("button");
      home.type = "button";
      home.className = "flex h-9 w-full items-center gap-2";
      home.title = "首页";
      home.setAttribute("data-blade-ui-factory-home", "true");
      home.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'/><path d='M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/></svg><span>首页</span>";
      home.addEventListener("click", function () {
        var origin = document.querySelector("button[title='软件工厂首页']");
        if (origin) origin.click();
      });
    }
    if (home.parentNode !== nav || home.nextElementSibling !== projectRow) nav.insertBefore(home, projectRow);
  }

  function markFactoryHome() {
    var composers = document.querySelectorAll("[data-blade-ui-factory-composer]");
    for (var i = 0; i < composers.length; i += 1) composers[i].removeAttribute("data-blade-ui-factory-composer");
    var section = document.querySelector("section.factory-home-section");
    if (!section) {
      document.documentElement.removeAttribute("data-blade-ui-factory-home");
      return;
    }
    document.documentElement.setAttribute("data-blade-ui-factory-home", "true");
    var editor = section.querySelector(".ProseMirror");
    var node = editor;
    while (node && node !== section) {
      var rect = node.getBoundingClientRect();
      var cls = String(node.className || "");
      if (rect.width > 280 && rect.height > 72 && rect.height < 320 && cls.indexOf("border") !== -1) {
        node.setAttribute("data-blade-ui-factory-composer", "true");
        break;
      }
      node = node.parentElement;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(paint);
    window.setTimeout(function () {
      if (scheduled) paint();
    }, 60);
  }

  function start() {
    schedule();
    if (document.documentElement) {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
    window.addEventListener("resize", schedule);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
