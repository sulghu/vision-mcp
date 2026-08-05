// vision-mcp-node 端到端验证：真实 MCP Client → stdio server.js → 本地假视觉 API
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const RECEIVED = [];

// ---- 假视觉 API ----
const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw);
    const c0 = body.messages[0].content[0];
    RECEIVED.push({
      path: req.url,
      auth: req.headers.authorization,
      ct: req.headers["content-type"],
      model: body.model,
      imageUrl: c0?.image_url?.url || "",
      isDataUrl: (c0?.image_url?.url || "").startsWith("data:image/"),
      text: body.messages[0].content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    });
    const out = JSON.stringify({
      choices: [{ message: { content: "图片里有一只猫在沙发上" }, finish_reason: "stop" }],
    });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(out);
  });
});
await new Promise((r) => fake.listen(8998, "127.0.0.1", r));

// ---- 1x1 PNG ----
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
writeFileSync("test_node.png", png);

// ---- 测试1：默认配置（aliyun 预设 + 本地文件）----
const t1 = new StdioClientTransport({
  command: process.execPath,
  args: ["server.js"],
  env: { ...process.env, VISION_API_KEY: "sk-test-key", VISION_BASE_URL: "http://127.0.0.1:8998/v1" },
});
const c1 = new Client({ name: "e2e-1", version: "1.0.0" });
await c1.connect(t1);

const tools = await c1.listTools();
const names = tools.tools.map((t) => t.name).sort();
console.log("工具:", names);
if (!["ocr_image", "recognize_image", "vision_version"].every((n) => names.includes(n))) {
  throw new Error("工具注册不完整: " + names);
}

const r1 = await c1.callTool({ name: "recognize_image", arguments: { image: "test_node.png" } });
if (r1.content[0].text !== "图片里有一只猫在沙发上") throw new Error("recognize 返回异常");
if (!RECEIVED[0].isDataUrl) throw new Error("本地文件应内联 base64: " + RECEIVED[0].imageUrl.slice(0, 40));
if (RECEIVED[0].auth !== "Bearer sk-test-key") throw new Error("Authorization 异常");
if (RECEIVED[0].model !== "qwen3.7-plus") throw new Error("预设模型异常: " + RECEIVED[0].model);

const r2 = await c1.callTool({ name: "ocr_image", arguments: { image: "test_node.png" } });
if (!/OCR|提取/.test(RECEIVED[1].text)) throw new Error("ocr prompt 异常");

// ---- 测试2：http URL 直传（B4：不应下载，image_url 保持原始 URL）----
const r3 = await c1.callTool({
  name: "recognize_image",
  arguments: { image: "http://example.com/pic.jpg" },
});
if (RECEIVED[2].isDataUrl) throw new Error("http URL 应直传而非下载: " + RECEIVED[2].imageUrl.slice(0, 60));
if (RECEIVED[2].imageUrl !== "http://example.com/pic.jpg") {
  throw new Error("直传 URL 不符: " + RECEIVED[2].imageUrl);
}

// ---- 测试3：vision_version 工具（D2）----
const rv = await c1.callTool({ name: "vision_version", arguments: {} });
const info = JSON.parse(rv.content[0].text);
console.log("vision_version:", JSON.stringify(info));
if (info.provider !== "aliyun") throw new Error("provider 异常");
if (info.model !== "qwen3.7-plus") throw new Error("model 异常");
if (info.hasApiKey !== true) throw new Error("hasApiKey 异常");
await c1.close();

// ---- 测试4：openai 预设（VISION_PROVIDER 覆盖模型默认值，BASE_URL 仍由显式 env 覆盖）----
const t2 = new StdioClientTransport({
  command: process.execPath,
  args: ["server.js"],
  env: {
    ...process.env,
    VISION_API_KEY: "sk-test-key",
    VISION_PROVIDER: "openai",
    VISION_BASE_URL: "http://127.0.0.1:8998/v1",
  },
});
const c2 = new Client({ name: "e2e-2", version: "1.0.0" });
await c2.connect(t2);
const rv2 = await c2.callTool({ name: "vision_version", arguments: {} });
const info2 = JSON.parse(rv2.content[0].text);
if (info2.provider !== "openai" || info2.model !== "gpt-4o") {
  throw new Error("openai 预设异常: " + JSON.stringify(info2));
}
const r4 = await c2.callTool({ name: "recognize_image", arguments: { image: "test_node.png" } });
if (RECEIVED[3].model !== "gpt-4o") throw new Error("openai 预设模型未生效: " + RECEIVED[3].model);
console.log("openai 预设生效: model =", RECEIVED[3].model);
await c2.close();

fake.close();
console.log("\n=== 端到端验证通过（含 URL 直传 / 版本工具 / 供应商预设）===");
