import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../components/Icon";
import { emptyRating, emptyUsage, formatStatNumber, type ResourceStat } from "./stats";

const PAGE_SIZE = 18;

export type BoardItem = {
  id: string;
  name: string;
  description?: string;
  status?: string;
  updatedAt?: string;
  category?: string;
  source?: string;
  footnote?: string;
  tags?: string[];
  hot?: number;
  usage?: ResourceStat;
  rating?: ResourceStat;
  action?: {
    label: string;
    disabled?: boolean;
    onClick: () => void;
  };
};

export type BoardFilterKey = "status" | "category" | "source";

export type BoardFilter = {
  key: BoardFilterKey;
  label: string;
  allLabel: string;
};

export type BoardNotice = {
  text: string;
  error?: boolean;
};

type Phase = "loading" | "ready" | "error";

export type BoardTone = "skills" | "knowledge" | "agents" | "tools" | "plugins";

type ResourceBoardProps = {
  title: string;
  noun: string;
  icon: string;
  tone: BoardTone;
  searchPlaceholder: string;
  phase: Phase;
  items: BoardItem[];
  filters: BoardFilter[];
  onRefresh: () => void;
  loadingText: string;
  errorText?: string;
  emptyTitle: string;
  emptyText: string;
  notices?: BoardNotice[];
  notes?: string[];
  callout?: { title: string; text: string } | null;
  toolbarExtra?: ReactNode;
  onOpen?: (item: BoardItem) => void;
};

