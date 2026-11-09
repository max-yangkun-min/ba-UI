import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { baOrigin, hubOrigin } from "../data/site";
import { findResourceNav, type ResourceKind } from "../data/resource-nav";
import { addMarketListing } from "../features/resources/agent-market";
import { portalAgentCategory } from "../features/resources/agent-categories";
import { loadResourceDetail, type ResourceDetail } from "../features/resources/detail";
import { addLocalDiscussion, readLocalDiscussions, type LocalDiscussion } from "../features/resources/local-discussions";
import { readLocalFavorite, writeLocalFavorite } from "../features/resources/local-favorites";
import { portalSkillCategory } from "../features/resources/skill-categories";
import { installStoreSkill } from "../features/resources/skill-store";

const icons: Record<ResourceKind, string> = {
  skills: "function-line",
  knowledge: "book-2-line",
  agents: "ai-agent-line",
  tools: "tools-line",
  plugins: "puzzle-line",
};

export function ResourceDetailPage() {
  const params = useParams();
  const kind = params.kind ?? "";
  const id = params["*"] ?? "";
  const nav = findResourceNav(kind);

  if (!nav) return <Navigate to="/" replace />;
  if (!id) return <Navigate to={nav.to} replace />;
  return <ResourceDetailBody kind={nav.id} id={id} label={nav.label} listTo={nav.to} />;
}

export function ResourceDetailBody({
  kind,
  id,
  label,
  listTo,
}: {
  kind: ResourceKind;
  id: string;
  label: string;
  listTo: string;
}) {
  return <DetailView kind={kind} label={label} listTo={listTo} id={id} icon={icons[kind]} />;
}

