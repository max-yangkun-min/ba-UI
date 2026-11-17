/** 知识库、插件装到当前用户。门户上由取票桥换成外壳传来的用户票，不走超级管理员。 */

export async function installAccountKnowledge(id: string, authorization?: string): Promise<void> {
  const kbId = id.trim();
  if (!/^[1-9]\d*$/.test(kbId)) throw new Error("没有知识库编号，不能安装。");
  await sendEmpty(`/api-bh/api/kb/${encodeURIComponent(kbId)}/install`, "POST", authorization, "安装");
}

export async function uninstallAccountKnowledge(id: string, authorization?: string): Promise<void> {
  const kbId = id.trim();
  if (!/^[1-9]\d*$/.test(kbId)) throw new Error("没有知识库编号，不能卸载。");
  await sendEmpty(`/api-bh/api/kb/${encodeURIComponent(kbId)}/install`, "DELETE", authorization, "卸载");
}

export async function installAccountPlugin(id: string, authorization?: string): Promise<void> {
  const name = pluginName(id);
  if (!name) throw new Error("没有插件名称，不能安装。");
  await sendEmpty(`/api-bh/api/plugins/${encodeURIComponent(name)}/install`, "POST", authorization, "安装");
}

export async function uninstallAccountPlugin(id: string, authorization?: string): Promise<void> {
  const name = pluginName(id);
  if (!name) throw new Error("没有插件名称，不能卸载。");
  await sendEmpty(`/api-bh/api/plugins/${encodeURIComponent(name)}/install`, "DELETE", authorization, "卸载");
}

function pluginName(id: string) {
  const raw = id.trim();
  if (raw.startsWith("builtin-")) return raw.slice("builtin-".length).trim();
  if (raw.startsWith("mine-")) return raw.slice("mine-".length).trim();
  return raw;
}

async function sendEmpty(path: string, method: "POST" | "DELETE", authorization: string | undefined, action: string): Promise<void> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) headers.Authorization = `Bearer ${authorization}`;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, cache: "no-store" });
  } catch {
    throw new Error("无法连接后台。请确认本机开发服务已启动，并且虚拟机可以访问。");
  }
  if (response.ok || (method === "DELETE" && response.status === 404)) return;
  const raw = await response.text();
  let detail = "";
  try {
    const body = raw ? (JSON.parse(raw) as { detail?: unknown; message?: unknown }) : null;
    const value = body?.detail ?? body?.message;
    if (typeof value === "string") detail = value.trim();
  } catch {
    detail = raw.replace(/\s+/g, " ").trim();
  }
  const reason =
    response.status === 401
      ? "需要登录，当前令牌无法访问"
      : response.status === 403
        ? `没有${action}权限`
        : response.status === 404
          ? "资源不存在或已下架"
          : response.status === 409
            ? `暂时不能${action}`
            : response.status >= 500
              ? `${action}失败`
              : `${action}失败（HTTP ${response.status}）`;
  throw new Error(detail ? `${reason}：${detail}` : `${reason}。`);
}
