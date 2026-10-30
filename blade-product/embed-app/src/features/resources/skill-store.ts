/**
 * 技能商店目录没有 visibility / published 这类公开字段。
 * 预置技能在平台 org 下，接口给 is_preset=true，并且 is_owner=false
 * （管理员能管预置时，接口也不会把预置标成 is_owner=true）。
 * 当前用户个人命名空间里的技能是 is_owner=true、org_is_mine=true。
 * 公用 = is_preset，或 is_owner===false。不要用 org_is_mine 把预置藏掉。
 */
export function isPublicCatalogSkill(row: Record<string, unknown>) {
  if (row.is_preset === true) return true;
  if (row.is_owner === false) return true;
  return false;
}

/** 用户级安装：Blade POST /api/skill-store/install，body.skill 为目录里的 org/name。星标到当前账号，不另建一条目录。 */
export async function installStoreSkill(skillId: string): Promise<void> {
  const id = skillId.trim();
  if (!id) throw new Error("没有技能编号，不能安装。");
  const body = await postJson("/api-ba/api/skill-store/install", { skill: id });
  const record = asRecord(body);
  if (record?.ok === false) {
    throw new Error(text(record.detail) || text(record.message) || "安装失败。");
  }
}

async function postJson(path: string, payload: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new Error("无法连接后台。请确认本机开发服务已启动，并且虚拟机可以访问。");
  }
  const raw = await response.text();
  const body = parseBody(raw);
  if (!response.ok || isHtml(body)) {
    const detail = failureDetail(body);
    const reason =
      response.status === 401
        ? "需要登录，当前令牌无法访问"
        : response.status === 403
          ? "没有安装权限"
          : response.status === 404
            ? "技能不存在或已下架"
            : response.status >= 500
              ? "安装失败"
              : `安装失败（HTTP ${response.status}）`;
    throw new Error(detail ? `${reason}：${detail}` : `${reason}。`);
  }
  return body;
}

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function isHtml(body: unknown) {
  return typeof body === "string" && /<html|<!doctype/i.test(body);
}

function failureDetail(body: unknown) {
  if (isHtml(body)) return "接口返回了网页而不是数据。";
  const record = asRecord(body);
  const detail = record?.detail ?? record?.message ?? record?.error;
  if (typeof detail === "string") return clip(detail);
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => text(asRecord(item)?.msg) || text(item)).filter(Boolean);
    if (parts.length) return clip(parts.join("；"));
  }
  if (typeof body === "string") return clip(body.replace(/\s+/g, " "));
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function clip(value: string) {
  const textValue = value.trim();
  if (!textValue) return "";
  return textValue.length > 180 ? `${textValue.slice(0, 180)}…` : textValue;
}
