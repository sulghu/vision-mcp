# vision-mcp-node

MCP 服务器：**直连远程多模态模型 API 识别图片 / OCR**，不经过任何本地代理。

- 工具 `recognize_image(image, prompt?)` — 识别/描述图片内容
- 工具 `ocr_image(image, language?)` — 从图片提取文字
- 支持任意 **OpenAI 兼容**视觉端点（阿里云百炼、OpenAI、硅基流动等）
- 图片输入：本地路径 / `http(s)://` URL / `data:` URL

## 快速开始（无需安装）

```bash
# 1. 设置 API Key（本包不内置、不硬编码任何 Key）
export VISION_API_KEY=sk-xxxx

# 2. 在 MCP 客户端配置里直接 npx 拉起（见下）
```

在 `claude_desktop_config.json` / `mcp.json` / Reasonix 配置中：

```json
{
  "mcpServers": {
    "vision-mcp": {
      "command": "npx",
      "args": ["-y", "vision-mcp-node"],
      "env": {
        "VISION_API_KEY": "${VISION_API_KEY}",
        "VISION_BASE_URL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "VISION_MODEL": "qwen3.7-plus"
      }
    }
  }
}
```

> `"${VISION_API_KEY}"` 会让客户端读取你机器上的同名环境变量，**Key 不落盘**。
> 也可以直接填字符串，但注意别把配置提交到公开仓库。

## 配置（环境变量）

| 变量 | 必填 | 默认值 |
|---|---|---|
| `VISION_API_KEY` | ✅ | —（也认 `DASHSCOPE_API_KEY` / `OPENAI_API_KEY`） |
| `VISION_BASE_URL` | 否 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `VISION_MODEL` | 否 | `qwen3.7-plus` |
| `VISION_TIMEOUT` | 否 | `120000`（毫秒） |
| `VISION_MAX_TOKENS` | 否 | `1024` |
| `VISION_ENABLE_THINKING` | 否 | `false`（qwen3 系列不开启深度思考，设 `true` 可开启） |

换 OpenAI 官方：`VISION_BASE_URL=https://api.openai.com/v1` + `VISION_MODEL=gpt-4o`。
换硅基流动：`VISION_BASE_URL=https://api.siliconflow.cn/v1` + `VISION_MODEL=Qwen/Qwen2.5-VL-72B-Instruct`。

## 工具用法

- `recognize_image("C:/a.png")` — 描述本地图片
- `recognize_image("https://example.com/a.jpg", prompt="图中横幅写了什么字？")`
- `recognize_image("data:image/png;base64,....")` — 直接传 data URL
- `ocr_image("C:/a.png", language="en")` — 提取英文文字

## 本地开发 / 调试

```bash
git clone https://github.com/sulghu/vision-mcp.git && cd vision-mcp-node
npm install
npm test                     # 端到端（本地假视觉 API，不需真实 Key）
node server.js               # 以 stdio 启动，等 MCP 客户端连接

# 或直接命令行冒烟：识别一张图（需要真实 Key）
export VISION_API_KEY=sk-xxxx
node -e "import('./analyze_image.mjs').then(m=>m.default('C:/a.png'))"  # 见 analyze_image.mjs
```

## 发布到 npm（维护者用）

```bash
npm login                       # 用你的 npm 账号登录
npm version patch               # 或 minor / major
npm publish                     # 发布（先跑 npm pack 检查内容）
npx -y vision-mcp-node          # 验证安装可用
```

发布前务必检查：`npm pack --dry-run` 列出的文件里**不能包含任何 API Key / .mcp.json / 本地测试脚本**（`files` 字段已限定为 `server.js` + `README.md` + `LICENSE`）。

## 原理

```
MCP 客户端 (Claude/Codex/Reasonix...)
   └─ stdio → vision-mcp-node (npx 拉起，stdio)
                └─ fetch POST {VISION_BASE_URL}/chat/completions
                     （OpenAI 兼容，图片 base64 data URL 内联发送）
```
