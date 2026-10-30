import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { loadChatModels, optimizeWithModel, testPrompt, type ChatModel } from "./llm";
import {
  CONTENT_MAX,
  INSTRUCTION_MAX,
  SAMPLE_MAX,
  byteLength,
  extractPlaceholders,
  formatTime,
  renderTemplate,
  type OptimizeTurn,
  type PromptTemplate,
  type TemplateErrors,
  type TestTurn,
} from "./model";

export type PromptPane = "edit" | "test" | "optimize";

type TemplateEditorProps = {
  draft: PromptTemplate;
  pane: PromptPane;
  saved: boolean;
  onChange: (next: PromptTemplate) => void;
  onSave: (next: PromptTemplate) => TemplateErrors | null;
  onDelete: () => void;
};

export function TemplateEditor({ draft, pane, saved, onChange, onSave, onDelete }: TemplateEditorProps) {
  const toast = useToast();
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [errors, setErrors] = useState<TemplateErrors>({});
  const [instruction, setInstruction] = useState("");
  const [optError, setOptError] = useState("");
  const [pending, setPending] = useState<OptimizeTurn | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [modelId, setModelId] = useState("");
  const [modelError, setModelError] = useState("");
  const [sample, setSample] = useState("");
  const [sampleError, setSampleError] = useState("");
  const [testing, setTesting] = useState(false);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  useEffect(() => {
    setErrors({});
    setInstruction("");
    setOptError("");
    setPending(null);
    setSample("");
    setSampleError("");
    setVarValues({});
  }, [draft.id]);

  useEffect(() => {
    let cancelled = false;
    loadChatModels()
      .then((catalog) => {
        if (cancelled) return;
        setModels(catalog.models);
        setModelId((current) => current || catalog.defaultModelId);
        setModelError(catalog.models.length ? "" : "GET /api-ba/api/config/models 已响应，但没有可用模型。");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setModels([]);
        setModelError(error instanceof Error ? error.message : "模型列表加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const names = variableNames(draft);
  const rendered = renderTemplate(draft.content, varValues);
  const model = models.find((item) => item.id === modelId) ?? null;

  function submit(next: PromptTemplate, clearPending = false) {
    const result = onSave(next);
    setErrors(result ?? {});
    if (!result && clearPending) setPending(null);
    return !result;
  }

  function update<K extends keyof PromptTemplate>(key: K, value: PromptTemplate[K]) {
    onChange({ ...draft, [key]: value });
  }

  async function sendOptimize() {
    const text = instruction.trim();
    if (!text) {
      setOptError("请用自然语言填写优化要求");
      return;
    }
    if (byteLength(instruction) > INSTRUCTION_MAX) {
      setOptError(`优化要求不能超过 2KB，当前 ${byteLength(instruction)} 字节`);
      return;
    }
    const source = pending?.after ?? draft.content;
    if (!source.trim()) {
      setOptError("请先填写原始提示词");
      return;
    }
    if (!model) {
      setOptError(modelError || "还没有可调用的模型");
      return;
    }
    setOptimizing(true);
    setOptError("");
    try {
      const after = await optimizeWithModel(model.id, source, text);
      const current = draftRef.current;
      const turn: OptimizeTurn = {
        id: crypto.randomUUID(),
        instruction: text,
        before: source,
        after,
        at: new Date().toISOString(),
      };
      onChange({
        ...current,
        baselineContent: current.baselineContent || source,
        optimizeTurns: [...current.optimizeTurns, turn],
      });
      setPending(turn);
      setInstruction("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "优化失败";
      setOptError(message);
      toast(message);
    } finally {
      setOptimizing(false);
    }
  }

  function confirmOptimize() {
    if (!pending) return;
    const next = { ...draft, content: pending.after };
    onChange(next);
    submit(next, true);
  }

  function rollback() {
    if (!draft.baselineContent) {
      toast("还没有可回退的原始提示词");
      return;
    }
    const next = { ...draft, content: draft.baselineContent };
    onChange(next);
    if (submit(next, true)) toast("已回退到原始提示词");
    else toast("已回退到编辑区，请补全后再保存");
  }

  async function runTest(nextModelId: string, nextSample: string) {
    const text = nextSample.trim();
    if (!draft.content.trim()) {
      setSampleError("请先填写模板内容");
      return;
    }
    if (!text) {
      setSampleError("请填写测试输入样例");
      return;
    }
    if (byteLength(nextSample) > SAMPLE_MAX) {
      setSampleError(`测试输入样例不能超过 4KB，当前 ${byteLength(nextSample)} 字节`);
      return;
    }
    const picked = models.find((item) => item.id === nextModelId);
    if (!picked) {
      setSampleError(modelError || "请选择模型");
      return;
    }
    const prompt = renderTemplate(draftRef.current.content, varValues);
    setTesting(true);
    setSampleError("");
    try {
      const output = await testPrompt(picked.id, prompt, text);
      const turn: TestTurn = {
        id: crypto.randomUUID(),
        modelId: picked.id,
        modelName: picked.label,
        sample: text,
        rendered: prompt,
        output,
        ok: true,
        error: "",
        at: new Date().toISOString(),
      };
      const current = draftRef.current;
      onChange({ ...current, testTurns: [...current.testTurns, turn] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型调用失败";
      const turn: TestTurn = {
        id: crypto.randomUUID(),
        modelId: picked.id,
        modelName: picked.label,
        sample: text,
        rendered: prompt,
        output: "",
        ok: false,
        error: message,
        at: new Date().toISOString(),
      };
      const current = draftRef.current;
      onChange({ ...current, testTurns: [...current.testTurns, turn] });
      toast(message);
    } finally {
      setTesting(false);
    }
  }

  function extractVariables() {
    const found = extractPlaceholders(draft.content);
    if (!found.length) {
      toast("模板内容里没有 {{变量}} 占位符");
      return;
    }
    const existing = new Set(draft.variables.map((item) => item.name.trim()));
    const added = found.filter((name) => !existing.has(name)).map((name) => ({ name, description: "" }));
    if (!added.length) {
      toast("占位符都已在变量定义中");
      return;
    }
    update("variables", [...draft.variables, ...added]);
  }

  return (
    <div className="prompt-editor">
      {pane === "edit" ? (
        <form
          id="prompt-template-form"
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <h2>编辑模板</h2>
          <div className="form-row">
            <label htmlFor="prompt-name">模板名称</label>
            <input
              id="prompt-name"
              className={errors.name ? "field invalid" : "field"}
              value={draft.name}
              maxLength={80}
              aria-label="模板名称"
              placeholder="1-64 个字符，个人空间内不可重名"
              onChange={(event) => update("name", event.target.value)}
            />
            {errors.name ? <p className="form-error" role="alert">{errors.name}</p> : null}
          </div>
          <div className="form-row">
            <span>可见范围</span>
            <div className="prompt-radios">
              <label className="prompt-radio">
                <input
                  type="radio"
                  name="visibility"
                  checked={draft.visibility === "个人"}
                  onChange={() => update("visibility", "个人")}
                />
                个人（我的）
              </label>
              <label className="prompt-radio">
                <input
                  type="radio"
                  name="visibility"
                  checked={draft.visibility === "组织"}
                  onChange={() => update("visibility", "组织")}
                />
                组织
              </label>
            </div>
            <p className="prompt-note">{draft.visibility === "个人" ? "保存后仅自己可见。" : `保存到组织「${draft.org}」。`}</p>
          </div>
          <div className="form-row">
            <label htmlFor="prompt-content">模板内容</label>
            <textarea
              id="prompt-content"
              className={errors.content ? "prompt-content invalid" : "prompt-content"}
              value={draft.content}
              aria-label="模板内容"
              placeholder="使用 {{变量名}} 作为占位符，例如：请以{{角色}}的身份回答{{问题}}"
              onChange={(event) => update("content", event.target.value)}
            />
            <p className="prompt-note">
              已用 {byteLength(draft.content)} / {CONTENT_MAX} 字节
            </p>
            {errors.content ? <p className="form-error" role="alert">{errors.content}</p> : null}
          </div>
          <div className="form-row">
            <span>变量定义</span>
            {draft.variables.map((item, index) => (
              <div className="prompt-var" key={`${draft.id}-${index}`}>
                <input
                  className="field"
                  value={item.name}
                  aria-label={`变量名称 ${index + 1}`}
                  placeholder="变量名称"
                  onChange={(event) => update("variables", replaceVariable(draft.variables, index, { ...item, name: event.target.value }))}
                />
                <input
                  className="field"
                  value={item.description}
                  aria-label={`变量说明 ${index + 1}`}
                  placeholder="变量说明"
                  onChange={(event) =>
                    update("variables", replaceVariable(draft.variables, index, { ...item, description: event.target.value }))
                  }
                />
                <button
                  className="icon-btn"
                  type="button"
                  aria-label={`删除变量 ${index + 1}`}
                  onClick={() => update("variables", draft.variables.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Icon name="close-line" />
                </button>
              </div>
            ))}
            <div className="prompt-inline">
              <button className="btn" type="button" onClick={() => update("variables", [...draft.variables, { name: "", description: "" }])}>
                <Icon name="add-line" />
                添加变量
              </button>
              <button className="btn" type="button" onClick={extractVariables}>
                从内容提取占位符
              </button>
            </div>
            {errors.variables ? <p className="form-error" role="alert">{errors.variables}</p> : null}
          </div>
          <div className="prompt-inline">
            <button className="btn btn-primary" type="submit">
              保存
            </button>
            <button className="btn" type="button" onClick={onDelete}>
              {saved ? "删除模板" : "放弃新建"}
            </button>
          </div>
        </form>
      ) : null}

      {pane === "optimize" ? (
        <section className="panel">
          <h2>提示词优化</h2>
          <p className="prompt-note">用所选模型按自然语言要求改写。保留原始提示词，可对照后确认保存或回退。</p>
          <ModelSelect id="prompt-opt-model" models={models} modelId={modelId} error={modelError} onChange={setModelId} />
          <div className="prompt-chat" aria-label="优化对话">
            {draft.optimizeTurns.length === 0 ? <p className="prompt-note">还没有优化对话。</p> : null}
            {draft.optimizeTurns.map((turn) => (
              <div className="prompt-bubble user" key={turn.id}>
                <b>优化要求</b>
                <span>{turn.instruction}</span>
                <small>{formatTime(turn.at)}</small>
              </div>
            ))}
          </div>
          <div className="form-row">
            <label htmlFor="prompt-opt">优化要求</label>
            <textarea
              id="prompt-opt"
              value={instruction}
              aria-label="优化要求"
              placeholder="例如：把任务说清楚，删掉含糊表述，明确先给结论"
              onChange={(event) => setInstruction(event.target.value)}
            />
            {optError ? <p className="form-error" role="alert">{optError}</p> : null}
          </div>
          <div className="prompt-inline">
            <button className="btn btn-primary" type="button" disabled={optimizing} onClick={() => void sendOptimize()}>
              <Icon name="send-plane-2-line" />
              {optimizing ? "优化中…" : "发送"}
            </button>
            <button className="btn" type="button" onClick={rollback} disabled={!draft.baselineContent || optimizing}>
              回退到原始提示词
            </button>
          </div>
          {pending ? (
            <div className="prompt-compare-wrap">
              <h3>优化前后比对</h3>
              <div className="prompt-compare">
                <div>
                  <span>优化前</span>
                  <pre>{pending.before}</pre>
                </div>
                <div>
                  <span>优化后</span>
                  <pre>{pending.after}</pre>
                </div>
              </div>
              <button className="btn btn-primary" type="button" onClick={confirmOptimize}>
                确认并保存
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {pane === "test" ? (
        <section className="panel" aria-label="提示词模板测试">
          <h2>提示词模板测试</h2>
          <p className="prompt-note">选择模型并填写测试样例。测试会把当前模板和样例发给模型，预览中显示模型返回的原文。</p>
          <div className="prompt-test-grid">
            <ModelSelect id="prompt-model" models={models} modelId={modelId} error={modelError} onChange={setModelId} />
            {names.map((name) => (
              <div className="form-row" key={name}>
                <label htmlFor={`var-${name}`}>变量 {name}</label>
                <input
                  id={`var-${name}`}
                  className="field"
                  aria-label={`变量 ${name}`}
                  value={varValues[name] ?? ""}
                  onChange={(event) => setVarValues((current) => ({ ...current, [name]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="form-row">
            <label htmlFor="prompt-sample">测试输入样例</label>
            <textarea
              id="prompt-sample"
              aria-label="测试输入样例"
              value={sample}
              placeholder="不超过 4KB"
              onChange={(event) => setSample(event.target.value)}
            />
            {sampleError ? <p className="form-error" role="alert">{sampleError}</p> : null}
          </div>
          <div className="form-row">
            <span>将提交的模板</span>
            <pre className="prompt-pre">{rendered.trim() || "（空）"}</pre>
          </div>
          <button className="btn btn-primary" type="button" disabled={testing} onClick={() => void runTest(model?.id ?? "", sample)}>
            {testing ? "测试中…" : "开始测试"}
          </button>
          <div className="prompt-chat" aria-label="测试对话">
            {draft.testTurns.length === 0 ? <p className="prompt-note">还没有测试记录。</p> : null}
            {draft.testTurns.map((turn) => (
              <article className="prompt-round" key={turn.id}>
                <div className="prompt-bubble user">
                  <b>测试输入 · {turn.modelName}</b>
                  <span>{turn.sample}</span>
                  <small>{formatTime(turn.at)}</small>
                </div>
                <div className={turn.ok ? "prompt-bubble assistant" : "prompt-bubble fail"}>
                  <b>{turn.ok ? "模型返回" : "调用失败"}</b>
                  <span>{turn.ok ? turn.output : turn.error}</span>
                  {turn.ok ? null : (
                    <button className="btn btn-sm" type="button" disabled={testing} onClick={() => void runTest(turn.modelId, turn.sample)}>
                      重试
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ModelSelect({
  id,
  models,
  modelId,
  error,
  onChange,
}: {
  id: string;
  models: ChatModel[];
  modelId: string;
  error: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="form-row">
      <label htmlFor={id}>模型</label>
      <select id={id} className="select" aria-label="模型" value={modelId} onChange={(event) => onChange(event.target.value)} disabled={!models.length}>
        {models.length === 0 ? <option value="">暂无模型</option> : null}
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

function variableNames(draft: PromptTemplate) {
  const names = draft.variables.map((item) => item.name.trim()).filter(Boolean);
  for (const name of extractPlaceholders(draft.content)) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function replaceVariable(variables: PromptTemplate["variables"], index: number, next: PromptTemplate["variables"][number]) {
  return variables.map((item, itemIndex) => (itemIndex === index ? next : item));
}
