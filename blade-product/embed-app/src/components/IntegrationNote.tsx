import type { ReactNode } from "react";
import { useState } from "react";
import { publicHost } from "../data/site";
import { useServiceProbe } from "../lib/probe";

type IntegrationNoteProps = {
  name: string;
  port: number;
  summary: string;
  children?: ReactNode;
};

export function IntegrationNote({ name, port, summary, children }: IntegrationNoteProps) {
  const host = publicHost();
  const url = host ? `http://${host}:${port}/` : "";
  const state = useServiceProbe(url);
  const [embed, setEmbed] = useState(false);
  const statusText = state === "checking" ? "正在检测" : state === "up" ? "可连接" : "未连通";

  return (
    <section className="integration-note" aria-label={`${name} 集成位`}>
      <p>
        <strong>
          集成位 · {name} · {port}
        </strong>
        {" · "}
        {statusText}
        {" · "}
        {summary}
      </p>
      <div className="note-actions">
        {state === "up" ? (
          <button className="btn btn-sm" type="button" onClick={() => setEmbed((value) => !value)}>
            {embed ? "返回规范示例" : "嵌入真实页面"}
          </button>
        ) : null}
        <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">
          打开 {port}
        </a>
      </div>
      {embed && state === "up" ? (
        <iframe className="live-frame" title={name} src={url} />
      ) : (
        children
      )}
    </section>
  );
}
