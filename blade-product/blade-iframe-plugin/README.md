# Blade iframe 插件

独立于 `blade-service-deployer` 的现场插件。把已经部署好的 Blade Agent / Blade Hub 变成可被 Vue 或其他宿主页面跨站 iframe 嵌入，并通过 `postMessage` 传递 BO Access Token，不依赖第三方 Cookie，也不需要重建镜像或改部署包。

适用对象：现场已经跑起来的 `box-ba`、`box-bh`。

## 它解决什么

宿主页面和 BA/BH 不同源时，iframe 里原来的 Cookie 登录会失败。本插件在 BA/BH 前端注入认证桥：

1. iframe 向宿主发送 `blade-embed-ready`
2. 宿主回传 `{ type: "blade-embed-token", token: "<JWT>" }`
3. 桥接脚本拦截同源 `/api` 和 `/socket.io` 请求，自动加 `Authorization: Bearer`
4. Token 只留在 iframe 内存，不写 Cookie

界面适配（v1.1.0 起）：**只隐藏品牌 logo 和左下角账号的用户名，不改任何配色**。

- v1.1.1：不再整块隐藏底部区域。账号按钮的弹层里有「设置 / 我的记忆 / 切换到深色模式 /
  退出登录」，整块隐藏会把设置入口一起藏掉，改为只抹掉用户名文本。
- v1.1.2：把圆圈里的用户名首字母替换为齿轮图标（内联 SVG，`stroke: currentColor`
  跟随圆圈前景色）。用户已上传头像时不动。

> v1.1.0 变更：移除了之前所有配色/主题改动（青黑主题 `#001922`/`#00ffff`、强制
> `dark` class、BH 背景注入、mermaid 重绘等）。界面颜色完全交还产品自身。
> 隐藏逻辑也从 `iframe-auth-bridge.js` 里拆出为独立的 `files/theme.js`
> （部署名 `blade-ui-slim.js`），因为原先它跟着 bridge 走，而 bridge 在非嵌入态
> 会直接 return，导致直链访问时 logo/账号根本没被隐藏。

## 一键免登录链接（v1.1.6+，BA / BH 通用）

给客户集成最省事的一种：**客户侧零改动**，只挂一条链接。

```text
http://<SERVER>:8020/autologin.html?token=<BO Access Token>
http://<SERVER>:8020/autologin.html?token=<BO Access Token>&refresh_token=<refresh>

http://<SERVER>:8010/autologin.html?token=<BO Access Token>&next=/skills   # 能力中心
```

用户点下去 → 自动种会话 Cookie → 抹掉地址栏 token → 探活 → 跳进 `/chat`。
**不出现登录页**。也可以直接把这条链接放进 iframe。

原理：BA 登录态就是 Cookie `blade_token`，**Cookie 按主机共享、不分端口**，
`:8020` 与 `:8010` 都认；`autologin.html` 是纯前端页面，v1.1.7 起 BA、BH 都部署。

| 参数 | 必填 | 说明 |
|---|---|---|
| `token` | 是（与 refresh 至少一项） | BO Access Token（JWT）。本环境 10000 小时（约 416 天） |
| `refresh_token` | 可选 | 刷新令牌，同为本环境 10000 小时 |
| `next` | 否 | 跳转路径，默认：BA=`/chat`，BH=`/`。嵌能力中心建议 `&next=/skills` |

令牌有效期可在 BO 侧调整，注意**应用级覆盖优先于全局默认**，详见
`使用手册.md` 第 5.1 节。

安全边界与完整说明见 `给客户的接入说明-免登录直连.md`。
## URL 直接带 token（v1.0.9+ / BH 自 v1.1.7）

除了 iframe 嵌入与 `autologin.html`，还支持把 token 直接附在页面地址上：

```text
http://<SERVER>:8020/chat?token=<BO Access Token>
http://<SERVER>:8010/skills?mode=embed&token=<BO Access Token>        # 能力中心
http://<SERVER>:8010/?token=<BO Access Token>                          # 能力中心首页
```

打开即进工作台 / 能力中心，不需要宿主页面。原理见 `files/url-token-auth.js`：
BA 与 BH 前端都只认会话 Cookie（启动时 `/api/auth/me` 不带 Authorization，401 就跳 OAuth），
但两者**后端**都接受 `?token=` 与 `Bearer`（BH 已实测）。本脚本在 app bundle 之前注入，给同源
`/api`、`/socket.io` 请求补上 `Authorization: Bearer`，并用 `replaceState`
把 token 从地址栏抹掉。

行为边界（已实测）：

