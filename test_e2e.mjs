// vision-mcp-node 端到端验证：真实 MCP Client → stdio server.js → 本地假视觉 API（不经 8001 代理）
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
    RECEIVED.push({
      path: req.url,
      auth: req.headers.authorization,
      ct: req.headers["content-type"],
      model: body.model,
      hasImage: body.messages[0].content.some(
        (c) => c.type === "image_url" && c.image_url.url.startsWith("data:image/")
      ),
      text: body.messages[0].content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join(""),
    });
    const out = JSON.stringify({ choices: [{ message: { content: "图片里有一只猫在沙发上" } }] });
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

// ---- MCP Client 拉起 server.js ----
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["server.js"],
  env: {
    ...process.env,
    VISION_API_KEY: "sk-test-key",
    VISION_BASE_URL: "http://127.0.0.1:8998/v1",
    VISION_MODEL: "qwen3-vl-plus",
  },
});
const client = new Client({ name: "e2e-test", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("工具:", tools.tools.map((t) => t.name).sort());
const names = tools.tools.map((t) => t.name);
if (!names.includes("recognize_image") || !names.includes("ocr_image")) {
  throw new Error("工具注册不完整: " + names);
}

// ---- 调用 ----
const r1 = await client.callTool({ name: "recognize_image", arguments: { image: "test_node.png" } });
console.log("recognize_image ->", r1.content[0].text);
const r2 = await client.callTool({ name: "ocr_image", arguments: { image: "test_node.png" } });
console.log("ocr_image       ->", r2.content[0].text);

// ---- 断言 ----
if (r1.content[0].text !== "图片里有一只猫在沙发上") throw new Error("recognize 返回异常");
if (r2.content[0].text !== "图片里有一只猫在沙发上") throw new Error("ocr 返回异常");
const rec = RECEIVED[0], ocr = RECEIVED[1];
if (rec.auth !== "Bearer sk-test-key") throw new Error("Authorization 异常: " + rec.auth);
if (!/charset=utf-8/i.test(rec.ct)) throw new Error("Content-Type 异常: " + rec.ct);
if (rec.model !== "qwen3-vl-plus") throw new Error("model 异常: " + rec.model);
if (rec.path !== "/v1/chat/completions") throw new Error("路径异常: " + rec.path);
if (!rec.hasImage || !ocr.hasImage) throw new Error("图片未内联发送");
if (!/描述/.test(rec.text)) throw new Error("recognize prompt 异常: " + rec.text);
if (!/OCR|提取/.test(ocr.text)) throw new Error("ocr prompt 异常: " + ocr.text);

await client.close();
fake.close();
console.log("\n=== Node 版端到端验证通过 ===");