function DetailView({
  kind,
  label,
  listTo,
  id,
  icon,
}: {
  kind: ResourceKind;
  label: string;
  listTo: string;
  id: string;
  icon: string;
}) {
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = `${label}详情 · 智能模型公共服务平台`;
  }, [label]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError("");
    setDetail(null);
    loadResourceDetail(kind, id)
      .then((next) => {
        if (cancelled) return;
        const shown = portalCatalogDetail(kind, listTo, id, next);
        setDetail(shown);
        setPhase("ready");
        document.title = `${shown.name} · ${label} · 智能模型公共服务平台`;
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "加载失败。");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id, kind, label, listTo]);

  return (
    <div className="agent-portal-detail">
      <div className="agent-portal-inner">
        <Link className="agent-portal-back" to={listTo}>
          <Icon name="arrow-left-line" size={14} />
          {label}
        </Link>
        {phase === "loading" ? <p className="agent-portal-status">正在读取这条资源的详情。</p> : null}
        {phase === "error" ? (
          <p className="agent-portal-status is-error" role="alert">
            {error}
          </p>
        ) : null}
        {phase === "ready" && detail ? (
          <AgentPortalDetail
            detail={detail}
            favoriteKey={`${kind}:${id}`}
            marketClone={kind === "agents"}
            skillInstall={kind === "skills"}
            icon={kind === "agents" ? "edit-line" : icon}
            showShots={kind === "agents"}
            experienceTopHref={experiencePageUrl(kind, id, params.get("name") ?? "")}
            onInstalled={() => {
              setPhase("loading");
              setDetail(null);
              loadResourceDetail(kind, id)
                .then((next) => {
                  setDetail(portalCatalogDetail(kind, listTo, id, next));
                  setPhase("ready");
                })
                .catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : "加载失败。");
                  setPhase("error");
                });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function portalCatalogDetail(kind: ResourceKind, listTo: string, id: string, detail: ResourceDetail) {
  if (!listTo.startsWith("/resources")) return detail;
  if (kind === "skills") return { ...detail, category: portalSkillCategory(id, detail.name, `${detail.summary}\n${detail.intro}`, detail.tags) };
  if (kind === "agents") return { ...detail, category: portalAgentCategory(detail.name, `${detail.summary}\n${detail.intro}`, detail.tags) };
  return detail;
}

function experiencePageUrl(kind: ResourceKind, id: string, name: string) {
  const agent = baOrigin() || (import.meta.env.DEV ? "http://192.168.171.128:8020" : "");
  const hub = hubOrigin() || (import.meta.env.DEV ? "http://192.168.171.128:8010" : "");
  if (kind === "knowledge") return `${agent}/knowledge/${encodeURIComponent(id)}`;
  if (kind === "skills") {
    const query = new URLSearchParams();
    query.set("skill", id);
    if (name) query.set("skill_name", name);
    return `${agent}/chat?${query.toString()}`;
  }
  if (kind === "tools") return `${hub}/tools/${encodeURIComponent(id)}`;
  if (kind === "plugins") return `${hub}/plugins/${encodeURIComponent(pluginNameOf(id))}`;
  return undefined;
}

function pluginNameOf(id: string) {
  if (id.startsWith("builtin-")) return id.slice("builtin-".length);
  if (id.startsWith("mine-")) return id.slice("mine-".length);
  return id;
}

const tagTones = ["is-primary", "is-purple", "is-green", ""];
const capIcons = ["book-2-line", "settings-4-line", "file-list-3-line", "shield-check-line"];
export function AgentPortalDetail({
  detail,
  favoriteKey,
  marketClone = false,
  skillInstall = false,
  icon,
  onInstalled,
  extra,
  showShots = true,
  experienceEmbed = null,
  experienceTopHref,
  onExperience,
}: {
  detail: ResourceDetail;
  favoriteKey: string;
  /** 智能体详情把「安装」接到市场上架安装，装到当前账号下使用。立即体验仍打开这条公用智能体。 */
  marketClone?: boolean;
  /** 技能详情把「安装」接到技能商店，装到当前账号下使用。立即体验仍打开这条公用技能。 */
  skillInstall?: boolean;
  icon: string;
  onInstalled: () => void;
  extra?: ReactNode;
  showShots?: boolean;
  experienceEmbed?: { path: string; origin?: string } | null;
  experienceTopHref?: string;
  onExperience?: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState("intro");
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [favored, setFavored] = useState(() => readLocalFavorite(favoriteKey));
  const [subscribed, setSubscribed] = useState(false);
  const [discussions, setDiscussions] = useState<LocalDiscussion[]>(() => readLocalDiscussions(favoriteKey));
  const [draft, setDraft] = useState("");
  const [author, setAuthor] = useState("访客");
  const alreadyInstalled = skillInstall ? detail.installed : marketClone && detail.marketInstalled;
  const [clonePhase, setClonePhase] = useState<"idle" | "busy" | "done">(alreadyInstalled ? "done" : "idle");
  const [cloneNote, setCloneNote] = useState("");
  useEffect(() => {
    setFavored(readLocalFavorite(favoriteKey));
    setDiscussions(readLocalDiscussions(favoriteKey));
    setDraft("");
    setClonePhase(alreadyInstalled ? "done" : "idle");
    setCloneNote("");
  }, [favoriteKey, detail.listingId, detail.marketInstalled, detail.installed, marketClone, skillInstall, alreadyInstalled]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api-ba/api/auth/me", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled || !body || typeof body !== "object") return;
        const record = body as Record<string, unknown>;
        const name = [record.display_name, record.name, record.username].find((value) => typeof value === "string" && value.trim());
        if (typeof name === "string") setAuthor(name.trim());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFavorite = () => {
    setFavored((current) => writeLocalFavorite(favoriteKey, !current));
  };

  const publishDiscussion = () => {
    const next = addLocalDiscussion(favoriteKey, draft, author);
    if (next.length === discussions.length) return;
    setDiscussions(next);
    setDraft("");
  };

  const installSkillForAccount = async () => {
    if (clonePhase === "busy" || clonePhase === "done") return;
    const skillId = detail.listingId.trim();
    if (!skillId) {
      const message = "没有技能编号，不能安装。";
      setCloneNote(message);
      toast(message);
      return;
    }
    setClonePhase("busy");
    setCloneNote("");
    try {
      await installStoreSkill(skillId);
      setClonePhase("done");
      toast("已安装到当前账号");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "安装失败。";
      if (/已安装|已经安装|already installed/i.test(message)) {
        setClonePhase("done");
        toast("已安装到当前账号");
        return;
      }
      setClonePhase("idle");
      setCloneNote(message);
      toast(message);
    }
  };

  const installAgentForAccount = async () => {
    if (clonePhase === "busy" || clonePhase === "done") return;
    if (!/^[0-9a-f-]{36}$/i.test(detail.listingId)) {
      const message = "没有市场上架编号，不能安装。";
      setCloneNote(message);
      toast(message);
      return;
    }
    setClonePhase("busy");
    setCloneNote("");
    try {
      await addMarketListing(detail.listingId);
      setClonePhase("done");
      toast("已安装到当前账号");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "安装失败。";
      if (/已安装|已经安装|already installed/i.test(message) && !/owner_cannot_install/i.test(message)) {
        setClonePhase("done");
        toast("已安装到当前账号");
        return;
      }
      setClonePhase("idle");
      setCloneNote(message);
      toast(message);
    }
  };

  const cloneToConsole = async () => {
    if (skillInstall) {
      await installSkillForAccount();
      return;
    }
    if (marketClone) {
      await installAgentForAccount();
      return;
    }
    toast("技能安装尚未接通。");
  };

  const directUrl = experienceEmbed || experienceTopHref ? "" : detail.experienceUrl;

  const confirmAdd = async () => {
    if (!detail.canInstall || adding) return;
    setAdding(true);
    setAddError("");
    try {
      await addMarketListing(detail.listingId);
      toast(`已添加「${detail.name}」`);
      setConfirming(false);
      onInstalled();
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : "添加失败。");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="agent-layout">
        <aside className="agent-side">
          <section className="agent-info-card agent-profile">
            <div className="agent-big-icon" data-icon={icon}>
              <Icon name="edit-line" size={32} />
            </div>
            <h1 className="agent-big-name">{detail.name}</h1>
            <p className={missing(detail.summary) ? "agent-big-desc is-missing" : "agent-big-desc"}>{detail.summary}</p>
            <div className="agent-action-bar">
              <button className={favored ? "btn btn-primary" : "btn"} type="button" aria-pressed={favored} onClick={toggleFavorite}>
                <Icon name="heart-line" size={14} />
                {favored ? "已收藏" : "收藏"}
              </button>
              <button className={subscribed ? "btn btn-primary" : "btn"} type="button" onClick={() => setSubscribed((value) => !value)}>
                {subscribed ? "已订阅" : "订阅"}
              </button>
              <button
                className={clonePhase === "done" ? "btn btn-primary" : "btn"}
                type="button"
                disabled={clonePhase === "busy"}
                onClick={() => void cloneToConsole()}
              >
                {clonePhase === "busy" ? "安装中…" : clonePhase === "done" ? "已安装" : "安装"}
              </button>
              {detail.canInstall ? (
                <button className="btn" type="button" onClick={() => setConfirming(true)}>
                  添加
                </button>
              ) : null}
              {/* 智能体没有 experienceTopHref，走 detail.experienceUrl 新开页。技能、知识库、工具、插件仍置灰。 */}
              {directUrl ? (
                <a className="btn" href={directUrl} target="_blank" rel="noopener noreferrer">
                  立即体验
                </a>
              ) : null}
              {experienceTopHref ? (
                <button className="btn" type="button" disabled>
                  立即体验
                </button>
              ) : null}
              {onExperience ? (
                <button className="btn" type="button" disabled>
                  立即体验
                </button>
              ) : null}
              {extra}
            </div>
            {cloneNote ? (
              <p className="agent-clone-note is-error" role="alert">
                {cloneNote}
              </p>
            ) : null}
            <div className="agent-stats-row">
              <StatBlock label="使用量" value={detail.usageText} />
              <StatBlock label="收藏" value={favored ? "1" : "0"} />
            </div>
          </section>
          <section className="agent-info-card">
            <h2 className="agent-info-title">
              <span className="agent-info-ico">
                <Icon name="apps-ai-line" size={16} />
              </span>
              核心能力
            </h2>
            {detail.capabilities.length > 0 ? (
              <div className="agent-cap-list">
                {detail.capabilities.map((item, index) => (
                  <div className="agent-cap-item" key={item.name}>
                    <span className="agent-cap-icon">
                      <Icon name={capIcons[index % capIcons.length]} size={14} />
                    </span>
                    <span>
                      <span className="agent-cap-name">{item.name}</span>
                      {item.desc ? <span className="agent-cap-desc">{item.desc}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="is-missing">暂无</span>
            )}
          </section>
          <section className="agent-info-card">
            <h2 className="agent-info-title">
              <span className="agent-info-ico">
                <Icon name="file-list-3-line" size={16} />
              </span>
              基本信息
            </h2>
            <InfoRow label="提供方" value={detail.developer} />
            <InfoRow label="类别" value={detail.category} />
            <InfoRow label="适用场景" value={detail.scene} />
            <InfoRow label="使用部门" value={detail.department} />
            <InfoRow label="最新版本" value={detail.version} />
            <InfoRow label="更新时间" value={detail.updatedAt} />
            <InfoRow label="状态" value={detail.publishStatus} />
            <InfoRow label={detail.usageLabel} value={detail.usageText} />
            <InfoRow label={detail.deployLabel} value={detail.deployText} />
            <InfoRow label="评分" value={detail.ratingText} />
            <InfoRow label="发布时间" value={detail.publishedAt} />
          </section>
          <section className="agent-info-card">
            <h2 className="agent-info-title">
              <span className="agent-info-ico">
                <Icon name="price-tag-3-line" size={16} />
              </span>
              标签
            </h2>
            {detail.tags.length > 0 ? (
              <div className="agent-detail-tags">
                {detail.tags.map((tag, index) => (
                  <span className={`agent-detail-tag ${tagTones[index % tagTones.length]}`} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <span className="is-missing">暂无</span>
            )}
          </section>
        </aside>
        <section className="agent-main">
          <div className="agent-main-tabs" role="tablist">
            <button className={tab === "intro" ? "agent-main-tab is-active" : "agent-main-tab"} type="button" onClick={() => setTab("intro")}>
              <Icon name="book-2-line" size={16} />
              介绍
            </button>
            <button className={tab === "discussion" ? "agent-main-tab is-active" : "agent-main-tab"} type="button" onClick={() => setTab("discussion")}>
              <Icon name="message-3-line" size={16} />
              讨论
            </button>
          </div>
          {tab === "discussion" ? (
            <div className="agent-prose">
              <form
                className="agent-discussion-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  publishDiscussion();
                }}
              >
                <label htmlFor="agent-discussion-draft">发起讨论</label>
                <textarea
                  id="agent-discussion-draft"
                  value={draft}
                  placeholder="写下要讨论的内容"
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>
                  发起讨论
                </button>
              </form>
              {discussions.length === 0 ? <p>还没有讨论</p> : null}
              {discussions.map((item) => (
                <div className="agent-discussion-item" key={item.id}>
                  <strong>{item.text}</strong>
                  <span>
                    {item.author} · {item.time}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {tab === "intro" ? (
            <div className="agent-prose">
              <h3>
                <Icon name="chat-ai-line" size={16} />
                摘要
              </h3>
              <p className={missing(detail.aiSummary) ? "is-missing" : undefined}>{detail.aiSummary}</p>
              {detail.aiNote ? <p className="agent-ai-note">{detail.aiNote}</p> : null}
              {showShots ? (
                <>
                  <h3>
                    <Icon name="eye-line" size={16} />
                    截图
                  </h3>
                  <Shots urls={detail.screenshots} />
                </>
              ) : null}
              <h3>
                <Icon name="book-2-line" size={16} />
                简介
              </h3>
              <Intro text={detail.intro} />
              <h3>
                <Icon name="history-line" size={16} />
                版本记录
              </h3>
              {detail.revisions.length > 0 ? (
                <ul className="agent-revision-list">
                  {detail.revisions.map((item) => (
                    <li key={`${item.version}-${item.date}`}>
                      <strong>
                        {item.version} — {item.date}
                      </strong>
                      <p className={item.note ? undefined : "is-missing"}>{item.note || "暂无说明"}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="is-missing">暂无</p>
              )}
            </div>
          ) : null}
        </section>
      </div>
      {confirming ? (
        <Dialog
          title="添加应用"
          onClose={() => {
            if (adding) return;
            setConfirming(false);
            setAddError("");
          }}
          footer={
            <>
              <button className="btn" type="button" disabled={adding} onClick={() => setConfirming(false)}>
                取消
              </button>
              <button className="btn btn-primary" type="button" disabled={adding} onClick={() => void confirmAdd()}>
                {adding ? "添加中…" : "添加"}
              </button>
            </>
          }
        >
          <p className="resource-note">确认后会把「{detail.name}」添加到当前账号。</p>
          {addError ? (
            <p className="resource-banner is-error" role="alert">
              {addError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}

function StatBlock({ label, value, example }: { label: string; value: string; example?: boolean }) {
  return (
    <div className="agent-stat">
      <div className={missing(value) ? "num is-missing" : "num"}>
        {value}
        {example ? <span className="agent-example">示例</span> : null}
      </div>
      <div className="agent-stat-label">{label}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="agent-info-row">
      <span>{label}</span>
      <b className={missing(value) ? "is-missing" : undefined}>{value}</b>
    </div>
  );
}

function Intro({ text }: { text: string }) {
  if (missing(text)) return <p className="agent-intro is-missing">{text}</p>;
  const blocks = parseIntro(text);
  return (
    <div className="agent-intro">
      {blocks.map((block, index) => {
        if (block.type === "h") return <h3 key={index}>{block.text}</h3>;
        if (block.type === "ul") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{richText(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{richText(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === "p") return <p key={index}>{richText(block.text)}</p>;
        return null;
      })}
    </div>
  );
}

function parseIntro(source: string) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<{ type: "h"; text: string } | { type: "p"; text: string } | { type: "ul" | "ol"; items: string[] }> = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(list);
    list = null;
  };
  for (const line of lines) {
    const trimmed = line.trim();
    const markdownHeading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    const bracketHeading = /^【[^】]+】$/.exec(trimmed);
    if (markdownHeading || bracketHeading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", text: markdownHeading ? markdownHeading[2] : trimmed });
      continue;
    }
    const bullet = /^[-*·]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((bullet ?? ordered)?.[1] ?? trimmed);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function richText(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function Shots({ urls }: { urls: string[] }) {
  const [live, setLive] = useState(urls);
  const [start, setStart] = useState(0);

  useEffect(() => {
    setLive(urls);
    setStart(0);
  }, [urls]);

  if (live.length === 0) return <p className="agent-shot-empty">暂无截图</p>;

  const pageSize = Math.min(3, live.length);
  const maxStart = Math.max(0, live.length - pageSize);
  const current = Math.min(start, maxStart);
  const visible = live.slice(current, current + pageSize);
  return (
    <div className="agent-shot">
      <div className="agent-shot-row">
        {visible.map((url) => (
          <div className="agent-shot-frame" key={url}>
            <img
              src={url}
              alt="截图"
              onError={() => setLive((items) => items.filter((item) => item !== url))}
            />
          </div>
        ))}
      </div>
      {live.length > pageSize ? (
        <div className="agent-shot-nav">
          <button type="button" disabled={current <= 0} onClick={() => setStart((value) => Math.max(0, value - 1))}>
            上一张
          </button>
          <input
            type="range"
            min={0}
            max={maxStart}
            value={current}
            aria-label="截图位置"
            onChange={(event) => setStart(Number(event.target.value))}
          />
          <span>
            {current + 1} / {maxStart + 1}
          </span>
          <button type="button" disabled={current >= maxStart} onClick={() => setStart((value) => Math.min(maxStart, value + 1))}>
            下一张
          </button>
        </div>
      ) : null}
    </div>
  );
}

function missing(value: string) {
  return value === "暂无" || value === "暂无评价" || value === "暂无摘要";
}
