// Replaced by Vite and Nitro at build time. Undefined in unbundled normal tests.
// Never consult process.env, settings, headers or the page for this capability.
declare const __SHIPPING_CLIP_SYNTHETIC_TEST__: boolean
export const CLIP_SYNTHETIC_TEST = typeof __SHIPPING_CLIP_SYNTHETIC_TEST__ !== "undefined" && __SHIPPING_CLIP_SYNTHETIC_TEST__ === true
export const CLIP_SYNTHETIC_URL = "http://127.0.0.1:5174/synthetic-article.html"
export const CLIP_SYNTHETIC_LABEL = "合成测试版 · 仅本地合成资料 · 非正式HTTPS验收"
export function isSyntheticClipUrl(raw: string): boolean {
  return CLIP_SYNTHETIC_TEST && raw === CLIP_SYNTHETIC_URL
}
