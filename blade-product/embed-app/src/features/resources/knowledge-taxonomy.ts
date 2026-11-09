/**
 * 知识库门户分类，来自对话最后一版《机关单位知识库分类》。
 * 分组是一级分类，条目是二级分类。标签列用来和知识库名称、简介、标签对齐。
 * 和智能体、技能正在用的机关单位场景五组分开，不写入 office-taxonomy。
 * 对不上的返回空数组：各组都是「全部」时仍显示，点了某个二级分类就不显示。
 */

import type { OfficeGroup } from "./office-taxonomy";

export const knowledgeGroups: OfficeGroup[] = [
  {
    id: "kb-regulation",
    name: "法规政策",
    items: [
      { id: "kb-law", name: "法律法规", labels: ["法律", "行政法规", "地方性法规", "政府规章"] },
      { id: "kb-policy-doc", name: "政策文件", labels: ["上级文件", "本级政策", "规范性文件"] },
      { id: "kb-standard", name: "标准规范", labels: ["国家标准", "行业标准", "技术规范"] },
      { id: "kb-interpretation", name: "政策解读", labels: ["条文解释", "适用口径", "答问口径"] },
    ],
  },
  {
    id: "kb-institution",
    name: "内部制度",
    items: [
      { id: "kb-rules", name: "议事制度", labels: ["工作规则", "议事规则", "会议制度"] },
      { id: "kb-process", name: "办事流程", labels: ["收发文流程", "审批流程", "办事指南"] },
      { id: "kb-duty", name: "岗位职责", labels: ["部门职责", "岗位职责", "权责清单"] },
      { id: "kb-emergency", name: "应急保密", labels: ["应急预案", "值班制度", "保密规定"] },
    ],
  },
  {
    id: "kb-papers",
    name: "公文文稿",
    items: [
      { id: "kb-formal", name: "正式公文", labels: ["通知", "请示", "报告", "函", "意见", "批复"] },
      { id: "kb-speech", name: "讲话发言", labels: ["领导讲话", "主持词", "表态发言"] },
      { id: "kb-summary", name: "总结汇报", labels: ["工作总结", "专题汇报", "述职材料"] },
      { id: "kb-brief", name: "信息简报", labels: ["值班信息", "工作快报", "简报", "信息摘报"] },
    ],
  },
  {
    id: "kb-business",
    name: "业务资料",
    items: [
      { id: "kb-meeting", name: "会议资料", labels: ["会议纪要", "议题说明", "签到名册"] },
      { id: "kb-survey", name: "调研成果", labels: ["调研方案", "座谈记录", "调研报告"] },
      { id: "kb-project", name: "项目档案", labels: ["项目方案", "合同文本", "验收材料"] },
      { id: "kb-ledger", name: "数据台账", labels: ["统计报表", "工作台账", "指标数据"] },
    ],
  },
  {
    id: "kb-reference",
    name: "参考素材",
    items: [
      { id: "kb-case", name: "经验案例", labels: ["典型案例", "工作经验", "问题案例"] },
      { id: "kb-study", name: "学习材料", labels: ["理论读本", "培训课件", "党课材料"] },
      { id: "kb-template", name: "模板样例", labels: ["公文模板", "表格模板", "检查清单"] },
      { id: "kb-faq", name: "常见问答", labels: ["办事问答", "口径问答", "操作说明"] },
    ],
  },
];

const itemById = new Map(knowledgeGroups.flatMap((group) => group.items.map((item) => [item.id, item] as const)));

export function knowledgeItemName(id: string) {
  return itemById.get(id)?.name ?? "";
}

export function matchKnowledgeItems(name: string, summary: string, tags: string[] = []) {
  const text = `${name.trim()}\n${summary}\n${tags.join("\n")}`;
  const exactTags = new Set(tags.map((tag) => tag.trim()).filter(Boolean));
  const matched: string[] = [];
  for (const group of knowledgeGroups) {
    for (const item of group.items) {
      const labelHit = item.labels.some((label) => exactTags.has(label) || (label.length >= 4 && text.includes(label)));
      if (text.includes(item.name) || labelHit) matched.push(item.id);
    }
  }
  return matched;
}
