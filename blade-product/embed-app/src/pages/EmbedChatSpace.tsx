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

/** 首页一个标签，开发页两个，管理页三个。AI对话仍是当前嵌入页里的 Blade 对话。标签和内层侧栏一起出现。 */
export function EmbedChatSpace({ mode }: { mode: "chat" | "workspace" | "admin" }) {
  const urls = useSpaceUrls();
  const links =
    mode === "chat"
      ? []
      : [
          { label: "开发空间", href: urls.dev },
          ...(mode === "admin" ? [{ label: "管理空间", href: urls.admin }] : []),
        ];

  useEffect(() => {
    document.title = mode === "admin" ? "管理 · 智能模型公共服务平台" : "对话 · 智能模型公共服务平台";
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
