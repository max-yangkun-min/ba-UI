import { FALLBACK_USER, type CurrentUser } from "./model";

const MODELS_PATH = "/api-ba/api/config/models";
const ME_PATH = "/api-ba/api/auth/me";
const CHAT_PATH = "/api-llm/v1/chat/completions";

export type ChatModel = {
  id: string;
  label: string;
};

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export async function loadCurrentUser(): Promise<CurrentUser> {
  try {
    const body = await requestJson("GET", ME_PATH);
    const record = asRecord(body) ?? {};
    const id = text(record.id) || text(record.user_id) || text(record.userId);
    const name = text(record.display_name) || text(record.displayName) || text(record.name) || text(record.username);
    const org = text(record.org) || text(record.organization) || FALLBACK_USER.org;
    if (!id && !name) return FALLBACK_USER;
    return { id: id || FALLBACK_USER.id, name: name || FALLBACK_USER.name, org };
  } catch {
    return FALLBACK_USER;
  }
}

export async function loadChatModels(): Promise<{ models: ChatModel[]; defaultModelId: string }> {
  const body = await requestJson("GET", MODELS_PATH);
  const record = asRecord(body);
  const models = Array.isArray(record?.models) ? record.models.map(readModel).filter((item): item is ChatModel => item !== null) : [];
  const preferred = text(record?.defaultServiceModel) || text(record?.default);
  const defaultModelId = models.some((item) => item.id === preferred) ? preferred : (models[0]?.id ?? "");
  return { models, defaultModelId };
}

export function testPrompt(model: string, template: string, sample: string) {
  return complete(model, [
    { role: "system", content: template },
    { role: "user", content: sample },
  ]);
}

export function optimizeWithModel(model: string, original: string, instruction: string) {
  return complete(model, [
    {
      role: "system",
      content: "你是提示词优化助手。按优化要求改写提示词。只输出改写后的完整提示词正文，不要解释，不要使用代码围栏。",
    },
    { role: "user", content: `原始提示词：\n${original}\n\n优化要求：\n${instruction}` },
  ]);
}

async function complete(model: string, messages: ChatMessage[]) {
  const body = await requestJson("POST", CHAT_PATH, {
    model,
    stream: false,
    max_tokens: 1024,
    messages,
  });
  const record = asRecord(body);
  const choice = Array.isArray(record?.choices) ? asRecord(record.choices[0]) : null;
  const message = asRecord(choice?.message);
  const content = text(message?.content);
  const reasoning = text(message?.reasoning_content);
  const output = content || reasoning;
  if (!output) {
    throw new Error(`${CHAT_PATH} 已响应，但没有返回文本。`);
  }
  return output;
}

async function requestJson(method: "GET" | "POST", path: string, payload?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "网络错误";
    throw new Error(`${method} ${path} 失败：${reason}`);
  }
  const raw = await response.text();
  const body = parseBody(raw);
  if (!response.ok) {
    throw new Error(`${method} ${path} 失败（HTTP ${response.status}）：${errorDetail(body, raw) || "接口没有返回原因"}`);
  }
  if (typeof body === "string" && /<html|<!doctype/i.test(body)) {
    throw new Error(`${method} ${path} 失败（HTTP ${response.status}）：接口返回了网页而不是数据`);
  }
  return body;
}

function readModel(value: unknown): ChatModel | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = text(record.serviceModelId) || text(record.id);
  if (!id) return null;
  return { id, label: text(record.label) || id };
}

function errorDetail(body: unknown, raw: string) {
  const record = asRecord(body);
  const nested = asRecord(record?.error);
  const detail = text(nested?.message) || text(record?.message) || text(record?.detail) || text(nested?.type);
  if (detail) return clip(detail);
  if (typeof body === "string") return clip(body);
  if (raw.trim()) return clip(raw);
  return "";
}

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}
