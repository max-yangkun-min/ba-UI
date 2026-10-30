---
name: "PPT生成与编辑"
description: "AI 驱动的多格式 SVG 内容生成系统。通过多角色协作，把来源文档（PDF / DOCX / 网址 / Markdown） 转成高质量 SVG 页面并导出为 PPTX，产物是可在 PowerPoint 中直接编辑的演示文稿。 当用户要\"做 PPT\"、\"生成 PPT\"、\"制作演示文稿\"、\"create PPT\"、\"make presentation\"， 或提到 \"ppt-master\" 时使用。"
---

# PPT Master 技能

> AI 驱动的多格式 SVG 内容生成系统。通过多角色协作把来源文档转成高质量 SVG 页面，并导出为 PPTX。

**核心管线**：`来源文档 → 创建工程 → [模板] → 策略师 → [配图生成] → 执行器 → 质量检查 → 后处理 → 导出`

> [!CAUTION]
> ## 🚨 全局执行纪律（强制）
>
> **本流程是严格串行的管线。以下规则优先级最高——违反任何一条即视为执行失败：**
>
> 1. **串行执行** —— 各步骤必须按顺序执行，上一步的产物是下一步的输入。非 BLOCKING 的相邻步骤在前置条件满足后可连续推进，无需等用户说"继续"
> 2. **BLOCKING = 硬停** —— 标了 ⛔ BLOCKING 的步骤必须完全停下，等用户明确回应后才能继续，**绝不**替用户做决定
> 3. **禁止跨阶段打包** —— 禁止把多个阶段捆在一起做。（注意：Step 4 的八项确认是 ⛔ BLOCKING——AI 必须给出建议并等用户明确确认后才能继续；用户一旦确认，后续所有非 BLOCKING 步骤——设计规范输出、SVG 生成、讲者备注、后处理——都可自动连续推进，无需再次确认）
> 4. **进入前先验门** —— 每个 Step 顶部列了前置条件（🚧 GATE），开始该 Step 前必须先核验
> 5. **禁止投机执行** —— 禁止为后续 Step "提前准备"内容（例如在策略师阶段就写 SVG 代码）
> 6. **禁止子智能体生成 SVG** —— Step 6 执行器的 SVG 生成依赖完整上下文，必须由当前主智能体端到端完成，禁止派给子智能体
> 7. **逐页顺序生成** —— Step 6 执行器里，全局设计上下文确认后，SVG 页面必须一页接一页、单次连续生成，禁止分批（例如一次 5 页）
> 8. **每页重读 spec_lock** —— 生成每个 SVG 页前，执行器必须 `read_file <project_path>/spec_lock.md`。所有颜色 / 字体 / 图标 / 图片都必须取自该文件，禁止凭记忆或现场杜撰。执行器还必须查当前页的 `page_rhythm`（`anchor` / `dense` / `breathing`）、`page_layouts`（继承哪个模板 SVG，若有）、`page_charts`（套用哪个图表模板，若有）。空 / 缺省条目是策略师有意发出的信号——见 executor-base.md §2.1。本规则用于抵抗长 deck 上的上下文压缩漂移，并打破"每页都是卡片网格"的千篇一律
> 9. **SVG 必须手写，不可脚本批量生成** —— 每个 SVG 页都由主智能体逐页直接手写（见规则 6、7）。禁止编写或运行 Python / Node / shell 脚本去批量产出 SVG 文件——遍历页面、按数据套模板、用生成器吐出——即使打着"省 token""快速草稿""用户着急"的旗号也不行。脚本生成路线曾在一个特性分支上试过并被废弃：跨页视觉一致性依赖带完整上游上下文的逐页创作，生成器脚本复现不了

> [!CAUTION]
> ## 🖥️ 部署环境适配 —— blade-agent 无头沙盒（最高优先级）
>
> 本技能运行在 **blade-agent 的无头远程沙盒**中：没有图形界面、没有浏览器，**用户无法打开本技能在沙盒内启动的任何 localhost 网页服务**。以下规则覆盖正文中一切"启动网页服务并等待浏览器操作"的指令：
>
> - **A. Step 4 八项确认**：用 **`AskUserQuestion` 工具点选式确认**（见 Step 4），把八项推荐做成可点击选项让用户挑/改。**禁止执行 `confirm_ui/server.py`**（不要 `--daemon --wait`、不要起任何端口）。
> - **B. Step 6 实时预览**：**禁止执行 `svg_editor/server.py --live`（及普通模式）**。整体跳过 live-preview；用户通过 Step 7 导出的 `.pptx` 在 blade-agent 前端查看效果。需要确认视觉时走对话描述，不要起预览服务。
> - **C. 通用**：正文中任何"启动本地网页服务并等用户在浏览器里确认 / 标注 / 操作"的步骤一律跳过，把交互改到对话里完成（优先用 `AskUserQuestion`）。**绝不要启动并阻塞等待一个 localhost 网页 UI——用户够不到，只会死锁。**
> - **D. 配图：无文生图后端，禁止规划 AI 图位**：本环境**没有 AI 文生图（text-to-image）后端**（只有对话 LLM，生不了图），`image_gen.py` 在沙盒里无法产出任何图片——硬选 `ai` 只会留下"待生成"占位。因此：
>   - **禁止**在 Step 4 配图方式（第 8 项）规划 `ai`、**禁止**写 `Acquire Via: ai` 行、**禁止**写 `images/image_prompts.json`、**禁止**在 Step 5 调 `image_gen.py`。
>   - **默认配图走"图标化 / 内联矢量 / 数据图表"**：需要视觉元素时，由你在 SVG 里直接手绘矢量插画、用 `templates/icons/` 的图标、或套 `templates/charts/` 的图表模板——这些都靠当前 LLM 画出来，永远可用、无需任何后端。商务演示用图标 + 图表 + 排版通常比照片更专业可控。
>   - `web`（网络搜图，免密钥开放授权图源）仅在**用户明确要真实照片**时才用；占位 / 不用图 / 用户自带图始终可选。
>   - 因此 Step 4 配图那一项的 `AskUserQuestion` 选项**不要出现"AI 生成"**，默认推荐"图标化/矢量/图表"。

