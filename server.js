#!/usr/bin/env node
// vision-mcp (Node.js 版) —— 直连远端多模态模型 API 识别图片/OCR，不经本地代理。
//
// 工具:
//   recognize_image(image, prompt?)  识别/描述图片内容
//   ocr_image(image, language?)      从图片中提取文字
//
// 环境变量:
//   VISION_API_KEY    必填。API Key
//   VISION_BASE_URL   可选。OpenAI 兼容端点，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
//   VISION_MODEL      可选。视觉模型名，默认 qwen3.7-plus
//   VISION_TIMEOUT    可选。请求超时毫秒数，默认 120000
//   VISION_MAX_TOKENS 可选。默认 1024
//
// Key 解析顺序: VISION_API_KEY -> DASHSCOPE_API_KEY -> OPENAI_API_KEY
// 图片输入支持: 本地文件路径、http(s):// URL、data:image/...;base64,.... data URL。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.VISION_BASE_URL ||
  "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
const MODEL = process.env.VISION_MODEL || "qwen3.7-plus";
const TIMEOUT = Number(process.env.VISION_TIMEOUT || 120000);
const MAX_TOKENS = Number(process.env.VISION_MAX_TOKENS || 1024);
// 深度思考开关：默认关闭（qwen3 系列 enable_thinking=false），设为 true 可开启
const ENABLE_THINKING =
  String(process.env.VISION_ENABLE_THINKING || "false").toLowerCase() === "true";
const API_KEY =
  process.env.VISION_API_KEY ||
  process.env.DASHSCOPE_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

if (!API_KEY) {
  console.error(
    "警告: 未设置 API Key。请设置环境变量 VISION_API_KEY (或 DASHSCOPE_API_KEY / OPENAI_API_KEY)。"
  );
}

const server = new McpServer({
  name: "vision-mcp",
  version: "1.0.0",
  instructions:
    "识别图片内容/OCR 文字，直连远端多模态模型 API，不经过本地代理。",
});

// ---------------------------------------------------------------------------
// 图片装载
// ---------------------------------------------------------------------------

function mimeFromPath(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
  };
  return map[ext] || "image/png";
}

async function loadImage(image) {
  // data:image/png;base64,xxxx
  if (image.startsWith("data:")) {
    const comma = image.indexOf(",");
    const header = image.slice(5, comma);
    const mime = header.split(";")[0] || "image/png";
    const b64 = image.slice(comma + 1);
    return { mime, data: Buffer.from(b64, "base64") };
  }

  // http(s):// URL
  if (image.startsWith("http://") || image.startsWith("https://")) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const resp = await fetch(image, { signal: ctrl.signal });
      if (!resp.ok) {
        throw new Error(`图片下载失败 HTTP ${resp.status}: ${image}`);
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const mime = (resp.headers.get("content-type") || "image/png").split(";")[0];
      return { mime, data: buf };
    } finally {
      clearTimeout(timer);
    }
  }

  // 本地文件路径
  if (!existsSync(image)) {
    throw new Error(`图片不存在或无法访问: ${image}`);
  }
  return { mime: mimeFromPath(image), data: readFileSync(image) };
}

async function callVision(messages) {
  const body = JSON.stringify({
    model: MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    enable_thinking: ENABLE_THINKING,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  let resp;
  try {
    resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${API_KEY}`,
      },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(`视觉 API 网络错误: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`视觉 API 请求失败 HTTP ${resp.status}: ${raw}`);
  }

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`视觉 API 返回格式异常: ${raw.slice(0, 500)}`);
  }
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`视觉 API 返回格式异常: ${raw.slice(0, 500)}`);
  }
  return content;
}

function imageMessage(image, text) {
  return {
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: { url: `data:${image.mime};base64,${image.data.toString("base64")}` },
      },
      { type: "text", text },
    ],
  };
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

server.tool(
  "recognize_image",
  {
    image: z.string().describe("图片的本地文件路径、http(s):// 链接或 data:image/...;base64,.... data URL"),
    prompt: z.string().optional().describe("可选，自定义识别要求；留空则默认详细描述图片内容"),
  },
  async ({ image, prompt }) => {
    const text = (prompt || "").trim() || "请详细描述这张图片的内容，包括主体、场景、文字等。";
    const img = await loadImage(image);
    const result = await callVision([imageMessage(img, text)]);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "ocr_image",
  {
    image: z.string().describe("图片的本地文件路径、http(s):// 链接或 data:image/...;base64,.... data URL"),
    language: z.string().optional().describe("期望文字语言，默认 zh"),
  },
  async ({ image, language }) => {
    const lang = (language || "zh").trim();
    const text = `请对这张图片做 OCR，原样提取图中所有文字。图片文字语言主要是 ${lang}。只输出提取到的文字，不要额外说明。`;
    const img = await loadImage(image);
    const result = await callVision([imageMessage(img, text)]);
    return { content: [{ type: "text", text: result }] };
  }
);

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
