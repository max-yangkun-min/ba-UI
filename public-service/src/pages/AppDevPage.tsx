import { useEffect } from "react";
import { RegistryBoard } from "../features/registry/RegistryBoard";

export function AppDevPage() {
  useEffect(() => {
    document.title = "应用开发 · 智能模型公共服务平台";
  }, []);

  return <RegistryBoard />;
}
