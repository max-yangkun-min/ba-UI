# Blade iframe / 免登录插件交付包

**版本：v1.1.7**

## 交付内容

```text
blade-iframe-plugin/
├── install.sh                       安装（幂等）
├── uninstall.sh                     卸载
├── status.sh                        自检
├── rollback.sh                      等价 uninstall.sh
├── VERSION / plugin.json            版本信息
├── 使用手册.md                       完整使用手册（安装 / 接入 / 排障）
├── 给客户的接入说明-免登录直连.md      客户侧零改动接入说明
├── README.md                        功能与原理说明
├── files/
│   ├── iframe-auth-bridge.js        iframe 桥接（仅嵌入态运行）
│   ├── url-token-auth.js            URL token 直链（BA + BH 注入）
│   ├── theme.js                     logo / 用户名隐藏 + 齿轮图标（BA+BH）
│   └── autologin.html               一键免登录页（BA + BH 部署）
├── scripts/                         注入脚本与公共函数
├── host/                            宿主页接入辅助（js / vue / 示例页）
└── tests/                           注入逻辑自测
```

## 支持版本

- Blade Agent (BA)：v2608 ～ v2610（已在 v2610.0.2 上验证）
- Blade Hub (BH)：v2608 ～ v2610（已在 v2610.0.0 上验证）

## 核心功能

1. **一键免登录链接** — `autologin.html?token=...`，打开直接进工作台 / 能力中心，不出现登录页（BA、BH 通用）
2. **iframe 嵌入** — 跨站 iframe 通过 postMessage 传 Token，token 不进 URL
3. **URL 直链** — `?token=` 直链免登录（`:8020/chat` 与 `:8010/skills`），地址栏 token 自动抹除
4. **界面精简** — 隐藏品牌 logo 与左下角用户名，圆圈字母换成齿轮图标（设置入口保留）

> v1.1.0 起**不再改任何配色**。早期版本的青黑主题已移除。

> **v1.1.7（当前）**：能力中心 = Blade Hub（`:8010`）也纳入支持——`?token=` 直链、`autologin.html`
> 一键入口、去品牌化（隐藏 logo / 隐藏用户名 / 齿轮图标）在 BH 上同样生效。同一台机器上 BA 与
> BH 共用主机级 Cookie，一条 `:8020/autologin.html?token=<JWT>` 即覆盖两端。

> **v1.1.6 修复**：v1.1.4 把 HTTP **403** 也当成 token 失效并停止注入，
> 而 BA 的 `/api/users/me/profile` 本来就会返回 403，导致 `?token=` 直链进入后
> 侧边栏显示「我的分组 / 分组加载失败」。v1.1.6 起只有 `/api/auth/*`、
> `/api/users/me*` 的 **401** 才算凭证失效。**遇到该现象请升级重装**。

> 令牌有效期：本环境 `blade-os` 应用级为 **10000 小时（约 416 天）**，
> 免登录链接可长期使用。调整方式见 `使用手册.md` 第 5.1 节。

## 快速安装

```bash
# 1) 上传到目标机
scp -r blade-iframe-plugin root@<SERVER>:/opt/

# 2) 安装
ssh root@<SERVER> 'sh /opt/blade-iframe-plugin/install.sh'

# 3) 自检
ssh root@<SERVER> 'sh /opt/blade-iframe-plugin/status.sh'
```

装完让浏览器 **Ctrl+F5** 硬刷新一次。

## 测试步骤

1. 运行 `status.sh`，确认 `bridge file: present`、`autologin page: present`、各 HTTP 均为 200
2. 浏览器无痕窗口打开 `http://<SERVER>:8020/autologin.html?token=<JWT>`
   预期：直接落到 `/chat`，地址栏无 token，不出现登录页
3. 打开 `http://<SERVER>:8020/?iframe=1` 测嵌入态（宿主需回传 `blade-embed-token`）

## 注意事项

- 容器重建（`docker compose up`）或产品升级后**必须重装**
- `autologin.html` 等价于一把钥匙，请通过可信渠道分发
- 详细排障见 `使用手册.md` 第 8 节
