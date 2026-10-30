# 智能模型公共服务平台（集成壳）

顶栏、控制台侧栏和占位模块留在这里。门户、资源列表、智能体详情、提示词工程和应用开发的页面内容是 iframe，指向虚拟机上的嵌入页。地址来自 `VITE_EMBED_ORIGIN`，示例见 `.env.example`。连接清单见 `D:\workspaces\zny\codes\集成说明.md`。

```bash
cd D:\workspaces\zny\codes\public-service
npm install
npm run dev
```

浏览器打开 http://127.0.0.1:5173/ 。本地只起这个集成壳，不再把本机 5174 当作集成目标。用户打通本期不做。
