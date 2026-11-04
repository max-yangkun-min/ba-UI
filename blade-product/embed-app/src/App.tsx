import { Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { AppDevEmbedPage } from "./pages/AppDevEmbedPage";
import { EmbedChatSpace } from "./pages/EmbedChatSpace";
import { MockAgentCatalog } from "./pages/MockAgentCatalog";
import { HomePage } from "./pages/HomePage";
import { PromptEngineeringPage } from "./pages/PromptEngineeringPage";
import { PromptTemplateCatalogPage } from "./pages/PromptTemplateCatalogPage";
import { PromptTemplateDetailPage } from "./pages/PromptTemplateDetailPage";
import { ResourceCatalogPage } from "./pages/ResourceCatalogPage";
import { ResourceDetailPage } from "./pages/ResourceDetailPage";
import "./styles/global.css";
import "./styles/workbench.css";
import "./styles/console.css";
import "./styles/registry.css";
import "./styles/prompts.css";
import "./styles/resources.css";
import "./styles/agent-portal.css";
import "./styles/embed.css";

export function App() {
  return (
    <ToastProvider>
      <div className="embed-app">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/chat-workspace" element={<EmbedChatSpace mode="workspace" />} />
          <Route path="/chat-admin" element={<EmbedChatSpace mode="admin" />} />
          <Route path="/resources/skills" element={<ResourceCatalogPage kind="skills" />} />
          <Route path="/resources/knowledge" element={<ResourceCatalogPage kind="knowledge" />} />
          <Route path="/resources/agents" element={<MockAgentCatalog />} />
          <Route path="/resources/tools" element={<ResourceCatalogPage kind="tools" />} />
          <Route path="/resources/plugins" element={<ResourceCatalogPage kind="plugins" />} />
          <Route path="/resources/prompt-templates" element={<PromptTemplateCatalogPage />} />
          <Route path="/resources/prompt-templates/:id" element={<PromptTemplateDetailPage />} />
          <Route path="/resources/prompts" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/resources/prompts/*" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/resources/:kind/*" element={<ResourceDetailPage />} />
          <Route path="/console/app-dev/prompts/:scope/:id" element={<PromptEngineeringPage />} />
          <Route path="/console/app-dev/prompts" element={<PromptEngineeringPage />} />
          <Route path="/console/prompts" element={<Navigate to="/console/app-dev/prompts" replace />} />
          <Route path="/console/app-dev/:baModule/*" element={<AppDevEmbedPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </ToastProvider>
  );
}