> [!IMPORTANT]
> ## 🌐 语言与沟通规则
>
> - **回复语言**：跟随用户的输入和来源材料。用户显式指定（如"请用英文回答"）优先。
> - **模板格式**：`design_spec.md` 必须沿用其原始英文模板结构（章节标题、字段名），无论对话语言是什么。字段的**取值**可以用用户的语言。

> [!IMPORTANT]
> ## 🔌 与通用编码技能的兼容
>
> - `ppt-master` 是一套专用工作流，不是通用应用脚手架
> - 默认不要创建 `.worktrees/`、`tests/`、分支流程或通用工程结构
> - 与通用编码技能冲突时，除非用户明确另有要求，否则以本技能为准

## 主管线脚本

| 脚本 | 用途 |
|--------|---------|
| `${SKILL_DIR}/scripts/source_to_md/pdf_to_md.py` | PDF 转 Markdown |
| `${SKILL_DIR}/scripts/source_to_md/doc_to_md.py` | 文档转 Markdown —— DOCX/HTML/EPUB/IPYNB 走原生 Python，旧格式（.doc/.odt/.rtf/.tex/.rst/.org/.typ）回退 pandoc |
| `${SKILL_DIR}/scripts/source_to_md/excel_to_md.py` | Excel 工作簿转 Markdown —— 支持 .xlsx/.xlsm；旧版 .xls 请先另存为 .xlsx |
| `${SKILL_DIR}/scripts/source_to_md/ppt_to_md.py` | PowerPoint 转 Markdown |
| `${SKILL_DIR}/scripts/source_to_md/web_to_md.py` | 网页转 Markdown（经 `curl_cffi` 支持微信） |
| `${SKILL_DIR}/scripts/project_manager.py` | 工程初始化 / 校验 / 管理 |
| `${SKILL_DIR}/scripts/analyze_images.py` | 图片分析 |
| `${SKILL_DIR}/scripts/latex_render.py` | LaTeX 公式渲染（manifest 驱动的 PNG 资源） |
| `${SKILL_DIR}/scripts/image_gen.py` | AI 配图生成（多供应商） |
| `${SKILL_DIR}/scripts/svg_quality_checker.py` | SVG 质量检查 |
| `${SKILL_DIR}/scripts/total_md_split.py` | 讲者备注拆分 |
| `${SKILL_DIR}/scripts/finalize_svg.py` | SVG 后处理（统一入口） |
| `${SKILL_DIR}/scripts/svg_to_pptx.py` | 导出为 PPTX |
| `${SKILL_DIR}/scripts/update_spec.py` | 把 `spec_lock.md` 的颜色 / 字体改动同步到所有已生成 SVG |

完整工具文档见 `${SKILL_DIR}/scripts/README.md`。

> **Windows 注意**：若 `python3 ...` 命令失败（python.org 安装常见，只提供 `python.exe` 而无 `python3.exe`），用 `python` 重跑同一命令。

## 模板索引

| 索引 | 路径 | 用途 |
|-------|------|---------|
| 版式模板 | `${SKILL_DIR}/templates/layouts/layouts_index.json` | 查可用的页面版式模板 |
| 品牌预设 | `${SKILL_DIR}/templates/brands/brands_index.json` | 查可用的品牌识别预设（颜色 / 字体 / logo / 语气） |
| 可视化模板 | `${SKILL_DIR}/templates/charts/charts_index.json` | 查可用的可视化 SVG 模板（图表、信息图、示意图、框架图） |
| 图标库 | `${SKILL_DIR}/templates/icons/` | 见 `${SKILL_DIR}/templates/icons/README.md`；按需用 `ls templates/icons/<library>/ \| grep <keyword>` 搜图标 |

## 独立工作流

| 工作流 | 路径 | 用途 |
|----------|------|---------|
| `topic-research` | `workflows/topic-research.md` | 管线前置 —— 用户只给主题、没有来源文件时，先抓网络素材 |
| `template-fill` | `workflows/template-fill-pptx.md` | 给一份原生 PPTX 模板 deck 加素材；挑合适的页（一页可复用给多张输出）并把文字回填，不走 SVG 转换 |
| `create-template` | `workflows/create-template.md` | 独立的版式模板创建流程 |
| `create-brand` | `workflows/create-brand.md` | 独立的纯品牌模板创建（识别预设；无 SVG 页面清单） |
| `resume-execute` | `workflows/resume-execute.md` | 阶段 B 入口 —— 阶段 A（Step 1–5）在另一会话完成后（split 模式），在新会话里恢复执行 |
| `verify-charts` | `workflows/verify-charts.md` | 图表坐标校准 —— deck 含数据图表时，在 SVG 生成后运行 |
| `customize-animations` | `workflows/customize-animations.md` | 对象级 PPTX 动画定制 —— 仅当用户明确要调动画顺序 / 效果 / 时序时运行 |
| `live-preview` | `workflows/live-preview.md` | 浏览器实时预览 —— **本环境禁用（见顶部部署适配 B）** |
| `visual-review` | `workflows/visual-review.md` | 逐页评分式视觉自检 —— 仅当用户明确要求对已生成 SVG 做视觉复检时运行。永不由主管线自动触发 |

---

## 工作流

### Step 1：来源内容处理

🚧 **GATE**：用户已提供来源材料（PDF / DOCX / EPUB / 网址 / Markdown 文件 / 文字描述 / 对话内容——任何形式均可）。

