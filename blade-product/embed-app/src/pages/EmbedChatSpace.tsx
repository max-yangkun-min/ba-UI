import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { BaEmbed } from "../features/agent/BaEmbed";
import { useSpaceUrls } from "../lib/space-urls";

function chatResourceId(value: string | null) {
  const id = (value ?? "").trim();
  if (!id || id.length > 200 || id.includes("..") || /[\s?#\\]/.test(id)) return "";
  return id;
}

function chatPathFromQuery(params: URLSearchParams) {
  const legacyKb = chatResourceId(params.get("kb"));
  const chat = params.get("chat")?.trim() ?? "";
  const id = chatResourceId(params.get("id")) || (chat ? "" : legacyKb);
  const name = params.get("name")?.trim() ?? "";
  if (!id) return legacyKb ? `/chat?kb=${encodeURIComponent(legacyKb)}` : "/";
  if (chat === "knowledge" || (!chat && legacyKb)) return `/chat?kb=${encodeURIComponent(id)}`;
  if (chat === "skills") {
    const query = new URLSearchParams();
    query.set("skill", id);
    if (name) query.set("skill_name", name);
    query.set("installed", "1");
    return `/chat?${query.toString()}`;
  }
  if (chat === "plugins") {
    const plugin = id.replace(/^(builtin|mine)-/, "");
    const query = new URLSearchParams();
    query.set("plugin", plugin);
    if (name) query.set("plugin_name", name);
    return `/chat?${query.toString()}`;
  }
  return "/";
}

type ChatSpaceMode = "chat" | "workspace" | "admin" | "general-admin";

function spaceLinks(mode: ChatSpaceMode, urls: { dev: string; admin: string }) {
  const dev = { label: "开发空间", href: urls.dev };
  const admin = { label: "管理空间", href: urls.admin };
  if (mode === "general-admin") return [admin];
  if (mode === "admin") return [dev, admin];
  return [dev];
}

function spaceTitle(mode: ChatSpaceMode) {
  if (mode === "admin") return "管理 · 智能模型公共服务平台";
  if (mode === "general-admin") return "普通管理 · 智能模型公共服务平台";
  return "对话 · 智能模型公共服务平台";
}

/** 四个对话页共用这一层。标签不在这里另画一列，交给内层画进对话侧栏，排在「新建对话」上面。 */
export function EmbedChatSpace({ mode }: { mode: ChatSpaceMode }) {
  const urls = useSpaceUrls();
  const links = spaceLinks(mode, urls);
  const [params] = useSearchParams();
  const chatPath = mode === "chat" ? chatPathFromQuery(params) : "/";

  useEffect(() => {
    document.title = spaceTitle(mode);
  }, [mode]);

  return <BaEmbed path={chatPath} title="对话" spaceLinks={links} />;
}
