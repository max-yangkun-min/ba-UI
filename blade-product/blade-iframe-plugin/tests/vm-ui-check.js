const fs = require("fs");
const path = require("path");
const { chromium } = require("C:/Users/11984/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright");

const OUT = "D:/workspaces/blade_agent/lyy/output/playwright";
const BA = "http://192.168.171.128:8020";
const BH = "http://192.168.171.128:8010";
const USER = "superadmin";
const PASS = "superadmin123";

function hex(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return String(color || "");
  return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
}

async function collect(page, name) {
  const info = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const cs = getComputedStyle(body);
    const logos = Array.from(document.querySelectorAll('img[alt="Blade AI"],img[alt="Blade Hub"],img[alt="Blade Agent"],img[alt="Blade OS"]')).map((el) => {
      const st = getComputedStyle(el.closest("[data-blade-branding-hidden]") || el);
      return { alt: el.getAttribute("alt"), display: st.display, hidden: el.closest("[data-blade-branding-hidden]") != null };
    });
    return {
      title: document.title,
      href: location.href,
      themeAttr: root.getAttribute("data-blade-cyan-ui"),
      dataTheme: root.getAttribute("data-theme"),
      bg: cs.backgroundColor,
      color: cs.color,
      logos,
      hasThemeStyle: !!document.getElementById("blade-cyan-logo-free-v2"),
      plugin: window.__bladeEmbedAuth ? window.__bladeEmbedAuth.version : null,
    };
  });
  info.bgHex = hex(info.bg);
  info.name = name;
  return info;
}

async function loginIfNeeded(page) {
  await page.waitForTimeout(1500);
  const url = page.url();
  if (!/19000|login|signin|oauth/i.test(url)) return "already";
  const user = page.locator('input[type="text"], input[name="username"], input[placeholder*="用户"], input[placeholder*="账号"]').first();
  const pass = page.locator('input[type="password"]').first();
  await user.waitFor({ timeout: 15000 });
  await user.fill(USER);
  await pass.fill(PASS);
  const submit = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Sign in")').first();
  await submit.click();
  await page.waitForURL((u) => !/19000|oauth\/authorize/i.test(u.href), { timeout: 30000 });
  return "logged-in";
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "C:/Users/11984/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(page.url() + " :: " + msg.text());
  });
  page.on("response", (res) => {
    if (/theme\.js/.test(res.url()) && res.status() >= 400) errors.push("HTTP " + res.status() + " " + res.url());
  });

  const report = { errors: [], pages: [] };

  await page.goto(BA + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  report.loginBa = await loginIfNeeded(page);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "ba-after-fix.png"), fullPage: false });
  report.pages.push(await collect(page, "ba"));

  await page.goto(BH + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  report.loginBh = await loginIfNeeded(page);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "bh-after-fix.png"), fullPage: false });
  report.pages.push(await collect(page, "bh"));

  await page.goto(BA + "/?iframe=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "ba-iframe-after-fix.png"), fullPage: false });
  report.pages.push(await collect(page, "ba-iframe"));

  await page.goto(BH + "/skills?mode=embed", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "bh-skills-embed-after-fix.png"), fullPage: false });
  report.pages.push(await collect(page, "bh-skills-embed"));

  await page.goto(BH + "/solutions?mode=embed", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, "bh-solutions-embed-after-fix.png"), fullPage: false });
  report.pages.push(await collect(page, "bh-solutions-embed"));

  report.errors = errors;
  fs.writeFileSync(path.join(OUT, "vm-ui-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
