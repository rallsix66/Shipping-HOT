import { CLIP_EXTENSION_ID, CLIP_ORIGIN, parseClipTransfer } from "../../../shared/clipper-bridge"
import type { ClipDraft, ClipMode } from "../../../shared/manual-clip"
import { chromeAPI as chrome } from "./chrome"
import { extractPageContent } from "./content-extractor"
import "./popup.css"

const field = (id: string) => document.getElementById(id) as HTMLInputElement
function message(text: string) {
  document.getElementById("status")!.textContent = text
}
let draft: ClipDraft | undefined
let busy = false
async function extract() {
  if (busy) return
  busy = true
  try {
    if (chrome.runtime.id !== CLIP_EXTENSION_ID) throw new Error("扩展ID不匹配，请核对本地包。")
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url) throw new Error("此页面不允许剪藏。")
    draft = await extractPageContent(tab.id, field("mode").value as ClipMode, tab.url)
    field("url").value = draft.actualUrl
    field("title").value = draft.title
    field("body").value = draft.body
    document.getElementById("date")!.textContent = `页面时间：${draft.date.raw || "未知"}`
    message(`仅本地预览，尚未发送或保存。接收入口：${CLIP_ORIGIN}/feed`)
  } catch (error) {
    draft = undefined
    message(error instanceof Error ? error.message : "提取失败")
  } finally {
    busy = false
  }
}
document.getElementById("extract")!.addEventListener("click", () => {
  void extract()
})
document.getElementById("send")!.addEventListener("click", () => {
  if (!draft || busy) return
  busy = true
  void (async () => {
    const transfer = parseClipTransfer({ draft: { ...draft, title: field("title").value, body: field("body").value }, requestId: crypto.randomUUID() })
    const result = await chrome.runtime.sendMessage(transfer) as { ok?: boolean }
    if (!result?.ok) throw new Error("发送未确认")
    message("已送入系统预览；请在系统中核对并点击保存。草稿两分钟过期，仅可领取一次。")
  })().catch(() => message("发送未确认，请重新提取并检查系统入口是否已打开；正文最多100000字符。")).finally(() => {
    busy = false
  })
})
void extract()
