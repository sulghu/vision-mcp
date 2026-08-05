// 用 vision-mcp 分析图片设计布局：从 ../.mcp.json 读取配置，避免硬编码 Key
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpCfg = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf-8"))
  .mcpServers["vision-mcp-node"];

const IMAGE = process.argv[2];

const transport = new StdioClientTransport({
  command: mcpCfg.command,
  args: mcpCfg.args,
  env: { ...process.env, ...mcpCfg.env },
});
const client = new Client({ name: "analyze-layout", version: "1.0.0" });
await client.connect(transport);
console.log("MCP 连接成功，工具:", (await client.listTools()).tools.map((t) => t.name));

const res = await client.callTool(
  {
    name: "recognize_image",
    arguments: {
      image: IMAGE,
      prompt:
        "请分析这张截图的设计布局：1) 整体页面类型与用途；2) 布局结构（顶部/侧边栏/内容区/底部等区域划分，栅格与对齐方式）；3) 配色方案（主色、辅色、背景、文字颜色）；4) 字体与字号层级；5) 组件清单（导航、按钮、卡片、表单、图表等）及其摆放；6) 间距、圆角、阴影等视觉风格细节；7) 整体设计风格评价。请用中文分条输出。",
    },
  },
  undefined,
  { timeout: 300000 }
);
console.log("\n===== 识别结果 =====\n" + res.content[0].text);

await client.close();
