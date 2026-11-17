import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { findBaAppModule } from "../data/ba-modules";
import { BaEmbed } from "../features/agent/BaEmbed";

/** 应用开发只嵌上游模块页。门户目录和详情已移交，不再在这里渲染。 */
export function AppDevEmbedPage() {
  const params = useParams();
  const baModule = params.baModule ?? "";
  const module = findBaAppModule(baModule);

  useEffect(() => {
    document.title = module ? `${module.label} · 应用开发` : "应用开发 · 智能模型公共服务平台";
  }, [module]);

  if (!module) {
    return <Navigate to="/console/app-dev/factory" replace />;
  }

  if (module.id === "knowledge") {
    return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} />;
  }

  if (module.id === "tools" || module.id === "plugins") {
    return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} hideNav />;
  }

  return <BaEmbed path={module.path} title={module.label} variant="module" frameOrigin={module.origin} />;
}
