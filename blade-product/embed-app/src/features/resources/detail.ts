import type { ResourceKind } from "../../data/resource-nav";
import { formatStatNumber, readRating, readUsage } from "./stats";

export type ResourceCapability = {
  name: string;
  desc: string;
};

export type ResourceRevision = {
  version: string;
  date: string;
  note: string;
};

export type ResourceDetail = {
  name: string;
  summary: string;
  intro: string;
  developer: string;
  category: string;
  tags: string[];
  usageLabel: string;
  usageText: string;
  favoriteText: string;
  ratingText: string;
  version: string;
  publishedAt: string;
  updatedAt: string;
  deployLabel: string;
  deployText: string;
  aiSummary: string;
  aiNote: string;
  screenshots: string[];
  listingId: string;
  canInstall: boolean;
  marketInstalled: boolean;
  /** 技能商店 is_installed：当前账号是否已星标安装。立即体验仍用原来的技能 id。 */
  installed: boolean;
  experienceUrl: string;
  scene: string;
  department: string;
  publishStatus: string;
  capabilities: ResourceCapability[];
  revisions: ResourceRevision[];
};

const MISSING = "暂无";

export function resourceDetailPath(kind: string, id: string) {
  return `/resources/${kind}/${encodeResourceId(id)}`;
}

/** 控制台里点开一条资源。门户继续用 resourceDetailPath。 */
export function consoleResourcePath(moduleId: string, id: string) {
  return `/console/app-dev/${encodeURIComponent(moduleId)}/open/${encodeResourceId(id)}`;
}

export function withSkillQuery(path: string, kind: string, item: { name?: string; status?: string }) {
  if (kind !== "skills") return path;
  const params = new URLSearchParams();
  if (item.name) params.set("name", item.name);
  params.set("installed", item.status === "未安装" ? "0" : "1");
  return `${path}?${params.toString()}`;
}

