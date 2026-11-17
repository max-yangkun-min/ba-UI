import { readRating, readUsage, type ResourceStat } from "./stats";

export type MarketListing = {
  id: string;
  /** 市场 id、service_id 等真实标识。合成卡片时优先用它们对齐。 */
  ids: string[];
  name: string;
  summary: string;
  category: string;
  owner: string;
  installed: boolean;
  available: boolean;
  isOwner: boolean;
  /** 市场 listings 里 status 为 published，或接口没给状态时视为已上架。 */
  listed: boolean;
  version?: string;
  updatedAt?: string;
  tags: string[];
  /** 已发布应用或市场详情里的真实访问地址。没有则是空字符串。 */
  experienceUrl: string;
  usage: ResourceStat;
  rating: ResourceStat;
};

export type InstalledAgent = {
  id: string;
  ids: string[];
  name: string;
  summary: string;
  category: string;
  owner: string;
  status: string;
  version?: string;
  updatedAt?: string;
  tags: string[];
  experienceUrl: string;
  usage: ResourceStat;
  rating: ResourceStat;
};

export type PublishedAgent = {
  id: string;
  ids: string[];
  name: string;
  summary: string;
  status: string;
  version?: string;
  updatedAt?: string;
  tags: string[];
  experienceUrl: string;
  usage: ResourceStat;
  rating: ResourceStat;
};

export type AgentBundle = {
  listings: MarketListing[];
  installed: InstalledAgent[];
  published: PublishedAgent[];
  marketError: string;
  installedError: string;
  publishedError: string;
};

const LISTINGS = "/api-bos/api/v1/market/listings?sort=recent";
const INSTALLED = "/api-bos/api/v1/market/installed";
const PUBLISHED = "/api-ba/api/published-apps";

export async function loadAgentBundle(): Promise<AgentBundle> {
  const [market, installed, published] = await Promise.all([
    readJson(LISTINGS),
    readJson(INSTALLED),
    readJson(PUBLISHED),
  ]);
  return {
    listings: market.error ? [] : parseListings(market.body),
    installed: installed.error ? [] : parseInstalled(installed.body),
    published: published.error ? [] : parsePublished(published.body),
    marketError: market.error,
    installedError: installed.error,
    publishedError: published.error,
  };
}

const IDENTITY_KEYS = ["id", "listing_id", "service_id", "session_id", "os_app_id", "analytics_app_id", "app_id"];

/** 市场目录、已添加、已发布里的同一条合成一条。控制台复用这份结果。 */
export function dedupeAgentLists(input: Pick<AgentBundle, "listings" | "installed" | "published">): Pick<
  AgentBundle,
  "listings" | "installed" | "published"
> {
  const listings = collapseOwners(input.listings.map(copyListing));
  const consumedInstalled = new Set<number>();
  const consumedPublished = new Set<number>();

  input.installed.forEach((item, index) => {
    const host = findMarketHost(item, listings);
    if (!host) return;
    consumedInstalled.add(index);
    fillListing(host, item);
  });
  input.published.forEach((item, index) => {
    const host = findMarketHost(item, listings);
    if (!host) return;
    consumedPublished.add(index);
    fillListing(host, item);
    // 已发布就是这条自有应用，合并后不再提供一次会失败的添加。
    host.isOwner = true;
  });

  const published = dedupeNamed(
    input.published.filter((_, index) => !consumedPublished.has(index)).map(copyPublished),
    fillPublished,
  );
  const installed = dedupeNamed(
    input.installed.filter((_, index) => !consumedInstalled.has(index)).map(copyInstalled),
    fillInstalled,
  ).filter((item) => !published.some((other) => sameAgent(other, item)));

  return { listings, installed, published };
}

export async function addMarketListing(id: string, authorization?: string): Promise<void> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) headers.Authorization = `Bearer ${authorization}`;
  const result = await readJson(`/api-bos/api/v1/market/listings/${encodeURIComponent(id)}/install`, "POST", headers);
  if (result.error) throw new Error(result.error);
}

/** 市场上架卸载：DELETE 同一条 /install。404 表示当前用户本来就没装。 */
export async function removeMarketListing(id: string, authorization?: string): Promise<void> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) headers.Authorization = `Bearer ${authorization}`;
  const result = await readJson(`/api-bos/api/v1/market/listings/${encodeURIComponent(id)}/install`, "DELETE", headers);
  if (result.status === 404) return;
  if (result.error) throw new Error(result.error);
}

