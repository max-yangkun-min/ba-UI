const PORTAL_PREFIXES = [
  "/resources/skills",
  "/resources/knowledge",
  "/resources/agents",
  "/resources/tools",
  "/resources/plugins",
] as const;

export function normalizePath(pathname: string) {
  const bare = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return bare || "/";
}

/**
 * portal：对外展示目录。没有用户票时用服务端超级管理员，有用户票后改走这张票。
 * user：对话页（含普通管理 `/chat-general-admin`），以及控制台应用开发（含其子路径）。未列出的地址会回到对话，同样要用户票。
 * /resources/prompts 会立刻转到提示词工程，按应用开发处理。
 */
export function pageAuthPolicy(pathname: string): "portal" | "user" {
  const path = normalizePath(pathname);
  if (path === "/resources/prompts" || path.startsWith("/resources/prompts/")) return "user";
  if (PORTAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return "portal";
  return "user";
}
