# Changelog

## [1.1.0] - 2026-08-06

### Added
- 新工具 `vision_version()`：返回当前模型/供应商/Key 状态，方便排查
- 供应商预设 `VISION_PROVIDER`（`aliyun` / `openai` / `siliconflow`），一键切换端点与模型，无需记 BASE_URL
- http(s) URL 图片默认**直传远端 API 不下载**（`VISION_FORCE_DOWNLOAD=true` 可改回下载内联）
- 大图自动压缩：超过 `VISION_MAX_IMAGE_MB`（默认 15MB）自动用 sharp 转 JPEG（sharp 未安装时给出明确错误）
- 输出被 `max_tokens` 截断时自动翻倍重试（最多 2 次）

### Improved
- HTTP 错误分类提示：401（Key 无效）/ 403（无权限）/ 404（模型或端点不存在）/ 429（限流或余额不足）/ 500

## [1.0.1] - 2026-08-06

### Fixed
- bin 规范化警告：`"./server.js"` → `"server.js"`

## [1.0.0] - 2026-08-06

### Added
- 初版发布：`recognize_image` / `ocr_image`，直连 OpenAI 兼容视觉端点
