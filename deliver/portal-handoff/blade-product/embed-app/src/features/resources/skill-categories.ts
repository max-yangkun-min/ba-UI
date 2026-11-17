/**
 * 技能门户按机关单位二级分类归类。五组分类在 office-taxonomy，这里只记技能对到哪一条。
 * 商店 category 多数为空，少数是作战标签，和这张表对不上，不沿用。
 * 已知技能按 id 末段对上；没收录的再用名称、简介、标签里的说法。
 * 对不上的返回空数组：各组都是「全部」时仍显示，点了某个二级分类就不显示。
 */

import { officeGroups, officeItemName } from "./office-taxonomy";

const itemIds = new Set(officeGroups.flatMap((group) => group.items.map((item) => item.id)));

const bySlug: Record<string, readonly string[]> = {
  "hang-mu-bian-dui-fan-qian-jing-jie-sou-suo": [],
  "hang-mu-bian-dui-duo-zhou-fan-jian-bao-he-da-ji": [],
  "hang-mu-bian-dui-fang-kong-fan-dao-zhen-xing-you-hua": [],
  "jian-li-mu-biao-yun-dong-bu-que-ding-xing-mo-xing": [],
  "sou-cha-qu-yu-hua-fen-lu-xian-she-ji": [],
  "wu-ren-qian-hang-qi-fu-ji-ren-wu-jue-ce-liu-cheng": [],
  "huan-jing-shu-ju-die-jia": [],
  "hang-du-gui-hua": [],
  "xiang-ding-sheng-cheng": [],
  "zhi-neng-lan-jun": [],
  "hui-shang-ping-gu": [],
  "sheng-cun-neng-li-fen-xi": [],
  "sheng-cheng-zuo-zhan-jue-xin": [],
  "hong-fang-xing-dong-sheng-cheng": [],
  "fu-zhu-xia-ding-jue-xin": [],
  "lu-ping-jie-shuo": [],
  "brand-guidelines": [],
  "frontend-design": [],
  playwright: [],
  screenshot: [],
  "security-best-practices": [],
  "theme-factory": [],
  "web-artifacts-builder": [],
  "webapp-testing": [],
  "ge-shi-xiu-fu": [],
  "ge-shi-zhuan-huan": [],
  "lun-wen-pai-ban": [],
  "shi-juan-pai-ban": [],
  "mo-ni-shu-ju": [],
  "chan-pin-xu-qiu": [],
  "chan-pin-yi-ye-zhi": [],
  "ke-hu-an-li": [],
  "shang-wu-you-jian": [],
  "tou-biao-fang-an": [],
  "ji-shu-fang-an": [],
  "xin-wen-tong-gao": [],
  "doc-coauthoring": [],
  docx: [],
  pdf: [],
  "word-sheng-cheng-yu-bian-ji": [],
  "hui-yi-fu-pan": [],
  "ren-wu-gui-hua": [],
  "xiang-mu-bei-jing": [],
  "xiang-mu-gan-te": [],

  "gong-wen-chu-li": ["gongwen-draft", "gongwen-review"],
  "zhi-du-wen-jian-zhuan-xie": ["gongwen-draft"],
  "wen-gao-jiao-dui": ["gongwen-review"],
  "dian-zi-yin-zhang": ["gongwen-issue"],

  "ppt-sheng-cheng-yu-bian-ji": ["writing-summary"],
  pptx: ["writing-summary"],
  "feng-kong-zhou-bao": ["writing-summary"],
  "gong-zuo-zhou-bao": ["writing-summary"],
  "hui-bao-zhu-shou": ["writing-summary"],
  "internal-comms": ["writing-summary"],
  "cai-liao-zong-he": ["writing-summary"],
  "jing-pin-jian-bao": ["writing-brief"],
  "jian-bao-zhai-yao": ["writing-brief", "materials-digest"],
  "xin-xi-bao-song": ["writing-brief"],
  "yan-jiang-bei-zhu": ["writing-speech"],
  "diao-yan-bao-gao": ["writing-survey"],
  "zheng-wu-shu-zi-hua-cai-liao": ["writing-survey"],

  "hui-yi-an-pai": ["meeting-arrange"],
  "hui-yi-ji-yao-zheng-li": ["meeting-minutes"],
  "du-cha-tui-jin": ["meeting-supervise"],
  "ren-wu-an-pai": ["meeting-supervise"],

  "zhi-du-he-gui-he-dui": ["materials-policy", "internal-legal"],
  "shuang-yu-wen-dang": ["materials-digest"],
  "mu-ban-tao-da": ["materials-archive"],
  "sop-bian-xie-zhu-shou": ["materials-archive"],
  "yan-shi-zhuai-wen-gao": ["materials-archive"],
  "biao-ge-gong-shi": ["materials-ledger"],
  "biao-ge-hong": ["materials-ledger"],
  "cha-zhao-yin-yong": ["materials-ledger"],
  "echart-skill": ["materials-ledger"],
  "huashu-excel": ["materials-ledger"],
  "hui-gui-fen-xi": ["materials-ledger"],
  "jupyter-notebook": ["materials-ledger"],
  "shu-ju-tou-shi": ["materials-ledger"],
  "shu-ju-zhi-jian": ["materials-ledger"],
  "tiao-jian-ge-shi": ["materials-ledger"],
  xlsx: ["materials-ledger"],

  "gong-zi-he-suan": ["internal-hr", "internal-finance"],
  "jie-jia-pai-ban": ["internal-hr"],
  "kao-qin-tong-ji": ["internal-hr"],
  "zheng-shu-jiang-zhuang": ["internal-hr"],
  "zhong-wen-jian-li": ["internal-hr"],
  "fa-piao-zheng-li": ["internal-finance"],
  "cai-wu-bao-biao": ["internal-finance"],
  "yu-suan-bian-zhi": ["internal-finance"],
  "he-tong-bi-dui": ["internal-legal"],
  "he-tong-qi-cao": ["internal-legal"],
  "he-tong-shen-cha": ["internal-legal"],
  "que-lou-jian-cha": ["internal-legal"],
  "tan-pan-yao-dian": ["internal-legal"],
  "tiao-kuan-bai-hua": ["internal-legal"],
  "wen-dang-shui-yin": ["internal-legal"],
  "nei-shen-bao-gao": ["internal-legal"],
};

