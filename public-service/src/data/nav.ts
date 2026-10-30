export type ConsoleChild = {
  label: string;
  to: string;
};

export type ConsoleNavItem = {
  label: string;
  to: string;
  icon: string;
  end?: boolean;
  /** 命中该前缀时父级保持展开，用来覆盖父链接以外的子路径。 */
  matchPrefix?: string;
  children?: ConsoleChild[];
  /** 展开后附在子项下面的次级入口，不占用子项层级。 */
  example?: ConsoleChild;
};

export const consoleNav: ConsoleNavItem[] = [
  { label: "智能体创建", to: "/console/app-dev/factory", icon: "ai-agent-line" },
  { label: "知识库搭建", to: "/console/app-dev/knowledge", icon: "book-2-line" },
  { label: "技能开发", to: "/console/app-dev/skills/manage", icon: "function-line" },
  { label: "MCP工具接入", to: "/console/app-dev/tools", icon: "tools-line" },
  { label: "插件管理", to: "/console/app-dev/plugins", icon: "puzzle-line" },
  { label: "工作流", to: "/console/app-dev/workflows", icon: "flow-chart" },
  { label: "数据源", to: "/console/app-dev/data-sources", icon: "database-2-line" },
  { label: "提示词工程", to: "/console/app-dev/prompts", icon: "chat-ai-line" },
];

export const moduleCopy: Record<string, { title: string; summary: string }> = {
  data: {
    title: "数据开发",
    summary: "数据集、标注与清洗入口。本页为控制台导航占位，结构对齐参考页左侧模块。",
  },
  "model-dev": {
    title: "模型开发",
    summary: "训练、微调与实验入口。本页为导航占位，正式能力不在本轮示例范围内。",
  },
  models: {
    title: "模型管理",
    summary: "纳管模型、版本与路由。本页为导航占位。",
  },
  "app-build": {
    title: "应用构建",
    summary: "参考页中「应用开发」下的应用构建。本轮示例把 Blade Hub 的技能与方案注册放在「技能与方案」。",
  },
  prompts: {
    title: "提示词工程",
    summary: "开发工作台：编辑提示词模板，调用模型测试和优化，并配置领域任务。",
  },
  plugins: {
    title: "插件管理",
    summary: "插件注册与启停。技能商店中的插件筛选仍在「技能与方案」示例里。",
  },
  mcp: {
    title: "MCP 服务",
    summary: "MCP 服务登记。示例数据中的 MCP 条目可在「技能与方案」中按类型筛选查看。",
  },
  kb: {
    title: "知识库管理",
    summary: "知识库目录与文档。本页为导航占位。",
  },
  edge: {
    title: "边缘管理",
    summary: "边缘节点与部署。本页为导航占位。",
  },
  resources: {
    title: "资源管理",
    summary: "算力、存储与租户资源。本页为导航占位，视觉遵循列表页留白与标题规范。",
  },
};
