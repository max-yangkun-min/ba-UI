export type CurrentUser = {
  id: string;
  name: string;
  org: string;
};

export const FALLBACK_USER: CurrentUser = { id: "current", name: "当前用户", org: "平台组织" };

export type Visibility = "个人" | "组织";
export type ScopeKind = "编排流程" | "智能体";

export type VariableDef = {
  name: string;
  description: string;
};

export type OptimizeTurn = {
  id: string;
  instruction: string;
  before: string;
  after: string;
  at: string;
};

export type TestTurn = {
  id: string;
  modelId: string;
  modelName: string;
  sample: string;
  rendered: string;
  output: string;
  ok: boolean;
  error: string;
  at: string;
};

export type PromptTemplate = {
  id: string;
  name: string;
  content: string;
  variables: VariableDef[];
  visibility: Visibility;
  ownerId: string;
  ownerName: string;
  org: string;
  baselineContent: string;
  optimizeTurns: OptimizeTurn[];
  testTurns: TestTurn[];
  createdAt: string;
  updatedAt: string;
};

export type DomainPrompt = {
  id: string;
  name: string;
  role: string;
  background: string;
  scene: string;
  scopeKind: ScopeKind;
  scopeTarget: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateErrors = Partial<Record<"name" | "content" | "variables", string>>;
export type DomainErrors = Partial<Record<"name" | "role" | "background" | "scene" | "scopeTarget", string>>;

export const NAME_MAX = 64;
export const CONTENT_MAX = 8 * 1024;
export const SAMPLE_MAX = 4 * 1024;
export const INSTRUCTION_MAX = 2 * 1024;

const VARIABLE_NAME = /^[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*$/;

export function byteLength(text: string) {
  return new TextEncoder().encode(text).length;
}

export function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function hasErrors(errors: object) {
  return Object.values(errors).some(Boolean);
}

export function extractPlaceholders(content: string) {
  const found: string[] = [];
  const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
  for (const match of content.matchAll(pattern)) {
    const name = match[1]?.trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

export function renderTemplate(content: string, values: Record<string, string>) {
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, raw: string) => {
    const name = raw.trim();
    return values[name] ?? `{{${name}}}`;
  });
}

export function createTemplate(user: CurrentUser): PromptTemplate {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "",
    content: "",
    variables: [],
    visibility: "个人",
    ownerId: user.id,
    ownerName: user.name,
    org: user.org,
    baselineContent: "",
    optimizeTurns: [],
    testTurns: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDomainPrompt(user: CurrentUser): DomainPrompt {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "",
    role: "",
    background: "",
    scene: "",
    scopeKind: "编排流程",
    scopeTarget: "",
    ownerId: user.id,
    ownerName: user.name,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateTemplate(draft: PromptTemplate, templates: PromptTemplate[]): TemplateErrors {
  const errors: TemplateErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "请填写模板名称";
  else if ([...name].length > NAME_MAX) errors.name = "模板名称长度为 1-64 个字符";
  else if (isDuplicateTemplate(draft, templates, name)) {
    errors.name = draft.visibility === "个人" ? "个人空间内已有同名模板，不能保存" : "组织空间内已有同名模板，不能保存";
  }

  if (!draft.content.trim()) errors.content = "请填写模板内容";
  else if (byteLength(draft.content) > CONTENT_MAX) {
    errors.content = `模板内容不能超过 8KB，当前 ${byteLength(draft.content)} 字节`;
  }

  const variableError = validateVariables(draft);
  if (variableError) errors.variables = variableError;
  return errors;
}

function isDuplicateTemplate(draft: PromptTemplate, templates: PromptTemplate[], name: string) {
  return templates.some((item) => {
    if (item.id === draft.id || item.name.trim() !== name) return false;
    if (draft.visibility === "个人") return item.visibility === "个人" && item.ownerId === draft.ownerId;
    return item.visibility === "组织" && item.org === draft.org;
  });
}

function validateVariables(draft: PromptTemplate) {
  const names = new Set<string>();
  for (const [index, item] of draft.variables.entries()) {
    const name = item.name.trim();
    if (!name) return `第 ${index + 1} 个变量名称不能为空`;
    if (!VARIABLE_NAME.test(name)) return `变量「${name}」仅支持中文、字母、数字和下划线，且不能以数字开头`;
    if (names.has(name)) return `变量名称「${name}」重复`;
    names.add(name);
  }
  for (const placeholder of extractPlaceholders(draft.content)) {
    if (!VARIABLE_NAME.test(placeholder)) return `占位符 {{${placeholder}}} 不是合法变量名`;
    if (!names.has(placeholder)) return `占位符 {{${placeholder}}} 尚未在变量定义中声明`;
  }
  return "";
}

export function stampTemplate(draft: PromptTemplate): PromptTemplate {
  const keepBaseline = draft.optimizeTurns.length > 0 && draft.baselineContent.length > 0;
  return {
    ...draft,
    name: draft.name.trim(),
    variables: draft.variables.map((item) => ({ name: item.name.trim(), description: item.description.trim() })),
    baselineContent: keepBaseline ? draft.baselineContent : draft.content,
    updatedAt: new Date().toISOString(),
  };
}

export function validateDomain(draft: DomainPrompt, domains: DomainPrompt[]): DomainErrors {
  const errors: DomainErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "请填写配置名称";
  else if ([...name].length > NAME_MAX) errors.name = "配置名称长度为 1-64 个字符";
  else if (domains.some((item) => item.id !== draft.id && item.name.trim() === name)) {
    errors.name = "已有同名领域任务提示词，不能保存";
  }
  if (!draft.role.trim()) errors.role = "请填写任务角色";
  if (!draft.background.trim()) errors.background = "请填写任务背景";
  if (!draft.scene.trim()) errors.scene = "请填写任务场景";
  if (!draft.scopeTarget.trim()) errors.scopeTarget = "请填写生效范围绑定的编排流程或智能体";
  return errors;
}

export function stampDomain(draft: DomainPrompt): DomainPrompt {
  return {
    ...draft,
    name: draft.name.trim(),
    role: draft.role.trim(),
    background: draft.background.trim(),
    scene: draft.scene.trim(),
    scopeTarget: draft.scopeTarget.trim(),
    updatedAt: new Date().toISOString(),
  };
}

