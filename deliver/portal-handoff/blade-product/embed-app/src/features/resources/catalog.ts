import type { ResourceKind } from "../../data/resource-nav";
import { isPublicCatalogAgent } from "./agent-market";
import { isPublicCatalogSkill } from "./skill-store";
import { readRating, readUsage, type ResourceStat } from "./stats";

export type CatalogCard = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  updatedAt?: string;
  category?: string;
  tags?: string[];
  hot?: number;
  usage: ResourceStat;
  rating: ResourceStat;
};

export type CatalogResult = {
  items: CatalogCard[];
  notice?: string;
};

const emptyCopy: Record<ResourceKind, string> = {
  skills: "当前没有可展示的公用技能。",
  knowledge: "后台当前没有可见的知识库。",
  agents: "当前没有可展示的公用智能体。",
  tools: "后台当前没有工具。",
  plugins: "后台当前没有插件。",
};

export function emptyCatalogCopy(kind: ResourceKind) {
  return emptyCopy[kind];
}

export function loadCatalog(kind: ResourceKind): Promise<CatalogResult> {
  if (kind === "skills") return loadSkills();
  if (kind === "knowledge") return loadKnowledge();
  if (kind === "agents") return loadAgents();
  if (kind === "tools") return loadTools();
  return loadPlugins();
}

async function loadSkills(): Promise<CatalogResult> {
  const data = asRecord(await fetchJson("/api-ba/api/skill-store/catalog"));
  if (!data || data.ok === false) {
    throw new Error("技能商店没有返回可用数据，后台标记为未连通。");
  }
  const returned = asArray(data.skills);
  // 展示页只留公用技能。判断见 isPublicCatalogSkill。
  const skills = returned.filter((item) => isPublicCatalogSkill(asRecord(item) ?? {}));
  const items = skills.map((item, index) => {
    const row = asRecord(item) ?? {};
      return {
        id: text(row.id) || text(row.name) || `skill-${index}`,
        name: text(row.display_name) || text(row.name) || "未命名技能",
        description: text(row.description),
        status: installStatus(row.is_installed),
        category: categoryOf(row),
        tags: tagsOf(row),
        ...statsOf(row),
        updatedAt: formatTime(row.updated_at),
      };
  });
  const total = typeof data.total === "number" ? data.total : returned.length;
  return {
    items,
    notice: total > returned.length ? `商店共 ${total} 条，这次接口只返回了前 ${returned.length} 条。` : undefined,
  };
}

async function loadKnowledge(): Promise<CatalogResult> {
  // 门户列表只留市场上架库。scope 缺省是 default，会带出超级管理员自己的私有库。
  const data = await fetchJson("/api-ba/api/registry/kb?scope=market");
  const rows = Array.isArray(data) ? data : asArray(asRecord(data)?.items);
  return {
    items: rows.map((item, index) => {
      const row = asRecord(item) ?? {};
      return {
        id: text(row.id) || `kb-${index}`,
        name: text(row.name) || "未命名知识库",
        description: text(row.description),
        status: visibilityStatus(text(row.visibility)),
        category: categoryOf(row),
        tags: tagsOf(row),
        ...statsOf(row),
        updatedAt: formatTime(row.updated_at),
      };
    }),
  };
}

async function loadAgents(): Promise<CatalogResult> {
  // 门户若改走这份目录，也只留公用上架。不并入 /api/published-apps（当前账号自己的应用）。
  const data = asRecord(await fetchJson("/api-ba/api/market-publish/listings?limit=200"));
  const returned = asArray(data?.items);
  const rows = returned.filter((item) => isPublicCatalogAgent(asRecord(item) ?? {}));
  const items = rows.map((item, index) => {
    const row = asRecord(item) ?? {};
    return {
      id: `market-${text(row.id) || index}`,
      name: text(row.name) || "未命名应用",
      description: text(row.summary),
      status: marketStatus(row),
      ...statsOf(row),
      updatedAt: formatTime(row.updated_at ?? row.published_at),
    };
  });
  return { items };
}

