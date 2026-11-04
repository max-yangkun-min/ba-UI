import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { resourceNav } from "../data/resource-nav";
import { useLabAuth } from "../lib/lab-auth";
import { Icon } from "./Icon";
import { useToast } from "./Toast";

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { session, logout } = useLabAuth();
  const inConsole = location.pathname.startsWith("/console");
  const [open, setOpen] = useState<"bell" | "user" | null>(null);

  useEffect(() => {
    setOpen(null);
  }, [location.pathname]);

  useEffect(() => {
    const close = () => setOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  return (
    <header className="app-header">
      <NavLink to="/" className="brand" aria-label="智能模型公共服务平台">
        <span className="brand-mark">
          <Icon name="ai-agent-line" size={18} />
        </span>
        <span className="brand-name">智能模型公共服务平台</span>
      </NavLink>
      <nav className="top-nav" aria-label="主导航">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : undefined)}>
          对话
        </NavLink>
        <NavLink to="/chat-workspace" className={({ isActive }) => (isActive ? "on" : undefined)}>
          开发
        </NavLink>
        <NavLink to="/chat-admin" className={({ isActive }) => (isActive ? "on" : undefined)}>
          管理
        </NavLink>
        {resourceNav.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "on" : undefined)}>
            {item.label}
          </NavLink>
        ))}
        <NavLink to="/console" className={({ isActive }) => (isActive ? "on" : undefined)}>
          控制台
        </NavLink>
      </nav>
      <div className="header-spacer" />
      <div className="header-right">
        {inConsole ? (
          <NavLink to="/" className="header-link">
            <Icon name="arrow-left-line" size={16} />
            返回对话
          </NavLink>
        ) : null}
        <div className="menu-anchor" onClick={(event) => event.stopPropagation()}>
          <button
            className="header-icon"
            type="button"
            aria-label="通知"
            aria-expanded={open === "bell"}
            onClick={() => setOpen((value) => (value === "bell" ? null : "bell"))}
          >
            <Icon name="notification-3-line" size={18} />
            <i className="dot" />
          </button>
          {open === "bell" ? (
            <div className="menu" role="menu">
              <div className="menu-label">通知 · 示例</div>
              <button type="button" onClick={() => toast("示例通知：技能「态势标绘」已发布")}>
                技能「态势标绘」已发布
              </button>
              <button type="button" onClick={() => toast("示例通知：有 3 条资产待审核")}>
                有 3 条资产待审核
              </button>
            </div>
          ) : null}
        </div>
        <div className="menu-anchor" onClick={(event) => event.stopPropagation()}>
          <button
            className="user-chip"
            type="button"
            aria-expanded={open === "user"}
            onClick={() => setOpen((value) => (value === "user" ? null : "user"))}
          >
            <span className="avatar">{session ? session.username.slice(0, 1).toUpperCase() : "访"}</span>
            {session ? session.username : "未登录"}
            <Icon name="arrow-down-s-line" size={16} />
          </button>
          {open === "user" ? (
            <div className="menu" role="menu">
              <div className="menu-label">账号</div>
              <button type="button" onClick={() => toast("个人中心为示例占位")}>
                <Icon name="user-line" />
                个人中心
              </button>
              <button type="button" onClick={() => toast("系统设置为示例占位")}>
                <Icon name="settings-4-line" />
                系统设置
              </button>
              {session ? (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                >
                  <Icon name="user-line" />
                  切换用户
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate("/");
                }}
              >
                <Icon name="logout-box-r-line" />
                {session ? "退出登录" : "登录"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
