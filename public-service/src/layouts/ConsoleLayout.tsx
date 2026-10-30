import { NavLink, Outlet, useLocation } from "react-router-dom";
import { consoleNav } from "../data/nav";
import { Icon } from "../components/Icon";

export function ConsoleLayout() {
  const location = useLocation();

  return (
    <div className="console-body">
      <aside className="console-side" aria-label="控制台模块">
        {consoleNav.map((item) => {
          const path = location.pathname;
          const childActive = item.children?.some((child) => path === child.to || path.startsWith(`${child.to}/`)) ?? false;
          const inSection = item.matchPrefix
            ? path === item.matchPrefix || path.startsWith(`${item.matchPrefix}/`)
            : false;
          const selfActive = item.end ? path === item.to : path === item.to || childActive || inSection;
          const expanded = Boolean(item.children && (selfActive || childActive));
          return (
            <div className="nav-block" key={item.label}>
              <NavLink to={item.to} end={item.end} className={() => (selfActive ? "nav-item on" : "nav-item")}>
                <Icon name={item.icon} size={16} />
                <span className="nav-label">{item.label}</span>
                {item.children ? <Icon name={expanded ? "arrow-down-s-line" : "arrow-right-s-line"} size={16} /> : null}
              </NavLink>
              {expanded ? (
                <div className="nav-children">
                  {item.children?.map((child) => (
                    <NavLink
                      key={child.to + child.label}
                      to={child.to}
                      className={({ isActive }) => (isActive ? "nav-sub on" : "nav-sub")}
                    >
                      <span className="nav-label">{child.label}</span>
                    </NavLink>
                  ))}
                  {item.example ? (
                    <NavLink to={item.example.to} end className="nav-example">
                      <span className="nav-label">{item.example.label}</span>
                    </NavLink>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </aside>
      <main className="console-main">
        <Outlet />
      </main>
    </div>
  );
}
