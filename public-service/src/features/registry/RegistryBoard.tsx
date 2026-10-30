import { useMemo, useState } from "react";
import { categories, registryAssets, type AssetKind, type AssetStatus, type RegistryAsset } from "../../data/registry";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { IntegrationNote } from "../../components/IntegrationNote";
import { useToast } from "../../components/Toast";

const kinds: Array<"全部类型" | AssetKind> = ["全部类型", "技能", "方案", "插件", "MCP"];
const statuses: Array<"全部" | AssetStatus> = ["全部", "已发布", "草稿", "审核中"];

const kindIcon: Record<AssetKind, string> = {
  技能: "function-line",
  方案: "node-tree",
  插件: "puzzle-line",
  MCP: "terminal-box-line",
};

export function RegistryBoard() {
  const toast = useToast();
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [kind, setKind] = useState<(typeof kinds)[number]>("全部类型");
  const [status, setStatus] = useState<(typeof statuses)[number]>("全部");
  const [category, setCategory] = useState("全部类别");
  const [sort, setSort] = useState("最近更新");
  const [active, setActive] = useState<RegistryAsset | null>(null);
  const [uploadKind, setUploadKind] = useState<AssetKind | null>(null);

  const filtered = useMemo(() => {
    const text = applied.trim();
    const list = registryAssets.filter((item) => {
      if (kind !== "全部类型" && item.kind !== kind) return false;
      if (status !== "全部" && item.status !== status) return false;
      if (category !== "全部类别" && item.category !== category) return false;
      if (!text) return true;
      return item.name.includes(text) || item.slug.includes(text) || item.description.includes(text);
    });
    if (sort === "调用最多") {
      return [...list].sort((a, b) => parseCalls(b.calls) - parseCalls(a.calls));
    }
    return list;
  }, [applied, category, kind, sort, status]);

  function reset() {
    setKeyword("");
    setApplied("");
    setKind("全部类型");
    setStatus("全部");
    setCategory("全部类别");
    setSort("最近更新");
  }

  return (
    <div>
      <IntegrationNote
        name="Blade Hub"
        port={8010}
        summary="技能与方案注册中心示例。列表、搜索和上传都在本页完成，不改写 skill_registory 源码。"
      />
      <div className="page-head">
        <div>
          <h1>应用开发</h1>
          <p>技能、方案、插件与 MCP 的检索和发布。视觉按界面规范，信息架构对应 Blade Hub 的商店与方案列表。</p>
        </div>
        <div className="grow" />
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => setUploadKind("技能")}>
            <Icon name="upload-2-line" />
            上传技能
          </button>
          <button className="btn btn-primary" type="button" onClick={() => setUploadKind("方案")}>
            <Icon name="add-line" />
            上传方案
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <label>
          状态{" "}
          <select className="select" value={status} aria-label="状态" onChange={(event) => setStatus(event.target.value as typeof status)}>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          类型{" "}
          <select className="select" value={kind} aria-label="类型" onChange={(event) => setKind(event.target.value as typeof kind)}>
            {kinds.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="field search-field">
          <Icon name="search-line" />
          <input
            value={keyword}
            placeholder="搜索名称、标识或描述"
            aria-label="搜索名称"
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") setApplied(keyword);
            }}
          />
        </label>
        <button className="btn" type="button" onClick={reset}>
          <Icon name="refresh-line" />
          重置
        </button>
        <button className="btn btn-primary" type="button" onClick={() => setApplied(keyword)}>
          查询
        </button>
        <label>
          排序{" "}
          <select className="select" value={sort} aria-label="排序" onChange={(event) => setSort(event.target.value)}>
            <option>最近更新</option>
            <option>调用最多</option>
          </select>
        </label>
      </div>

      <div className="chips" role="tablist" aria-label="类别">
        {categories.map((item) => (
          <button
            key={item}
            className={item === category ? "chip on" : "chip"}
            type="button"
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-result">没有符合条件的资产。可重置筛选后再查询。</div>
      ) : (
        <div className="asset-grid">
          {filtered.map((item) => (
            <button key={item.id} className="asset-card" type="button" onClick={() => setActive(item)}>
              <div className="asset-top">
                <span className={`asset-ic ${iconTone(item.kind)}`}>
                  <Icon name={kindIcon[item.kind]} size={18} />
                </span>
                <span className="asset-title">
                  <b>{item.name}</b>
                  <small>
                    {item.slug} · {item.version}
                  </small>
                </span>
                <StatusTag status={item.status} />
              </div>
              <p className="desc">{item.description}</p>
              <div className="asset-meta">
                <span>
                  调用 <b className="num">{item.calls}</b>
                </span>
                <span>
                  评分 <b className="num">{item.score}</b>
                </span>
                <span>{item.updated}</span>
              </div>
              <div className="asset-foot">
                <span className="tag">{item.category}</span>
                <span className="btn-text">查看详情</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="pager">
        <span>共 {filtered.length} 条</span>
        <button type="button" disabled>
          上一页
        </button>
        <button className="on" type="button">
          1
        </button>
        <button type="button" disabled>
          下一页
        </button>
      </div>

      {active ? (
        <Dialog
          title={active.name}
          onClose={() => setActive(null)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setActive(null)}>
                关闭
              </button>
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => {
                  toast(`示例：未安装到 Agent。「${active.name}」只存在于静态列表。`);
                  setActive(null);
                }}
              >
                安装到 Agent
              </button>
            </>
          }
        >
          <dl className="detail-grid">
            <dt>类型</dt>
            <dd>{active.kind}</dd>
            <dt>标识</dt>
            <dd>{active.slug}</dd>
            <dt>组织</dt>
            <dd>{active.org}</dd>
            <dt>版本</dt>
            <dd>{active.version}</dd>
            <dt>状态</dt>
            <dd>{active.status}</dd>
            <dt>类别</dt>
            <dd>{active.category}</dd>
            <dt>说明</dt>
            <dd>{active.description}</dd>
          </dl>
        </Dialog>
      ) : null}

      {uploadKind ? (
        <UploadDialog
          kind={uploadKind}
          onClose={() => setUploadKind(null)}
          onSubmit={(name) => {
            toast(`示例环境未连接 8010，未实际上传「${name || uploadKind}」。`);
            setUploadKind(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StatusTag({ status }: { status: AssetStatus }) {
  const tone = status === "已发布" ? "tag tag-ok" : status === "审核中" ? "tag tag-warn" : "tag tag-muted";
  return <span className={tone}>{status}</span>;
}

function iconTone(kind: AssetKind) {
  if (kind === "方案") return "scheme";
  if (kind === "插件") return "plugin";
  if (kind === "MCP") return "mcp";
  return "";
}

function parseCalls(value: string) {
  if (value.includes("万")) return Number.parseFloat(value) * 10000;
  return Number.parseFloat(value.replace(/,/g, "")) || 0;
}

function UploadDialog({
  kind,
  onClose,
  onSubmit,
}: {
  kind: AssetKind;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("我的组织");
  const [desc, setDesc] = useState("");

  return (
    <Dialog
      title={kind === "方案" ? "上传方案" : "上传技能"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="button" onClick={() => onSubmit(name)}>
            提交
          </button>
        </>
      }
    >
      <div className="form-row">
        <label htmlFor="asset-name">名称</label>
        <input id="asset-name" className="field" value={name} placeholder="例如：航线规划助手" onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="asset-org">组织</label>
        <input id="asset-org" className="field" value={org} onChange={(event) => setOrg(event.target.value)} />
      </div>
      <div className="form-row">
        <label htmlFor="asset-file">压缩包</label>
        <input id="asset-file" className="field" type="file" />
      </div>
      <div className="form-row">
        <label htmlFor="asset-desc">说明</label>
        <textarea id="asset-desc" value={desc} placeholder="简要说明用途与包含的技能" onChange={(event) => setDesc(event.target.value)} />
      </div>
      <p className="group-label">提交后不会写入 Blade Hub，只用于演示对话框。</p>
    </Dialog>
  );
}