export function ResourceBoard({
  title,
  noun,
  icon,
  tone,
  searchPlaceholder,
  phase,
  items,
  filters,
  onRefresh,
  loadingText,
  errorText,
  emptyTitle,
  emptyText,
  notices,
  notes,
  callout,
  toolbarExtra,
  onOpen,
}: ResourceBoardProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Partial<Record<BoardFilterKey, string>>>({});
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);

  const groups = useMemo(() => {
    return filters
      .map((filter) => {
        const options = [...new Set(items.map((item) => item[filter.key]).filter((value): value is string => Boolean(value)))].sort((a, b) =>
          a.localeCompare(b, "zh-CN"),
        );
        return { ...filter, options };
      })
      .filter((group) => group.options.length > 0);
  }, [filters, items]);

  const hasHot = items.some((item) => typeof item.hot === "number");
  const sorts = hasHot ? ["最热门", "最近更新", "名称"] : ["最近更新", "名称"];
  const activeSort = sorts.includes(sort) ? sort : sorts[0];

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = items.filter((item) => {
      for (const filter of filters) {
        const value = picked[filter.key];
        if (value && item[filter.key] !== value) return false;
      }
      if (!text) return true;
      const haystack = [item.name, item.description, item.status, item.category, item.source, item.footnote, ...(item.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    });
    const next = [...list];
    if (activeSort === "名称") {
      next.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    } else if (activeSort === "最热门") {
      next.sort((a, b) => (b.hot ?? -1) - (a.hot ?? -1));
    } else {
      next.sort((a, b) => compareTime(b.updatedAt, a.updatedAt));
    }
    return next;
  }, [activeSort, filters, items, picked, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, filtered.length);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const listKey = items.map((item) => item.id).join("\n");

  useEffect(() => {
    setPage(1);
  }, [query, picked, activeSort, listKey]);

  const showCallout = Boolean(callout) && items.length > 0;
  const narrowed = items.length > 0 && filtered.length === 0;

  return (
    <div className="resource-page">
      <h1 className="resource-heading">{title}</h1>
      <aside className="resource-filters" aria-label="筛选">
        {groups.length === 0 ? (
          <FilterGroup label="分类" allLabel="全部分类" options={[]} value="" onChange={() => undefined} />
        ) : (
          groups.map((group) => (
            <FilterGroup
              key={group.key}
              label={group.label}
              allLabel={group.allLabel}
              options={group.options}
              value={picked[group.key] ?? ""}
              onChange={(value) => setPicked((current) => ({ ...current, [group.key]: value }))}
            />
          ))
        )}
      </aside>
      <div className="resource-main">
        <div className="resource-toolbar">
          <label className="resource-search">
            <Icon name="search-line" />
            <input
              value={query}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="resource-count">
            共 <b className="num">{phase === "ready" ? filtered.length : items.length}</b> 个{noun}
          </p>
        </div>
        <div className="resource-subbar">
          <span className="resource-range">
            {phase === "loading" ? "正在读取列表" : filtered.length === 0 ? "当前显示 0 条" : `当前显示第 ${start}-${end} 条`}
          </span>
          <div className="grow" />
          {toolbarExtra}
          <button className="btn" type="button" disabled={phase === "loading"} onClick={onRefresh}>
            <Icon name="refresh-line" />
            刷新
          </button>
          <select className="select resource-sort" aria-label="排序" value={activeSort} onChange={(event) => setSort(event.target.value)}>
            {sorts.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        {notices?.map((notice) => (
          <p key={notice.text} className={notice.error ? "resource-banner is-error" : "resource-banner"} role={notice.error ? "alert" : undefined}>
            {notice.text}
          </p>
        ))}
        {notes?.map((note) => (
          <p key={note} className="resource-note">
            {note}
          </p>
        ))}
        {showCallout && callout ? (
          <section className="placeholder resource-callout">
            <h2>{callout.title}</h2>
            <p>{callout.text}</p>
          </section>
        ) : null}

        {phase === "loading" ? (
          <section className="placeholder resource-empty" aria-live="polite">
            <span className={`market-ic tone-${tone}`}>
              <Icon name={icon} size={20} />
            </span>
            <h2>正在加载</h2>
            <p>{loadingText}</p>
          </section>
        ) : null}
        {phase === "error" ? (
          <section className="placeholder resource-empty" aria-live="polite">
            <span className={`market-ic tone-${tone}`}>
              <Icon name={icon} size={20} />
            </span>
            <h2>没有同步上</h2>
            <p>{errorText || "加载失败。"}</p>
          </section>
        ) : null}
        {phase === "ready" && filtered.length === 0 ? (
          <section className="placeholder resource-empty">
            <span className={`market-ic tone-${tone}`}>
              <Icon name={icon} size={20} />
            </span>
            <h2>{narrowed ? "没有符合条件的条目" : emptyTitle}</h2>
            <p>{narrowed ? "换个分类、状态或关键词后再看。" : emptyText}</p>
          </section>
        ) : null}
        {phase === "ready" && pageItems.length > 0 ? (
          <div className="resource-grid">
            {pageItems.map((item) => {
              const tags = cardTags(item);
              return (
                <article
                  className={onOpen ? "market-card is-openable" : "market-card"}
                  key={item.id}
                  role={onOpen ? "link" : undefined}
                  tabIndex={onOpen ? 0 : undefined}
                  onClick={
                    onOpen
                      ? (event) => {
                          const target = event.target;
                          if (target instanceof Element && target.closest("button, a, .market-action")) return;
                          onOpen(item);
                        }
                      : undefined
                  }
                  onKeyDown={
                    onOpen
                      ? (event) => {
                          if (event.key !== "Enter" || event.target !== event.currentTarget) return;
                          onOpen(item);
                        }
                      : undefined
                  }
                >
                  <div className="market-head">
                    <span className={`market-ic tone-${tone}`}>
                      <Icon name={icon} size={20} />
                    </span>
                    <h2>{item.name}</h2>
                  </div>
                  <p className="desc">{item.description?.trim() || "暂无介绍"}</p>
                  {tags.length > 0 ? (
                    <div className="market-tags">
                      {tags.map((tag) => (
                        <span className={`tag ${tagTone(tag)}`} key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="market-base">
                    <div className="market-stats">
                      <Stat stat={item.usage ?? emptyUsage} icon="fire-line" kind="usage" />
                      <Stat stat={item.rating ?? emptyRating} icon="star-line" kind="rating" />
                    </div>
                    {item.footnote || item.updatedAt || item.action ? (
                      <div className="market-aside">
                        <div className="market-aside-text">
                          {item.footnote ? <span className="market-note">{item.footnote}</span> : null}
                          {item.updatedAt ? <time>{item.updatedAt}</time> : null}
                        </div>
                        {item.action ? (
                          <span className="market-action" onClick={(event) => event.stopPropagation()}>
                            <button
                              className="btn btn-primary"
                              type="button"
                              disabled={item.action.disabled}
                              onClick={(event) => {
                                event.stopPropagation();
                                item.action?.onClick();
                              }}
                            >
                              {item.action.label}
                            </button>
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        {phase === "ready" && pageCount > 1 ? (
          <div className="resource-pager">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <span>
              {currentPage} / {pageCount}
            </span>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  allLabel,
  options,
  value,
  onChange,
}: {
  label: string;
  allLabel: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="resource-filter-group">
      <div className="resource-filter-title">{label}</div>
      <button className={value === "" ? "resource-filter-item on" : "resource-filter-item"} type="button" onClick={() => onChange("")}>
        <span>{allLabel}</span>
      </button>
      {options.map((option) => (
        <button
          key={option}
          className={value === option ? "resource-filter-item on" : "resource-filter-item"}
          type="button"
          onClick={() => onChange(option)}
        >
          <span>{option}</span>
        </button>
      ))}
    </div>
  );
}

function Stat({ stat, icon, kind }: { stat: ResourceStat; icon: string; kind: "usage" | "rating" }) {
  const missing = stat.value === undefined;
  const showHint =
    !missing &&
    Boolean(stat.hint) &&
    stat.hint !== stat.label &&
    stat.hint !== "调用次数" &&
    stat.hint !== "使用次数" &&
    !stat.hint?.endsWith("分制");
  return (
    <span className={missing ? `market-stat is-${kind} is-empty` : `market-stat is-${kind}`} title={stat.hint}>
      <Icon name={icon} size={14} />
      <span>{stat.label}</span>
      {stat.value !== undefined ? (
        <b className="num">
          {formatStatNumber(stat.value)}
          {kind === "rating" && stat.scale !== undefined ? `/${formatStatNumber(stat.scale)}` : ""}
        </b>
      ) : null}
      {showHint ? <span className="market-stat-hint">{stat.hint}</span> : null}
    </span>
  );
}

function tagTone(tag: string) {
  if (/未安装|暂不可用|已停止|失败|不可用/.test(tag)) return "tone-muted";
  if (/审核/.test(tag)) return "tone-warn";
  if (/已安装|检测通过|运行中|已上架|已添加|已发布|成功/.test(tag)) return "tone-ok";
  if (/私有/.test(tag)) return "tone-purple";
  if (/内置/.test(tag)) return "tone-cyan";
  if (/自有|官方/.test(tag)) return "tone-blue";
  const tones = ["tone-blue", "tone-cyan", "tone-purple", "tone-orange", "tone-magenta"];
  let hash = 0;
  for (const char of tag) hash = (hash + char.charCodeAt(0)) % tones.length;
  return tones[hash];
}

function cardTags(item: BoardItem) {
  const tags: string[] = [];
  if (item.status) tags.push(item.status);
  if (item.category && item.category !== item.status && !item.status?.includes(item.category)) tags.push(item.category);
  for (const tag of item.tags ?? []) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 4);
}

function compareTime(left?: string, right?: string) {
  if (left && right) return left < right ? -1 : left > right ? 1 : 0;
  if (left) return 1;
  if (right) return -1;
  return 0;
}
