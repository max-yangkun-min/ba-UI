/** 门户智能体主页按用途归类，名称与技能页同一套。市场原分类不沿用。 */

const byName: Record<string, string> = {
  文巡公文校对台: "文档处理",
  "文摘 · 文档摘要助手": "文档处理",
  合同审查智能体: "合同法务",
};

const rules: Array<{ category: string; pattern: RegExp }> = [
  { category: "作战推演", pattern: /作战|潜艇|反舰|防空|想定|毁伤|航渡|伏击|声呐|编队/ },
  { category: "合同法务", pattern: /合同|条款|谈判|协议|法务|合规审查/ },
  { category: "人事财务", pattern: /工资|考勤|预算|发票|排班|财务|五险|薪酬/ },
  { category: "截图录屏", pattern: /截图|录屏|屏幕/ },
  { category: "界面测试", pattern: /playwright|功能测试|浏览器自动化|网页测试/i },
  { category: "网页界面", pattern: /网页|落地页|界面设计|react|shadcn/i },
  { category: "安全检查", pattern: /安全实践|安全审查|安全报告|漏洞/ },
  { category: "项目协作", pattern: /甘特|任务安排|项目背景|任务规划|SOP|流程/ },
  { category: "演示文稿", pattern: /pptx|幻灯片|演示文稿|演讲/i },
  { category: "视觉样式", pattern: /主题|品牌|配色|字体/ },
  { category: "表格数据", pattern: /表格|excel|xlsx|公式|透视|回归|图表|csv|质检/i },
  { category: "文档处理", pattern: /公文|校对|摘要|文档|word|pdf|docx|排版|简历/i },
  { category: "写作沟通", pattern: /周报|纪要|邮件|汇报|文案|方案|沟通/ },
];

export function portalAgentCategory(name: string, summary: string, tags: string[] = []) {
  const title = name.trim().replace(/\s+/g, " ");
  const known = byName[title];
  if (known) return known;
  const text = `${title}\n${summary}\n${tags.join(" ")}`;
  for (const rule of rules) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return "专项办理";
}