| 场景 | 结果 |
|---|---|
| `?token=<有效>` | 免登录进工作台，地址栏 token 被抹掉 |
| `?token=<无效>` | `/api/auth/me` 返回 401 → 自动停止注入 → 正常跳登录页，**不会死循环** |
| 不带 token | 脚本直接 return，fetch/XHR 完全不接管，行为与未装插件时一致 |
| iframe 嵌入态 | 脚本跳过，仍走 `blade-embed-token` 桥接 |
| `?token=<API Key（sk-blade-…）>` | 界面能进，但 socket.io 握手失败（实时对话不通）。**要用 JWT** |

也接受 `?access_token=` 与 `#token=`。

> `token` 必须是 **BO Access Token（JWT，`eyJ...`）**。`sk-blade-v3-...` 是 **API Key**：
> `/api/auth/me` 对它返回 `auth_type: "api_key"` 且**不带 `token` 字段**，前端拿不到
> JWT，socket.io 只认 auth payload，于是握手被拒
> （`connect_error: Connection rejected by server`）。

### 403 ≠ token 失效（v1.1.6 起）

v1.1.4 及更早版本把 **401 和 403 一律当成"token 不被接受"**，收到就停止注入。
问题是 BA 对个别接口本来就会返回 403（权限不足 / 功能未开启），典型的是
`GET /api/users/me/profile`——它 403 只是"这个用户没资料"，跟凭证有效性无关。

于是 `http://<SERVER>:8020/chat?token=<有效 token>` 会出现这样的连锁反应：

1. 前端启动并发了一批接口，其中一个 `/api/users/me/profile` 返回 **403**
2. 旧脚本据此判定 token 失效，**停止给后续请求补 Bearer**
3. 同一批里的 `/api/chat-groups`、`/api/sessions` 等因为没带 Bearer 全部 **401**
4. 侧边栏渲染成「我的分组 / **分组加载失败** / 重试」

**这不是 token 的问题**，同一 token 单独 curl `/api/chat-groups` 是 200。

v1.1.6 起判据收紧为：

- **只有** `/api/auth/*` 或 `/api/users/me*` 返回 **401** 才判定凭证失效并停止注入
- **403 一律忽略**，继续正常补 Bearer
- 任意接口的 401 都不再作为判据（避免一次网络抖动就废掉整个会话）

⚠️ token 放 URL 里会被浏览器历史、代理/网关访问日志、以及 `Referer` 带出去。
脚本虽已抹掉地址栏，但**日志里的那份抹不掉**，排查完记得清理网关日志。
生产环境建议只在受控入口使用，或改用 iframe + `postMessage`（token 不经过 URL）。

## 安装

把整个 `blade-iframe-plugin` 目录拷到目标机，在**已经部署好核心产品**的机器上执行：

```bash
scp -r blade-iframe-plugin root@SERVER:/opt/
ssh root@SERVER 'sh /opt/blade-iframe-plugin/install.sh'
```

常用选项：

```bash
sh install.sh --ba-only
sh install.sh --bh-only
sh install.sh --ba box-ba --bh box-bh
sh install.sh --allow-origin http://10.0.0.8:8080
sh status.sh
sh uninstall.sh
```

`install.sh` 是幂等的。产品升级或容器被重建后，再执行一次即可重新打上补丁。

### v1.1.7：能力中心（BH）也支持免登录（重要）

能力中心 = Blade Hub（`:8010`）。它的前端与 BA 一样只认会话 Cookie，后端一样接受
`Bearer`（已实测）。v1.1.7 起把同一套 `url-token-auth.js` 与 `autologin.html`
也装到 BH：

- `http://<SERVER>:8010/?token=<JWT>`、`http://<SERVER>:8010/skills?mode=embed&token=<JWT>` 直链免登录
- `http://<SERVER>:8010/autologin.html?token=<JWT>&next=/skills` 一键入口（Cookie 会话，刷新仍有效）
- 左上角品牌 logo、左下角账号用户名在 BH 同样隐藏，圆圈首字母换齿轮图标，**账号菜单保留**

同一台机器上 BA 与 BH 共用主机级 Cookie，因此 `http://<SERVER>:8020/autologin.html?token=<JWT>`
一条链接即可覆盖两端（Cookie 不分端口）。

`status.sh` 同时修掉了一个假阳性：BH 是 SPA，对不存在的静态路径也兜底返回 `index.html`，
旧版只看 HTTP 200 会误报脚本“已部署”。新版会校验响应体是否为脚本/HTML。

