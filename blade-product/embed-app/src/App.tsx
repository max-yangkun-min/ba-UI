import { Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { UserAuthGate } from "./lib/UserAuthGate";
import { AppDevEmbedPage } from "./pages/AppDevEmbedPage";
import { EmbedChatSpace } from "./pages/EmbedChatSpace";
import { HomePage } from "./pages/HomePage";
import { PromptEngineeringPage } from "./pages/PromptEngineeringPage";
import "./styles/global.css";
import "./styles/workbench.css";
import "./styles/console.css";
import "./styles/registry.css";
import "./styles/prompts.css";
import "./styles/embed.css";

export function App() {
  return (
    <ToastProvider>
      <div className="embed-app">
        <Routes>
          <Route path="/" element={<UserAuthGate><HomePage /></UserAuthGate>} />
          <Route path="/chat-workspace" element={<UserAuthGate><EmbedChatSpace mode="workspace" /></UserAuthGate>} />
          <Route path="/chat-admin" element={<UserAuthGate><EmbedChatSpace mode="admin" /></UserAuthGate>} />
          <Route path="/chat-general-admin" element={<UserAuthGate><EmbedChatSpace mode="general-admin" /></UserAuthGate>} />
          <Route path="/resources/prompts" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/resources/prompts/*" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/console/app-dev/prompts/:scope/:id" element={<UserAuthGate><PromptEngineeringPage /></UserAuthGate>} />
          <Route path="/console/app-dev/prompts" element={<UserAuthGate><PromptEngineeringPage /></UserAuthGate>} />
          <Route path="/console/prompts" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/console/app-dev/:baModule/*" element={<UserAuthGate><AppDevEmbedPage /></UserAuthGate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </ToastProvider>
  );
}
