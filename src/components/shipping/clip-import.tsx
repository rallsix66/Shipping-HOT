import { useEffect, useRef, useState } from "react"
import type { ClipTransfer } from "@shared/clipper-bridge"
import { clipSavePayload } from "@shared/clipper-bridge"
import { receiveLocationClip } from "~/utils/clip-import"
import { myFetch } from "~/utils"

export function ClipImporter({ onSaved }: { onSaved: (id: string) => void }) {
  const [draft, setDraft] = useState<ClipTransfer | null>(null)
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const attempted = useRef<{ fingerprint: string, requestId: string } | null>(null)
  useEffect(() => {
    const request = receiveLocationClip()
    if (request) {
      void request.then((value) => {
        setDraft(value)
        setStatus("已领取未保存草稿；请核对后显式保存。刷新页面会丢失草稿。")
      }, () => setStatus("剪藏草稿领取失败或已过期／已领取。请从插件重新发送，并核对入口与扩展ID。"))
    }
  }, [])
  async function save() {
    if (!draft || busy) return
    setBusy(true)
    try {
      const payload = clipSavePayload(draft)
      const fingerprint = JSON.stringify({ ...payload, requestId: undefined })
      const requestId = attempted.current ? attempted.current.fingerprint === fingerprint ? attempted.current.requestId : crypto.randomUUID() : draft.requestId
      attempted.current = { fingerprint, requestId }
      const result = await myFetch<{ outcome: string, itemId: string }>("/shipping/intel/manual", { method: "POST", body: { ...payload, requestId } })
      setStatus(`已保存人工剪藏资料：${result.outcome}；未经独立核验，不是官方预警。`)
      setDraft(null)
      onSaved(result.itemId)
    } catch {
      setStatus("保存未确认。草稿保留，可重试；正文最多100000字符。")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="glass-panel">
      <h3>插件剪藏导入</h3>
      <p>在插件预览后送入这里，再显式保存。人工资料与官方预警分开；不联网补取原文，不调用模型。</p>
      {draft && (
        <form onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        >
          <p className="manual-text">{`实际地址：${draft.draft.actualUrl}`}</p>
          <label>
            标题
            <input maxLength={500} value={draft.draft.title} onChange={event => setDraft({ ...draft, draft: { ...draft.draft, title: event.target.value } })} />
          </label>
          <label>
            正文
            <textarea maxLength={100000} value={draft.draft.body} onChange={event => setDraft({ ...draft, draft: { ...draft.draft, body: event.target.value } })} />
          </label>
          <p className="manual-text">{`页面时间：${draft.draft.date.raw || "未知"}`}</p>
          <p>作为人工私人资料保存，权利状态未知；不代表官方核验。</p>
          <button className="chip" disabled={busy} type="submit">{busy ? "保存中" : "保存人工剪藏资料"}</button>
          <button
            className="chip"
            disabled={busy}
            type="button"
            onClick={() => {
              setDraft(null)
              setStatus("已放弃未保存草稿。")
            }}
          >
            放弃草稿
          </button>
        </form>
      )}
      <p role="status">{status}</p>
    </section>
  )
}
