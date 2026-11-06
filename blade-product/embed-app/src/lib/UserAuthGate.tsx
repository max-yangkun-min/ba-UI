import { useEffect, useState, type ReactNode } from "react";
import { currentPortalSession, whenPortalSession, type PortalSession } from "./portal-session";

/** 授权页在票确定之前不挂出会写数据的子树。门户页不要包这层。 */
export function UserAuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PortalSession | null>(() => currentPortalSession());

  useEffect(() => {
    let live = true;
    whenPortalSession().then((value) => {
      if (live) setSession(value);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!session) {
    return (
      <div className="auth-hold" role="status">
        正在等待授权…
      </div>
    );
  }
  if (session.mode === "unauthorized") {
    return (
      <div className="auth-hold" role="status">
        未收到授权，页面未打开。
      </div>
    );
  }
  return children;
}
