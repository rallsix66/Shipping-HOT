import { CLIP_EXTENSION_ID, CLIP_ORIGIN, parseClipTransfer } from "../../../shared/clipper-bridge"
import type { ClipDraft, ClipMode, DateRole } from "../../../shared/manual-clip"
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
    field("date").value = draft.date.raw
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
document.getElementById("metadata")!.addEventListener("click", () => {
  if (!draft) return
  draft = { ...draft, mode: "metadata", body: "" }
  field("body").value = ""
  field("scope").value = "metadata_only"
  message("已按你的选择移除本次草稿正文；仅带标题、链接和时间证据。")
})
document.getElementById("send")!.addEventListener("click", () => {
  if (!draft || busy) return
  busy = true
  void (async () => {
    const transfer = parseClipTransfer({ draft: { ...draft, title: field("title").value, body: field("body").value, date: { ...draft!.date, raw: field("date").value, role: field("role").value as DateRole } }, rights: { basis: field("basis").value, scope: field("scope").value, evidence: field("evidence").value, applicableUrl: draft!.actualUrl }, operator: field("operator").value, requestId: crypto.randomUUID() })
    const result = await chrome.runtime.sendMessage(transfer) as { ok?: boolean }
    if (!result?.ok) throw new Error("发送未确认")
    message("已送入系统预览；请在系统中核对并点击保存。草稿两分钟过期，仅可领取一次。")
  })().catch(() => message("不能发送：请填写录入人；正文需明确权利依据与范围，摘录最多280字符。未知权利请明确移除正文。也请检查系统入口和扩展ID。")).finally(() => {
    busy = false
  })
})
void extract()
