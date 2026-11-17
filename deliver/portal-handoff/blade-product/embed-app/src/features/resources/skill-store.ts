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
export async function installStoreSkill(skillId: string, authorization?: string): Promise<void> {
  const id = skillId.trim();
  if (!id) throw new Error("没有技能编号，不能安装。");
  const body = await postJson("/api-ba/api/skill-store/install", { skill: id }, authorization);
  const record = asRecord(body);
  if (record?.ok === false) {
    throw new Error(text(record.detail) || text(record.message) || "安装失败。");
  }
}

/** 用户级卸载：Hub DELETE /api/me/skills/{org}/{name}/install，也就是取消星标。 */
export async function uninstallStoreSkill(skillId: string, authorization?: string): Promise<void> {
  const id = skillId.trim();
  const cut = id.indexOf("/");
  if (cut <= 0 || cut >= id.length - 1) throw new Error("没有技能编号，不能卸载。");
  const org = encodeURIComponent(id.slice(0, cut));
  const name = encodeURIComponent(id.slice(cut + 1));
  await postJson(`/api-bh/api/me/skills/${org}/${name}/install`, undefined, authorization, "DELETE");
}

async function postJson(
  path: string,
  payload: unknown,
  authorization?: string,
  method: "POST" | "DELETE" = "POST",
): Promise<unknown> {
  let response: Response;
  const headers: Record<string, string> = { Accept: "application/json" };
  const action = method === "DELETE" ? "卸载" : "安装";
  if (method !== "DELETE") headers["Content-Type"] = "application/json";
  if (authorization) headers.Authorization = `Bearer ${authorization}`;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: method === "DELETE" ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new Error("无法连接后台。请确认本机开发服务已启动，并且虚拟机可以访问。");
  }
  const raw = await response.text();
  const body = parseBody(raw);
  if (method === "DELETE" && response.status === 404) return body;
  if (!response.ok || isHtml(body)) {
    const detail = failureDetail(body);
    const reason =
      response.status === 401
        ? "需要登录，当前令牌无法访问"
        : response.status === 403
          ? `没有${action}权限`
          : response.status === 404
            ? "技能不存在或已下架"
            : response.status >= 500
              ? `${action}失败`
              : `${action}失败（HTTP ${response.status}）`;
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
