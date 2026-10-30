# 宿主接入

安装插件后，宿主页面用 iframe 打开 BA/BH，并在收到 `blade-embed-ready` 后回传 BO Access Token。

```js
frame.contentWindow.postMessage(
  { type: "blade-embed-token", token: accessToken },
  new URL(frame.src).origin,
)
```

本目录提供三种用法：

- `blade-embed-host.js`：直接给现有页面引用
- `vue-snippet.vue`：拷进 Vue 3 项目
- `example.html`：零构建联调，用 `?ba=` / `?bh=` 指定现场地址