> **没有来源内容？** 当用户只给了一个主题名或要求、没有任何文件或实质描述时，先运行 [`topic-research`](workflows/topic-research.md) 工作流，再带着它的产物回到这里作为输入。

用户提供非 Markdown 内容时，立即转换：

| 用户提供 | 命令 |
|---------------|---------|
| PDF 文件 | `python3 ${SKILL_DIR}/scripts/source_to_md/pdf_to_md.py <file>` |
| DOCX / Word / Office 文档 | `python3 ${SKILL_DIR}/scripts/source_to_md/doc_to_md.py <file>` |
| XLSX / XLSM / Excel 工作簿 | `python3 ${SKILL_DIR}/scripts/source_to_md/excel_to_md.py <file>` |
| CSV / TSV | 直接当纯文本表格来源读取 |
| PPTX / PowerPoint deck | `python3 ${SKILL_DIR}/scripts/source_to_md/ppt_to_md.py <file>` |
| EPUB / HTML / LaTeX / RST / 其它 | `python3 ${SKILL_DIR}/scripts/source_to_md/doc_to_md.py <file>` |
| 网页链接 | `python3 ${SKILL_DIR}/scripts/source_to_md/web_to_md.py <URL>` |
| 微信 / 高防护站点 | `python3 ${SKILL_DIR}/scripts/source_to_md/web_to_md.py <URL>`（需 `curl_cffi`，已含在 `requirements.txt`） |
| Markdown | 直接读取 |

> **来自 DOCX/PPTX 的 Office 矢量素材（EMF/WMF）**：
> `doc_to_md.py` / `ppt_to_md.py` 会连同位图一起抽出内嵌的 Office 矢量图（.emf/.wmf）。
> `import-sources` 后，它们落在 `images/` 里，连同 `image_manifest.json`，
> 在 §VIII 图片资源清单里是一等资产。
>
> **不要把 EMF/WMF 转成 PNG。** PPT Master 管线把它们保留为外部引用
> （`finalize_svg.py` 跳过它们），`svg_to_pptx.py` 经 `image/x-emf` / `image/x-wmf`
> MIME 把它们嵌为 PPTX 原生媒体——PowerPoint 以完整矢量保真渲染。
> 经 LibreOffice/Inkscape 转换会引入中文字体替换漂移和栅格化损失；原始 EMF/WMF 始终比转出的 PNG 更保真。
>
> 浏览器实时预览渲染不了 EMF（会显示空白）——这是预期；PPTX 输出才是准绳。

**✅ 检查点 —— 确认来源内容就绪，进入 Step 2。**

---

### Step 2：工程初始化

🚧 **GATE**：Step 1 完成；来源内容就绪（Markdown 文件、用户给的文字、或对话里描述的需求均有效）。

```bash
python3 ${SKILL_DIR}/scripts/project_manager.py init <project_name> --format <format>
```

格式选项：`ppt169`（默认）、`ppt43`、`xhs`、`story` 等。完整格式列表见 `references/canvas-formats.md`。

> 工程建在 `<当前工作目录>/projects/<project_name>/`，下文 `<project_path>` 即指这个目录。

导入来源内容（按情况选）：

| 情况 | 操作 |
|-----------|--------|
| 有来源文件（PDF/MD/等） | `python3 ${SKILL_DIR}/scripts/project_manager.py import-sources <project_path> <source_files...> --move` |
| 用户在对话里直接给了文字 | 无需导入——内容已在对话上下文里，后续步骤可直接引用 |

> ⚠️ **必须用 `--move`**（不是 copy）：所有来源文件——Step 1 生成的 Markdown、原始 PDF / MD / 图片——经 `import-sources --move` 进 `sources/`。执行后它们不再在原位置。中间产物（如 `_files/`）自动处理。

**✅ 检查点 —— 确认工程结构创建成功、`sources/` 含所有来源文件、转换素材就绪。进入 Step 3。**

---

### Step 3：模板选项

🚧 **GATE**：Step 2 完成；工程目录结构就绪。

**默认 —— 自由设计。** 直接进 Step 4。除非被触发，否则不要查任何 `*_index.json`。不要问用户。不要基于内容、像 slug 的词、或模糊风格描述去主动建议 / 暗示 / 模糊匹配任何模板。

**模板流程仅在用户初始消息里给出明确目录路径时触发。** 触发规则是机械的，不做解读：

| 用户输入包含 | Step 3 操作 |
|---|---|
| 一个或多个明确的模板目录路径（每个都解析到一个含 `design_spec.md` 的目录，其 YAML frontmatter 里 `kind: brand` / `kind: layout` / `kind: deck`） | 读每份 spec 的 `kind`，按下方 kind 矩阵分派，多个则融合 |
| 其它任何情况 —— 裸模板名（"用 academic_defense"）、风格描述（"麦肯锡风格"）、品牌提及（"招商银行风格"）、模糊意图（"想用个模板"）、或沉默 | 跳过 Step 3，自由设计 |

没有 slug 匹配、没有按名查找、没有模糊解析。光有名字没有路径不触发——用户必须给一个 AI 能 `cd` 进去的路径。

> 风格描述（"麦肯锡风格" / "Keynote 风" / "极简风" 等）永不触发 Step 3。它们作为风格简报流入策略师的八项确认（确认项 e–g 的颜色 / 字体 / 语气）。

> 裸名字（"academic_defense"、"招商银行"、"anthropic"）即使库里有同名目录也**不**触发 Step 3。用户必须给路径。AI 不要"热心地"把名字解析成路径。

> "有哪些模板？"是题外问答 —— 通过列出 `brands_index.json` / `layouts_index.json` / `decks_index.json` 的条目连同路径来回答。光列出不推进管线；用户必须回传一个路径才触发 Step 3。

