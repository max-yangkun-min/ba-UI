import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installEmbedResize } from "./lib/embed-resize";
import { installPortalSession } from "./lib/portal-session";

installEmbedResize();
// 门户展示页不等票。对话和后台开发页自己等父页面的票，超时也不要用超级管理员先把内层打开。
void installPortalSession();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
