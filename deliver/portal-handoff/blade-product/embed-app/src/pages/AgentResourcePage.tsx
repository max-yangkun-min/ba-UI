import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/Toast";
import { findResourceNav } from "../data/resource-nav";
import {
  addMarketListing,
  dedupeAgentLists,
  loadAgentBundle,
  type InstalledAgent,
  type MarketListing,
  type PublishedAgent,
} from "../features/resources/agent-market";
import { resourceDetailPath } from "../features/resources/detail";
import { emptyRating, emptyUsage, formatStatNumber, type ResourceStat } from "../features/resources/stats";

type Phase = "loading" | "ready";
type SortKey = "hot" | "latest" | "rating" | "name";
type FilterKey = "category" | "tag" | "owner" | "status" | "source";

type AgentCard = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  category?: string;
  source?: string;
  owner?: string;
  version?: string;
  updatedAt?: string;
  tags: string[];
  experienceUrl: string;
  usage: ResourceStat;
  rating: ResourceStat;
  hot?: number;
  action?: {
    label: string;
    disabled?: boolean;
    onClick: () => void;
  };
};

const filters: Array<{ key: FilterKey; label: string }> = [
  { key: "category", label: "分类" },
  { key: "tag", label: "标签" },
  { key: "owner", label: "提供方" },
  { key: "status", label: "状态" },
  { key: "source", label: "来源" },
];

const sorts: Array<{ key: SortKey; label: string }> = [
  { key: "hot", label: "热门" },
  { key: "latest", label: "最新发布" },
  { key: "rating", label: "评分" },
  { key: "name", label: "名称" },
];

const PAGE_SIZE = 12;

