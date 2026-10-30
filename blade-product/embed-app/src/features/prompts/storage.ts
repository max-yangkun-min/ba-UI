import {
  type DomainPrompt,
  type OptimizeTurn,
  type PromptTemplate,
  type ScopeKind,
  type TestTurn,
  type VariableDef,
} from "./model";

const KEY = "public-service.prompt-engineering.v1";

/** 空字符串表示未登录，继续用原来的本地浏览数据。登录后按用户分开，不混进这份数据。 */
let owner = "";

export function setPromptOwner(next: string) {
  owner = next.trim();
}

function storageKey() {
  return owner ? `${KEY}.user.${owner}` : KEY;
}

export type PromptStore = {
  templates: PromptTemplate[];
  domains: DomainPrompt[];
};

export function emptyStore(): PromptStore {
  return { templates: [], domains: [] };
}

export function loadStore(): PromptStore {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return emptyStore();
    return sanitizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

export function saveStore(data: PromptStore) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(data));
  } catch {
    // 浏览器拒绝写入时，页面仍使用当前内存数据。
  }
}

function sanitizeStore(value: unknown): PromptStore {
  if (!isRecord(value)) return emptyStore();
  return {
    templates: readArray(value.templates, readTemplate),
    domains: readArray(value.domains, readDomain),
  };
}

function readTemplate(value: unknown): PromptTemplate | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const now = new Date().toISOString();
  return {
    id: value.id,
    name: value.name,
    content: readString(value.content),
    variables: readArray(value.variables, readVariable),
    visibility: value.visibility === "组织" ? "组织" : "个人",
    ownerId: readString(value.ownerId, "admin"),
    ownerName: readString(value.ownerName, "管理员"),
    org: readString(value.org, "平台组织"),
    baselineContent: readString(value.baselineContent),
    optimizeTurns: readArray(value.optimizeTurns, readOptimizeTurn),
    testTurns: readArray(value.testTurns, readTestTurn),
    createdAt: readString(value.createdAt, now),
    updatedAt: readString(value.updatedAt, now),
  };
}

function readDomain(value: unknown): DomainPrompt | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const now = new Date().toISOString();
  const scopeKind: ScopeKind = value.scopeKind === "智能体" ? "智能体" : "编排流程";
  return {
    id: value.id,
    name: value.name,
    role: readString(value.role),
    background: readString(value.background),
    scene: readString(value.scene),
    scopeKind,
    scopeTarget: readString(value.scopeTarget),
    ownerId: readString(value.ownerId, "admin"),
    ownerName: readString(value.ownerName, "管理员"),
    createdAt: readString(value.createdAt, now),
    updatedAt: readString(value.updatedAt, now),
  };
}

function readVariable(value: unknown): VariableDef | null {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return { name: value.name, description: readString(value.description) };
}

function readOptimizeTurn(value: unknown): OptimizeTurn | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    instruction: readString(value.instruction),
    before: readString(value.before),
    after: readString(value.after),
    at: readString(value.at, new Date().toISOString()),
  };
}

function readTestTurn(value: unknown): TestTurn | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    modelId: readString(value.modelId),
    modelName: readString(value.modelName),
    sample: readString(value.sample),
    rendered: readString(value.rendered),
    output: readString(value.output),
    ok: value.ok === true,
    error: readString(value.error),
    at: readString(value.at, new Date().toISOString()),
  };
}

function readArray<T>(value: unknown, map: (item: unknown) => T | null) {
  if (!Array.isArray(value)) return [];
  return value.map(map).filter((item): item is T => item !== null);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
