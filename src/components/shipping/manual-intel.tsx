import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { ClipAudit } from "@shared/manual-clip"
import { MANUAL_CLIP_SOURCE_ID } from "@shared/manual-clip"
import { ShippingShell } from "./app"
import { ClipImporter } from "./clip-import"
import { FeedPage } from "./pages"
import { myFetch } from "~/utils"
import "./manual-intel.css"

interface Action {
  operator: string
  entered_at: string
  action: string
  outcome: string
}
interface Source {
  id: string
  catalogId: string
  name: string
  urls: string[]
  grade: string
  cadence: string
  focus: string
  historicalOnly: boolean
  persistence: string
  recentActions: Action[]
}
interface Item {
  manualEntry?: { operator: string, enteredAt: string } | null
  id: string
  sourceId: string
  title: string
  canonicalUrl: string | null
  publishedAt: string | null
  firstSeenAt: string
}
interface Detail {
  clip?: ClipAudit | null
  manualLabel: string | null
  manualEntry?: { operator: string, enteredAt: string } | null
  item: Item
  source: { name: string, persistence: string }
  manualActions: Action[]
  selectedVersion: { id: string, publishedAt: string | null, blocks: { blockKey: string, text: string }[] } | null
  versions: { items: { id: string, createdAt: string }[] }
}

export function FeedRoutePage() {
  const [legacy, setLegacy] = useState(false)
  if (legacy) {
    return (
      <>
        <button type="button" className="chip" onClick={() => setLegacy(false)}>返回资讯录入与记录</button>
        <FeedPage />
      </>
    )
  }
  return <ManualIntelPage onLegacy={() => setLegacy(true)} />
}

