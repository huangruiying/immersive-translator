# 沉浸式翻译（大模型自定义端点版）

一个 **Chrome / Edge 通用** 的浏览器插件，把任意网页的正文以「双语对照」方式内联翻译，并把译文**写回原文所在位置**。翻译后端对接**任意 OpenAI 兼容的大模型接口**（`/v1/chat/completions`），只需配置「接口地址 + API Key + 模型名」即可，无需内置任何翻译厂商。

---

## 一、翻译原理（沉浸式翻译是怎么做的）

沉浸式翻译类插件的核心思路，不在于「截屏 OCR」或「整页替换」，而是**在 DOM 层面做局部双语渲染**。整个过程分四步：

### 1. 内容脚本注入（Content Script）
插件不在安装后自动注入所有网页。用户点击「翻译当前页面」、使用快捷键或右键菜单时，扩展通过 `activeTab + chrome.scripting.executeScript` 临时把 `content.js` 注入到当前标签页。脚本运行在页面的 DOM 环境，但**和页面自身的 JS 隔离**（不能直接访问页面的全局变量，只能操作 DOM）。

### 2. 文本节点抽取（DOM 遍历）
`content.js` 用 `document.createTreeWalker(..., NodeFilter.SHOW_TEXT, ...)` 遍历整棵 DOM 树，只挑出**纯文本节点**，并过滤掉：
- 脚本/样式/输入类标签：`SCRIPT`、`STYLE`、`CODE`、`PRE`、`TEXTAREA`、`INPUT`、`SVG` 等；
- 已经翻译过的节点（避免重复翻译、死循环）；
- 空文本、纯标点/纯链接、隐藏元素。

### 3. 后台代理调用大模型（Background Service Worker）
抽取出的文本被分批（每批约 12 段）通过 `chrome.runtime.sendMessage` 发给插件的**后台 service worker**。后台从本机存储读取接口配置和 API Key，并负责真正发 HTTP 请求：

```
POST {接口地址}/v1/chat/completions
Authorization: Bearer {API Key}
Content-Type: application/json

{
  "model": "{模型名}",
  "messages": [
    {"role":"system","content":"你是翻译器，把用户输入翻译成{目标语言}..."},
    {"role":"user","content":"[0] 第一段原文\n\n[1] 第二段原文\n..."}
  ],
  "temperature": 0.3
}
```

> **为什么走后台而不是直接在页面里调？**
> 1. **API Key 安全**：Key 只由后台/service worker 从 `chrome.storage.local` 读取，不会传给内容脚本或页面 JS。
> 2. **CORS**：部分模型服务对浏览器跨域有限制，后台 `fetch` 更可控。
> 3. **统一管理**：流式、重试、缓存、限流都集中在后台。

### 4. 译文内联写回（Inline Render）
后台拿到译文后回传给 `content.js`，脚本为每个原文文本节点在其**紧邻位置插入一个译文节点**：
- 父元素是块级（`<p>`、`<li>`、`<div>`…）→ 插入 `<div class="immersive-translator__translation">译文</div>`，显示为原文下方带左边框的小灰字；
- 父元素是行内（`<span>`、`<a>`…）→ 插入 `<span> 译文</span>`。

原文**保留不动**，形成「原文 + 译文」的沉浸式双语效果。点「还原」时，脚本删除所有 `.immersive-translator__translation` 节点即可恢复原貌。

---

## 二、如何对接你自己的大模型（端点 + API Key）

所有兼容 **OpenAI Chat Completions** 协议的接口都能直接用，区别只在「接口地址 / Key / 模型名」三栏。常见填写示例：

| 服务商 | 接口地址 (Base URL) | 模型名示例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot(月之暗面) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| **本地 Ollama** | `http://localhost:11434/v1` | `qwen2.5` |
| **vLLM / 自建** | `https://你的服务器:8000/v1` | 你部署的模型名 |

为满足 Chrome Web Store 的用户数据安全要求，远程接口必须使用 HTTPS；`http://localhost` 和 `http://127.0.0.1` 仅用于本机模型服务。

> 你提到的「V1/V2 那种地址」指的就是 `/v1/chat/completions` 这一路径。只要你的服务暴露这个 OpenAI 兼容端点，把 Base URL 填到「接口地址」、模型名填到「模型名称」即可，**完全不用改代码**。

**提示词**：默认内置了一段翻译提示词（要求模型用 `[0] [1]…` 序号标注每段译文，方便对齐）。你也可以在设置里用 `{text}` 和 `{lang}` 占位符写自己的提示词。

---

## 三、安装方法（Chrome / Edge 通用）

因为是 **Manifest V3**，同一份代码在 Chrome 和 Edge 都能跑：

1. 打开扩展管理页：
   - **Chrome**：地址栏输入 `chrome://extensions`
   - **Edge**：地址栏输入 `edge://extensions`
2. 右上角打开「**开发者模式**」（Developer mode）。
3. 点击「**加载已解压的扩展程序**」（Load unpacked），选择本目录 `immersive-translator/`。
4. 插件出现在列表后，点「详情」→ 固定到工具栏。
5. 点工具栏图标 → 「扩展设置」→ 填写接口地址 / API Key / 模型名，点「测试连接」验证。

> 想上架商店的话：Chrome 走 Chrome Web Store、Edge 走 Edge Add-ons，分别打包 `zip` 提交即可，代码无需改动（两侧都接受 MV3）。

---

## 四、使用方式

- **整页翻译**：点工具栏图标 → 「翻译当前页面」，或快捷键 `Ctrl+Shift+U`。
- **还原**：点「还原」，或快捷键 `Ctrl+Shift+Y`。
- **选中翻译**：在页面上选中文字 → 右键「翻译选中内容」，会在选区旁弹出译文气泡。
- **显示模式**：设置里可在「双语对照 / 仅显示译文」间切换。

---

## 五、隐私与权限说明

- 扩展只在用户主动点击、快捷键或右键菜单触发翻译时注入当前页面，不常驻读取所有网页。
- 翻译时会把待翻译的网页文本或选中文本发送到用户填写的接口地址。
- API Key 和设置项保存在 `chrome.storage.local`，不会通过 Chrome Sync 同步。
- 首次保存或测试接口时，浏览器会请求访问该接口域名的运行时权限。
- 上架 Chrome Web Store 时，需要在开发者后台填写隐私政策 URL，可参考本仓库的 `PRIVACY.md`。

---

## 六、文件结构

```
immersive-translator/
├── manifest.json   # MV3 清单（Chrome/Edge 通用）
├── background.js   # 后台：代理调用大模型、右键菜单、快捷键
├── content.js      # 内容脚本：抽取文本、内联渲染译文
├── popup.html/js/css  # 工具栏弹窗
├── options.html/js/css # 设置页（端点/Key/模型/语言/提示词）
└── icons/          # 16/48/128 图标
```

---

## 七、可增强方向（当前为可用最小实现）

- **流式输出**：用 SSE 边出边渲染，体验更接近官方沉浸式翻译。
- **翻译缓存**：同一段文本按 hash 缓存，避免重复计费。
- **PDF / 字幕 / 视频网站**适配。
- **更多源语言自动检测**、术语表（glossary）注入。
- **多段合并 + 更长上下文**以节省 token。

当前实现已覆盖你要的核心能力：**对接自定义大模型端点 + 把译文内联写回原文**，且在 Chrome 与 Edge 上通用。
