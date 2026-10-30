# blade-ui-plugin

版本 0.2.9。给已经跑起来的 Blade Agent（8020，容器 `box-ba`）和 Blade Hub（8010，容器 `box-bh`）套上一层界面规范样式。

0.2.9 在 0.2.8 的白底蓝主色上，只给场景入口加一小块点缀：左侧 3px 色边，图标 16px 同色。合同审查蓝、数据分析青、报告撰写紫、信息检索橙、软件工厂洋红。按钮本身仍是白底细边框。

0.2.8 把 8020 工作台收回蓝加中性灰白：问候是白卡片加左侧主色细线，输入区是白底细边框，选中导航是浅蓝底加主色字，场景入口统一白底。页面底是 `#F5F7FA`。不改侧栏宽度，不恢复 Blade 字标。

0.2.7 曾把问候、输入、场景做成多色色块。0.2.8 去掉这些装饰。

0.2.2 隐藏页面上的 Blade 标识图和「Blade / Blade AI / Blade Hub」字标。卡片按布局规范补了 16px 内边距、16px 间距、1px 分割线、4px 圆角、浅阴影、14px 标题和 12px 次要说明，悬停时边框改为主色。工作台侧栏宽度不动。

## 解决什么问题

两个系统的页面仍是产品自带皮肤。本插件只往前端静态目录注入样式、少量顶栏标记脚本和两套规范字体，让主要视觉靠近规范：

- 主色 `#237CFF`，页面底 `#F5F7FA`，正文 `#323233`
- 顶栏至少 48px、蓝底白字（只标页面顶部的 `header`，不改弹窗）
- 正文字体微软雅黑，标题用阿里妈妈数黑体，表格数字用 DIN Alternate
- 按钮和输入框圆角 4px，输入框最低 32px

不改接口，不重写业务页面，不改侧栏宽度和拖拽布局。产品名保持 Blade Agent / Blade Hub。

## 怎么安装

在已经部署 `box-ba`、`box-bh` 的机器上执行。不重建镜像，不重启容器。

```bash
scp -r blade-ui-plugin root@<SERVER>:/opt/blade-ui-plugin
ssh root@<SERVER> 'sh /opt/blade-ui-plugin/install.sh'
ssh root@<SERVER> 'sh /opt/blade-ui-plugin/status.sh'
```

只装一边：`sh install.sh --ba-only` 或 `sh install.sh --bh-only`。

注入标记是 `<!-- blade-ui-plugin:start -->` … `<!-- blade-ui-plugin:end -->`。文件名是 `blade-ui-theme.css`、`blade-ui-theme.js`，和 iframe 插件的 `blade-ui-slim.js` 不是同一个文件。

容器重建或产品升级后需要再执行一次 `install.sh`。

## 怎么卸载

```bash
sh /opt/blade-ui-plugin/uninstall.sh
```

只删本插件的样式、脚本、字体和 index.html 里的标记。iframe 插件的 `iframe-auth-bridge.js`、`url-token-auth.js`、`blade-ui-slim.js` 会保留。

## 影响哪些容器

| 容器 | 端口 | 系统 |
|---|---|---|
| box-ba | 8020 | Blade Agent |
| box-bh | 8010 | Blade Hub |
