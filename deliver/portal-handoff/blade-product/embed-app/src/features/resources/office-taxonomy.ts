/**
 * 机关单位场景分类，来自《机关单位场景分类.xlsx》的「分类表」。
 * 分组是一级分类，条目是二级分类。标签列用来和智能体文案对齐，不单独做一列筛选项。
 */

export type OfficeItem = {
  id: string;
  name: string;
  /** Excel「标签」列，按顿号拆开。 */
  labels: string[];
};

export type OfficeGroup = {
  id: string;
  name: string;
  items: OfficeItem[];
};

export const officeGroups: OfficeGroup[] = [
  {
    id: "gongwen",
    name: "公文办理",
    items: [
      { id: "gongwen-draft", name: "公文起草", labels: ["通知", "请示", "报告", "函", "意见", "批复"] },
      { id: "gongwen-review", name: "公文审核", labels: ["核稿", "错字病句", "版式", "固定提法"] },
      { id: "gongwen-receive", name: "收文办理", labels: ["签收", "登记", "拟办", "分办", "传阅"] },
      { id: "gongwen-issue", name: "发文归档", labels: ["套红", "用印", "印发", "归档"] },
    ],
  },
  {
    id: "writing",
    name: "文字材料",
    items: [
      { id: "writing-summary", name: "总结汇报", labels: ["阶段总结", "专题汇报", "汇报PPT", "汇报提纲"] },
      { id: "writing-brief", name: "信息快报", labels: ["值班信息", "工作快报", "简报", "信息摘报"] },
      { id: "writing-speech", name: "讲话发言", labels: ["领导讲话", "主持词", "表态发言"] },
      { id: "writing-survey", name: "调研报告", labels: ["调研方案", "座谈提纲", "调研报告"] },
    ],
  },
  {
    id: "meeting",
    name: "会议与落实",
    items: [
      { id: "meeting-arrange", name: "会务安排", labels: ["参会通知", "议程", "座席", "会前材料分发"] },
      { id: "meeting-minutes", name: "纪要成文", labels: ["会议纪要", "议定事项", "责任人"] },
      { id: "meeting-schedule", name: "日程联络", labels: ["领导日程", "外单位约时", "来访安排"] },
      { id: "meeting-supervise", name: "督办反馈", labels: ["交办单", "催办", "进度", "办结反馈"] },
    ],
  },
  {
    id: "materials",
    name: "研究与资料",
    items: [
      { id: "materials-policy", name: "政策解读", labels: ["条文解释", "适用对象", "口径对照"] },
      { id: "materials-digest", name: "摘要翻译", labels: ["文章摘要", "要点提取", "公文翻译"] },
      { id: "materials-archive", name: "资料入库", labels: ["文件汇编", "知识条目", "常用模板"] },
      { id: "materials-ledger", name: "数据台账", labels: ["表格核对", "数据清洗", "信息提取", "固定表样", "图表"] },
    ],
  },
  {
    id: "internal",
    name: "内部管理",
    items: [
      { id: "internal-hr", name: "人事干部", labels: ["考勤", "请销假", "培训", "人事材料"] },
      { id: "internal-finance", name: "财务资产", labels: ["预算", "报销", "经费", "资产登记"] },
      { id: "internal-legal", name: "法规保密", labels: ["合同条款审查", "合法性审查", "保密检查"] },
      { id: "internal-logistics", name: "后勤保障", labels: ["办公用品", "用餐", "用车", "住宿", "维修"] },
    ],
  },
];

/**
 * 市场接口没有场景/领域字段，category 是「办公效率」「智能体应用」，对不上这张表。
 * 下面按现有卡片的名称、简介和标签，把能对上的智能体收进二级分类。
 */
const byName: Record<string, readonly string[]> = {
  文巡公文校对台: ["gongwen-review"],
  "文摘 · 文档摘要助手": ["materials-digest"],
  合同审查智能体: ["internal-legal"],
};

/** 卡片文案里的说法，和 Excel 标签不是同一串字，但指的是同一条。 */
const wording: Array<{ id: string; pattern: RegExp }> = [
  { id: "gongwen-review", pattern: /公文校对|错别字|行文规则|公文格式|核稿|错字病句|固定提法|版式/ },
  { id: "materials-digest", pattern: /文档摘要|文章摘要|AI摘要|结构化摘要|要点提取|核心要点/ },
  { id: "internal-legal", pattern: /合同审查|合同条款|合规审查|合法性审查|法规保密/ },
];

const itemById = new Map(officeGroups.flatMap((group) => group.items.map((item) => [item.id, item] as const)));
const groupIdByItem = new Map(officeGroups.flatMap((group) => group.items.map((item) => [item.id, group.id] as const)));

export function officeItemName(id: string) {
  return itemById.get(id)?.name ?? "";
}

export function officeGroupIdOf(itemId: string) {
  return groupIdByItem.get(itemId) ?? "";
}

export function matchOfficeItems(name: string, summary: string, tags: string[]) {
  const title = name.trim().replace(/[\s\u3000]+/g, " ");
  const known = byName[title];
  if (known) return known.filter((id) => itemById.has(id));

  const text = `${title}\n${summary}\n${tags.join("\n")}`;
  const exactTags = new Set(tags.map((tag) => tag.trim()).filter(Boolean));
  const matched: string[] = [];
  for (const group of officeGroups) {
    for (const item of group.items) {
      const labelHit = item.labels.some((label) => exactTags.has(label) || (label.length >= 4 && text.includes(label)));
      if (text.includes(item.name) || labelHit) matched.push(item.id);
    }
  }
  if (matched.length > 0) return matched;
  return wording.filter((rule) => rule.pattern.test(text) && itemById.has(rule.id)).map((rule) => rule.id);
}