function encodeResourceId(id: string) {
  return id
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

export function loadResourceDetail(kind: ResourceKind, id: string): Promise<ResourceDetail> {
  const key = id.trim();
  if (!key) return Promise.reject(new Error("没有找到这条资源。"));
  if (kind === "skills") return loadSkill(key);
  if (kind === "knowledge") return loadKnowledge(key);
  if (kind === "agents") return loadAgent(key);
  if (kind === "tools") return loadTool(key);
  return loadPlugin(key);
}

async function loadSkill(id: string): Promise<ResourceDetail> {
  const parts = id.split("/").filter(Boolean);
  if (parts.length >= 2) {
    try {
      const row = asRecord(await fetchJson(`/api-bh/api/skills/${parts.map((part) => encodeURIComponent(part)).join("/")}`));
      if (row) return present(row);
    } catch {
      // 详情接口失败时，退回商店列表里的同一条。
    }
  }
  const data = asRecord(await fetchJson("/api-ba/api/skill-store/catalog"));
  const row = findRow(asArray(data?.skills), id, ["id", "name"]);
  if (!row) throw new Error("没有找到这条技能。");
  return present(row);
}

async function loadKnowledge(id: string): Promise<ResourceDetail> {
  try {
    const row = asRecord(await fetchJson(`/api-ba/api/registry/kb/${encodeURIComponent(id)}`));
    if (row && (text(row.name) || text(row.id))) return present(row);
  } catch {
    // 详情失败时再从列表里找。
  }
  const data = await fetchJson("/api-ba/api/registry/kb");
  const rows = Array.isArray(data) ? data : asArray(asRecord(data)?.items);
  const row = findRow(rows, id, ["id"]);
  if (!row) throw new Error("没有找到这条知识库。");
  return present(row);
}

async function loadTool(id: string): Promise<ResourceDetail> {
  try {
    const row = asRecord(await fetchJson(`/api-bh/api/resources/${encodeURIComponent(id)}`));
    if (row && (text(row.name) || text(row.id))) return present(row);
  } catch {
    // 详情失败时再从列表里找。
  }
  const data = asRecord(await fetchJson("/api-bh/api/resources?type=tool"));
  const row = findRow(asArray(data?.items), id, ["id"]);
  if (!row) throw new Error("没有找到这个工具。");
  return present(row);
}

async function loadPlugin(id: string): Promise<ResourceDetail> {
  const name = id.startsWith("builtin-") ? id.slice("builtin-".length) : id.startsWith("mine-") ? id.slice("mine-".length) : id;
  try {
    const row = asRecord(await fetchJson(`/api-bh/api/plugins/${encodeURIComponent(name)}`));
    if (row && (text(row.name) || text(row.display_name))) return present(row);
  } catch {
    // 详情失败时再从列表里找。
  }
  const data = asRecord(await fetchJson("/api-bh/api/plugins"));
  const rows = [...asArray(data?.builtin), ...asArray(data?.mine)];
  const row = findRow(rows, name, ["name"]);
  if (!row) throw new Error("没有找到这个插件。");
  return present(row);
}

async function loadAgent(id: string): Promise<ResourceDetail> {
  if (id.startsWith("market-")) return loadMarket(id.slice("market-".length));
  if (id.startsWith("installed-")) return loadInstalled(id.slice("installed-".length));
  if (id.startsWith("published-")) return loadPublished(id.slice("published-".length));
  throw new Error("没有找到这个智能体。");
}

async function loadMarket(id: string): Promise<ResourceDetail> {
  try {
    const row = unwrapRecord(await fetchJson(`/api-bos/api/v1/market/listings/${encodeURIComponent(id)}`));
  if (row) return present(row);
  } catch {
    // 详情失败时再从目录里找。
  }
  const data = await fetchJson("/api-bos/api/v1/market/listings?sort=recent");
  const rows = Array.isArray(data) ? data : asArray(asRecord(data)?.items);
  const row = findRow(rows, id, ["id"]);
  if (!row) throw new Error("没有找到这个智能体。");
  return present(row);
}

async function loadInstalled(id: string): Promise<ResourceDetail> {
  let base: Record<string, unknown> | null = null;
  try {
    const data = await fetchJson("/api-bos/api/v1/market/installed");
    const rows = Array.isArray(data) ? data : asArray(asRecord(data)?.items);
    base = findRow(rows, id, ["listing_id", "id"]);
  } catch {
    base = null;
  }
  const listingId = text(base?.listing_id) || id;
  let extra: Record<string, unknown> | null = null;
  try {
    extra = unwrapRecord(await fetchJson(`/api-bos/api/v1/market/listings/${encodeURIComponent(listingId)}`));
  } catch {
    extra = null;
  }
  const row = mergeRows(base, extra);
  if (!row) throw new Error("没有找到这个智能体。");
  return present(row);
}

async function loadPublished(id: string): Promise<ResourceDetail> {
  try {
    const row = asRecord(await fetchJson(`/api-ba/api/published-apps/${encodeURIComponent(id)}`));
    if (row && (text(row.name) || text(row.session_id))) return present(row);
  } catch {
    // 单条失败时再从已发布列表里找。
  }
  const data = asRecord(await fetchJson("/api-ba/api/published-apps"));
  const row = findRow(asArray(data?.items), id, ["session_id", "name"]);
  if (!row) throw new Error("没有找到这个智能体。");
  return present(row);
}

function present(row: Record<string, unknown>): ResourceDetail {
  const summary = text(row.summary) || text(row.description);
  const metrics = metricsOf(row);
  const ai = readAi(row);
  const description = text(row.description);
  const listingId = text(row.id);
  return {
    name: text(row.display_name) || text(row.name) || text(row.title) || MISSING,
    summary: summary || MISSING,
    intro: introOf(row, summary) || MISSING,
    developer: text(row.owner) || text(row.org_display_name) || text(row.owner_name) || MISSING,
    category: categoryOf(row) || MISSING,
    tags: tagsOf(row),
    usageLabel: metrics.usageLabel,
    usageText: metrics.usageText || MISSING,
    favoriteText: formatStatNumber(favoriteCountOf(row)),
    ratingText: ratingOf(row) || "暂无评价",
    version: versionOf(row) || MISSING,
    publishedAt: formatDay(row.published_at ?? row.created_at) || MISSING,
    updatedAt: formatDay(row.updated_at) || MISSING,
    deployLabel: metrics.deployLabel,
    deployText: metrics.deployText || MISSING,
    aiSummary: ai.text || "暂无摘要",
    aiNote: ai.text ? ai.note : "",
    screenshots: screenshotUrls(row),
    listingId,
    canInstall: canInstallOf(row, listingId),
    // 只有 installed 表示当前账号已经装过。is_owner 是发布者，不是已安装，安装按钮仍要打安装接口。
    marketInstalled: /^[0-9a-f-]{36}$/i.test(listingId) && row.installed === true,
    installed: row.is_installed === true,
    experienceUrl: httpUrl(row.service_url) || httpUrl(row.url) || httpUrl(row.public_url),
    scene: sectionText(description, "适用场景") || MISSING,
    department: sectionText(description, "使用部门") || MISSING,
    publishStatus: publishStatus(row) || MISSING,
    capabilities: capabilitiesOf(description),
    revisions: revisionsOf(row),
  };
}

function canInstallOf(row: Record<string, unknown>, listingId: string) {
  return /^[0-9a-f-]{36}$/i.test(listingId) && row.available === true && row.installed !== true && row.is_owner !== true;
}

function httpUrl(value: unknown) {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function publishStatus(row: Record<string, unknown>) {
  const parts: string[] = [];
  if (row.is_owner === true) parts.push("自有");
  const status = text(row.status);
  if (status === "published") parts.push("已发布");
  else if (status === "running") parts.push("运行中");
  else if (status) parts.push(status);
  const service = text(row.service_status);
  if (service === "running" && !parts.includes("运行中")) parts.push("运行中");
  else if (service && service !== "running") parts.push(service);
  return parts.join(" · ");
}

function sectionText(source: string, title: string) {
  if (!source) return "";
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let capture = false;
  const body: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const heading = headingText(trimmed);
    if (heading) {
      if (capture) break;
      capture = heading === title;
      continue;
    }
    if (capture && trimmed) body.push(trimmed);
  }
  return body.join("\n");
}

function capabilitiesOf(source: string) {
  if (!source) return [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let capture = false;
  const items: ResourceCapability[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const heading = headingText(trimmed);
    if (heading) {
      capture = /能力|功能/.test(heading);
      continue;
    }
    if (!capture) continue;
    const bullet = /^[-*·]\s+(.+)$/.exec(trimmed) || /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (!bullet) continue;
    const value = bullet[1].replace(/[；;]$/, "");
    const splitAt = value.search(/[：:]/);
    if (splitAt > 0) items.push({ name: value.slice(0, splitAt), desc: value.slice(splitAt + 1) });
    else items.push({ name: value, desc: "" });
  }
  return items.slice(0, 6);
}

function headingText(line: string) {
  const markdown = /^(#{1,3})\s+(.+)$/.exec(line);
  if (markdown) return markdown[2].trim();
  const bracket = /^【([^】]+)】$/.exec(line);
  if (bracket) return bracket[1].trim();
  return "";
}

function revisionsOf(row: Record<string, unknown>) {
  const items: ResourceRevision[] = [];
  for (const item of asArray(row.revisions)) {
    const record = asRecord(item);
    if (!record) continue;
    const seq = text(record.seq) || text(record.version);
    const date = formatDay(record.deployed_at ?? record.updated_at);
    const note = text(record.note);
    if (!seq && !date) continue;
    items.push({ version: seq ? (/^v/i.test(seq) ? seq : `v${seq}`) : MISSING, date: date || MISSING, note });
  }
  return items;
}

function metricsOf(row: Record<string, unknown>) {
  const installCount = countOf(row, "install_count");
  const installTotal = countOf(row, "install_total");
  const callCount = countOf(row, "call_count");
  const deployCount = countOf(row, "deploy_count") ?? countOf(row, "deployment_count") ?? countOf(row, "deploy_total");
  let usageLabel = "在用";
  let usageText = "";
  let deployLabel = "累计部署";
  let deployText = "";

  if (deployCount !== undefined) deployText = `${formatStatNumber(deployCount)} 次`;
  else if (installTotal !== undefined) deployText = `${formatStatNumber(installTotal)} 次`;

  if (installCount !== undefined && installTotal !== undefined) {
    usageLabel = "在用";
    usageText = `${formatStatNumber(installCount)} 人`;
  } else if (callCount !== undefined) {
    usageLabel = "调用";
    usageText = `${formatStatNumber(callCount)} 次`;
    if (installCount !== undefined && !deployText) {
      deployLabel = "安装";
      deployText = `${formatStatNumber(installCount)} 次`;
    }
  } else if (installCount !== undefined) {
    usageLabel = "安装";
    usageText = `${formatStatNumber(installCount)} 次`;
  } else {
    const usage = usageOf(row);
    if (usage.text) {
      usageLabel = usage.label;
      usageText = usage.label === "热度" ? usage.text : `${usage.text} 次`;
    }
  }

  return { usageLabel, usageText, deployLabel, deployText };
}

function versionOf(row: Record<string, unknown>) {
  const raw = text(row.version) || text(row.release) || text(row.latest);
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return `v${raw}`;
  return raw;
}

const favoriteKeys = [
  "favorite_count",
  "favorites",
  "favourite_count",
  "favourites",
  "collect_count",
  "collection_count",
  "bookmark_count",
  "bookmarks",
  "star_count",
  "like_count",
];

function favoriteCountOf(row: Record<string, unknown>) {
  for (const key of favoriteKeys) {
    const value = countOf(row, key);
    if (value !== undefined) return value;
  }
  return 0;
}

function countOf(row: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === null || row[key] === "") return undefined;
  if (typeof row[key] === "number" && Number.isFinite(row[key])) return row[key];
  if (typeof row[key] === "string" && row[key].trim() && Number.isFinite(Number(row[key]))) return Number(row[key]);
  return undefined;
}

function introOf(row: Record<string, unknown>, summary: string) {
  const description = text(row.description);
  const content = text(row.content);
  const hint = text(row.agent_hint);
  let body = "";
  if (content && content !== description && content !== summary) body = content;
  else if (description) body = description;
  else body = summary;
  if (hint && hint !== body) body = body ? `${body}\n\n${hint}` : hint;
  return body;
}

function categoryOf(row: Record<string, unknown>) {
  const category = text(row.category) || text(row.group);
  if (category) return category;
  const subtype = text(row.subtype);
  if (subtype === "mcp") return "MCP";
  if (subtype === "http") return "HTTP";
  if (subtype === "http_stream") return "流式";
  if (subtype) return subtype;
  if (typeof row.builtin === "boolean") return row.builtin ? "内置" : "我的";
  return "";
}

function usageOf(row: Record<string, unknown>) {
  const stat = readUsage(row);
  if (stat.value === undefined) return { label: "在用", text: "" };
  const label =
    stat.hint === "安装量" ? "安装量" : stat.hint === "下载量" ? "下载量" : stat.hint === "调用次数" ? "用量" : stat.hint === "热度" ? "热度" : "在用";
  return { label, text: formatStatNumber(stat.value) };
}

function ratingOf(row: Record<string, unknown>) {
  const stat = readRating(row);
  if (stat.value === undefined) return "";
  const value = formatStatNumber(stat.value);
  return stat.scale === undefined ? value : `${value}/${formatStatNumber(stat.scale)}`;
}

function readAi(row: Record<string, unknown>) {
  const review = text(row.ai_review_summary);
  if (review) return { text: review, note: "由 Blade AI 根据应用介绍生成" };
  const summary = text(row.ai_summary);
  if (summary) return { text: summary, note: "由 Blade AI 根据应用介绍生成" };
  return { text: "", note: "" };
}

function screenshotUrls(row: Record<string, unknown>) {
  const listingId = text(row.id);
  const media = asRecord(row.media);
  const raw = [...asArray(row.screenshots), ...asArray(media?.screenshots)];
  const shots = raw
    .map((item, index) => ({ item, index, seq: finite(asRecord(item)?.seq) ?? index }))
    .sort((left, right) => left.seq - right.seq);
  const urls: string[] = [];
  for (const shot of shots) {
    const url = screenshotUrl(shot.item, listingId);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function screenshotUrl(item: unknown, listingId: string) {
  const record = asRecord(item);
  const raw = typeof item === "string" ? item : text(record?.url) || text(record?.src) || text(record?.path) || text(record?.image);
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/api-ba/") || raw.startsWith("/api-bh/") || raw.startsWith("/api-bos/")) return raw;
    if (raw.startsWith("/api/") && /screenshot|\.(png|jpe?g|webp|gif)(\?|$)/i.test(raw)) return `/api-bos${raw}`;
  }
  const shotId = text(record?.id);
  if (shotId && /^[0-9a-f-]{16,}$/i.test(listingId)) {
    return `/api-bos/api/v1/market/listings/${encodeURIComponent(listingId)}/screenshots/${encodeURIComponent(shotId)}/image`;
  }
  return "";
}

function tagsOf(row: Record<string, unknown>) {
  const raw = row.tags ?? row.labels ?? row.keywords;
  if (!Array.isArray(raw)) return [];
  const tags = raw.map((item) => text(item) || text(asRecord(item)?.name) || text(asRecord(item)?.label)).filter(Boolean);
  return [...new Set(tags)];
}

function mergeRows(base: Record<string, unknown> | null, extra: Record<string, unknown> | null) {
  if (!base && !extra) return null;
  if (!base) return extra;
  if (!extra) return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }
  return merged;
}

function findRow(rows: unknown[], id: string, keys: string[]) {
  for (const item of rows) {
    const row = asRecord(item);
    if (!row) continue;
    if (keys.some((key) => text(row[key]) === id)) return row;
  }
  return null;
}

function unwrapRecord(body: unknown) {
  const row = asRecord(body);
  if (!row) return null;
  const nested = asRecord(row.item) ?? asRecord(row.data);
  if (nested && (text(nested.name) || text(nested.id) || text(nested.summary) || text(nested.display_name))) return nested;
  if (text(row.name) || text(row.id) || text(row.summary) || text(row.display_name)) return row;
  return null;
}

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new Error("无法连接后台。请确认本机开发服务已启动，并且虚拟机可以访问。");
  }
  const textBody = await response.text();
  const body = parseBody(textBody);
  if (!response.ok || isHtml(body)) throw new Error(failureMessage(response.status, body));
  return body;
}

