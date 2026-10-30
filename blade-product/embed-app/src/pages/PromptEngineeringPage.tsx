import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { loadCurrentUser } from "../features/prompts/llm";
import { TemplateEditor, type PromptPane } from "../features/prompts/TemplateEditor";
import {
  FALLBACK_USER,
  createDomainPrompt,
  createTemplate,
  formatTime,
  hasErrors,
  stampDomain,
  stampTemplate,
  validateDomain,
  validateTemplate,
  type CurrentUser,
  type DomainErrors,
  type DomainPrompt,
  type PromptTemplate,
  type TemplateErrors,
} from "../features/prompts/model";
import { loadStore, saveStore, type PromptStore } from "../features/prompts/storage";

type StudioPane = PromptPane | "domain";
type DeleteTarget = { kind: "template" | "domain"; id: string; name: string };

const panes: { id: StudioPane; label: string }[] = [
  { id: "edit", label: "编辑" },
  { id: "test", label: "测试" },
  { id: "optimize", label: "优化" },
  { id: "domain", label: "领域任务" },
];

export function PromptEngineeringPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const appliedEdit = useRef("");
  const edit = searchParams.get("edit") ?? "";
  const [store, setStore] = useState<PromptStore>(() => loadStore());
  const [pane, setPane] = useState<StudioPane>(() => (params.scope === "domain" ? "domain" : "edit"));
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<PromptTemplate | null>(() => initialTemplate(params.scope, params.id));
  const [domainDraft, setDomainDraft] = useState<DomainPrompt | null>(() => initialDomain(params.scope, params.id));
  const [domainErrors, setDomainErrors] = useState<DomainErrors>({});
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const [user, setUser] = useState<CurrentUser>(FALLBACK_USER);

  useEffect(() => {
    document.title = "提示词工程 · 智能模型公共服务平台";
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCurrentUser().then((next) => {
      if (!cancelled) setUser(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    if (!edit || appliedEdit.current === edit) return;
    appliedEdit.current = edit;
    const split = edit.indexOf(":");
    if (split >= 0) {
      const scopeName = edit.slice(0, split);
      const id = edit.slice(split + 1);
      if (scopeName === "template") {
        const item = store.templates.find((row) => row.id === id);
        if (item) {
          setDraft(structuredClone(item));
          setPane("edit");
        }
      }
      if (scopeName === "domain") {
        const item = store.domains.find((row) => row.id === id);
        if (item) {
          setDomainErrors({});
          setDomainDraft(structuredClone(item));
          setPane("domain");
        }
      }
    }
    navigate("/console/app-dev/prompts", { replace: true });
  }, [edit, navigate, store.domains, store.templates]);

  const templates = useMemo(() => [...store.templates].sort(byUpdated), [store.templates]);
  const domains = useMemo(() => [...store.domains].sort(byUpdated), [store.domains]);
  const keyword = query.trim();
  const visibleTemplates = templates.filter((item) => !keyword || item.name.includes(keyword) || item.content.includes(keyword));
  const draftIsNew = Boolean(draft && !store.templates.some((item) => item.id === draft.id));

  function openTemplate(id: string) {
    const item = store.templates.find((row) => row.id === id);
    if (!item) return;
    setDraft(structuredClone(item));
    setPane((current) => (current === "domain" ? "edit" : current));
  }

  function openDomain(id: string) {
    const item = store.domains.find((row) => row.id === id);
    if (!item) return;
    setDomainErrors({});
    setDomainDraft(structuredClone(item));
    setPane("domain");
  }

  function startTemplate() {
    setDraft(createTemplate(user));
    setPane("edit");
  }

  function startDomain() {
    setDomainErrors({});
    setDomainDraft(createDomainPrompt(user));
    setPane("domain");
  }

  function saveTemplate(next: PromptTemplate): TemplateErrors | null {
    const errors = validateTemplate(next, store.templates);
    if (hasErrors(errors)) {
      toast("模板校验未通过，请按提示修改");
      return errors;
    }
    const stamped = stampTemplate(next);
    setStore((current) => {
      const exists = current.templates.some((item) => item.id === stamped.id);
      const nextTemplates = exists
        ? current.templates.map((item) => (item.id === stamped.id ? stamped : item))
        : [stamped, ...current.templates];
      return { ...current, templates: nextTemplates };
    });
    setDraft(stamped);
    toast("提示词模板已保存");
    return null;
  }

  function saveDomain() {
    if (!domainDraft) return;
    const errors = validateDomain(domainDraft, store.domains);
    setDomainErrors(errors);
    if (hasErrors(errors)) {
      toast("配置字段缺失，请补全后再保存");
      return;
    }
    const stamped = stampDomain(domainDraft);
    setStore((current) => {
      const exists = current.domains.some((item) => item.id === stamped.id);
      const nextDomains = exists
        ? current.domains.map((item) => (item.id === stamped.id ? stamped : item))
        : [stamped, ...current.domains];
      return { ...current, domains: nextDomains };
    });
    setDomainDraft(stamped);
    toast("领域任务提示词已保存");
  }

  function askDeleteTemplate() {
    if (!draft) return;
    if (draftIsNew) {
      setDraft(null);
      return;
    }
    setPendingDelete({ kind: "template", id: draft.id, name: draft.name || "未命名模板" });
  }

  function askDeleteDomain() {
    if (!domainDraft) return;
    const saved = store.domains.some((item) => item.id === domainDraft.id);
    if (!saved) {
      setDomainDraft(null);
      return;
    }
    setPendingDelete({ kind: "domain", id: domainDraft.id, name: domainDraft.name || "未命名领域任务" });
  }

  function removeTarget() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "template") {
      setStore((current) => ({ ...current, templates: current.templates.filter((item) => item.id !== pendingDelete.id) }));
      if (draft?.id === pendingDelete.id) setDraft(null);
      toast("已删除提示词模板");
    } else {
      setStore((current) => ({ ...current, domains: current.domains.filter((item) => item.id !== pendingDelete.id) }));
      if (domainDraft?.id === pendingDelete.id) setDomainDraft(null);
      toast("已删除领域任务提示词");
    }
    setPendingDelete(null);
  }

  return (
    <div className="prompt-studio">
      <aside className="side-panel" aria-label="提示词模板">
        <div className="side-hd">
          <Icon name="chat-ai-line" />
          <h2>模板</h2>
        </div>
        <div className="side-bd">
          <div className="side-actions">
            <button className="btn btn-primary" type="button" onClick={startTemplate}>
              <Icon name="add-line" />
              新建模板
            </button>
            <input className="field" value={query} placeholder="搜索模板" aria-label="搜索模板" onChange={(event) => setQuery(event.target.value)} />
          </div>
          {draftIsNew && draft ? (
            <button className={pane === "domain" ? "session-item" : "session-item on"} type="button" onClick={() => setPane("edit")}>
              <b>{draft.name.trim() || "未命名模板"}</b>
              <small>未保存</small>
            </button>
          ) : null}
          {visibleTemplates.length === 0 && !draftIsNew ? <p className="prompt-note">还没有模板。新建后可在右侧编辑、测试和优化。</p> : null}
          {visibleTemplates.map((item) => (
            <button
              className={draft?.id === item.id && pane !== "domain" ? "session-item on" : "session-item"}
              type="button"
              key={item.id}
              onClick={() => openTemplate(item.id)}
            >
              <b>{item.name || "未命名模板"}</b>
              <small>
                {item.visibility} · {formatTime(item.updatedAt)}
              </small>
            </button>
          ))}
        </div>
      </aside>

      <section className="prompt-studio-main" aria-label="提示词开发">
        <div className="prompt-studio-tabs" role="tablist" aria-label="开发操作">
          {panes.map((item) => (
            <button
              key={item.id}
              className={pane === item.id ? "prompt-studio-tab on" : "prompt-studio-tab"}
              type="button"
              role="tab"
              aria-selected={pane === item.id}
              onClick={() => setPane(item.id)}
            >
              {item.label}
            </button>
          ))}
          <span className="prompt-studio-current">
            {pane === "domain" ? domainDraft?.name.trim() || "领域任务" : draft?.name.trim() || "未选择模板"}
          </span>
        </div>
        <div className="prompt-studio-body">
          {draft ? (
            <div hidden={pane === "domain"}>
              <TemplateEditor
                draft={draft}
                pane={pane === "domain" ? "edit" : pane}
                saved={!draftIsNew}
                onChange={setDraft}
                onSave={saveTemplate}
                onDelete={askDeleteTemplate}
              />
            </div>
          ) : null}
          {pane !== "domain" && !draft ? (
            <div className="prompt-studio-empty">
              <p>从左侧选择模板，或新建一个后再编辑、测试、优化。</p>
              <button className="btn btn-primary" type="button" onClick={startTemplate}>
                新建模板
              </button>
            </div>
          ) : null}
          {pane === "domain" ? (
            <div className="prompt-domain">
              <aside className="panel prompt-domain-list" aria-label="领域任务列表">
                <div className="prompt-inline">
                  <button className="btn btn-primary" type="button" onClick={startDomain}>
                    <Icon name="add-line" />
                    新建领域任务
                  </button>
                </div>
                {domains.length === 0 && !domainDraft ? <p className="prompt-note">还没有领域任务。用来约束角色、背景和场景。</p> : null}
                {domainDraft && !store.domains.some((item) => item.id === domainDraft.id) ? (
                  <button className="session-item on" type="button">
                    <b>{domainDraft.name.trim() || "未命名领域任务"}</b>
                    <small>未保存</small>
                  </button>
                ) : null}
                {domains.map((item) => (
                  <button
                    className={domainDraft?.id === item.id ? "session-item on" : "session-item"}
                    type="button"
                    key={item.id}
                    onClick={() => openDomain(item.id)}
                  >
                    <b>{item.name}</b>
                    <small>
                      {item.scopeKind} · {formatTime(item.updatedAt)}
                    </small>
                  </button>
                ))}
              </aside>
              {domainDraft ? (
                <form
                  className="panel"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveDomain();
                  }}
                >
                  <h2>{store.domains.some((item) => item.id === domainDraft.id) ? "编辑领域任务" : "新建领域任务"}</h2>
                  <p className="prompt-note">任务角色、任务背景、任务场景用于约束大模型能力。字段缺失时不能保存。</p>
                  <DomainField label="配置名称" value={domainDraft.name} error={domainErrors.name} onChange={(name) => setDomainDraft({ ...domainDraft, name })} />
                  <DomainField label="任务角色" value={domainDraft.role} error={domainErrors.role} onChange={(role) => setDomainDraft({ ...domainDraft, role })} />
                  <DomainField
                    label="任务背景"
                    value={domainDraft.background}
                    error={domainErrors.background}
                    multiline
                    onChange={(background) => setDomainDraft({ ...domainDraft, background })}
                  />
                  <DomainField
                    label="任务场景"
                    value={domainDraft.scene}
                    error={domainErrors.scene}
                    multiline
                    onChange={(scene) => setDomainDraft({ ...domainDraft, scene })}
                  />
                  <div className="form-row">
                    <label htmlFor="domain-scope-kind">生效范围</label>
                    <select
                      id="domain-scope-kind"
                      className="select"
                      aria-label="生效范围"
                      value={domainDraft.scopeKind}
                      onChange={(event) => setDomainDraft({ ...domainDraft, scopeKind: event.target.value as DomainPrompt["scopeKind"] })}
                    >
                      <option value="编排流程">编排流程</option>
                      <option value="智能体">智能体</option>
                    </select>
                  </div>
                  <DomainField
                    label="绑定对象"
                    value={domainDraft.scopeTarget}
                    error={domainErrors.scopeTarget}
                    onChange={(scopeTarget) => setDomainDraft({ ...domainDraft, scopeTarget })}
                  />
                  <div className="prompt-inline">
                    <button className="btn btn-primary" type="submit">
                      保存
                    </button>
                    <button className="btn" type="button" onClick={askDeleteDomain}>
                      {store.domains.some((item) => item.id === domainDraft.id) ? "删除领域任务" : "放弃新建"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="prompt-studio-empty">
                  <p>选择一条领域任务，或新建后再填写角色、背景和场景。</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {pendingDelete ? (
        <Dialog
          title="确认删除"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setPendingDelete(null)}>
                取消
              </button>
              <button className="btn btn-primary" type="button" onClick={removeTarget}>
                删除
              </button>
            </>
          }
        >
          <p className="prompt-copy">确定删除「{pendingDelete.name}」？删除后不可恢复。</p>
        </Dialog>
      ) : null}
    </div>
  );
}

function initialTemplate(scope?: string, id?: string) {
  const store = loadStore();
  if (scope === "template" && id) {
    const item = store.templates.find((row) => row.id === id);
    if (item) return structuredClone(item);
  }
  const first = [...store.templates].sort(byUpdated)[0];
  return first ? structuredClone(first) : null;
}

function initialDomain(scope?: string, id?: string) {
  if (scope !== "domain" || !id) return null;
  const item = loadStore().domains.find((row) => row.id === id);
  return item ? structuredClone(item) : null;
}

function byUpdated<T extends { updatedAt: string }>(a: T, b: T) {
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

function DomainField({
  label,
  value,
  error,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="form-row">
      <label htmlFor={`domain-${label}`}>{label}</label>
      {multiline ? (
        <textarea id={`domain-${label}`} aria-label={label} className={error ? "invalid" : undefined} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input id={`domain-${label}`} aria-label={label} className={error ? "field invalid" : "field"} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
