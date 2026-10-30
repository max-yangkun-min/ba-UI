/** 嵌入页源站。生产环境由 /shell-site.js 在页面脚本之前写入。 */
const runtime = (window.__EMBED_ORIGIN__ ?? "").trim();
export const EMBED_ORIGIN = runtime.replace(/\/$/, "");
