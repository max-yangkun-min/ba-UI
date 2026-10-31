import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { ToastProvider } from "./components/Toast";
import { ConsoleLayout } from "./layouts/ConsoleLayout";
import { AppDevPage } from "./pages/AppDevPage";
import { LabAuthProvider } from "./lib/lab-auth";
import { ChatEmbed } from "./pages/ChatEmbed";
import { ConsoleHome } from "./pages/ConsoleHome";
import { LoginTestPage } from "./pages/LoginTestPage";
import { ModulePage } from "./pages/ModulePage";
import { ShellEmbed } from "./pages/ShellEmbed";

/** 首页向嵌入页要平台票，再打开对话。不展示登录门。 */
const HomeEmbed = ChatEmbed;
const LoginTestRoute = import.meta.env.DEV ? <Route path="/login-test" element={<LoginTestPage />} /> : null;
import "./styles/global.css";
import "./styles/login-test.css";
import "./styles/header.css";
import "./styles/console.css";
import "./styles/registry.css";

export function App() {
  return (
    <ToastProvider>
      <LabAuthProvider>
      <div className="app-shell">
        <AppHeader />
        <Routes>
          <Route path="/" element={<HomeEmbed />} />
          <Route path="/resources/prompts" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/resources/prompts/*" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/resources/*" element={<ShellEmbed />} />
          {LoginTestRoute}
          <Route path="/console" element={<ConsoleLayout />}>
            <Route index element={<ConsoleHome />} />
            <Route path="app-dev" element={<AppDevPage />} />
            <Route path="app-dev/*" element={<ShellEmbed />} />
            <Route path="prompts" element={<Navigate to="/console/app-dev/prompts" replace />} />
            <Route path=":moduleId" element={<ModulePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      </LabAuthProvider>
    </ToastProvider>
  );
}