> 要创建新版式或 deck，读 [`workflows/create-template.md`](workflows/create-template.md)。要创建新品牌，读 [`workflows/create-brand.md`](workflows/create-brand.md)。

#### 三种模板 kind

架构有三组独立的参考包。完整 schema 见 [`docs/zh/templates-architecture.md`](../../docs/zh/templates-architecture.md)。概要：

| Kind | 物理目录 | 包含 | Frontmatter |
|---|---|---|---|
| **brand** | `templates/brands/<id>/` | 仅识别段：颜色 / 字体 / logo / 语气 / 图标风格 | `kind: brand` |
| **layout** | `templates/layouts/<id>/` | 仅结构段：画布 / 页面结构 / 页面类型 / SVG 清单 | `kind: layout` |
| **deck** | `templates/decks/<id>/` | 完整复刻：识别 + 结构 + 中段（模板总览） | `kind: deck` |

**段归属**（决定融合时的覆盖优先级）：

| 段 | 章节 | 融合时归属 kind |
|---|---|---|
| 识别 | 配色 / 字体 / Logo / 语气 / 图标风格 | brand |
| 结构 | 画布 / 页面结构 / 页面类型 / SVG 清单 | layout |
| 中段 | 模板总览（用例 / 设计意图） | deck（其它 kind 不写这段） |

#### 单路径分派

| 用户路径的 `kind` | Step 3 操作 |
|---|---|
| `kind: brand` | 把 `design_spec.md` + logo 文件 + 资产子目录（`images/` / `illustrations/` / `icons/`）拷进 `<project>/templates/`。策略师锁定识别段为准；结构保持自由。 |
| `kind: layout` | 把 `design_spec.md` + SVG 清单 + 资产文件拷进 `<project>/templates/`。策略师锁定结构；识别在八项确认 e–g 决定。 |
| `kind: deck` | 全部拷贝（`design_spec.md` + SVG + logo + 资产）进 `<project>/templates/`。策略师锁定所有段；八项确认收窄到 deck 内容字段（受众 / 页数 / 大纲 / 语气微调）。 |

```bash
TEMPLATE_DIR=<user-supplied path>
cp -r ${TEMPLATE_DIR}/* <project_path>/templates/
```

这一行拷贝对三种 kind 都够了——spec 的 `kind` 字段告诉策略师怎么读它；下游代码不区分。

#### 多路径融合

用户给两个或更多**不同 kind** 的路径时，Step 3 把它们融成单一 `<project>/templates/design_spec.md`。**默认粒度是段级整体替换**——整个识别 / 结构 / 中段取自该段优先级最高的来源，不做隐式字段级混合。

按段的覆盖优先级：

| 组合 | 识别来自 | 结构来自 | 中段来自 |
|---|---|---|---|
| 仅 brand | brand | （自由设计） | （无） |
| 仅 layout | （自由设计） | layout | （无） |
| 仅 deck | deck | deck | deck |
| brand + layout | brand | layout | （无） |
| brand + deck | brand（覆盖 deck） | deck | deck |
| layout + deck | deck | layout（覆盖 deck） | deck |
| brand + layout + deck | brand | layout | deck |

字段级微调（如"用 anthropic 品牌但 primary 改成 #FF0000"）**不**属于 Step 3 融合——它作为普通用户请求流入策略师八项确认 e–g。

#### 同 kind 多路径 —— 冲突解决

用户给两个**同 kind** 路径（如 `brands/anthropic` + `brands/google`）时，Step 3 在融合前抛一个冲突提示——像解 git 合并冲突：

```
AI: 你给了两个 brand，检测到段级冲突：
    - Color Scheme（Anthropic 橙红 vs Google 多色）
    - Typography（Styrene/AnthropicSans vs GoogleSans/Roboto）
    - Logo（Anthropic 标 vs Google 标）
    - Voice & Tone（restrained vs friendly）
    - Icon Style（stroke vs filled）

    要 (a) 全部按 Anthropic / (b) 全部按 Google / (c) 逐段挑？
```

规则：
- 默认：无隐式排序——每个跨来源段差异都报为冲突
- 仅当用户选 `(c)` 时，AI 才逐段过一遍
- 字段级冲突超出范围——只到段级
- 不支持三个及以上同 kind 路径——请用户收敛到最多两个

#### 融合 spec 的来源标注

发生融合时（任何多路径情况），产出的 `<project>/templates/design_spec.md` 在其 H1 正下方带一个来源标注块：

```markdown
> **Fused from:**
> - deck: `templates/decks/招商银行/` （base）
> - brand: `templates/brands/anthropic/` （identity override）
> - layout: `templates/layouts/academic_defense/` （structure override）
> - conflicts resolved: Color Scheme from anthropic（user picked a）
```

单路径 Step 3 **不**加来源标注（来源从拷贝的文件就一目了然）。

**✅ 检查点 —— 默认路径无需用户交互即进 Step 4。若用户给了一个或多个明确模板路径，它们已在推进前分派（或融合）进 `<project_path>/templates/`。**

---

### Step 4：策略师阶段（强制——不可跳过）

🚧 **GATE**：Step 3 完成；走了默认自由设计路径，或（若触发）模板文件已拷入工程。

先读角色定义：
```
Read references/strategist.md
```

> ⚠️ **强制门**：写 `design_spec.md` 前，策略师必须 `read_file templates/design_spec_reference.md` 并遵循其完整的 I–XI 章节结构。见 `strategist.md` 第 1 节。

**八项确认**（完整模板：`templates/design_spec_reference.md`）：

⛔ **BLOCKING**：把八项确认作为一组呈现，**等用户明确确认或修改**后，才输出设计规范与内容大纲。这是唯一的核心确认点——一旦确认，后续所有步骤自动推进。

