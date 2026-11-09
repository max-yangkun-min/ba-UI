import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { OfficeFacetNav } from "./OfficeFacetNav";
import { officeGroups, type OfficeGroup } from "./office-taxonomy";

const PAGE_SIZE = 12;

export type PortalCard = {
  id: string;
  name: string;
  desc: string;
  category: string;
  /** 左侧二级分类。技能页、知识库页筛选用，其它目录留空。 */
  officeItemIds?: string[];
  status: string;
  owner: string;
  tags: string[];
  updatedAt: string;
  usageText: string;
  ratingText: string;
  hot?: number;
};

type FilterKey = "category" | "status";
type SortKey = "hot" | "latest" | "name";

const facets: Array<{ key: FilterKey; label: string }> = [
  { key: "category", label: "分类" },
  { key: "status", label: "状态" },
];

const sorts: Array<{ key: SortKey; label: string }> = [
  { key: "hot", label: "热门" },
  { key: "latest", label: "最新发布" },
  { key: "name", label: "名称" },
];

export function PortalCatalog({
  title,
  noun,
  icon,
  phase,
  error,
  emptyText,
  items,
  onOpen,
  toolbar,
  searchPlaceholder,
  officeFacet = false,
  facetGroups,
  hideCardStatus = false,
}: {
  title: string;
  noun: string;
  icon: string;
  phase: "loading" | "ready" | "error";
  error?: string;
  emptyText: string;
  items: PortalCard[];
  onOpen: (item: PortalCard) => void;
  toolbar?: ReactNode;
  searchPlaceholder?: string;
  /** 左侧改用机关单位五组分类，和智能体页同一套。 */
  officeFacet?: boolean;
  /** 知识库左侧分组。传入后走同一套白卡片导航，不用智能体那五组。 */
  facetGroups?: OfficeGroup[];
  /** 卡片标题右侧的状态不显示。技能页隐「已安装 / 未安装」，工具页隐「MCP · 检测通过」这类。 */
  hideCardStatus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Partial<Record<FilterKey, string>>>({});
  const [officePicked, setOfficePicked] = useState<Record<string, string>>({});
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortKey>("latest");
  const [page, setPage] = useState(1);
  const sideGroups = facetGroups ?? officeGroups;
  const sideFacet = officeFacet || facetGroups != null;

  const groups = useMemo(() => {
    return facets
      .map((facet) => {
        const options = [...new Set(items.map((item) => item[facet.key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
        return { ...facet, options };
      })
      .filter((group) => group.options.length > 0);
  }, [items]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = items.filter((item) => {
      if (sideFacet) {
        const ids = item.officeItemIds ?? [];
        for (const group of sideGroups) {
          const selected = officePicked[group.id];
          if (selected && !ids.includes(selected)) return false;
        }
      } else {
        for (const facet of facets) {
          const value = picked[facet.key];
          if (value && item[facet.key] !== value) return false;
        }
      }
      if (!text) return true;
      const officeText = sideFacet
        ? (item.officeItemIds ?? []).flatMap((id) => {
            const group = sideGroups.find((entry) => entry.items.some((option) => option.id === id));
            return [facetItemName(sideGroups, id), group?.name ?? ""];
          })
        : [];
      return [item.name, item.desc, item.category, item.status, item.owner, ...officeText, ...item.tags].join(" ").toLowerCase().includes(text);
    });
    const next = [...list];
    if (sort === "name") next.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    else if (sort === "hot") next.sort((a, b) => (b.hot ?? -1) - (a.hot ?? -1));
    else next.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return next;
  }, [items, officePicked, picked, query, sideFacet, sideGroups, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selections = facets.flatMap((facet) => (picked[facet.key] ? [{ key: facet.key, label: picked[facet.key] as string }] : []));

  useEffect(() => {
    setPage(1);
  }, [query, picked, officePicked, sort, items]);

  const rangeText = filtered.length === 0 ? "0" : `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)}`;
  const sortCaption = sort === "hot" ? "按用量排序" : sort === "latest" ? "按更新时间排序" : "按名称排序";

  return (
    <div className="agent-catalog">
      <h1 className="agent-catalog-heading">{title}</h1>
      <div className="agent-catalog-frame">
        <div className={sideFacet ? "agent-catalog-stage" : "agent-catalog-layout"}>
          {sideFacet ? (
            <div className="agent-cat-side">
              <OfficeFacetNav
                groups={facetGroups}
                picked={officePicked}
                folded={folded}
                onFold={(groupId, open) => setFolded((prev) => ({ ...prev, [groupId]: open }))}
                onPick={(groupId, itemId) => {
                  setOfficePicked((prev) => {
                    const next = { ...prev };
                    if (!itemId) delete next[groupId];
                    else next[groupId] = itemId;
                    return next;
                  });
                }}
              />
            </div>
          ) : (
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
          )}
          <div className="agent-catalog-main">
            <div className="agent-search">
              <div className="agent-search-field">
                <span className="agent-search-icon">
                  <Icon name="search-line" size={16} />
                </span>
                <input
                  type="search"
                  aria-label={`搜索${noun}`}
                  placeholder={searchPlaceholder ?? `搜索${noun}名称、描述、分类...`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="agent-search-count">
                共 <strong className="num">{phase === "ready" ? filtered.length : 0}</strong> 个{noun}
              </div>
            </div>
            {!sideFacet && selections.length > 0 ? (
              <div className="agent-selected">
                <span>已选条件</span>
                {selections.map((item) => (
                  <button key={item.key} type="button" onClick={() => setPicked((current) => ({ ...current, [item.key]: "" }))}>
                    {item.label} <span aria-hidden="true">×</span>
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
              {toolbar ? <div className="agent-catalog-options">{toolbar}</div> : null}
            </div>
            <div className="agent-catalog-status">
              <span>{phase === "loading" ? "正在读取列表" : `${sortCaption} · ${rangeText} / ${filtered.length} 条`}</span>
            </div>
            {phase === "loading" ? (
              <div className="agent-catalog-empty">
                正在加载
                <p>正在从后台读取{noun}。</p>
              </div>
            ) : null}
            {phase === "error" ? (
              <div className="agent-catalog-empty" role="alert">
                没有读到{noun}
                <p>{error || "加载失败。"}</p>
              </div>
            ) : null}
            {phase === "ready" && filtered.length === 0 ? (
              <div className="agent-catalog-empty">
                没有符合条件的{noun}
                <p>{items.length === 0 ? emptyText : sideFacet ? "试试其他关键词，或改回全部分类。" : "试试其他关键词，或清空筛选条件。"}</p>
                {items.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPicked({});
                      setOfficePicked({});
                      setQuery("");
                    }}
                  >
                    {sideFacet ? "重置搜索与分类" : "重置搜索与筛选"}
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
                      onOpen(item);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.target !== event.currentTarget) return;
                      onOpen(item);
                    }}
                  >
                    <div className="agent-card-head">
                      <span className="agent-card-icon">
                        <Icon name={icon} size={18} />
                      </span>
                      <h2 className="agent-card-title" title={item.name}>
                        {item.name}
                      </h2>
                      <button
                        className="agent-card-view"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(item);
                        }}
                      >
                        查看
                      </button>
                      {item.status && !hideCardStatus && !(officeFacet && item.status === "可添加") ? <span className="agent-card-status">{item.status}</span> : null}
                    </div>
                    <p className="agent-card-desc">{item.desc || "暂无"}</p>
                    <div className="agent-card-tags">
                      {sideFacet
                        ? (item.officeItemIds ?? []).map((itemId) => (
                            <button
                              className="agent-card-tag"
                              key={itemId}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                const group = sideGroups.find((entry) => entry.items.some((option) => option.id === itemId));
                                if (group) setOfficePicked({ [group.id]: itemId });
                              }}
                            >
                              {facetItemName(sideGroups, itemId)}
                            </button>
                          ))
                        : item.category ? (
                        <button
                          className="agent-card-tag"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPicked((current) => ({ ...current, category: item.category }));
                          }}
                        >
                          {item.category}
                        </button>
                      ) : null}
                      {item.tags
                        .filter((tag) => tag && tag !== item.category && tag !== item.status && !(item.officeItemIds ?? []).some((itemId) => facetItemName(sideGroups, itemId) === tag))
                        .slice(0, 3)
                        .map((tag) => (
                          <span className="agent-card-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                    </div>
                    <div className="agent-card-meta">
                      <span className="agent-card-lead">
                        {item.owner ? <span>{item.owner}</span> : null}
                        {item.updatedAt ? <time>{item.updatedAt}</time> : null}
                      </span>
                      <span className="agent-meta-stat" title="用量">
                        <Icon name="fire-line" size={14} />
                        {item.usageText}
                      </span>
                      <span className="agent-meta-stat" title="评分">
                        <Icon name="star-line" size={14} />
                        {item.ratingText}
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

function facetItemName(groups: OfficeGroup[], itemId: string) {
  for (const group of groups) {
    const found = group.items.find((item) => item.id === itemId);
    if (found) return found.name;
  }
  return "";
}
