import { useEffect } from "react";
import { BaEmbed } from "../features/agent/BaEmbed";
import { assignTopHref, useSpaceUrls } from "../lib/space-urls";
import "../styles/embed-space.css";

function SpaceTab({ label, href }: { label: string; href: string }) {
  if (!href) {
    return (
      <button type="button" role="tab" aria-selected="false">
        {label}
      </button>
    );
  }
  return (
    <a
      role="tab"
      aria-selected="false"
      href={href}
      target="_top"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        assignTopHref(href);
      }}
    >
      {label}
    </a>
  );
}

type ChatSpaceMode = "chat" | "workspace" | "admin" | "general-admin";

function spaceLinks(mode: ChatSpaceMode, urls: { dev: string; admin: string }) {
  if (mode === "workspace") return [{ label: "开发空间", href: urls.dev }];
  if (mode === "admin") {
    return [
      { label: "开发空间", href: urls.dev },
      { label: "管理空间", href: urls.admin },
    ];
  }
  if (mode === "general-admin") return [{ label: "管理空间", href: urls.admin }];
  return [];
}

function spaceTitle(mode: ChatSpaceMode) {
  if (mode === "admin") return "管理 · 智能模型公共服务平台";
  if (mode === "general-admin") return "普通管理 · 智能模型公共服务平台";
  return "对话 · 智能模型公共服务平台";
}

/** 首页一个标签，开发页两个，管理页三个，普通管理两个（AI对话、管理空间）。AI对话仍是当前嵌入页里的 Blade 对话。标签只在内层还是对话侧栏时出现。 */
export function EmbedChatSpace({ mode }: { mode: ChatSpaceMode }) {
  const urls = useSpaceUrls();
  const links = spaceLinks(mode, urls);

  useEffect(() => {
    document.title = spaceTitle(mode);
  }, [mode]);

  return (
    <div className={mode === "chat" ? "embed-chat-space is-chat" : mode === "admin" ? "embed-chat-space is-admin" : "embed-chat-space"}>
      <div className="embed-chat-space-head">
        <div className="embed-chat-space-tabs" role="tablist" aria-label="工作空间">
          <button type="button" role="tab" aria-selected="true">
            AI对话
          </button>
          {links.map((link) => (
            <SpaceTab key={link.label} label={link.label} href={link.href} />
          ))}
        </div>
      </div>
      <BaEmbed title="对话" spaceTabs />
    </div>
  );
}