1. 画布格式
2. 页数范围
3. 目标受众
4. 风格目标
5. 配色方案
6. 图标使用方式
7. 字体方案（含公式渲染策略）
8. 配图使用方式（⚠️ 本环境无文生图后端，**不要选 `ai`**；默认走图标化 / 内联矢量 / 数据图表，详见顶部部署适配 D）

**用 `AskUserQuestion` 点选式确认（本环境默认确认方式 —— 强制）**：策略师先为这八项各自拟好推荐值，然后用 `AskUserQuestion` 工具把它们做成可点击的选项让用户确认，**不要**用 `confirm_ui/server.py` 网页、也不要只丢一段纯文字让用户打字。做法：

1. **先想清楚推荐**：策略师照常为八项各拟一个推荐值；生成类字段（配色、字体、生成图风格）各准备 2–3 个候选方案（如配色给"暖色商务 / 冷色科技 / 黑白极简"三套；字体给两三个中西文搭配）。
2. **用 `AskUserQuestion` 分批问**：每个工具调用最多 4 个问题，所以八项分成两批（4 + 4）问完。每个问题对应一项确认；**第一个选项放策略师的推荐值，标注"（推荐）"**，再给 1–2 个备选。用户可直接点推荐、点备选、或用自动出现的"其他"自己填（页数、受众这类自由值就靠"其他"输入，或给几个常见档位当选项）。
3. **这两批连着问完，算作那一次 ⛔ BLOCKING 确认**。问完即拿到用户对八项的选择，无需再让用户打字复述。
4. 若用户在对话里直接用文字给了确认或修改（没等你问），也照单接收，等价于点选结果。

> 选项文案用页面 / 用户的语言。生成类字段的候选要让用户看得懂在选什么（例如配色候选给出主色描述），沿用 strategist.md h.5 的候选思路。

**尊重确认结果（用户的选择优先 —— 强制）**：用户选定的值在你写 `design_spec.md` / `spec_lock.md` 时**覆盖你自己的推荐**。用户改了哪个字段就是有意改的。特别地，把 `image_usage`（配图使用方式）映射到 §VIII 的 `Acquire Via`（取值名与确认项不同，需翻译）：

| 确认的配图方式 | §VIII `Acquire Via` | h.5 + Step 5 生成 |
|---|---|---|
| `ai`（或含 AI 的自定义方案） | `ai` 行 | 跑 h.5（锁定渲染 + 配色）；Step 5 生成 |
| `web` | `web` 行 | 无 |
| `provided`（用户已提供） | **`user`** 行 | 无——绝不生成 |
| `placeholder`（占位） | `placeholder` 行 | 无 |
| `none`（不用图） | 无图片行（§h 选项 A） | 无 |

当确认的配图方式不是 `ai`（且方案无 AI 部分）时，**不要**跑 h.5、**不要**写 `ai` 行、**不要**在 Step 5 生成图片——无论你之前推荐了什么。"确认值优先"对每个字段都成立（颜色 → §III，字体 → §IV，等等）。

策略师始终是每条推荐的作者；确认只是确认面，不生成内容。

**强制 —— split 模式提示**（不是第九项确认）：列完八项确认细节后，必须追加恰好一行（用用户的语言，以 💡 开头）说明生成模式。按对阶段 A 信号（推荐页数、来源材料体量、`topic-research` 是否跑了且累积了大量网页抓取）的定性判断挑变体：

| 信号判断 | 该行内容 |
|---|---|
| 重（页数长 / 来源大 / 网页抓取累积多） | 说明预估页数和来源体量大；建议 Step 5 后切到 [split 模式](workflows/resume-execute.md)——结束本会话、开新窗口、输入 `继续生成 projects/<project_name>` 进入阶段 B（SVG 生成 + 导出）；不回应或回"继续"= 默认连续模式。 |
| 普通（默认） | 说明规模适中、默认连续模式一气呵成；若想中途切窗口，Step 5 后输入 `继续生成 projects/<project_name>` 切到 [split 模式](workflows/resume-execute.md)。 |

这行每次都要输出——用户必须始终看到模式选择的存在。是否采用由用户定。

**强制 —— spec 精修提示**（不是第九项确认）：在 split 模式那行之后，必须追加一行 opt-in 提示（用用户的语言，以 💡 开头），告诉用户可以**先精修 spec**——策略师产出完整设计规范后，停下来供用户审阅 / 修改其中任何部分，再开始任何生成，经 [refine-spec](workflows/refine-spec.md) 工作流。默认关闭：无请求 → spec 一次写完、管线照常自动推进。仅当用户在对话里明确要求（如"先精修一下 spec"）才让 [refine-spec](workflows/refine-spec.md) 工作流在八项确认后接管。这行和 split 模式那行一样每次必出——用户须看到选择存在；是否采用由用户定。

**公式渲染策略在第 7 项（字体方案）里**：

| 策略 | 行为 |
|---|---|
| `mixed`（默认） | 策略师把值得做公式的复杂表达式渲成 PNG 资源；简单的行内表达式保留为可编辑文本 / Unicode |
| `render-all` | 策略师把每个值得做公式的表达式都渲成 PNG 资源 |
| `text-only` | 不渲染公式；公式保留为可编辑文本 / Unicode |

八项确认通过后、**输出 `design_spec.md` / `spec_lock.md` 之前**，若确认的公式策略是 `mixed` 或 `render-all` 且内容含值得做公式的表达式，策略师必须：

1. 识别显式 LaTeX 及任何应忠实结构化为公式的源表达式。
2. 写 `<project_path>/images/formula_manifest.json`，只放选中要渲染的公式。
3. 运行：
   ```bash
   python3 ${SKILL_DIR}/scripts/latex_render.py <project_path>
   ```