function parseBody(textBody: string): unknown {
  if (!textBody) return null;
  try {
    return JSON.parse(textBody) as unknown;
  } catch {
    return textBody;
  }
}

function isHtml(body: unknown) {
  return typeof body === "string" && /<html|<!doctype/i.test(body);
}

function failureMessage(status: number, body: unknown) {
  if (isHtml(body)) return `接口返回了网页而不是数据（HTTP ${status}）。`;
  const detail = detailText(body);
  const reason =
    status === 401
      ? "需要登录，当前令牌无法访问"
      : status === 403
        ? "没有访问权限"
        : status === 404
          ? "接口不存在"
          : status >= 500
            ? "后台暂时不可用"
            : `请求失败（HTTP ${status}）`;
  return detail ? `${reason}：${detail}` : `${reason}。`;
}

function detailText(body: unknown) {
  const record = asRecord(body);
  const detail = record?.detail ?? record?.message;
  if (typeof detail === "string") return clip(detail);
  if (typeof body === "string") return clip(body.replace(/\s+/g, " "));
  return "";
}

function clip(value: string) {
  const textValue = value.trim();
  if (!textValue) return "";
  return textValue.length > 180 ? `${textValue.slice(0, 180)}…` : textValue;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatDay(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const millis = value > 1e12 ? value : value * 1000;
    return day(new Date(millis));
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return day(date);
  }
  return "";
}

function day(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const dateNumber = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${dateNumber}`;
}
