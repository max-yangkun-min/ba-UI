import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { findResourceNav, type ResourceKind } from "../data/resource-nav";
import { emptyCatalogCopy, loadCatalog, type CatalogCard } from "../features/resources/catalog";
import { resourceDetailPath, withSkillQuery } from "../features/resources/detail";
import { PortalCatalog, type PortalCard } from "../features/resources/PortalCatalog";
import { portalSkillCategory } from "../features/resources/skill-categories";
import { ResourceBoard, type BoardFilter, type BoardItem } from "../features/resources/ResourceBoard";
import { formatStatNumber } from "../features/resources/stats";

type Phase = "loading" | "ready" | "error";

const iconOf: Record<ResourceKind, string> = {
  skills: "function-line",
  knowledge: "book-2-line",
  agents: "ai-agent-line",
  tools: "tools-line",
  plugins: "puzzle-line",
};

const filters: BoardFilter[] = [
  { key: "category", label: "分类", allLabel: "全部分类" },
  { key: "status", label: "状态", allLabel: "全部状态" },
];

export function ResourceCatalogPage({
  kind,
  toolbarExtra,
  toDetail,
}: {
  kind: ResourceKind;
  toolbarExtra?: ReactNode;
  /** 控制台传入时，点卡片留在 /console/...；缺省仍去门户 /resources/...。 */
  toDetail?: (item: BoardItem) => string;
}) {
  const nav = findResourceNav(kind);
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<CatalogCard[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    document.title = `${nav?.label ?? "资源"} · 智能模型公共服务平台`;
  }, [nav?.label]);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError("");
    setNotice("");
    setItems([]);
    loadCatalog(kind)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setNotice(result.notice ?? "");
        setPhase("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "加载失败。");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, reloadToken]);

  const noun = nav?.label ?? "资源";
  const portal = !toolbarExtra && !toDetail;

  if (portal) {
    return (
      <PortalCatalog
        key={kind}
        title={noun}
        noun={noun}
        icon={iconOf[kind]}
        phase={phase}
        error={error}
        emptyText={emptyCatalogCopy(kind)}
        items={items.map((item) => toPortalCard(item, kind))}
        searchPlaceholder={`搜索${noun}名称、描述、分类...`}
        onOpen={(item) => navigate(openPath(kind, item))}
      />
    );
  }

  return (
    <ResourceBoard
      key={kind}
      title={noun}
      noun={noun}
      icon={iconOf[kind]}
      tone={kind}
      searchPlaceholder={`搜索${noun}名称、描述、状态`}
      phase={phase}
      items={items.map(toBoardItem)}
      filters={filters}
      onRefresh={() => setReloadToken((value) => value + 1)}
      loadingText="正在从后台读取最新列表。"
      errorText={error}
      emptyTitle="暂无数据"
      emptyText={emptyCatalogCopy(kind)}
      notices={notice ? [{ text: notice }] : undefined}
      toolbarExtra={toolbarExtra}
      onOpen={(item) => navigate(toDetail ? toDetail(item) : openPath(kind, item))}
    />
  );
}

function openPath(kind: ResourceKind, item: { id: string; name?: string; status?: string }) {
  return withSkillQuery(resourceDetailPath(kind, item.id), kind, item);
}

function toPortalCard(item: CatalogCard, kind: ResourceKind): PortalCard {
  const category = kind === "skills" ? portalSkillCategory(item.id, item.name, item.description ?? "") : (item.category ?? "");
  return {
    id: item.id,
    name: item.name,
    desc: item.description ?? "",
    category,
    status: item.status ?? "",
    owner: "",
    tags: item.tags ?? [],
    updatedAt: item.updatedAt ?? "",
    usageText: item.usage.value === undefined ? item.usage.label : formatStatNumber(item.usage.value),
    ratingText: item.rating.value === undefined ? item.rating.label : formatStatNumber(item.rating.value),
    hot: item.hot ?? item.usage.value,
  };
}

function toBoardItem(item: CatalogCard): BoardItem {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    status: item.status,
    updatedAt: item.updatedAt,
    category: item.category,
    tags: item.tags,
    hot: item.hot,
    usage: item.usage,
    rating: item.rating,
  };
}
