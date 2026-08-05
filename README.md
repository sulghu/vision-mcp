# vision-mcp-node

[![npm version](https://img.shields.io/npm/v/vision-mcp-node)](https://www.npmjs.com/package/vision-mcp-node)
[![npm downloads](https://img.shields.io/npm/dm/vision-mcp-node)](https://www.npmjs.com/package/vision-mcp-node)
[![license](https://img.shields.io/npm/l/vision-mcp-node)](https://github.com/sulghu/vision-mcp/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

MCP 服务器：**直连远程多模态模型 API 识别图片 / OCR**，不经过任何本地代理。

- 工具 `recognize_image(image, prompt?)` — 识别/描述图片内容
- 工具 `ocr_image(image, language?)` — 从图片提取文字
- 工具 `vision_version()` — 查看当前服务配置（模型/供应商/Key 状态）
- 支持任意 **OpenAI 兼容**视觉端点（阿里云百炼、OpenAI、硅基流动等）
- 图片输入：本地路径 / `http(s)://` URL（默认直传不下载）/ `data:` URL
- 大图自动压缩、输出截断自动重试、错误分类提示

## 快速开始（全局安装，推荐）

```bash
# 1. 安装（只需一次）
npm install -g vision-mcp-node

# 2. 配置 API Key（默认已指向阿里云百炼 + qwen3.7-plus）
export VISION_API_KEY=sk-你的Key
# 永久生效可写入：echo 'export VISION_API_KEY=sk-你的Key' >> ~/.bashrc

# 3. 验证安装
npm ls -g vision-mcp-node      # 显示 vision-mcp-node@1.0.1
vision-mcp                     # 以 stdio 启动，等 MCP 客户端连接（Ctrl+C 退出）
```

然后只需在 MCP 客户端配置里加一段最小配置：

```json
{
  "mcpServers": {
    "vision-mcp": {
      "command": "vision-mcp",
      "args": []
    }
  }
}
```

Key 已通过环境变量传给客户端，无需写进 JSON。

## 或者：npx 免安装即用

不全局安装，直接在 `claude_desktop_config.json` / `mcp.json` / Reasonix 配置中用 `npx` 拉起：

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
> 想换供应商时，在 `env` 里覆盖 `VISION_BASE_URL` / `VISION_MODEL` 即可（见下方配置表）。

## 接入 Codex（TOML 格式）

Codex 的 MCP 配置在 `~/.codex/config.toml`（TOML 不是 JSON）。全局安装后只需：

```toml
# ~/.codex/config.toml
[mcp_servers.vision-mcp]
command = "vision-mcp"
```

用 npx 免安装版（显式传 env，Key 用 `${VISION_API_KEY}` 从环境变量读取、不落盘）：

```toml
# ~/.codex/config.toml
[mcp_servers.vision-mcp]
command = "npx"
args = ["-y", "vision-mcp-node"]
env = {
  VISION_API_KEY = "${VISION_API_KEY}",
  VISION_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1",
  VISION_MODEL = "qwen3.7-plus"
}
```

改完执行 `codex` 重启会话生效（或 `codex mcp list` 检查是否加载）。

## 配置（环境变量）

| 变量 | 必填 | 默认值 |
|---|---|---|
| `VISION_API_KEY` | ✅ | —（也认 `DASHSCOPE_API_KEY` / `OPENAI_API_KEY`） |
| `VISION_PROVIDER` | 否 | `aliyun`（可选 `openai` / `siliconflow`，一键切换预设） |
| `VISION_BASE_URL` | 否 | 随 `VISION_PROVIDER` 预设（也可显式覆盖） |
| `VISION_MODEL` | 否 | 随 `VISION_PROVIDER` 预设（也可显式覆盖） |
| `VISION_TIMEOUT` | 否 | `120000`（毫秒） |
| `VISION_MAX_TOKENS` | 否 | `1024`（被截断自动翻倍重试） |
| `VISION_ENABLE_THINKING` | 否 | `false`（qwen3 系列不开启深度思考，设 `true` 可开启） |
| `VISION_MAX_IMAGE_MB` | 否 | `15`（超过自动压缩，需 sharp） |
| `VISION_FORCE_DOWNLOAD` | 否 | `false`（http 图片默认直传 URL，设 `true` 强制下载内联） |

### 供应商预设（`VISION_PROVIDER`）

| `VISION_PROVIDER` | 默认端点 | 默认模型 |
|---|---|---|
| `aliyun` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.7-plus` |
| `openai` | `https://api.openai.com/v1` | `gpt-4o` |
| `siliconflow` | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` |

显式设置 `VISION_BASE_URL` / `VISION_MODEL` 会覆盖预设。

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
