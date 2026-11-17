import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { HUB_ORIGIN } from "../data/ba-modules";
import type { ResourceKind } from "../data/resource-nav";
import { BaEmbed } from "../features/agent/BaEmbed";

export function ResourceOriginEmbed({
  kind,
  id,
  label,
  listTo,
}: {
  kind: Exclude<ResourceKind, "agents">;
  id: string;
  label: string;
  listTo: string;
}) {
  const [params] = useSearchParams();
  const target = originTarget(kind, id, params.get("name") ?? "", params.get("installed") !== "0");

  useEffect(() => {
    document.title = `${label} · 智能模型公共服务平台`;
  }, [label]);

  return (
    <div className="resource-embed">
      <div className="resource-embed-bar">
        <Link className="detail-crumb" to={listTo}>
          <Icon name="arrow-left-line" size={14} />
          {label}
        </Link>
      </div>
      <BaEmbed path={target.path} title={label} variant="module" frameOrigin={target.origin} />
    </div>
  );
}

/** 这条资源在 Blade 上可直接使用的页面。8020 对话或内容页，工具和插件走 8010。 */
export function resourceExperienceTarget(kind: Exclude<ResourceKind, "agents">, id: string, name: string, installed: boolean) {
  return originTarget(kind, id, name, installed);
}

function originTarget(kind: Exclude<ResourceKind, "agents">, id: string, name: string, installed: boolean) {
  if (kind === "skills") {
    const query = new URLSearchParams();
    query.set("skill", id);
    if (name) query.set("skill_name", name);
    query.set("installed", installed ? "1" : "0");
    return { path: `/chat?${query.toString()}`, origin: undefined };
  }
  if (kind === "knowledge") return { path: `/knowledge/${encodeURIComponent(id)}`, origin: undefined };
  if (kind === "tools") return { path: `/tools/${encodeURIComponent(id)}`, origin: HUB_ORIGIN };
  const pluginName = id.startsWith("builtin-") ? id.slice("builtin-".length) : id.startsWith("mine-") ? id.slice("mine-".length) : id;
  return { path: `/plugins/${encodeURIComponent(pluginName)}`, origin: HUB_ORIGIN };
}