4. 把渲出的公式 PNG 作为 `Acquire Via: formula`、`Status: Rendered`、`Type: Latex Formula` 行写进 `design_spec.md §VIII Image Resource List`；也在 `spec_lock.md images` 里列出并标 `| no-crop`。

公式渲染器默认用供应商回退链：`codecogs,quicklatex,mathpad,wikimedia`。前三个支持配色；Wikimedia 是可用性兜底。公式 PNG 默认透明：manifest 的 `background` 是临时渲染底和去透明参考，除非给该项设了 `transparent: false`，否则不作为保留的最终背景。不要在 `spec_lock.md` 里扫 `$...$` 或 `$$...$$`。源材料里的美元符号数学只是给策略师的信号；渲染器消费的是显式 manifest。

若用户提供了图片或渲染了公式 PNG，在**输出设计规范之前**跑分析：
```bash
python3 ${SKILL_DIR}/scripts/analyze_images.py <project_path>/images
```

> ⚠️ **图片处理**：绝不直接读 / 打开 / 查看图片文件（`.jpg`、`.png` 等）。所有图片信息来自 `analyze_images.py` 输出或设计规范的图片资源清单。

**输出**：
- `<project_path>/design_spec.md` —— 人类可读的设计叙述
- `<project_path>/spec_lock.md` —— 机器可读的执行契约（骨架：`templates/spec_lock_reference.md`）；执行器每页生成前重读

**✅ 检查点 —— 阶段交付完成，自动进入下一步**：
```markdown
## ✅ 策略师阶段完成
- [x] 八项确认完成（用户经 AskUserQuestion 点选或对话确认）
- [x] split 模式提示已追加在八项下方（重 / 普通变体）
- [x] spec 精修 opt-in 行已追加（默认关闭；仅用户明确请求才进 refine-spec）
- [x] 设计规范与内容大纲已生成
- [x] 执行锁（spec_lock.md）已生成
- [ ] **下一步**：自动进入 [配图生成 / 执行器] 阶段
```

---

### Step 5：配图获取阶段（条件性）

🚧 **GATE**：Step 4 完成；设计规范与内容大纲已生成并经用户确认。任何公式行已是 `Acquire Via: formula` 且 `Status: Rendered`。

> **触发**：资源清单里至少有一行是 `Acquire Via: ai` 和/或 `Acquire Via: web`。若每行都是 `user`、`formula`、`placeholder`，跳到 Step 6。

**始终加载通用框架**：

```
Read references/image-base.md
```

然后按需**懒加载各路径专属参考**（仅当真有对应行时）：

| Acquire Via | 加载参考（仅当有此类行时） | 运行 |
|---|---|---|
| `ai` | `references/image-generator.md` | `python3 ${SKILL_DIR}/scripts/image_gen.py --manifest <project_path>/images/image_prompts.json` |
| `web` | `references/image-searcher.md` | `python3 ${SKILL_DIR}/scripts/image_search.py ...` |
| `user` / `placeholder` | （跳过） | （跳过） |

只有 `ai` 行的 deck 永不加载 `image-searcher.md`；只有 `web` 行的永不加载 `image-generator.md`。混合 deck 两者都加载，各行走各自路径，同时写 `image_prompts.json` 和 `image_sources.json`。

> ⚠️ **管线内 ai 路径必须用 manifest 模式**——即使只有 1 个 ai 行。先写 `images/image_prompts.json`，再跑 `image_gen.py --manifest`，再 `image_gen.py --render-md` 产出 `image_prompts.md` 边车文件。位置参数形式（`image_gen.py "prompt" ...`）保留给**管线外的一次性测试 / 单图修补**——它跳过 manifest + 边车，不留审计痕迹。

工作流：

1. 从设计规范抽出所有 `Status: Pending` 且 `Acquire Via ∈ {ai, web}` 的行
2. 按 [image-base.md](references/image-base.md) §2 分派表生成提示词（ai 行）和/或跑搜索（web 行）
3. 校验每行抵达终态：`Generated`（ai 成功）、`Sourced`（web 成功）、或 `Needs-Manual`

**✅ 检查点 —— 确认每行都已尝试获取**：
```markdown
## ✅ 配图获取阶段完成
- [x] image_prompts.json 已建（处理了 ai 行时）
- [x] image_prompts.md 边车已渲染（处理了 ai 行时）
- [x] image_sources.json 已建（处理了 web 行时）
- [x] 每行状态为 `Generated` / `Sourced` / `Needs-Manual`（无 `Pending` 残留）
```

**默认 —— 自动进 Step 6。** 仅当用户在 Step 4 明确选了 split 模式（对话里或 AskUserQuestion 选择了 split），才输出下面的阶段 A 交接并停止本会话：

  ```markdown
  ## ✅ 阶段 A 完成
  - [x] 规范：`design_spec.md`、`spec_lock.md`
  - [x] 资源：`sources/`、`images/`、`templates/`
  - [ ] **下一步**：开新对话窗口、输入 `继续生成 projects/<project_name>`，经 [`resume-execute`](workflows/resume-execute.md) 工作流进入阶段 B。
  ```

> 获取失败时不要停——按 [image-base.md](references/image-base.md) §5 的失败处理规则：重试一次，然后把该行标 `Needs-Manual`，报告用户，继续到上面的检查点。

---

### Step 6：执行器阶段

🚧 **GATE**：Step 4（及触发时的 Step 5）完成；所有前置交付就绪。

按本 deck 锁定的 `mode` + `visual_style`（来自 `spec_lock.md`）读执行参考：
```
Read references/executor-base.md                  # 必读：通用准则
Read references/shared-standards.md               # 必读：SVG/PPT 技术约束
Read references/modes/<locked-mode>.md            # 叙事骨架（spec_lock.md `mode`）
Read references/visual-styles/<locked-style>.md   # 美学（spec_lock.md `visual_style`）
```

