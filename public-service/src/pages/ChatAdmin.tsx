import { useEffect } from "react";
import { embedAppPage } from "../data/embed-origin";

/** 外壳只留顶栏。管理页的标签在嵌入页里，这里不再画第二套。 */
export function ChatAdmin() {
  const src = embedAppPage("/chat-admin");

  useEffect(() => {
    document.title = "管理 · 智能模型公共服务平台";
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
      <iframe className="shell-embed-frame" title="管理" src={src} scrolling="no" />
    </div>
  );
}
