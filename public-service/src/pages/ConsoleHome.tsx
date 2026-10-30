import { useEffect } from "react";
import { Link } from "react-router-dom";
import { consoleNav } from "../data/nav";
import { Icon } from "../components/Icon";

const stats = [
  { label: "在册技能", value: "128", hint: "含示例资产" },
  { label: "解决方案", value: "24", hint: "已发布 18" },
  { label: "运行会话", value: "12", hint: "门户工作台" },
  { label: "待审核", value: "3", hint: "技能与插件" },
];

const feed = [
  { text: "能力中心 · MCP「态势标绘」登记为已发布", time: "08 分钟前" },
  { text: "方案组 · 「态势综合分析方案」更新到 v0.8", time: "03 小时前" },
  { text: "办公组 · 「公文写作助手」调用量上升", time: "昨天" },
];

export function ConsoleHome() {
  useEffect(() => {
    document.title = "控制台 · 智能模型公共服务平台";
  }, []);

  const modules = consoleNav.filter((item) => item.to !== "/console");

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>控制台</h1>
          <p>从这里进入智能体创建、知识库搭建、技能开发、MCP工具接入、插件管理、工作流、数据源和提示词工程。</p>
        </div>
      </div>
      <section className="stat-grid" aria-label="概览">
        {stats.map((item) => (
          <article className="stat-card" key={item.label}>
            <div className="label">{item.label}</div>
            <div className="value num">{item.value}</div>
            <div className="hint">{item.hint}</div>
          </article>
        ))}
      </section>
      <section className="panel">
        <h2>模块入口</h2>
        <div className="module-grid">
          {modules.map((item) => (
            <Link className="module-card" key={item.to} to={item.to}>
              <span className="ic">
                <Icon name={item.icon} size={18} />
              </span>
              <b>{item.label}</b>
              <span>进入模块</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>最近动态</h2>
        {feed.map((item) => (
          <div className="feed-item" key={item.text}>
            <span>{item.text}</span>
            <time>{item.time}</time>
          </div>
        ))}
      </section>
    </div>
  );
}
