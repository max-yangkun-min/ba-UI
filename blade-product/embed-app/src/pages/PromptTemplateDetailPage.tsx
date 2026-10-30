import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { formatTime, type PromptTemplate } from "../features/prompts/model";
import { loadStore } from "../features/prompts/storage";

export function PromptTemplateDetailPage() {
  const params = useParams();
  const id = params.id ?? "";
  const [template, setTemplate] = useState<PromptTemplate | null>(() => findTemplate(id));

  useEffect(() => {
    const next = findTemplate(id);
    setTemplate(next);
    document.title = `${next?.name || "提示词模板"} · 智能模型公共服务平台`;
  }, [id]);

  useEffect(() => {
    const reload = () => setTemplate(findTemplate(id));
    window.addEventListener("storage", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("focus", reload);
    };
  }, [id]);

  return (
    <div className="agent-portal-detail">
      <div className="agent-portal-inner">
        <Link className="agent-portal-back" to="/resources/prompt-templates">
          <Icon name="arrow-left-line" size={14} />
          提示词模板
        </Link>
        {template ? <TemplateDetail template={template} /> : <p className="agent-portal-status is-error">没有找到这条提示词模板。</p>}
      </div>
    </div>
  );
}

function TemplateDetail({ template }: { template: PromptTemplate }) {
  const scope = visibilityText(template);
  return (
    <div className="agent-layout">
      <aside className="agent-side">
        <section className="agent-info-card agent-profile">
          <div className="agent-big-icon">
            <Icon name="chat-ai-line" size={32} />
          </div>
          <h1 className="agent-big-name">{template.name || "未命名模板"}</h1>
          <p className="agent-big-desc">{scope}</p>
        </section>
        <section className="agent-info-card">
          <h2 className="agent-info-title">
            <span className="agent-info-ico">
              <Icon name="file-list-3-line" size={16} />
            </span>
            基本信息
          </h2>
          <InfoRow label="名称" value={template.name || "未命名模板"} />
          <InfoRow label="可见范围" value={scope} />
          <InfoRow label="维护人" value={template.ownerName || "暂无"} />
          <InfoRow label="更新时间" value={formatTime(template.updatedAt)} />
        </section>
      </aside>
      <section className="agent-main" aria-label="提示词模板内容">
        <div className="agent-prose">
          <h3>
            <Icon name="chat-ai-line" size={16} />
            模板内容
          </h3>
          {template.content.trim() ? <pre className="agent-template-body">{template.content}</pre> : <p className="is-missing">暂无</p>}
          <h3>
            <Icon name="price-tag-3-line" size={16} />
            变量
          </h3>
          {template.variables.length > 0 ? (
            <ul className="agent-var-list">
              {template.variables.map((item) => (
                <li key={item.name}>
                  <strong>{item.name}</strong>
                  {item.description ? <span> · {item.description}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="is-missing">暂无</p>
          )}
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="agent-info-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function visibilityText(item: PromptTemplate) {
  if (item.visibility === "组织") return item.org ? `组织 · ${item.org}` : "组织";
  return "个人";
}

function findTemplate(id: string) {
  const key = safeDecode(id);
  return loadStore().templates.find((item) => item.id === key || item.id === id) ?? null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
