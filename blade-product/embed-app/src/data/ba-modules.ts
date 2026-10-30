import { hubOrigin } from "./site";

/** 能力中心（8010）页面源站。主机与 8020 相同，由 /blade-site.js 提供。 */
export const HUB_ORIGIN = hubOrigin();

/** 嵌进「应用开发」的分模块。缺省 origin 走 8020；8010 的页面单独标明。 */
export type BaAppModule = {
  id: string;
  label: string;
  path: string;
  /** 缺省嵌 8020。有值时嵌这个源站。 */
  origin?: string;
};

export const baAppModules: BaAppModule[] = [
  { id: "skills", label: "技能开发", path: "/studio/skill-editor" },
  { id: "knowledge", label: "知识库搭建", path: "/knowledge" },
  { id: "apps", label: "智能体", path: "/app-market" },
  { id: "factory", label: "智能体创建", path: "/projects" },
  { id: "plugins", label: "插件管理", path: "/plugins", origin: HUB_ORIGIN },
  { id: "workflows", label: "工作流", path: "/workflows", origin: HUB_ORIGIN },
  { id: "data-sources", label: "数据源", path: "/data-sources", origin: HUB_ORIGIN },
  { id: "tools", label: "MCP工具接入", path: "/tools", origin: HUB_ORIGIN },
  { id: "scheduled", label: "定时任务", path: "/scheduled" },
  { id: "admin", label: "运营中心", path: "/admin" },
];

export function findBaAppModule(id: string) {
  return baAppModules.find((item) => item.id === id);
}
