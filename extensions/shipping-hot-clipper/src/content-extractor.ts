// Adapted from obsidian-clipper@6d56d618b00bd970aa738d6a7a61edee27783e81
// src/utils/content-extractor.ts:67-125 (MIT). Direct one-shot injection replaces
// background messaging
// retain explicit failures and one bounded reinjection retry.
import { parseClipDraft } from "../../../shared/manual-clip"
import type { ClipMode } from "../../../shared/manual-clip"
import { chromeAPI as chrome } from "./chrome"

async function sendExtractRequest(tabId: number, mode: ClipMode, expectedUrl: string) {
  // mode is set by a closure-free injected function serialized by Chrome.
  const setter = new Map<ClipMode, () => void>([
    ["metadata", () => {
      (globalThis as unknown as { shippingClipMode: string, shippingClipResult: unknown }).shippingClipMode = "metadata"
      delete (globalThis as { shippingClipResult?: unknown }).shippingClipResult
    }],
    ["selection", () => {
      (globalThis as unknown as { shippingClipMode: string, shippingClipResult: unknown }).shippingClipMode = "selection"
      delete (globalThis as { shippingClipResult?: unknown }).shippingClipResult
    }],
    ["article", () => {
      (globalThis as unknown as { shippingClipMode: string, shippingClipResult: unknown }).shippingClipMode = "article"
      delete (globalThis as { shippingClipResult?: unknown }).shippingClipResult
    }],
  ])
  const [started] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: setter.get(mode) })
  const [response] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ["content.js"] })
  if (!response || response.frameId !== 0 || !response.documentId) throw new Error("clip_no_content")
  const [current] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: () => {
    const context = globalThis as { shippingClipResult?: unknown, shippingClipMode?: string }
    const result = { draft: context.shippingClipResult, url: location.href }
    delete context.shippingClipResult
    delete context.shippingClipMode
    return result
  } })
  const result = current?.result as { draft?: unknown, url?: unknown } | undefined
  if (started?.documentId !== response.documentId || current?.documentId !== response.documentId || result?.url !== expectedUrl) throw new Error("clip_navigation_changed")
  const draft = parseClipDraft(result?.draft)
  if (draft.actualUrl !== expectedUrl) throw new Error("clip_navigation_changed")
  return draft
}
export async function extractPageContent(tabId: number, mode: ClipMode, expectedUrl: string) {
  try {
    return await sendExtractRequest(tabId, mode, expectedUrl)
  } catch (error) {
    if (error instanceof Error && error.message === "clip_navigation_changed") throw error
    try {
      return await sendExtractRequest(tabId, mode, expectedUrl)
    } catch {
      throw new Error("剪藏提取失败或页面已变化，请回到原页后重试；也可选择仅标题链接。")
    }
  }
}
