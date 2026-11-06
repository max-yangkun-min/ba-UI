import { useEffect, useRef } from "react";
import { embedAppPage } from "../data/embed-origin";
import { useEmbedGrant } from "../lib/embed-grant";
import { useLabAuth } from "../lib/lab-auth";

/** 外壳只留顶栏。页签在嵌入页里，这里不再画第二套「AI对话」。 */
export function ChatEmbed() {
  const src = embedAppPage("/");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { session } = useLabAuth();
  useEmbedGrant(frameRef, src, "/");

  useEffect(() => {
    document.title = "对话 · 智能模型公共服务平台";
  }, []);

  if (!src) {
    return (
      <div className="shell-embed">
        <p className="login-test-error">没有拿到嵌入页地址，对话页打不开。</p>
      </div>
    );
  }

  return (
    <div className="shell-embed">
      <iframe key={session?.token || "admin"} ref={frameRef} className="shell-embed-frame" title="对话" src={src} scrolling="no" />
    </div>
  );
}
