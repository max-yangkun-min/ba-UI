import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installEmbedResize } from "./lib/embed-resize";
import { installPortalSession } from "./lib/portal-session";

installEmbedResize();
// 门户目录没有票就先用超级管理员。父页面后来的票和对话页是同一条。对话页没有票则停在未授权。
void installPortalSession();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