### v1.1.6：URL 直链的 403 误判修复（重要）

细节见上文「URL 直接带 token」的 **403 ≠ token 失效** 小节。一句话：
旧版把 `/api/users/me/profile` 的 403 当成 token 失效，导致 `?token=` 直链进来后
`/api/chat-groups` 全部 401、侧边栏显示「分组加载失败」。**用 v1.1.6 重装即可。**

顺带修掉一个文档级坑：直链必须用 **JWT**，`sk-blade-v3-…` 这种 API Key 会让
socket.io 握手被拒（界面能开、实时对话不通）。

### v1.1.3：v2610 注入点修复（重要）

BA/BH **v2610** 的 `index.html` 新增了一段埋点引导的 HTML 注释，注释正文里含有
`<script src>` 字样。早期版本的 `inject-index.awk` 用宽松的 `/<script/` 匹配定位插入点，
结果把桥接脚本插进了**注释内部** → 脚本被浏览器忽略 → iframe 桥接静默失效
（表现为宿主页始终收不到 `blade-embed-ready`，5 秒后提示"插件可能没装"）。

v1.1.3 起三个注入脚本（inject-index / inject-url-token / inject-slim-ui）统一改为：

1. 只认真正的 `type="module"` script 标签；
2. 跟踪 `<!-- -->` 注释状态，注释内一律不插入。

升级到 v2610 后重跑 `install.sh` 即可。若 index.html 已被旧版 awk 污染
（脚本落在注释里），先从备份还原再安装：

```bash
docker cp /var/lib/blade-iframe-plugin/backups/ba/index.html.last box-ba:/app/web/apps/web/dist/index.html
sh /opt/blade-iframe-plugin/install.sh
```

安装时会把原始 `index.html` 备份到 `/var/lib/blade-iframe-plugin/backups/`（写不入时回退到插件目录 `state/backups/`），不会改 compose、不会动镜像、不会写 C 盘。升级插件时不要删掉这个备份目录。

## 嵌入地址

| 页面 | 地址 |
|---|---|
| BA 完整工作台 | `http://<SERVER>:8020/?iframe=1` |
| BH Skill 商店（能力中心） | `http://<SERVER>:8010/skills?mode=embed` |
| 领域智能体 | `http://<SERVER>:8010/solutions?mode=embed` |

注意：BA 不要用 `?mode=embed` 来嵌完整工作台。那个参数是官方简化嵌入页。完整工作台用 `?iframe=1`。

## 宿主怎么接

最小协议：

```js
iframe.contentWindow.postMessage(
  { type: "blade-embed-token", token: accessToken },
  new URL(iframe.src).origin,
)
```

可直接用本插件自带的宿主辅助：

- `host/blade-embed-host.js`：原生 JS
- `host/vue-snippet.vue`：Vue 3 片段
- `host/example.html`：零构建联调页

联调页示例：

```text
http://HOST/example.html?ba=http://SERVER:8020&bh=http://SERVER:8010
```

Token 必须是 BO Access Token（JWT），不要传 OAuth Client Secret，也不要传带中文的整段报错文本。

## 和部署包的关系

- 不进入 `blade-service-deployer`，也不依赖它的 upgrade/deploy 流程。
- 不替换 BA/BH 镜像。
- 只覆盖运行中容器的前端静态文件。
- `docker restart` 后仍然有效；`docker compose up` 重建容器或产品升级后需要重装本插件。

## 卸载

```bash
sh uninstall.sh
```

默认只删除注入脚本和桥接文件。如果确认容器还是安装前的同一版前端，才使用：

```bash
sh uninstall.sh --restore-backup
```

升级后再 `--restore-backup` 会把旧版 `index.html` 盖回去，导致静态资源 404，不要这样做。

## 目录

```text
blade-iframe-plugin/
  install.sh                      安装（幂等）
  uninstall.sh                    卸载
  status.sh                       自检
  rollback.sh                     = uninstall.sh
  VERSION / plugin.json           版本信息
  pack.sh                         打分发 zip
  使用手册.md                      完整使用手册
  给客户的接入说明-免登录直连.md     客户侧接入说明（免登录）
  files/
    iframe-auth-bridge.js         iframe 桥接（仅嵌入态运行）
    url-token-auth.js             URL token 直链（BA + BH 注入）
    theme.js                      logo / 用户名隐藏 + 齿轮图标（BA + BH）
    autologin.html                一键免登录页（BA + BH 部署）
  host/                           宿主页接入辅助（js / vue / 示例页）
  scripts/                        注入与公共函数
  tests/                          注入逻辑自测
```
