#!/usr/bin/env node
// vision-mcp (Node.js 版) —— 直连远端多模态模型 API 识别图片/OCR，不经本地代理。
//
// 工具:
//   recognize_image(image, prompt?)  识别/描述图片内容
//   ocr_image(image, language?)      从图片中提取文字
//   vision_version()                 查看当前服务配置
//
// 环境变量:
//   VISION_API_KEY        必填。API Key
//   VISION_PROVIDER       可选。供应商预设: aliyun | openai | siliconflow（默认 aliyun）
//   VISION_BASE_URL       可选。OpenAI 兼容端点（显式设置时优先于预设）
//   VISION_MODEL          可选。视觉模型名（显式设置时优先于预设）
//   VISION_TIMEOUT        可选。请求超时毫秒数，默认 120000
//   VISION_MAX_TOKENS     可选。默认 1024；被截断时自动翻倍重试
//   VISION_ENABLE_THINKING 可选。qwen3 系列深度思考，默认 false
//   VISION_MAX_IMAGE_MB   可选。图片体积上限，默认 15MB；超限自动压缩（需 sharp）
//   VISION_FORCE_DOWNLOAD 可选。设为 true 时强制下载 http 图片再发送（默认直传 URL）
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

const PROVIDER_PRESETS = {
  aliyun: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-plus",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
  },
  siliconflow: {
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-VL-72B-Instruct",
  },
};

const PROVIDER = (process.env.VISION_PROVIDER || "aliyun").toLowerCase();
const preset = PROVIDER_PRESETS[PROVIDER] || PROVIDER_PRESETS.aliyun;

const BASE_URL = (process.env.VISION_BASE_URL || preset.baseUrl).replace(/\/+$/, "");
const MODEL = process.env.VISION_MODEL || preset.model;
const TIMEOUT = Number(process.env.VISION_TIMEOUT || 120000);
const MAX_TOKENS = Number(process.env.VISION_MAX_TOKENS || 1024);
const MAX_RETRIES_ON_TRUNCATION = 2; // 输出被 max_tokens 截断时自动翻倍重试次数
const MAX_IMAGE_MB = Number(process.env.VISION_MAX_IMAGE_MB || 15);
const FORCE_DOWNLOAD =
  String(process.env.VISION_FORCE_DOWNLOAD || "false").toLowerCase() === "true";
// 深度思考开关：默认关闭（qwen3 系列 enable_thinking=false），设为 true 可开启
const ENABLE_THINKING =
  String(process.env.VISION_ENABLE_THINKING || "false").toLowerCase() === "true";
const API_KEY =
  process.env.VISION_API_KEY ||
  process.env.DASHSCOPE_API_KEY ||
  process.env.OPENAI_API_KEY ||
  "";

const SERVER_VERSION = "1.1.0";

if (!API_KEY) {
  console.error(
    "警告: 未设置 API Key。请设置环境变量 VISION_API_KEY (或 DASHSCOPE_API_KEY / OPENAI_API_KEY)。"
  );
}

const server = new McpServer({
  name: "vision-mcp",
  version: SERVER_VERSION,
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

/**
 * 装载图片。返回 { mime, data }（内联 base64）或 { remoteUrl }（http URL 直传，不下载）。
 */
async function loadImage(image) {
  // data:image/png;base64,xxxx
  if (image.startsWith("data:")) {
    const comma = image.indexOf(",");
    const header = image.slice(5, comma);
    const mime = header.split(";")[0] || "image/png";
    const b64 = image.slice(comma + 1);
    return { mime, data: Buffer.from(b64, "base64") };
  }

  // http(s):// URL —— 默认直传 URL（B4），VISION_FORCE_DOWNLOAD=true 时才下载
  if (image.startsWith("http://") || image.startsWith("https://")) {
    if (!FORCE_DOWNLOAD) {
      return { remoteUrl: image };
    }
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

/**
 * 大图自动压缩（B1）：超过 VISION_MAX_IMAGE_MB 时用 sharp 转 JPEG。
 * sharp 未安装时给出明确错误而非玄学超时。
 */
async function maybeCompress(img) {
  if (img.remoteUrl || !img.data || img.data.length <= MAX_IMAGE_MB * 1024 * 1024) {
    return img;
  }
  const mb = (n) => (n / 1048576).toFixed(1);
  try {
    const sharp = (await import("sharp")).default;
    const jpeg = await sharp(img.data, { limitInputPixels: 100_000_000 })
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer();
    console.error(
      `[vision-mcp] 图片 ${mb(img.data.length)}MB 超过上限 ${MAX_IMAGE_MB}MB，已压缩为 JPEG ${mb(jpeg.length)}MB`
    );
    return { mime: "image/jpeg", data: jpeg };
  } catch (e) {
    throw new Error(
      `图片 ${mb(img.data.length)}MB 超过上限 ${MAX_IMAGE_MB}MB，且无法自动压缩（需要 sharp，可用 npm install sharp 安装）: ${e.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// API 调用
// ---------------------------------------------------------------------------

const HTTP_ERROR_HINTS = {
  401: "API Key 无效或已过期，请检查 VISION_API_KEY",
  403: "无权限访问该模型/资源（检查 Key 权限与模型名）",
  404: "模型或端点不存在，请检查 VISION_MODEL / VISION_BASE_URL",
  429: "请求过于频繁或余额不足（限流），请稍后重试或检查账户余额",
  500: "模型服务端错误，请稍后重试",
};

async function callVision(messages, maxTokens = MAX_TOKENS, attempt = 0) {
  const body = JSON.stringify({
    model: MODEL,
    messages,
    max_tokens: maxTokens,
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
    const hint = HTTP_ERROR_HINTS[resp.status] || "未知错误";
    throw new Error(`视觉 API 请求失败 HTTP ${resp.status}（${hint}）: ${raw.slice(0, 500)}`);
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

  // B2：输出被 max_tokens 截断时自动翻倍重试
  const finish = result?.choices?.[0]?.finish_reason;
  if (finish === "length" && attempt < MAX_RETRIES_ON_TRUNCATION) {
    console.error(`[vision-mcp] 输出被截断（max_tokens=${maxTokens}），翻倍重试`);
    return callVision(messages, maxTokens * 2, attempt + 1);
  }
  return content;
}

function imageMessage(img, text) {
  return {
    role: "user",
    content: [
      {
        type: "image_url",
        image_url: img.remoteUrl ? { url: img.remoteUrl } : { url: `data:${img.mime};base64,${img.data.toString("base64")}` },
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
    const img = await maybeCompress(await loadImage(image));
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
    const img = await maybeCompress(await loadImage(image));
    const result = await callVision([imageMessage(img, text)]);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "vision_version",
  {},
  async () => {
    const info = {
      version: SERVER_VERSION,
      provider: PROVIDER,
      baseUrl: BASE_URL,
      model: MODEL,
      maxTokens: MAX_TOKENS,
      enableThinking: ENABLE_THINKING,
      maxImageMB: MAX_IMAGE_MB,
      forceDownload: FORCE_DOWNLOAD,
      hasApiKey: Boolean(API_KEY),
    };
    return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