async function readJson(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  headers: HeadersInit = { Accept: "application/json" },
): Promise<{ body: unknown; error: string; status: number }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      cache: "no-store",
    });
  } catch {
    return { body: null, error: "无法连接后台。请确认本机开发服务已启动，并且虚拟机可以访问。", status: 0 };
  }
  const text = await response.text();
  const body = parseBody(text);
  if (!response.ok || isHtml(body)) return { body, error: explainFailure(response.status, body), status: response.status };
  return { body, error: "", status: response.status };
}

export function explainFailure(status: number, body: unknown) {
  if (isHtml(body)) return `接口返回了网页而不是数据（HTTP ${status}）。`;
  const detail = detailText(body);
  if (/owner_cannot_install/i.test(detail)) {
    return `不能安装到当前账号：${detail}`;
  }
  if (status === 401) return detail ? `需要登录，当前令牌无法访问：${detail}` : "需要登录，当前令牌无法访问。";
  if (status === 403) return detail ? `没有添加权限：${detail}` : "没有添加权限。";
  if (status === 404) return detail ? `应用不存在或已下架：${detail}` : "应用不存在或已下架。";
  if (status === 409) return detail ? `暂时不能添加：${detail}` : "暂时不能添加。应用可能已添加，或当前版本不可用。";
  if (status === 400 || status === 422) {
    if (/重名|已存在|duplicate|already exists|冲突/i.test(detail)) return detail ? `名称重复：${detail}` : "名称重复。";
    if (/缺|required|field|字段/i.test(detail)) return detail ? `缺少必要字段：${detail}` : "缺少必要字段。";
    return detail ? `无法添加：${detail}` : `无法添加（HTTP ${status}）。`;
  }
  if (status >= 500) return detail ? `后台暂时不可用：${detail}` : "后台暂时不可用。";
  return detail ? `请求失败：${detail}` : `请求失败（HTTP ${status}）。`;
}

/**
 * 市场 listings 没有 is_preset，也没有 visibility。
 * 不带 all_statuses / mine 时，接口只该返回已上架条目：status 缺省或 published。
 * 公用 = 已上架，或接口明确给了 is_preset。
 * is_owner 只表示当前账号是发布者。平台上架由管理员发布时也是 true，不能据此藏掉，
 * 否则管理员打开展示页会是空的。未上架（draft / removed / rejected 等）是私有条目，列表不收。
 * 账号自己的已发布应用（published-apps）不是这条公用目录。
 */
export function isPublicCatalogAgent(row: Record<string, unknown>) {
  if (row.is_preset === true) return true;
  const status = text(row.status).toLowerCase();
  if (!status) return true;
  return status === "published";
}

function isListedRow(row: Record<string, unknown>) {
  return isPublicCatalogAgent(row);
}

function parseListings(body: unknown): MarketListing[] {
  const rows = Array.isArray(body) ? body : asArray(asRecord(body)?.items);
  return rows.map((item, index) => {
    const row = asRecord(item) ?? {};
    return {
      id: text(row.id) || `listing-${index}`,
      ids: identityIds(row),
      name: text(row.name) || "未命名应用",
      summary: text(row.summary),
      category: text(row.category),
      owner: text(row.owner) || "匿名",
      installed: row.installed === true,
      available: row.available !== false,
      isOwner: row.is_owner === true,
      listed: isListedRow(row),
      version: versionLabel(row.version ?? row.release ?? row.latest),
      updatedAt: formatTime(row.updated_at ?? row.published_at ?? row.installed_at),
      tags: tagsOf(row),
      experienceUrl: httpUrl(row.service_url) || httpUrl(row.url) || httpUrl(row.public_url),
      usage: readUsage(row),
      rating: readRating(row),
    };
  });
}

function parseInstalled(body: unknown): InstalledAgent[] {
  const rows = Array.isArray(body) ? body : asArray(asRecord(body)?.items);
  return rows.map((item, index) => {
    const row = asRecord(item) ?? {};
    return {
      id: text(row.listing_id) || text(row.id) || `installed-${index}`,
      ids: identityIds(row),
      name: text(row.name) || "未命名应用",
      summary: text(row.summary) || text(row.description),
      category: text(row.category),
      owner: text(row.owner),
      status: installedStatus(row),
      version: versionLabel(row.version ?? row.release ?? row.latest),
      updatedAt: formatTime(row.updated_at ?? row.installed_at),
      tags: tagsOf(row),
      experienceUrl: httpUrl(row.service_url) || httpUrl(row.url) || httpUrl(row.public_url),
      usage: readUsage(row),
      rating: readRating(row),
    };
  });
}

