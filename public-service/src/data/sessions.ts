export type StepState = "done" | "doing";

export type ChatMessage = {
  id: string;
  role: "user" | "agent" | "steps";
  text: string;
  steps?: { label: string; state: StepState }[];
};

export type SessionItem = {
  id: string;
  title: string;
  group: "pin" | "recent";
  time: string;
  messages: ChatMessage[];
};

export const scenarios = [
  { label: "合同审查", prompt: "帮我审查以下合同，找出潜在风险和不合理条款" },
  { label: "数据分析", prompt: "帮我分析以下数据，提炼关键结论" },
  { label: "报告撰写", prompt: "帮我撰写一份结构清晰的任务报告初稿" },
  { label: "信息检索", prompt: "帮我检索并整理这个主题的关键信息与来源" },
];

export const initialSessions: SessionItem[] = [
  {
    id: "draft",
    title: "新对话",
    group: "recent",
    time: "刚刚",
    messages: [],
  },
  {
    id: "s-brief",
    title: "整理任务执行摘要",
    group: "pin",
    time: "今天 09:20",
    messages: [
      { id: "m1", role: "user", text: "整理一份任务执行摘要，突出结论、依据和下一步。" },
      {
        id: "m2",
        role: "steps",
        text: "执行过程",
        steps: [
          { label: "已理解任务描述", state: "done" },
          { label: "已匹配公文写作、信息检索技能", state: "done" },
          { label: "已整理可查看的结果", state: "done" },
        ],
      },
      {
        id: "m3",
        role: "agent",
        text: "摘要已按三段组织：结论、依据、下一步。这是静态示例回复，未调用 Blade Agent 服务。",
      },
    ],
  },
  {
    id: "s-route",
    title: "查找航线规划工具",
    group: "recent",
    time: "昨天 16:08",
    messages: [
      { id: "m4", role: "user", text: "查找可用于航线规划的工具，并说明各自适用条件。" },
      {
        id: "m5",
        role: "agent",
        text: "示例结果：航线规划插件、态势标绘 MCP。适用条件与参数以技能注册中心条目为准。",
      },
    ],
  },
  {
    id: "s-contract",
    title: "装备采购合同审查",
    group: "recent",
    time: "10-14",
    messages: [
      { id: "m6", role: "user", text: "审查装备采购合同中的交付与验收条款。" },
      {
        id: "m7",
        role: "agent",
        text: "示例审查：交付节点缺少逾期处理，验收标准未引用量化指标。建议补充时限与复验条件。",
      },
    ],
  },
];

export const capabilities = [
  { name: "公文写作", kind: "技能", status: "已启用", desc: "材料、报告与摘要整理" },
  { name: "数据可视化", kind: "技能", status: "已启用", desc: "表格转图表与要点提取" },
  { name: "装备知识问答", kind: "知识库", status: "已启用", desc: "装备参数与维护问答" },
  { name: "态势标绘", kind: "MCP", status: "已启用", desc: "标绘工具调用示例" },
  { name: "仿真态势读取", kind: "工具", status: "建设中", desc: "想定与态势读取" },
];
