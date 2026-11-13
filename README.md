# v2exthread

一个轻量的 Chrome 扩展（Manifest V3），将 V2EX 帖子中的 `@回复` 自动合并进被引用的楼层形成对话树，原位融入 V2EX 原生页面风格。

<img src="icons/128.png" width="72" alt="v2exthread" />

## 功能特性

- **渐进式秒开**：在 `document_end` 即刻基于当前页回复同步建树显示，不阻塞在多页请求上；多页帖子随后在后台并发抓取其余分页并增量合并，同时保持当前阅读位置不跳动。
- **融入原生页面**：沿用 V2EX 原生回复卡片样式与主题变量（支持浅色/深色主题），保留原生回复数与标签头部，并在头部提供「对话树 / 原序」一键切换。
- **跨页引用合并**：
  - 优先匹配显式 `@用户 #楼层` 引用；
  - 未指定楼层号时，自动就近匹配该用户在此前最近的发言；
  - 已合并进对话树的回复不再在原列表重复占楼。
- **实用交互**：点击楼层号平滑滚动并高亮定位、当前登录账号回复标注「我」徽章、兼容 V2EX AJAX 回复后自动重建对话树。

## 安装使用

### 方式一：从源码构建（推荐）

需要 Node.js（支持原生 TypeScript 测试运行器，推荐 Node 22.18+ / 24+）：

```bash
npm install
npm run build
```

然后在 Chrome / Edge 中安装：

1. 打开 `chrome://extensions/`（或 `edge://extensions/`）
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择项目下的 `dist/` 目录即可

### 方式二：打包分发

如果你下载了发布压缩包，解压后直接通过「加载已解压的扩展程序」选择解压后的目录即可。

## 本地开发与测试

```bash
# 监听源码改动并自动重新构建到 dist/
npm run watch

# 类型检查
npm run typecheck

# 运行单元测试
npm test
```

## 项目结构

```text
src/
  early.ts / early.css     # document_start 阶段防止平铺→树形切换闪屏与兜底显示
  content.ts / content.css # 主入口：两阶段建树、AJAX 监听与对话树样式
  parse.ts                 # 解析帖子元信息、楼层与开头 @mention
  resolve.ts               # 引用关系解析与树结构构建
  fetcher.ts               # 并发抓取多页回复（支持进度回调与中断）
  render.ts                # 原位对话树渲染、滚动锚定与视图模式切换
  types.ts                 # 类型定义
test/
  engine.test.ts           # 解析与建树算法测试
  view.test.ts             # 视图渲染与模式切换测试
  fixtures/                # 离线 HTML 测试样本
build.mjs                  # esbuild 构建脚本
manifest.json              # Chrome 扩展清单 (MV3)
```

## 隐私说明

本扩展所有解析与渲染均在浏览器本地完成，仅使用浏览器当前同源会话请求 V2EX 帖子分页，不收集或上传任何用户数据。

## License

[MIT](LICENSE)
