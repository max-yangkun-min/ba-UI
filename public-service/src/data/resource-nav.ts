export const resourceNav = [
  {
    id: "agents",
    label: "智能体",
    to: "/resources/agents",
    summary: "从应用市场添加，并同步已添加和已发布的应用。",
  },
  {
    id: "knowledge",
    label: "知识库",
    to: "/resources/knowledge",
    summary: "与后台知识库目录同步。",
  },
  {
    id: "skills",
    label: "技能",
    to: "/resources/skills",
    summary: "与后台技能商店同步。",
  },
  {
    id: "tools",
    label: "工具",
    to: "/resources/tools",
    summary: "与后台工具目录同步。",
  },
  {
    id: "plugins",
    label: "插件",
    to: "/resources/plugins",
    summary: "与后台插件目录同步。",
  },
  {
    id: "prompt-templates",
    label: "提示词模板",
    to: "/resources/prompt-templates",
    summary: "查看控制台提示词工程里已保存的模板。",
  },
] as const;

export type ResourceKind = (typeof resourceNav)[number]["id"];

export function findResourceNav(kind: string) {
  return resourceNav.find((item) => item.id === kind);
}
