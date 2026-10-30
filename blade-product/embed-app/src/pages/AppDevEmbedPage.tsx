import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { findBaAppModule } from "../data/ba-modules";
import { findResourceNav, type ResourceKind } from "../data/resource-nav";
import { BaEmbed } from "../features/agent/BaEmbed";
import { consoleResourcePath, withSkillQuery } from "../features/resources/detail";
import type { BoardItem } from "../features/resources/ResourceBoard";
import { AgentResourcePage } from "./AgentResourcePage";
import { ResourceCatalogPage } from "./ResourceCatalogPage";
import { ResourceDetailBody } from "./ResourceDetailPage";

const cardKind: Partial<Record<string, ResourceKind>> = {
  skills: "skills",
  knowledge: "knowledge",
  apps: "agents",
  tools: "tools",
  plugins: "plugins",
};

export function AppDevEmbedPage() {
  const params = useParams();
  const baModule = params.baModule ?? "";
  const rest = params["*"] ?? "";
  const module = findBaAppModule(baModule);

  useEffect(() => {
    document.title = module ? `${module.label} · 应用开发` : "应用开发 · 智能模型公共服务平台";
  }, [module]);

  if (!module) {
    return <Navigate to="/console/app-dev/skills" replace />;
  }

  const listTo = `/console/app-dev/${module.id}`;
  const kind = cardKind[module.id];

  // 控制台「知识库搭建」直接嵌 8020 的知识库页。不要落到门户卡片目录，也不要回到主页。
  if (module.id === "knowledge") {
    return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} />;
  }

  // 控制台「MCP工具接入」「插件管理」直接嵌 8010。hide_nav 显式带上；8020 以外缺省不会加。
  if (module.id === "tools" || module.id === "plugins") {
    return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} hideNav />;
  }

  if (rest === "manage" && module.id === "skills") {
    return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} />;
  }

  if (rest === "manage") {
    if (!kind) return <Navigate to={listTo} replace />;
    return (
      <div className="console-manage">
        <div className="console-manage-bar">
          <Link className="btn" to={listTo}>
            返回卡片
          </Link>
          <strong>{module.label}</strong>
          <span>后台管理</span>
        </div>
        <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} />
      </div>
    );
  }

  if (rest === "open" || rest.startsWith("open/")) {
    const id = rest.startsWith("open/") ? rest.slice("open/".length) : "";
    if (!kind || !id) return <Navigate to={listTo} replace />;
    const nav = findResourceNav(kind);
    return <ResourceDetailBody kind={kind} id={id} label={nav?.label ?? module.label} listTo={listTo} />;
  }

  if (rest) return <Navigate to={listTo} replace />;

  if (!kind) {
    return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} />;
  }

  const enter = (
    <Link className="btn btn-primary" to={`${listTo}/manage`}>
      进入管理
    </Link>
  );
  if (kind === "agents") {
    return <AgentResourcePage toolbarExtra={enter} toDetail={(id) => consoleResourcePath(module.id, id)} />;
  }
  return (
    <ResourceCatalogPage
      kind={kind}
      toolbarExtra={enter}
      toDetail={(item: BoardItem) => withSkillQuery(consoleResourcePath(module.id, item.id), kind, item)}
    />
  );
}
