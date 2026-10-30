import { useState } from "react";
import { useLabAuth } from "../lib/lab-auth";
import { ShellEmbed } from "./ShellEmbed";

/** 生产包的对话入口。只有账号口令登录，没有实验室快捷按钮。 */
export function ChatGate() {
  const { ready, session, busy, error, loginWithPassword } = useLabAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const canSubmit = username.trim().length > 0 && password.length > 0 && !busy;

  if (!ready) return <div className="shell-embed" />;
  if (session?.token) return <ShellEmbed />;

  return (
    <div className="chat-gate">
      <section className="panel">
        <h2>登录后进入对话</h2>
        <p>
          对话只使用当前用户换到的平台票。未登录时，智能体、知识库、技能、工具、插件、提示词模板和控制台应用开发仍使用超级管理员票。退出后这些页面回到超级管理员票。
        </p>
        <form
          className="chat-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            const nextPassword = password;
            setPassword("");
            void loginWithPassword(username, nextPassword);
          }}
        >
          <div className="form-row">
            <label htmlFor="chat-username">用户名</label>
            <input
              id="chat-username"
              className="field"
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="chat-password">密码</label>
            <input
              id="chat-password"
              className="field"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            登录并进入对话
          </button>
        </form>
        {error ? <p className="login-test-error">{error}</p> : null}
      </section>
    </div>
  );
}
