import { useEffect } from "react";
import { BaEmbed } from "../features/agent/BaEmbed";

export function HomePage() {
  useEffect(() => {
    document.title = "对话 · 智能模型公共服务平台";
  }, []);

  return <BaEmbed />;
}