function parsePublished(body: unknown): PublishedAgent[] {
  return asArray(asRecord(body)?.items).map((item, index) => {
    const row = asRecord(item) ?? {};
    const status = text(row.status);
    const label = status === "running" ? "运行中" : status === "restarting" ? "重启中" : status === "exited" ? "已停止" : status;
    return {
      id: text(row.session_id) || text(row.name) || `published-${index}`,
      ids: identityIds(row),
      name: text(row.name) || "未命名应用",
      summary: text(row.summary) || text(row.description),
      status: label ? `已发布 · ${label}` : "已发布",
      version: versionLabel(row.version ?? row.release ?? row.latest),
      updatedAt: formatTime(row.created_at),
      tags: tagsOf(row),
      experienceUrl: httpUrl(row.url) || httpUrl(row.service_url) || httpUrl(row.public_url),
      usage: readUsage(row),
      rating: readRating(row),
    };
  });
}

function installedStatus(row: Record<string, unknown>) {
  const status = text(row.status) || text(row.service_status);
  if (status === "running") return "已添加 · 运行中";
  if (status === "stopped" || status === "exited") return "已添加 · 已停止";
  if (row.available === false) return "已添加 · 暂不可用";
  return "已添加";
}

type AgentFacts = {
  ids: string[];
  name: string;
  summary: string;
  category?: string;
  owner?: string;
  version?: string;
  updatedAt?: string;
  usage: ResourceStat;
  rating: ResourceStat;
  tags?: string[];
  experienceUrl?: string;
};

function collapseOwners(listings: MarketListing[]) {
  const result: MarketListing[] = [];
  for (const item of listings) {
    const existing = result.find((other) => sameOwnListing(other, item));
    if (!existing) {
      result.push(item);
      continue;
    }
    fillListing(existing, item);
    existing.isOwner = existing.isOwner || item.isOwner;
    if (!existing.isOwner) existing.installed = existing.installed || item.installed;
  }
  return result;
}

function sameOwnListing(left: MarketListing, right: MarketListing) {
  if (shareIds(left.ids, right.ids)) return true;
  if (!left.isOwner || !right.isOwner) return false;
  return sameName(left.name, right.name);
}

function findMarketHost(item: AgentFacts, listings: MarketListing[]) {
  const byId = listings.find((listing) => shareIds(listing.ids, item.ids));
  if (byId) return byId;
  const name = normalizeAgentName(item.name);
  if (!name) return undefined;
  const named = listings.filter((listing) => normalizeAgentName(listing.name) === name);
  return named.find((listing) => listing.isOwner) ?? named.find((listing) => listing.installed) ?? named[0];
}

function fillListing(host: MarketListing, extra: AgentFacts) {
  host.ids = unionIds(host.ids, extra.ids);
  if (!host.summary && extra.summary) host.summary = extra.summary;
  if (!host.category && extra.category) host.category = extra.category;
  if ((!host.owner || host.owner === "匿名") && extra.owner) host.owner = extra.owner;
  if (!host.version && extra.version) host.version = extra.version;
  if (!host.updatedAt && extra.updatedAt) host.updatedAt = extra.updatedAt;
  if (host.usage.value === undefined && extra.usage.value !== undefined) host.usage = extra.usage;
  if (host.rating.value === undefined && extra.rating.value !== undefined) host.rating = extra.rating;
  if (!host.experienceUrl && extra.experienceUrl) host.experienceUrl = extra.experienceUrl;
  if (host.tags.length === 0 && extra.tags && extra.tags.length > 0) host.tags = [...extra.tags];
}

