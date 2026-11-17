import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import {
  dedupeAgentLists,
  loadAgentBundle,
  type MarketListing,
} from "../features/resources/agent-market";
import { OfficeFacetNav } from "../features/resources/OfficeFacetNav";
import { matchOfficeItems, officeGroupIdOf, officeGroups, officeItemName } from "../features/resources/office-taxonomy";
import { resourceDetailPath } from "../features/resources/detail";
import { formatStatNumber, type ResourceStat } from "../features/resources/stats";

const PAGE_SIZE = 12;

type SortKey = "default" | "usage" | "rating" | "updated";

type AgentCard = {
  id: string;
  name: string;
  desc: string;
  category: string;
  officeItemIds: string[];
  source: string;
  status: string;
  owner: string;
  tags: string[];
  updatedAt: string;
  usage?: number;
  usageHint?: string;
  rating?: number;
};

const sorts: Array<{ key: SortKey; label: string }> = [
  { key: "default", label: "默认" },
  { key: "usage", label: "按用量" },
  { key: "rating", label: "按评分" },
  { key: "updated", label: "最近更新" },
];

export function MockAgentCatalog() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AgentCard[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortKey>("default");
  const [page, setPage] = useState(1);

  useEffect(() => {
    document.title = "智能体 · 智能模型公共服务平台";
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    loadAgentBundle()
      .then((bundle) => {
        if (cancelled) return;
        const notes = bundle.marketError ? [bundle.marketError] : [];
        const visible = uniqueMarketListings(dedupeAgentLists(bundle).listings);
        const cards = visible.map((item) => {
          const officeItemIds = matchOfficeItems(item.name, item.summary, item.tags);
          return toCard(
            `market-${item.id}`,
            item.name,
            item.summary,
            officeItemIds.map((id) => officeItemName(id)).filter(Boolean).join(" "),
            officeItemIds,
            "市场",
            listingLabel(item),
            item.owner,
            item.tags,
            item.updatedAt,
            item.usage,
            item.rating,
          );
        });
        setItems(cards);
        setError(cards.length === 0 && notes.length > 0 ? notes.join(" ") : "");
        setPhase(cards.length === 0 && notes.length > 0 ? "error" : "ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "智能体列表加载失败。");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasUpdated = useMemo(() => items.some((item) => item.updatedAt), [items]);
  const sortOptions = hasUpdated ? sorts : sorts.filter((item) => item.key !== "updated");

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = items.filter((item) => {
      for (const group of officeGroups) {
        const selected = picked[group.id];
        if (selected && !item.officeItemIds.includes(selected)) return false;
      }
      if (!text) return true;
      const officeText = item.officeItemIds.flatMap((id) => {
        const groupId = officeGroupIdOf(id);
        const group = officeGroups.find((entry) => entry.id === groupId);
        return [officeItemName(id), group?.name ?? ""];
      });
      return [item.name, item.desc, item.category, item.source, item.status, item.owner, ...officeText, ...item.tags].join(" ").toLowerCase().includes(text);
    });
    const next = list.map((item, index) => ({ item, index }));
    if (sort === "usage") {
      next.sort((a, b) => compareNumber(b.item.usage, a.item.usage) || a.index - b.index);
    } else if (sort === "rating") {
      next.sort((a, b) => compareNumber(b.item.rating, a.item.rating) || a.index - b.index);
    } else if (sort === "updated" && hasUpdated) {
      next.sort((a, b) => compareText(b.item.updatedAt, a.item.updatedAt) || a.index - b.index);
    }
    return next.map((entry) => entry.item);
  }, [items, picked, query, sort, hasUpdated]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, picked, sort, items]);

  const openItem = (id: string) => navigate(resourceDetailPath("agents", id));
  const pickGroup = (groupId: string, itemId: string) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (!itemId) delete next[groupId];
      else next[groupId] = itemId;
      return next;
    });
  };
  const rangeText = filtered.length === 0 ? "0" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)}`;
  const sortCaption = sort === "usage" ? "按用量排序" : sort === "rating" ? "按评分排序" : sort === "updated" ? "按更新时间排序" : "默认排序";

  return (
    <div className="agent-catalog">
      <h1 className="agent-catalog-heading">智能体</h1>
      <div className="agent-catalog-frame">
        <div className="agent-catalog-stage">
          <div className="agent-cat-side">
            <OfficeFacetNav
              picked={picked}
              folded={folded}
              onFold={(groupId, open) => setFolded((prev) => ({ ...prev, [groupId]: open }))}
              onPick={pickGroup}
            />
          </div>
          <div className="agent-catalog-main">
            <div className="agent-main-sort">
              <label className="agent-sort-field">
                排序
                <select
                  aria-label="排序"
                  value={sort === "updated" && !hasUpdated ? "default" : sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                >
                  {sortOptions.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="agent-search">
              <div className="agent-search-field">
                <span className="agent-search-icon">
                  <Icon name="search-line" size={16} />
                </span>
                <input
                  type="search"
                  aria-label="搜索智能体"
                  placeholder="搜索智能体名称、描述、分类..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="agent-search-count">
                共 <strong className="num">{phase === "ready" ? filtered.length : 0}</strong> 个智能体
              </div>
            </div>
            <div className="agent-catalog-status">
              <span>{phase === "loading" ? "正在读取列表" : `${sortCaption} · ${rangeText} / ${filtered.length} 条`}</span>
            </div>
            {phase === "loading" ? (
              <div className="agent-catalog-empty">
                正在加载
                <p>正在读取智能体目录。</p>
              </div>
            ) : null}
            {phase === "error" ? (
              <div className="agent-catalog-empty" role="alert">
                没有读到智能体
                <p>{error}</p>
              </div>
            ) : null}
            {phase === "ready" && filtered.length === 0 ? (
              <div className="agent-catalog-empty">
                没有符合条件的智能体
                <p>{items.length === 0 ? "当前没有可展示的公用智能体。" : "试试其他关键词，或改回全部分类。"}</p>
                {items.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPicked({});
                      setQuery("");
                    }}
                  >
                    重置搜索与分类
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
                      openItem(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.target !== event.currentTarget) return;
                      openItem(item.id);
                    }}
                  >
                    <div className="agent-card-head">
                      <span className="agent-card-icon">
                        <Icon name="ai-agent-line" size={18} />
                      </span>
                      <h2 className="agent-card-title" title={item.name}>
                        {item.name}
                      </h2>
                      <button
                        className="agent-card-view"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openItem(item.id);
                        }}
                      >
                        查看
                      </button>
                      {item.status && item.status !== "可添加" ? (
                        <span className={`agent-card-status ${statusTone(item.status)}`}>{item.status}</span>
                      ) : null}
                    </div>
                    <p className="agent-card-desc">{item.desc || "暂无"}</p>
                    <div className="agent-card-tags">
                      {item.officeItemIds[0] ? (
                        <button
                          className="agent-card-tag"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            const itemId = item.officeItemIds[0];
                            const groupId = officeGroupIdOf(itemId);
                            if (groupId) setPicked({ [groupId]: itemId });
                          }}
                        >
                          {officeItemName(item.officeItemIds[0])}
                        </button>
                      ) : null}
                      {item.tags
                        .filter((tag) => tag !== officeItemName(item.officeItemIds[0] ?? ""))
                        .slice(0, 3)
                        .map((tag) => (
                          <span className="agent-card-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                    </div>
                    <div className="agent-card-meta">
                      <span className="agent-card-lead">
                        {item.updatedAt ? <time>{catalogDate(item.updatedAt)}</time> : null}
                      </span>
                      <span className="agent-meta-stat" title={item.usageHint || "用量"}>
                        <Icon name="fire-line" size={14} />
                        {item.usage === undefined ? "暂无用量" : formatStatNumber(item.usage)}
                      </span>
                      <span className="agent-meta-stat" title="评分">
                        <Icon name="star-line" size={14} />
                        {item.rating === undefined ? "暂无评分" : formatStatNumber(item.rating)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {phase === "ready" && pageCount > 1 ? (
              <nav className="agent-pager" aria-label="资源分页">
                <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  上一页
                </button>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (
                  <button key={item} type="button" aria-current={item === currentPage ? "page" : undefined} onClick={() => setPage(item)}>
                    {item}
                  </button>
                ))}
                <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                  下一页
                </button>
              </nav>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 只留公用上架。listed 由 isPublicCatalogAgent 算出。先按 id 对齐，再按去掉空白、忽略大小写的名称对齐。 */
function uniqueMarketListings(listings: MarketListing[]) {
  const result: MarketListing[] = [];
  for (const item of listings) {
    if (!item.listed) continue;
    const name = canonicalName(item.name);
    const duplicate = result.find((other) => {
      if (item.id && other.id === item.id) return true;
      if (item.ids.some((id) => other.ids.includes(id))) return true;
      const otherName = canonicalName(other.name);
      return Boolean(name) && name === otherName;
    });
    if (!duplicate) result.push(item);
  }
  return result;
}

function canonicalName(name: string) {
  return name.trim().replace(/[\s\u3000]+/g, "").toLocaleLowerCase("zh-CN");
}

function compareNumber(left?: number, right?: number) {
  return (left ?? Number.NEGATIVE_INFINITY) - (right ?? Number.NEGATIVE_INFINITY);
}

function compareText(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

function toCard(
  id: string,
  name: string,
  desc: string,
  category: string,
  officeItemIds: string[],
  source: string,
  status: string,
  owner: string,
  tags: string[],
  updatedAt: string | undefined,
  usage: ResourceStat,
  rating: ResourceStat,
): AgentCard {
  return {
    id,
    name,
    desc,
    category,
    officeItemIds,
    source,
    status,
    owner: owner && owner !== "匿名" ? owner : "",
    tags,
    updatedAt: updatedAt ?? "",
    usage: usage.value,
    usageHint: usage.hint,
    rating: rating.value,
  };
}

function listingLabel(item: MarketListing) {
  if (item.installed) return "已添加";
  if (!item.available) return "暂不可用";
  return "";
}

function statusTone(status: string) {
  if (/暂不可用|已停止|失败/.test(status)) return "is-muted";
  if (/已添加|已发布|运行中/.test(status)) return "is-ok";
  if (/可添加/.test(status)) return "is-ready";
  return "";
}

function catalogDate(value: string) {
  const match = value.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return value;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
