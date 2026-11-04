import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installEmbedResize } from "./lib/embed-resize";
import { installPortalSession } from "./lib/portal-session";

installEmbedResize();
// 票在后台问父页面要。这里不等它：等的话，父页面不回答就会空白大约 4 秒，内层对话地址也跟着晚。
void installPortalSession();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