function fillPublished(host: PublishedAgent, extra: PublishedAgent) {
  host.ids = unionIds(host.ids, extra.ids);
  if (!host.summary && extra.summary) host.summary = extra.summary;
  if (!host.version && extra.version) host.version = extra.version;
  if (!host.updatedAt && extra.updatedAt) host.updatedAt = extra.updatedAt;
  if (host.usage.value === undefined && extra.usage.value !== undefined) host.usage = extra.usage;
  if (host.rating.value === undefined && extra.rating.value !== undefined) host.rating = extra.rating;
  if (!host.experienceUrl && extra.experienceUrl) host.experienceUrl = extra.experienceUrl;
  if (host.tags.length === 0 && extra.tags.length > 0) host.tags = [...extra.tags];
}

function fillInstalled(host: InstalledAgent, extra: InstalledAgent) {
  host.ids = unionIds(host.ids, extra.ids);
  if (!host.summary && extra.summary) host.summary = extra.summary;
  if (!host.category && extra.category) host.category = extra.category;
  if (!host.owner && extra.owner) host.owner = extra.owner;
  if (!host.version && extra.version) host.version = extra.version;
  if (!host.updatedAt && extra.updatedAt) host.updatedAt = extra.updatedAt;
  if (host.usage.value === undefined && extra.usage.value !== undefined) host.usage = extra.usage;
  if (host.rating.value === undefined && extra.rating.value !== undefined) host.rating = extra.rating;
  if (!host.experienceUrl && extra.experienceUrl) host.experienceUrl = extra.experienceUrl;
  if (host.tags.length === 0 && extra.tags.length > 0) host.tags = [...extra.tags];
}

function dedupeNamed<T extends AgentFacts>(items: T[], fill: (host: T, extra: T) => void) {
  const result: T[] = [];
  for (const item of items) {
    const existing = result.find((other) => sameAgent(other, item));
    if (!existing) {
      result.push(item);
      continue;
    }
    fill(existing, item);
  }
  return result;
}

function sameAgent(left: AgentFacts, right: AgentFacts) {
  return shareIds(left.ids, right.ids) || sameName(left.name, right.name);
}

function sameName(left: string, right: string) {
  const name = normalizeAgentName(left);
  return Boolean(name) && name === normalizeAgentName(right);
}

function normalizeAgentName(name: string) {
  return name.trim().replace(/[\s\u3000]+/g, "").toLocaleLowerCase("zh-CN");
}

function shareIds(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return false;
  const known = new Set(left);
  return right.some((id) => known.has(id));
}

function unionIds(left: string[], right: string[]) {
  const ids = [...left];
  for (const id of right) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function copyListing(item: MarketListing): MarketListing {
  return { ...item, ids: [...item.ids], tags: [...item.tags], usage: { ...item.usage }, rating: { ...item.rating } };
}

function copyInstalled(item: InstalledAgent): InstalledAgent {
  return { ...item, ids: [...item.ids], usage: { ...item.usage }, rating: { ...item.rating } };
}

function copyPublished(item: PublishedAgent): PublishedAgent {
  return { ...item, ids: [...item.ids], usage: { ...item.usage }, rating: { ...item.rating } };
}

function identityIds(row: Record<string, unknown>) {
  const ids: string[] = [];
  for (const key of IDENTITY_KEYS) {
    const value = text(row[key]);
    if (!value || ids.includes(value)) continue;
    ids.push(value);
  }
  return ids;
}

function tagsOf(row: Record<string, unknown>) {
  const raw = row.tags ?? row.labels;
  if (!Array.isArray(raw)) return [];
  const tags = raw.map((item) => text(item) || text(asRecord(item)?.name) || text(asRecord(item)?.label)).filter(Boolean);
  return [...new Set(tags)];
}

function httpUrl(value: unknown) {
  const raw = text(value);
  if (!/^https?:\/\//i.test(raw)) return "";
  return raw;
}

function versionLabel(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  return /^\d+(?:\.\d+)*$/.test(raw) ? `v${raw}` : raw;
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isHtml(body: unknown) {
  return typeof body === "string" && /<html|<!doctype/i.test(body);
}

function detailText(body: unknown) {
  const record = asRecord(body);
  const detail = record?.detail ?? record?.message ?? record?.reason;
  if (typeof detail === "string") return clip(detail);
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) => {
        const row = asRecord(item);
        return text(row?.msg) || text(row?.message) || text(item);
      })
      .filter(Boolean)
      .join("；");
    return clip(joined);
  }
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

function formatTime(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const millis = value > 1e12 ? value : value * 1000;
    return formatDate(new Date(millis));
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return formatDate(date);
  }
  return undefined;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