> 读 executor-base + shared-standards + 那一个锁定的 mode 文件 + 那一个锁定的 visual-style 文件。`mode: custom` 或 `visual_style: custom` 时，跳过该预设文件，改follow `spec_lock.md` 里的 `mode_behavior` / `visual_style_behavior`。永不 glob `modes/` 或 `visual-styles/`。

**设计参数确认（强制）**：第一个 SVG 前，输出 spec 里的关键设计参数（画布尺寸、配色、字体方案、正文字号）。见 executor-base.md §2。

**实时预览 —— 本环境跳过**：blade-agent 无头沙盒里**不要**执行 `svg_editor/server.py`（见顶部部署适配 B）。用户够不到沙盒内的 localhost 页面，起它只会死锁。视觉效果由 Step 7 导出的 `.pptx` 在 blade-agent 前端查看；需要确认视觉时走对话描述。

**生成前批量读取（强制）**：第一个 SVG 前，批量读取 `spec_lock.page_layouts` 引用的每个不同版式 SVG、以及 `spec_lock.page_charts` 引用的每个不同图表 SVG（加任何 §VII 备用图表）。每文件读一次、一次性读完——页面生成期间不要重读。见 executor-base.md §1.0。

**每页重读 spec_lock（强制）**：**每个** SVG 页前，`read_file <project_path>/spec_lock.md`，只用其中的颜色 / 字体 / 图标 / 图片，加每页的 `page_rhythm` / `page_layouts` / `page_charts` 查询（解析到上面批量读过的模板 SVG）。抵抗长 deck 的上下文压缩漂移。见 executor-base.md §2.1。

> ⚠️ **只限主智能体**：SVG 生成必须留在当前主智能体——页面设计依赖完整上游上下文。不要派给子智能体。
> ⚠️ **生成节奏**：逐页顺序生成、一次一页、在同一连续上下文里。不要分批（如一组 5 页）。

**视觉构建阶段**：逐页顺序、一次一页、单次连续生成 SVG → `<project_path>/svg_output/`

**质量检查门（强制）** —— 所有 SVG 之后、标注处理和讲者备注之前：
```bash
python3 ${SKILL_DIR}/scripts/svg_quality_checker.py <project_path>
```
- 任何 `error`（禁用的 SVG 特性、viewBox 不匹配、spec_lock 漂移等）必须先修再继续——回到视觉构建、重生成那页、重跑检查。
- `warning` 条目（低分辨率图、非 PPT 安全字体尾巴等）：能直接修就修，否则确认后放行。
- 对 `svg_output/` 跑（不是在 `finalize_svg.py` 之后——finalize 会重写 SVG 并掩盖违规）。

**逻辑构建阶段**：生成讲者备注 → `<project_path>/notes/total.md`

**✅ 检查点 —— 确认所有 SVG 和备注完整生成并通过质检。直接进 Step 7 后处理**：
```markdown
## ✅ 执行器阶段完成
- [x] 所有 SVG 已生成到 svg_output/
- [x] svg_quality_checker.py 通过（0 错误）
- [x] 讲者备注已生成于 notes/total.md
```

> **有图表页？** 若本 deck 含数据图表（柱 / 线 / 饼 / 雷达等），在 Step 7 前跑独立的 [`verify-charts`](workflows/verify-charts.md) 工作流校准坐标。AI 模型把数据映射到像素位置时常引入 10–50 px 误差；verify-charts 消除这类误差。无图表页则跳过。

> **视觉自检（opt-in）？** 若用户明确要求对 SVG 做逐页视觉复检（"跑一下视觉自检 / 视觉回看"、"visual review"、"check pages visually" 等），在 Step 7 前跑独立的 [`visual-review`](workflows/visual-review.md) 工作流。默认不跑，也不要基于推测的模型能力或 deck 大小去推荐——仅用户请求才触发。

---

### Step 7：后处理与导出

🚧 **GATE**：Step 6 完成；所有 SVG 已生成到 `svg_output/`；讲者备注 `notes/total.md` 已生成。

🚧 **图片就绪门**（当 Step 5 把 ai 行留在 `Needs-Manual` 时）：跑 7.1 前，每个预期文件必须存在于 `project/images/<filename>`。

> 若文件缺失：暂停，列出缺失的文件名，指引用户看 `images/image_prompts.md`（每个 `### Image N:` 块可直接粘给 ChatGPT / Gemini / Midjourney，由 `image_prompts.json` 自动生成）和所需放置位置 `project/images/<filename>`。所有预期文件到位后才恢复 Step 7.1。`finalize_svg.py` 和 `svg_to_pptx.py` 不在这层检测缺失文件——带缺口推进会产出图片引用断裂的 deck。

> ⚠️ 三个子步骤**一个一个**跑——每个成功后才下一个。
> ❌ **绝不**把它们合进单个代码块或一次 shell 调用。

标准三命令管线（对应 `references/shared-standards.md` §5）：

**Step 7.1** —— 拆分讲者备注：
```bash
python3 ${SKILL_DIR}/scripts/total_md_split.py <project_path>
```

**Step 7.2** —— SVG 后处理（图标内嵌 / 图片裁剪与内嵌 / 文本扁平化 / 圆角矩形转 path）：
```bash
python3 ${SKILL_DIR}/scripts/finalize_svg.py <project_path>
```

**Step 7.3** —— 导出 PPTX（默认内嵌讲者备注）：
```bash
python3 ${SKILL_DIR}/scripts/svg_to_pptx.py <project_path>
# 输出（默认流程模式）：
#   exports/<project_name>_<timestamp>.pptx           ← 原生 pptx（标准产物，读 svg_output/）
#   backup/<timestamp>/svg_output/                    ← 执行器 SVG 源备份（始终写）
#
# 加 --svg-snapshot 可在原生 pptx 旁额外产出 SVG 图片版预览 pptx：
#   exports/<project_name>_<timestamp>_svg.pptx      ← SVG 预览 pptx（读 svg_final/）
```