for (const ids of Object.values(bySlug)) {
  for (const id of ids) {
    if (!itemIds.has(id)) throw new Error(`未知的机关单位分类：${id}`);
  }
}

/** 名称、简介里的说法。只给没进 bySlug 的技能用，避免简介里的举例把通用工具扫进去。 */
const fallbacks: Array<{ id: string; pattern: RegExp }> = [
  { id: "gongwen-review", pattern: /公文校对|文稿校对|错别字|错字病句|核稿/ },
  { id: "gongwen-draft", pattern: /公文起草|公文处理|起草公文|制度文件|实施细则/ },
  { id: "gongwen-receive", pattern: /收文办理|拟办意见|分办|传阅/ },
  { id: "gongwen-issue", pattern: /套红|用印|电子印章|发文归档/ },
  { id: "writing-summary", pattern: /总结汇报|阶段总结|专题汇报|工作周报|汇报材料|汇报PPT/ },
  { id: "writing-brief", pattern: /信息快报|信息报送|工作快报|简报摘要|信息摘报/ },
  { id: "writing-speech", pattern: /领导讲话|主持词|表态发言|演讲备注|讲话稿/ },
  { id: "writing-survey", pattern: /调研报告|调研方案|座谈提纲/ },
  { id: "meeting-arrange", pattern: /会务安排|会议安排|参会通知|会议议程/ },
  { id: "meeting-minutes", pattern: /会议纪要|纪要成文|议定事项/ },
  { id: "meeting-schedule", pattern: /领导日程|来访安排|日程联络/ },
  { id: "meeting-supervise", pattern: /督办反馈|督查推进|交办单|催办|办结反馈/ },
  { id: "materials-policy", pattern: /政策解读|条文解释|口径对照|制度核对|条文对照/ },
  { id: "materials-digest", pattern: /文章摘要|文档摘要|要点提取|公文翻译|双语文档|中英双语/ },
  { id: "materials-archive", pattern: /资料入库|文件汇编|知识条目|模板套打/ },
  { id: "materials-ledger", pattern: /数据台账|数据质检|数据透视|表格公式|数据清洗/ },
  { id: "internal-hr", pattern: /考勤统计|请销假|工资核算|人事材料|中文简历|节假排班/ },
  { id: "internal-finance", pattern: /发票整理|财务报表|预算编制|经费预算|资产登记/ },
  { id: "internal-legal", pattern: /合同审查|合同比对|合同起草|合同条款|合法性审查|保密检查|条款白话/ },
  { id: "internal-logistics", pattern: /办公用品|用餐安排|用车申请|住宿安排|后勤保障/ },
];

export function matchSkillOfficeItems(id: string, title: string, description: string, tags: string[] = []) {
  const slug = id.split("/").filter(Boolean).pop() ?? "";
  if (Object.prototype.hasOwnProperty.call(bySlug, slug)) {
    return bySlug[slug].filter((itemId) => itemIds.has(itemId));
  }
  const text = `${title}\n${description}\n${tags.join("\n")}`;
  const matched: string[] = [];
  for (const rule of fallbacks) {
    if (rule.pattern.test(text) && itemIds.has(rule.id) && !matched.includes(rule.id)) matched.push(rule.id);
  }
  return matched;
}

export function portalSkillCategory(id: string, title: string, description: string, tags: string[] = []) {
  const names = matchSkillOfficeItems(id, title, description, tags).map((itemId) => officeItemName(itemId)).filter(Boolean);
  return names.join("、") || "暂无";
}
