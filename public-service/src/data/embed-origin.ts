/** 嵌入页源站。生产环境由 /shell-site.js 在页面脚本之前写入。 */
const runtime = (window.__EMBED_ORIGIN__ ?? "").trim();
export const EMBED_ORIGIN = runtime.replace(/\/$/, "");

/** 开发时对话、开发、管理直接嵌本机嵌入页。生产包只用安装时写入的地址。 */
export function embedAppPage(path: "/" | "/chat-workspace" | "/chat-admin"): string {
  const origin = (import.meta.env.DEV ? "http://127.0.0.1:5174" : EMBED_ORIGIN).replace(/\/$/, "");
  if (!origin) return "";
  return path === "/" ? `${origin}/` : `${origin}${path}`;
}