> 原生 pptx 直接消费 `svg_output/`，让转换器保留高保真原语（图标 `<use>` 占位、图片 `preserveAspectRatio` → `srcRect`、圆角矩形 `rx/ry` → `prstGeom roundRect`）。`backup/<timestamp>/` 里的 `svg_output/` 快照始终写，这样工程可从冻结的 SVG 源重新导出而无需重跑 LLM。SVG 渲染的预览 pptx 经 `--svg-snapshot` opt-in——一般不需要，仅当你想要个自包含文件去分享时才用。需要强制单一来源时传 `-s output` 或 `-s final`。

> **段落可编辑性 vs 行保真** —— 默认情况下，可合并的 dy 堆叠段落块会折叠成一个含多个 `<a:p>` 的可编辑 PowerPoint 文本框，改善正文编辑与缩放/重排行为。仅当用户明确要求严格行版式保真、或某个版式紧凑的页必须让每个 dy 堆叠行各自成框时，才加 `--no-merge`。合并检测保守；混合版式文本会回退到逐行成框。

**Step 7.4** —— 把成品 pptx 放到工作区根目录（强制，便于用户查找）：

导出后的原生 pptx 默认埋在 `projects/<project_name>/exports/` 深处，用户不好找。导完必须把它复制到**工作区根目录**（即 `projects/` 的父级、当前工作目录），并用演示文稿标题命名：

```bash
cp "projects/<project_name>/exports/<project_name>_<timestamp>.pptx" "<演示文稿标题>.pptx"
```

- 用 Step 7.3 输出里打印的真实文件名（含时间戳）作为来源；目标文件名用一个干净、用户看得懂的中文标题（如 `公司远程办公政策.pptx`），不要带时间戳。
- 完成后明确告诉用户：成品 pptx 就在工作区根目录的 `<演示文稿标题>.pptx`，可直接下载、用 PowerPoint 打开并编辑。
- `exports/` 下的原文件保留不动（作为带时间戳的归档）。

**可选动画参数**（默认已启用丰富的入场动画——仅当用户要不同效果时才调）：
- `-t <effect>` —— 翻页转场。默认 `fade`。选项：`fade` / `push` / `wipe` / `split` / `strips` / `cover` / `random` / `none`。
- `-a <effect>` —— 每元素入场动画。默认 `auto`（按 group id 映射：chart→wipe，card-/step-/pillar-→fly，title/takeaway→fade；图片类 id `hero` / `figure-` / `image` / `img-` / `kpi` 轮换更丰富的池——zoom / dissolve / circle / box / diamond / wheel——让多张图在 deck 里有变化）。传 `none` 禁用、传具体效果如 `fade`、或 `mixed` 走旧版 16 效果轮换。需要顶层 `<g id="...">` group（执行器已要求）。
- `--animation-trigger {on-click,with-previous,after-previous}` —— 启动方式（对应 PowerPoint 动画窗格的 Start 下拉）。默认 `after-previous`（免点击级联；用 `--animation-stagger` 控节奏）。演讲者按节奏揭示用 `on-click`，全部一起出用 `with-previous`。
- `--animation-config <path>` —— 可选的对象级边车。默认：存在时取 `<project_path>/animations.json`。
- `--auto-advance <seconds>` —— 自助机式自动播放。

**可选自定义动画**（仅当用户要为特定对象调动画顺序 / 效果 / 时序时）：

跑独立的 [`customize-animations`](workflows/customize-animations.md) 工作流。默认导出已有全局入场动画；除非要对象级定制，否则不要创建 `animations.json`。

**可选录制旁白**（仅当用户要带旁白 / 视频导出时）：

跑独立的 [`generate-audio`](workflows/generate-audio.md) 工作流。AI 选一个旁白后端（默认 `edge`，或已配置的云供应商如 ElevenLabs / MiniMax / Qwen / CosyVoice 做高质量或克隆音色），向用户问一次（后端 + 音色 + 语速/设置 + 是否内嵌，都带推荐值），再执行 `notes_to_audio.py` 并（若选了）以 `--recorded-narration audio` 重导出 PPTX。

不要绕过工作流直接调 `notes_to_audio.py`——`--voice` / `--voice-id` 是必填，工作流会产出感知地区/供应商的推荐，让选择有意义。

完整效果列表、锚点逻辑和限制：[`references/animations.md`](references/animations.md)。

> ❌ **绝不**用 `cp` 替代 `finalize_svg.py`——finalize 做了多个关键处理步骤
> ❌ **绝不**为旧版/预览 pptx 强制 `-s output`（PowerPoint 内部 SVG 解析器会丢图标和圆角）。默认自动分流已给原生版它需要的高保真源，不动旧版。
> ❌ **绝不**用 `--only`（它会压掉两个输出文件之一）

---

## 角色切换协议

切换角色前，**必须先读**对应的参考文件。输出标记：

```markdown
## [Role Switch: <Role Name>]
📖 Reading role definition: references/<filename>.md
📋 Current task: <brief description>
```

---

## 参考资源

| 资源 | 路径 |
|----------|------|
| 共享技术约束 | `references/shared-standards.md` |
| 画布格式规范 | `references/canvas-formats.md` |
| 图文版式范式（主结构 + 修饰层——可自由组合） | `references/image-layout-patterns.md` |
| 图文版式尺寸（并排容器尺寸的算法） | `references/image-layout-spec.md` |
| SVG 图片内嵌 | `references/svg-image-embedding.md` |
| 图标库 | `templates/icons/README.md` |

---

## 备注

- **故障排查**：生成出问题（版式溢出、导出错误、空白图片等）时，查 `docs/faq.md` 的已知解法