export function AgentResourcePage({
  toolbarExtra,
  toDetail,
}: {
  toolbarExtra?: ReactNode;
  /** 控制台传入时，点卡片留在 /console/...；缺省仍去门户详情。 */
  toDetail?: (id: string) => string;
}) {
  const nav = findResourceNav("agents");
  const navigate = useNavigate();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [installed, setInstalled] = useState<InstalledAgent[]>([]);
  const [published, setPublished] = useState<PublishedAgent[]>([]);
  const [marketError, setMarketError] = useState("");
  const [installedError, setInstalledError] = useState("");
  const [publishedError, setPublishedError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [pending, setPending] = useState<MarketListing | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Partial<Record<FilterKey, string>>>({});
  const [sort, setSort] = useState<SortKey>("hot");
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.title = `${nav?.label ?? "智能体"} · 智能模型公共服务平台`;
  }, [nav?.label]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    loadAgentBundle()
      .then((bundle) => {
        if (cancelled) return;
        setListings(bundle.listings);
        setInstalled(bundle.installed);
        setPublished(bundle.published);
        setMarketError(bundle.marketError);
        setInstalledError(bundle.installedError);
        setPublishedError(bundle.publishedError);
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : "加载失败。";
        setListings([]);
        setInstalled([]);
        setPublished([]);
        setMarketError(message);
        setInstalledError(message);
        setPublishedError(message);
        setPhase("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const reload = () => setReloadToken((value) => value + 1);
  const marketEmpty = phase === "ready" && !marketError && listings.length === 0;

  const confirmAdd = async () => {
    if (!pending || adding) return;
    setAdding(true);
    setAddError("");
    try {
      await addMarketListing(pending.id);
      toast(`已添加「${pending.name}」`);
      setPending(null);
      reload();
    } catch (reason) {
      setAddError(reason instanceof Error ? reason.message : "添加失败。");
    } finally {
      setAdding(false);
    }
  };

  const notices: string[] = [];
  if (phase === "ready" && marketError) notices.push(`应用市场接口失败：${marketError}`);
  if (phase === "ready" && installedError) notices.push(`已添加列表没有同步：${installedError}`);
  if (phase === "ready" && publishedError) notices.push(`已发布应用没有同步：${publishedError}`);

  const notes: string[] = [];
  if (phase === "ready" && !installedError && installed.length === 0) notes.push("还没有从市场添加过应用。");
  if (phase === "ready" && !publishedError && published.length === 0) notes.push("当前账号没有已发布的应用。");

  const visible = dedupeAgentLists({ listings, installed, published });
  const items: AgentCard[] = [
    ...visible.listings.map((item) => ({
      id: `market-${item.id}`,
      name: item.name,
      description: item.summary,
      status: listingLabel(item),
      category: item.category || undefined,
      source: "市场",
      owner: item.owner,
      version: item.version,
      updatedAt: item.updatedAt,
      tags: item.tags,
      experienceUrl: item.experienceUrl,
      usage: item.usage,
      rating: item.rating,
      hot: item.usage.value,
      action: canAdd(item)
        ? {
            label: "添加",
            disabled: adding,
            onClick: () => {
              setAddError("");
              setPending(item);
            },
          }
        : undefined,
    })),
    ...visible.installed.map((item) => ({
      id: `installed-${item.id}`,
      name: item.name,
      description: item.summary || undefined,
      status: item.status,
      category: item.category || undefined,
      source: "已添加",
      owner: item.owner,
      version: item.version,
      updatedAt: item.updatedAt,
      tags: item.tags,
      experienceUrl: item.experienceUrl,
      usage: item.usage,
      rating: item.rating,
      hot: item.usage.value,
    })),
    ...visible.published.map((item) => ({
      id: `published-${item.id}`,
      name: item.name,
      description: item.summary || undefined,
      status: item.status,
      source: "已发布",
      version: item.version,
      updatedAt: item.updatedAt,
      tags: item.tags,
      experienceUrl: item.experienceUrl,
      usage: item.usage,
      rating: item.rating,
      hot: item.usage.value,
    })),
  ];

  const groups = useMemo(() => {
    return filters.map((filter) => {
      const values = items.flatMap((item) => {
        if (filter.key === "tag") return item.tags;
        if (filter.key === "owner") return item.owner && item.owner !== "匿名" ? [item.owner] : [];
        if (filter.key === "category") return item.category ? [item.category] : [];
        if (filter.key === "status") return item.status ? [item.status] : [];
        return item.source ? [item.source] : [];
      });
      const options = [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
      return { ...filter, options };
    });
  }, [items]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = items.filter((item) => {
      for (const filter of filters) {
        const value = picked[filter.key];
        if (!value) continue;
        if (filter.key === "tag") {
          if (!item.tags.includes(value)) return false;
          continue;
        }
        const current =
          filter.key === "owner" ? (item.owner === "匿名" ? "" : item.owner) : filter.key === "category" ? item.category : filter.key === "status" ? item.status : item.source;
        if (current !== value) return false;
      }
      if (!text) return true;
      const haystack = [item.name, item.description, item.status, item.category, item.source, item.owner, item.version, ...item.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    });
    const next = [...list];
    if (sort === "name") next.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    else if (sort === "rating") next.sort((a, b) => (b.rating.value ?? -1) - (a.rating.value ?? -1));
    else if (sort === "hot") next.sort((a, b) => (b.hot ?? -1) - (a.hot ?? -1));
    else next.sort((a, b) => compareTime(b.updatedAt, a.updatedAt));
    return next;
  }, [items, picked, query, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const listKey = items.map((item) => item.id).join("\n");
  const showLoading = phase === "loading" && items.length === 0;
  const narrowed = items.length > 0 && filtered.length === 0;
  const selections = filters.flatMap((filter) => {
    const value = picked[filter.key];
    return value ? [{ key: filter.key, value }] : [];
  });

  useEffect(() => {
    setPage(1);
  }, [query, picked, sort, listKey]);

  const openItem = (item: AgentCard) => navigate(toDetail ? toDetail(item.id) : resourceDetailPath("agents", item.id));
  const clearFilters = () => {
    setPicked({});
    setQuery("");
  };
  const sortCaption = sort === "hot" ? "按使用量排序" : sort === "latest" ? "按发布时间排序" : sort === "rating" ? "按评分排序" : "按名称排序";
  const rangeText =
    filtered.length === 0 ? "0" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)}`;

  return (
    <>
      <div className="agent-catalog">
        <h1 className="agent-catalog-heading">{nav?.label ?? "智能体"}</h1>
        <div className="agent-catalog-frame">
          <div className="agent-catalog-layout">
            <aside className="agent-catalog-side" aria-label="资源筛选">
              {groups.map((group) => (
                <details className="agent-facet" key={group.key} open>
                  <summary>
                    {group.label}
                    {picked[group.key] ? <small> 1</small> : null}
                  </summary>
                  <div className="agent-facet-options">
                    <button type="button" aria-pressed={!picked[group.key]} onClick={() => setPicked((current) => ({ ...current, [group.key]: "" }))}>
                      全部
                    </button>
                    {group.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={picked[group.key] === option}
                        onClick={() => setPicked((current) => ({ ...current, [group.key]: current[group.key] === option ? "" : option }))}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </details>
              ))}
            </aside>
            <div className="agent-catalog-main">
              <div className="agent-search">
                <div className="agent-search-field">
                  <span className="agent-search-icon">
                    <Icon name="search-line" size={16} />
                  </span>
                  <input
                    type="search"
                    aria-label="搜索智能体"
                    placeholder="搜索智能体名称、描述、状态..."
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="agent-search-count">
                  共 <strong className="num">{phase === "ready" ? filtered.length : items.length}</strong> 个智能体
                </div>
              </div>
              {selections.length > 0 ? (
                <div className="agent-selected">
                  <span>已选条件</span>
                  {selections.map((item) => (
                    <button key={item.key} type="button" onClick={() => setPicked((current) => ({ ...current, [item.key]: "" }))}>
                      {item.value} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setPicked({})}>
                    清空筛选
                  </button>
                </div>
              ) : null}
              <div className="agent-catalog-toolbar">
                <div className="agent-catalog-sort" role="group" aria-label="排序方式">
                  {sorts.map((item) => (
                    <button key={item.key} type="button" aria-pressed={sort === item.key} onClick={() => setSort(item.key)}>
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="agent-catalog-options">
                  {toolbarExtra}
                  <button className="btn" type="button" disabled={phase === "loading"} onClick={reload}>
                    <Icon name="refresh-line" size={14} />
                    刷新
                  </button>
                </div>
              </div>
              <div className="agent-catalog-status">
                <span>
                  {showLoading ? "正在读取列表" : `${sortCaption} · ${rangeText} / ${filtered.length} 条`}
                </span>
              </div>
              {notices.map((notice) => (
                <p key={notice} className="resource-banner is-error" role="alert">
                  {notice}
                </p>
              ))}
              {notes.map((note) => (
                <p key={note} className="resource-note">
                  {note}
                </p>
              ))}
              {marketEmpty && items.length > 0 ? (
                <p className="resource-note">没有可添加的应用。应用市场目录是空的。这不是接口失败，已发布和已添加的应用仍显示在下面。</p>
              ) : null}
              {showLoading ? (
                <div className="agent-catalog-empty" aria-live="polite">
                  正在加载
                  <p>正在从应用市场读取可添加的应用。</p>
                </div>
              ) : null}
              {phase === "ready" && filtered.length === 0 ? (
                <div className="agent-catalog-empty">
                  {narrowed ? "没有符合条件的智能体" : marketEmpty ? "没有可添加的应用" : "暂无数据"}
                  <p>
                    {narrowed
                      ? "试试其他关键词，或清空筛选条件。"
                      : marketEmpty
                        ? "应用市场目录是空的。这不是接口失败，已发布和已添加的应用仍显示在下面。"
                        : "应用市场、已添加和已发布应用当前都是空的。"}
                  </p>
                  {narrowed ? (
                    <button type="button" onClick={clearFilters}>
                      重置搜索与筛选
                    </button>
                  ) : null}
                </div>
              ) : null}
              {pageItems.length > 0 ? (
                <div className="agent-catalog-grid">
                  {pageItems.map((item) => (
                    <article
                      className="agent-card"
                      key={item.id}
                      role="link"
                      tabIndex={0}
                      onClick={(event) => {
                        const target = event.target;
                        if (target instanceof Element && target.closest("button, a")) return;
                        openItem(item);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.target !== event.currentTarget) return;
                        openItem(item);
                      }}
                    >
                      <div className="agent-card-head">
                        <span className="agent-card-icon">
                          <Icon name="ai-agent-line" size={18} />
                        </span>
                        <h2 className="agent-card-title" title={item.name}>
                          {item.name}
                        </h2>
                        {item.status ? <span className={`agent-card-status ${statusTone(item.status)}`}>{item.status}</span> : null}
                      </div>
                      <p className="agent-card-desc">{item.description?.trim() || "暂无"}</p>
                      <div className="agent-card-tags">
                        {cardTags(item).map((tag) =>
                          tag.kind === "version" ? (
                            <span className="agent-card-tag" key={tag.label}>
                              {tag.label}
                            </span>
                          ) : (
                            <button
                              className="agent-card-tag"
                              key={`${tag.kind}-${tag.label}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPicked((current) => ({ ...current, [tag.kind]: tag.label }));
                              }}
                            >
                              {tag.label}
                            </button>
                          ),
                        )}
                      </div>
                      <div className="agent-card-meta">
                        <span className="agent-card-lead">
                          {item.owner && item.owner !== "匿名" ? <span>{item.owner}</span> : null}
                          {item.updatedAt ? <time>{catalogDate(item.updatedAt)}</time> : null}
                        </span>
                        <span className="agent-meta-stat" title={item.usage.hint || "用量"}>
                          <Icon name="fire-line" size={14} />
                          {statText(item.usage, emptyUsage)}
                        </span>
                        <span className="agent-meta-stat" title={item.rating.hint || "评分"}>
                          <Icon name="star-line" size={14} />
                          {statText(item.rating, emptyRating)}
                        </span>
                      </div>
                      {item.action ? (
                        <button
                          className="agent-card-go"
                          type="button"
                          disabled={item.action.disabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            item.action?.onClick();
                          }}
                        >
                          {item.action.label}
                        </button>
                      ) : item.experienceUrl ? (
                        <a
                          className="agent-card-go"
                          href={item.experienceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => event.stopPropagation()}
                        >
                          立即体验 →
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
              {phase === "ready" && pageCount > 1 ? (
                <nav className="agent-pager" aria-label="资源分页">
                  <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                    上一页
                  </button>
                  {pagerItems(currentPage, pageCount).map((item, index) =>
                    item === "gap" ? (
                      <span className="agent-pager-gap" key={`gap-${index}`}>
                        …
                      </span>
                    ) : (
                      <button key={item} type="button" aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>
                        {item}
                      </button>
                    ),
                  )}
                  <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                    下一页
                  </button>
                </nav>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {pending ? (
        <Dialog
          title="添加应用"
          onClose={() => {
            if (adding) return;
            setPending(null);
            setAddError("");
          }}
          footer={
            <>
              <button
                className="btn"
                type="button"
                disabled={adding}
                onClick={() => {
                  setPending(null);
                  setAddError("");
                }}
              >
                取消
              </button>
              <button className="btn btn-primary" type="button" disabled={adding} onClick={() => void confirmAdd()}>
                {adding ? "添加中…" : "添加"}
              </button>
            </>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void confirmAdd();
            }}
          >
            <div className="form-row">
              <label htmlFor="agent-add-name">应用名称</label>
              <input id="agent-add-name" className="field" value={pending.name} readOnly />
            </div>
            <div className="form-row">
              <label htmlFor="agent-add-category">分类</label>
              <input id="agent-add-category" className="field" value={pending.category || "未分类"} readOnly />
            </div>
            <p className="resource-note">确认后会把这个市场应用添加到当前账号。名称和分类来自市场目录，不能在这里改。</p>
            {addError ? (
              <p className="resource-banner is-error" role="alert">
                {addError}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
    </>
  );
}

function canAdd(item: MarketListing) {
  return item.available && !item.installed && !item.isOwner;
}

function listingLabel(item: MarketListing) {
  if (item.isOwner) return "自有";
  if (item.installed) return "已添加";
  if (!item.available) return "暂不可用";
  return "可添加";
}

function cardTags(item: AgentCard) {
  const tags: Array<{ kind: "category" | "tag" | "version"; label: string }> = [];
  if (item.category) tags.push({ kind: "category", label: item.category });
  for (const tag of item.tags) {
    if (!tags.some((itemTag) => itemTag.label === tag)) tags.push({ kind: "tag", label: tag });
  }
  if (item.version && !tags.some((itemTag) => itemTag.label === item.version)) tags.push({ kind: "version", label: item.version });
  return tags.slice(0, 4);
}

function statusTone(status: string) {
  if (/暂不可用|已停止|失败/.test(status)) return "is-muted";
  if (/已添加|已发布|运行中/.test(status)) return "is-ok";
  if (/可添加/.test(status)) return "is-ready";
  return "";
}

function statText(stat: ResourceStat, empty: ResourceStat) {
  if (stat.value === undefined) return empty.label;
  const value = formatStatNumber(stat.value);
  if (stat.scale !== undefined) return `${value}/${formatStatNumber(stat.scale)}`;
  return value;
}

function catalogDate(value: string) {
  const match = value.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return value;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function compareTime(left?: string, right?: string) {
  if (left && right) return left < right ? -1 : left > right ? 1 : 0;
  if (left) return 1;
  if (right) return -1;
  return 0;
}

function pagerItems(current: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const raw = [1, current - 1, current, current + 1, count]
    .filter((page, index, list) => page >= 1 && page <= count && list.indexOf(page) === index)
    .sort((a, b) => a - b);
  const items: Array<number | "gap"> = [];
  raw.forEach((page, index) => {
    if (index > 0 && page - raw[index - 1] > 1) items.push("gap");
    items.push(page);
  });
  return items;
}