async function loadTools(): Promise<CatalogResult> {
  const data = asRecord(await fetchJson("/api-bh/api/resources?type=tool"));
  const rows = asArray(data?.items);
  return {
    items: rows.map((item, index) => {
      const row = asRecord(item) ?? {};
      return {
        id: text(row.id) || `tool-${index}`,
        name: text(row.name) || "未命名工具",
        description: text(row.description),
        status: toolStatus(text(row.subtype), row.last_test_ok),
        category: subtypeLabel(text(row.subtype)) || categoryOf(row),
        tags: tagsOf(row),
        ...statsOf(row),
        updatedAt: formatTime(row.updated_at),
      };
    }),
  };
}

async function loadPlugins(): Promise<CatalogResult> {
  const data = asRecord(await fetchJson("/api-bh/api/plugins"));
  const builtin = asArray(data?.builtin).map((item) => ({ item, builtin: true }));
  const mine = asArray(data?.mine).map((item) => ({ item, builtin: false }));
  return {
    items: [...builtin, ...mine].map(({ item, builtin: isBuiltin }, index) => {
      const row = asRecord(item) ?? {};
      const installed = row.installed === true ? "已安装" : "未安装";
      return {
        id: `${isBuiltin ? "builtin" : "mine"}-${text(row.name) || index}`,
        name: text(row.display_name) || text(row.name) || "未命名插件",
        description: text(row.description),
        status: `${isBuiltin ? "内置" : "我的"} · ${installed}`,
        category: isBuiltin ? "内置" : "我的",
        tags: tagsOf(row),
        ...statsOf(row),
        updatedAt: formatTime(row.updated_at),
      };
    }),
  };
}

async function fetchJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new Error("无法连接后台。请确认本机开发服务已启动，并且虚拟机可以访问。");
  }
  const text = await response.text();
  const body = parseBody(text);
  if (!response.ok || isHtml(body)) {
    throw new Error(failureMessage(response.status, body));
  }
  return body;
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

function categoryOf(row: Record<string, unknown>) {
  const value = text(row.category) || text(row.group) || text(row.kind);
  return value || undefined;
}

function tagsOf(row: Record<string, unknown>) {
  const raw = row.tags ?? row.labels;
  if (!Array.isArray(raw)) return undefined;
  const tags = raw
    .map((item) => text(item) || text(asRecord(item)?.name) || text(asRecord(item)?.label))
    .filter(Boolean);
  return tags.length ? tags : undefined;
}

function statsOf(row: Record<string, unknown>) {
  const usage = readUsage(row);
  return { usage, rating: readRating(row), hot: usage.value };
}

function subtypeLabel(subtype: string) {
  if (!subtype) return "";
  if (subtype === "mcp") return "MCP";
  if (subtype === "http") return "HTTP";
  if (subtype === "http_stream") return "流式";
  return subtype;
}

function installStatus(value: unknown) {
  if (value === true) return "已安装";
  if (value === false) return "未安装";
  return undefined;
}

function visibilityStatus(value: string) {
  if (value === "private") return "私有";
  if (value === "pending") return "审核中";
  if (value === "public") return "已上架";
  if (value === "shared") return "共享";
  return value || undefined;
}

function marketStatus(row: Record<string, unknown>) {
  if (row.available === false) return "市场 · 暂不可用";
  if (row.featured === true) return "市场 · 精选";
  return "市场";
}

function toolStatus(subtype: string, tested: unknown) {
  const kind = subtype === "mcp" ? "MCP" : subtype === "http" ? "HTTP" : subtype === "http_stream" ? "流式" : subtype;
  const check = tested === true ? "检测通过" : tested === false ? "检测失败" : "";
  return [kind, check].filter(Boolean).join(" · ") || undefined;
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
