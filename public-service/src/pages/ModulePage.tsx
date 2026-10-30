import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { moduleCopy } from "../data/nav";

export function ModulePage() {
  const { moduleId = "" } = useParams();
  const copy = moduleCopy[moduleId] ?? {
    title: "模块",
    summary: "该地址没有对应模块。",
  };

  useEffect(() => {
    document.title = `${copy.title} · 智能模型公共服务平台`;
  }, [copy.title]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{copy.title}</h1>
          <p>导航占位</p>
        </div>
      </div>
      <section className="placeholder">
        <h2>{copy.title}</h2>
        <p>{copy.summary}</p>
        <p>
          <Link className="btn-text" to="/console/app-dev/skills/manage">
            前往技能开发
          </Link>
        </p>
      </section>
    </div>
  );
}
