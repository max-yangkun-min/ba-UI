import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatTime, type PromptTemplate } from "../features/prompts/model";
import { loadStore } from "../features/prompts/storage";
import { PortalCatalog, type PortalCard } from "../features/resources/PortalCatalog";

export function PromptTemplateCatalogPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<PromptTemplate[]>(() => loadStore().templates);

  useEffect(() => {
    document.title = "提示词模板 · 智能模型公共服务平台";
  }, []);

  useEffect(() => {
    const reload = () => setItems(loadStore().templates);
    window.addEventListener("storage", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener("focus", reload);
    };
  }, []);

  return (
    <PortalCatalog
      title="提示词模板"
      noun="提示词模板"
      icon="chat-ai-line"
      phase="ready"
      emptyText="控制台里还没有保存的提示词模板。保存后会出现在这里。"
      items={items.map(toCard)}
      searchPlaceholder="搜索提示词模板名称、内容、可见范围..."
      onOpen={(item) => navigate(`/resources/prompt-templates/${encodeURIComponent(item.id)}`)}
    />
  );
}

function toCard(item: PromptTemplate): PortalCard {
  return {
    id: item.id,
    name: item.name || "未命名模板",
    desc: item.content.replace(/\s+/g, " ").trim(),
    category: item.visibility,
    status: "",
    owner: item.ownerName,
    tags: item.variables.map((variable) => variable.name).filter(Boolean),
    updatedAt: formatTime(item.updatedAt),
    usageText: "暂无用量",
    ratingText: "暂无评分",
  };
}
