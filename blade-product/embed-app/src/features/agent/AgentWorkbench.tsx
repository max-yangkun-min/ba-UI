import { useMemo, useState } from "react";
import { capabilities, initialSessions, scenarios, type ChatMessage, type SessionItem } from "../../data/sessions";
import { IntegrationNote } from "../../components/IntegrationNote";
import { Icon } from "../../components/Icon";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了，还在忙吗？";
  if (hour < 12) return "早上好，需要我帮你处理什么？";
  if (hour < 18) return "下午好，需要我帮你处理什么？";
  return "晚上好，需要我帮你处理什么？";
}

function buildReply(text: string): ChatMessage[] {
  return [
    {
      id: `steps-${Date.now()}`,
      role: "steps",
      text: "执行过程",
      steps: [
        { label: "已理解任务描述", state: "done" },
        { label: "正在匹配技能与资料（示例）", state: "doing" },
        { label: "下一步：形成可查看的结果", state: "done" },
      ],
    },
    {
      id: `agent-${Date.now()}`,
      role: "agent",
      text: `已收到任务：「${text}」。左侧保留会话，右侧能力列表保持不变。此回复只演示改造后的工作台布局，没有调用 8020 上的 Blade Agent。`,
    },
  ];
}

export function AgentWorkbench() {
  const [sessions, setSessions] = useState<SessionItem[]>(initialSessions);
  const [activeId, setActiveId] = useState("draft");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const active = sessions.find((item) => item.id === activeId) ?? sessions[0];
  const visible = useMemo(() => {
    const keyword = query.trim();
    return sessions.filter((item) => {
      if (item.id === "draft" && item.messages.length === 0) return false;
      if (!keyword) return true;
      return item.title.includes(keyword);
    });
  }, [query, sessions]);

  const pinned = visible.filter((item) => item.group === "pin");
  const recent = visible.filter((item) => item.group === "recent");
  const showEmpty = active.messages.length === 0;

  function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", text: content };
    setSessions((list) =>
      list.map((item) =>
        item.id === active.id
          ? {
              ...item,
              title: item.id === "draft" && item.messages.length === 0 ? content.slice(0, 18) : item.title,
              time: "刚刚",
              messages: [...item.messages, userMessage],
            }
          : item,
      ),
    );
    setDraft("");
    window.setTimeout(() => {
      setSessions((list) =>
        list.map((item) =>
          item.id === active.id ? { ...item, messages: [...item.messages, ...buildReply(content)] } : item,
        ),
      );
      setBusy(false);
    }, 360);
  }

  function startNew() {
    setActiveId("draft");
    setDraft("");
    setSessions((list) =>
      list.map((item) => (item.id === "draft" ? { ...item, title: "新对话", messages: [], time: "刚刚" } : item)),
    );
  }

  return (
    <div className="workbench">
      <aside className="side-panel" aria-label="会话">
        <div className="side-hd">
          <Icon name="chat-1-line" />
          <h2>对话</h2>
        </div>
        <div className="side-bd">
          <div className="side-actions">
            <button className="btn btn-primary" type="button" onClick={startNew}>
              <Icon name="add-line" />
              新建对话
            </button>
            <input
              className="field"
              value={query}
              placeholder="搜索对话"
              aria-label="搜索对话"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {pinned.length > 0 ? <div className="group-label">置顶</div> : null}
          {pinned.map((item) => (
            <SessionButton key={item.id} item={item} active={item.id === active.id} onSelect={setActiveId} />
          ))}
          <div className="group-label">最近</div>
          {recent.length === 0 ? <p className="group-label">当前筛选下暂无会话</p> : null}
          {recent.map((item) => (
            <SessionButton key={item.id} item={item} active={item.id === active.id} onSelect={setActiveId} />
          ))}
        </div>
      </aside>

      <section className="chat-col" aria-label="智能助手">
        <div className="chat-note">
          <IntegrationNote
            name="Blade Agent"
            port={8020}
            summary="本机服务未作为页面皮肤使用。下面是按界面规范重做的对话工作台，数据为静态示例。"
          />
        </div>
        <div className="chat-stage">
          {showEmpty ? (
            <div className="chat-empty">
              <div className="welcome">
                <h1>{greeting()}</h1>
                <Composer value={draft} busy={busy} onChange={setDraft} onSend={() => send(draft)} centered />
                <div className="scenario-row">
                  {scenarios.map((item) => (
                    <button key={item.label} className="scenario-chip" type="button" onClick={() => setDraft(item.prompt)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="thread" aria-live="polite">
                {active.messages.map((message) =>
                  message.role === "steps" ? (
                    <div className="steps" key={message.id}>
                      <h3>正在处理当前任务 · 示例流程</h3>
                      <ul>
                        {message.steps?.map((step) => (
                          <li key={step.label} className={step.state === "done" ? "done" : undefined}>
                            {step.state === "done" ? "已完成 · " : "进行中 · "}
                            {step.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      {message.text}
                    </div>
                  ),
                )}
              </div>
              <Composer value={draft} busy={busy} onChange={setDraft} onSend={() => send(draft)} />
            </>
          )}
        </div>
      </section>

      <aside className="side-panel cap-panel" aria-label="能力">
        <div className="side-hd">
          <Icon name="apps-ai-line" />
          <h2>能力</h2>
        </div>
        <div className="side-bd">
          {capabilities.map((item) => (
            <article className="cap-card" key={item.name}>
              <div className="row">
                <b>{item.name}</b>
                <span className={item.status === "已启用" ? "tag tag-ok" : "tag tag-warn"}>{item.status}</span>
              </div>
              <p>
                {item.kind} · {item.desc}
              </p>
            </article>
          ))}
          <div className="model-box">
            <span>当前模型</span>
            <strong>示例模型 · 未连接</strong>
          </div>
        </div>
      </aside>
    </div>
  );
}

function SessionButton({
  item,
  active,
  onSelect,
}: {
  item: SessionItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button className={active ? "session-item on" : "session-item"} type="button" onClick={() => onSelect(item.id)}>
      <b>{item.title}</b>
      <small>{item.time}</small>
    </button>
  );
}

function Composer({
  value,
  busy,
  centered,
  onChange,
  onSend,
}: {
  value: string;
  busy: boolean;
  centered?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <div className={centered ? "composer-wrap center" : "composer-wrap"}>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <textarea
          className="composer-input"
          aria-label="输入任务"
          placeholder="输入你想交给智能助手的任务"
          rows={2}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <button className="btn btn-primary" type="submit" disabled={busy || !value.trim()} aria-label="发送">
          <Icon name="send-plane-2-line" />
          发送
        </button>
      </form>
      <div className="composer-meta">
        <span>Enter 发送，Shift+Enter 换行</span>
        <span>静态示例 · 不调用真实会话</span>
      </div>
    </div>
  );
}
