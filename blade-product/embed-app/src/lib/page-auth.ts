export function normalizePath(pathname: string) {
  const bare = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return bare || "/";
}

/**
 * 门户目录已移交。本进程只剩对话和应用开发，一律要用户票。
 * /resources/prompts 会转到提示词工程，同样按应用开发处理。
 */
export function pageAuthPolicy(pathname: string): "portal" | "user" {
  normalizePath(pathname);
  return "user";
}