export function ManualIntelPage({ onLegacy }: { onLegacy: () => void }) {
  const client = useQueryClient()
  const [sourceId, setSourceId] = useState("")
  const [operator, setOperator] = useState("")
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [publishedAt, setPublishedAt] = useState("")
  const [selected, setSelected] = useState("")
  const [version, setVersion] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState<{ requestId: string, fingerprint: string } | null>(null)
  const sources = useQuery({ queryKey: ["intel-manual"], queryFn: () => myFetch<{ items: Source[] }>("/shipping/intel/manual"), retry: false })
  const items = useQuery({ queryKey: ["intel-items", sourceId], queryFn: () => myFetch<{ items: Item[], hasMore: boolean }>(`/shipping/intel/items?limit=50${sourceId ? `&sourceId=${encodeURIComponent(sourceId)}` : ""}`), retry: false })
  const detail = useQuery({ queryKey: ["intel-item", selected, version], queryFn: () => myFetch<Detail>(`/shipping/intel/items/${encodeURIComponent(selected)}${version ? `?versionId=${encodeURIComponent(version)}` : ""}`), enabled: Boolean(selected), retry: false })
  const source = sources.data?.items.find(row => row.id === sourceId)
  async function save(action: "submit" | "checked_empty") {
    const data = action === "submit" ? { sourceId, operator, action, url, title, body, publishedAt } : { sourceId, operator, action }
    const fingerprint = JSON.stringify(data)
    const requestId = pending?.fingerprint === fingerprint ? pending.requestId : crypto.randomUUID()
    setPending({ requestId, fingerprint })
    setBusy(true)
    setMessage("")
    try {
      const result = await myFetch<{ outcome: string, itemId?: string }>("/shipping/intel/manual", { method: "POST", body: { ...data, requestId } })
      setMessage(result.outcome === "checked_empty" ? "已记录：查看后无新内容。不是抓取成功或来源已验证。" : `已保存：${result.outcome}。人工录入不代表已核实港口影响。`)
      setPending(null)
      if (result.itemId) {
        setSelected(result.itemId)
        setVersion("")
      }
      await client.invalidateQueries({ queryKey: ["intel-manual"] })
      await client.invalidateQueries({ queryKey: ["intel-items"] })
      await client.invalidateQueries({ queryKey: ["intel-item"] })
    } catch {
      setMessage("保存未确认，请检查字段或重试；输入保留，重试沿用同一提交编号。")
    } finally {
      setBusy(false)
    }
  }
  return (
    <ShippingShell title="资讯录入与记录">
      <div className="manual-intel">
        <div className="console-head">
          <h2 className="console-title">资讯录入与记录</h2>
          <button type="button" className="chip" onClick={onLegacy}>已有 Feed 与天气预警</button>
        </div>
        <p>正文许可仅适用于已核实的精确 Feed 产品 URL；同域其他页面仅保存元数据。纯手动表单：粘贴 URL 不联网，不自动识别字段、不调用模型。未知发布时间留空；录入人是本地操作者自填，未经账户认证。风险分析尚未开放。</p>
        <ClipImporter onSaved={(id) => {
          setSelected(id)
          setVersion("")
          void client.invalidateQueries({ queryKey: ["intel-items"] })
          void client.invalidateQueries({ queryKey: ["intel-item"] })
          void client.invalidateQueries({ queryKey: ["intel-manual"] })
        }}
        />
        <div className="manual-grid">
          <aside className="filter-panel">
            <h3>人工信源检查清单</h3>
            {sources.isPending && <p>读取中</p>}
            {sources.isError && <p role="alert">检查清单读取失败，不能当作没有来源。</p>}
            {!sources.isError && sources.data?.items.map(row => (
              <div key={row.id} className="manual-source">
                <button
                  type="button"
                  className={`fbtn${sourceId === row.id ? " active" : ""}`}
                  onClick={() => {
                    setSourceId(row.id)
                    setBody("")
                    setSelected("")
                    setVersion("")
                  }}
                >
                  {row.catalogId}
                  {" "}
                  ·
                  {" "}
                  {row.name}
                </button>
                <p>{row.focus}</p>
                <p>
                  建议：
                  {row.cadence}
                  {" "}
                  ·
                  {row.historicalOnly ? "仅历史回放，不开放录入" : `保存许可：${row.persistence}`}
                </p>
                {row.urls.map(link => <a key={link} href={link} target="_blank" rel="noreferrer">自行打开原站</a>)}
                <p>{row.recentActions[0] ? `上次${row.recentActions[0].action === "checked_empty" ? "查看（无新内容）" : "录入"}：${row.recentActions[0].entered_at} · ${row.recentActions[0].operator}` : "尚无查看或录入记录（不是失败）"}</p>
              </div>
            ))}
          </aside>
          <section className="glass-panel">
            <h3>显式人工录入</h3>
            <p>{source ? `${source.catalogId} · 保存许可：${source.persistence}；官方通知/报道属性来自目录，人工提交尚未独立核实。` : "请先选择目录中的来源。"}</p>
            <form onSubmit={(event) => {
              event.preventDefault()
              void save("submit")
            }}
            >
              <label>
                录入人
                <input required maxLength={80} value={operator} onChange={event => setOperator(event.target.value)} />
              </label>
              <label>
                原文链接（HTTPS）
                <input required type="url" maxLength={2048} value={url} onChange={event => setUrl(event.target.value)} />
              </label>
              <label>
                标题
                <input required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} />
              </label>
              <label>
                原文发布时间（带时区 ISO；未知留空）
                <input placeholder="2026-10-14T12:00:00+07:00" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} />
              </label>
              <label>
                许可范围纯文本（不接受 HTML）
                <textarea disabled={!source || source.persistence === "disallowed"} maxLength={100000} value={body} onChange={event => setBody(event.target.value)} />
              </label>
              {sourceId === MANUAL_CLIP_SOURCE_ID && <p>人工剪藏资料请使用上方插件导入；此处原目录表单不授予剪藏正文许可。</p>}
              <button className="chip" disabled={busy || !source || source.historicalOnly || sourceId === MANUAL_CLIP_SOURCE_ID} type="submit">{busy ? "保存中" : "保存人工条目"}</button>
              <button className="chip" disabled={busy || !source || source.historicalOnly || !operator.trim() || sourceId === MANUAL_CLIP_SOURCE_ID} type="button" onClick={() => void save("checked_empty")}>已查看，无新内容</button>
            </form>
            <p role="status">{message}</p>
            <h3>持久化资讯（最多 50 条）</h3>
            {items.isPending && <p>读取中</p>}
            {items.isError && <p role="alert">资讯读取失败；已存记录未删除。</p>}
            {!items.isError && items.data?.items.length === 0 && <p>此筛选暂无已存条目。</p>}
            {!items.isError && items.data?.items.map(item => (
              <article key={item.id} className="manual-source">
                <button
                  type="button"
                  className="fbtn"
                  onClick={() => {
                    setSelected(item.id)
                    setVersion("")
                  }}
                >
                  {item.title}
                </button>
                <p>
                  原文发布时间：
                  {item.publishedAt ?? "未知"}
                  {" "}
                  · 首次入库：
                  {item.firstSeenAt}
                  （不是发布时间）
                </p>
                {item.manualEntry && <p>{`人工录入 · ${item.manualEntry.operator} · 操作者录入时间：${item.manualEntry.enteredAt}（不是发布时间）`}</p>}
                {item.canonicalUrl && <a href={item.canonicalUrl} target="_blank" rel="noreferrer">原文</a>}
              </article>
            ))}
            {items.data?.hasMore && <p>还有更多记录，本片仅展示前 50 条。</p>}
            {selected && (
              <section>
                <h3>正文与旧版本</h3>
                {detail.isPending && <p>读取中</p>}
                {detail.isError && <p role="alert">详情读取失败</p>}
                {!detail.isError && detail.data && (
                  <>
                    <p>{`所选版本原文发布时间：${detail.data.selectedVersion?.publishedAt ?? "未知"}（不以录入时间代替）`}</p>
                    {detail.data.manualEntry && <p>{`所选版本录入人：${detail.data.manualEntry.operator} · 录入时间：${detail.data.manualEntry.enteredAt}`}</p>}
                    <p>{detail.data.manualLabel ? `${detail.data.manualLabel} · 真实性未独立核验` : "未记录人工提交，保留原有来源"}</p>
                    {detail.data.clip && (
                      <div className="manual-text">
                        <p>{`实际来源地址：${detail.data.clip.actualUrl}`}</p>
                        <p>{`剪藏方式：${detail.data.clip.mode}；浏览器提取时间：${detail.data.clip.capturedAt}（不是发布时间）`}</p>
                        <p>{`原时间证据：${detail.data.clip.date.raw || "未知"}；字段：${detail.data.clip.date.field || "未知"}；角色：${detail.data.clip.date.role}`}</p>
                        <p>{`权利依据：${detail.data.clip.rights.basis}；范围：${detail.data.clip.rights.scope}；说明：${detail.data.clip.rights.evidence || "无"}；声明人：${detail.data.clip.declaredBy}；声明时间：${detail.data.clip.declaredAt}。用户声明未经独立核验，不授予自动采集、转发或模型使用权限。`}</p>
                      </div>
                    )}
                    {detail.data.manualActions.map((action, index) => (
                      <p key={index}>
                        录入人：
                        {action.operator}
                        {" "}
                        · 操作者录入时间：
                        {action.entered_at}
                        {" "}
                        ·
                        {action.outcome}
                      </p>
                    ))}
                    <label>
                      版本
                      <select value={version || detail.data.selectedVersion?.id || ""} onChange={event => setVersion(event.target.value)}>
                        {detail.data.versions.items.map(row => (
                          <option key={row.id} value={row.id}>
                            {row.createdAt}
                            {" "}
                            ·
                            {" "}
                            {row.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    {detail.data.selectedVersion?.blocks.map(block => <p key={block.blockKey} className="manual-text">{block.text}</p>)}
                  </>
                )}
              </section>
            )}
          </section>
        </div>
      </div>
    </ShippingShell>
  )
}
