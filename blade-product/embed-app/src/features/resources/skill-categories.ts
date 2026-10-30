/** 门户技能页按技能作用归类。商店 category 多数为空，少数作战标签和卡片对不上，这里不沿用。 */

const groups: Record<string, readonly string[]> = {
  作战推演: [
    "hang-mu-bian-dui-fan-qian-jing-jie-sou-suo",
    "hang-mu-bian-dui-duo-zhou-fan-jian-bao-he-da-ji",
    "hang-mu-bian-dui-fang-kong-fan-dao-zhen-xing-you-hua",
    "jian-li-mu-biao-yun-dong-bu-que-ding-xing-mo-xing",
    "sou-cha-qu-yu-hua-fen-lu-xian-she-ji",
    "wu-ren-qian-hang-qi-fu-ji-ren-wu-jue-ce-liu-cheng",
    "huan-jing-shu-ju-die-jia",
    "hang-du-gui-hua",
    "xiang-ding-sheng-cheng",
    "zhi-neng-lan-jun",
    "hui-shang-ping-gu",
    "sheng-cun-neng-li-fen-xi",
    "sheng-cheng-zuo-zhan-jue-xin",
    "hong-fang-xing-dong-sheng-cheng",
    "fu-zhu-xia-ding-jue-xin",
  ],
  文档处理: [
    "word-sheng-cheng-yu-bian-ji",
    "docx",
    "pdf",
    "ge-shi-xiu-fu",
    "ge-shi-zhuan-huan",
    "gong-wen-chu-li",
    "lun-wen-pai-ban",
    "shi-juan-pai-ban",
    "mu-ban-tao-da",
    "shuang-yu-wen-dang",
    "wen-dang-shui-yin",
    "wen-gao-jiao-dui",
    "yan-shi-zhuai-wen-gao",
    "dian-zi-yin-zhang",
    "zheng-shu-jiang-zhuang",
    "zhong-wen-jian-li",
  ],
  表格数据: [
    "xlsx",
    "biao-ge-gong-shi",
    "biao-ge-hong",
    "cha-zhao-yin-yong",
    "huashu-excel",
    "hui-gui-fen-xi",
    "echart-skill",
    "jupyter-notebook",
    "shu-ju-tou-shi",
    "shu-ju-zhi-jian",
    "tiao-jian-ge-shi",
    "mo-ni-shu-ju",
  ],
  写作沟通: [
    "chan-pin-xu-qiu",
    "chan-pin-yi-ye-zhi",
    "diao-yan-bao-gao",
    "doc-coauthoring",
    "feng-kong-zhou-bao",
    "gong-zuo-zhou-bao",
    "hui-bao-zhu-shou",
    "hui-yi-fu-pan",
    "hui-yi-ji-yao-zheng-li",
    "internal-comms",
    "ji-shu-fang-an",
    "jing-pin-jian-bao",
    "ke-hu-an-li",
    "nei-shen-bao-gao",
    "shang-wu-you-jian",
    "tou-biao-fang-an",
    "xin-wen-tong-gao",
  ],
  演示文稿: ["ppt-sheng-cheng-yu-bian-ji", "pptx", "yan-jiang-bei-zhu"],
  视觉样式: ["theme-factory", "brand-guidelines"],
  合同法务: ["he-tong-bi-dui", "he-tong-qi-cao", "he-tong-shen-cha", "que-lou-jian-cha", "tan-pan-yao-dian", "tiao-kuan-bai-hua"],
  人事财务: ["fa-piao-zheng-li", "cai-wu-bao-biao", "gong-zi-he-suan", "kao-qin-tong-ji", "jie-jia-pai-ban", "yu-suan-bian-zhi"],
  网页界面: ["web-artifacts-builder", "frontend-design"],
  界面测试: ["webapp-testing", "playwright"],
  截图录屏: ["screenshot", "lu-ping-jie-shuo"],
  项目协作: ["ren-wu-an-pai", "ren-wu-gui-hua", "xiang-mu-bei-jing", "xiang-mu-gan-te", "sop-bian-xie-zhu-shou"],
  安全检查: ["security-best-practices"],
};

const bySlug: Record<string, string> = {};
for (const [category, slugs] of Object.entries(groups)) {
  for (const slug of slugs) bySlug[slug] = category;
}

const fallbacks: Array<{ category: string; pattern: RegExp }> = [
  { category: "作战推演", pattern: /作战|潜艇|反舰|防空|想定|毁伤|航渡|伏击|声呐|编队/ },
  { category: "合同法务", pattern: /合同|条款|谈判|协议/ },
  { category: "人事财务", pattern: /工资|考勤|预算|发票|排班|财务|五险|薪酬/ },
  { category: "截图录屏", pattern: /截图|录屏|屏幕/ },
  { category: "界面测试", pattern: /playwright|功能测试|浏览器自动化|网页测试/i },
  { category: "网页界面", pattern: /网页|落地页|界面设计|react|shadcn/i },
  { category: "安全检查", pattern: /安全实践|安全审查|安全报告/ },
  { category: "项目协作", pattern: /甘特|任务安排|项目背景|任务规划|SOP|流程/ },
  { category: "演示文稿", pattern: /pptx|幻灯片|演示文稿|演讲/i },
  { category: "视觉样式", pattern: /主题|品牌|配色|字体/ },
  { category: "表格数据", pattern: /表格|excel|xlsx|公式|透视|回归|图表|csv|质检|笔记本/i },
  { category: "文档处理", pattern: /word|pdf|docx|排版|公文|简历|水印|校对|印章/i },
];

export function portalSkillCategory(id: string, title: string, description: string) {
  const slug = id.split("/").filter(Boolean).pop() ?? "";
  const known = bySlug[slug];
  if (known) return known;
  const text = `${title}\n${description}`;
  for (const rule of fallbacks) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return "写作沟通";
}
