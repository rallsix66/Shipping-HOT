import type { Plugin } from "vite"

export function clipSyntheticMark(): Plugin {
  return {
    name: "shipping-clip-synthetic-mark",
    transformIndexHtml(html) {
      return html.replace("<body>", "<body><aside role=\"note\" style=\"padding:12px;background:#ffe8a3;color:#171717;font:700 16px/1.5 sans-serif;position:relative;z-index:10000\">合成测试版 · 仅本地合成资料 · 非正式HTTPS验收</aside>")
    },
  }
}
