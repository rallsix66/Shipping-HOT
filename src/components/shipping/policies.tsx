import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type PolicyDetail, type PolicyListResponse, type PolicyRecordView, policyCategories, policyCountries, policyDeclaredStatuses, policyDisplayLabels, policyPlatforms, policySourceTypes, policyTimezones } from "@shared/policy"
import { ShippingShell } from "./app"
import { PolicyFacts, PolicyHistory, PolicyRows } from "./policy-view"
import { myFetch } from "~/utils"
import "./annual-calendar.css"

const positionLabels: Record<PolicyRecordView["datePosition"], string> = { future: "未来生效", in_effect: "生效期内", past_expiry: "已过失效日", undated: "生效日未定", not_applicable: "不适用自动生效", superseded: "已被替代", timezone_unconfirmed: "适用时区未确认（不自动生效）" }
const entryStatuses = ["rumor", "draft", "published", "effective"] as const

interface FormState {
  [key: string]: string | boolean
}
const emptyForm: FormState = { category: "customs_tax", countryCode: "VN", platform: "", title: "", documentNumber: "", publisher: "", publishedAt: "", effectiveAt: "", expiresAt: "", status: "published", applicableTimezone: "", scopeText: "", stage: "", sourceType: "official", sourceUrl: "", bodyExcerpt: "", fullText: "", basisText: "", enteredBy: "", isFixture: false, supersedesPolicyId: "", relation: "revised", changeSummary: "" }

function formFrom(record: PolicyRecordView): FormState {
  return { ...emptyForm, category: record.category, countryCode: record.countryCode, platform: record.platform ?? "", title: record.title, documentNumber: record.documentNumber ?? "", publisher: record.publisher ?? "", publishedAt: record.publishedAt ?? "", effectiveAt: record.effectiveAt ?? "", expiresAt: record.expiresAt ?? "", status: entryStatuses.includes(record.status as never) ? record.status : "published", applicableTimezone: record.applicableTimezone ?? "", scopeText: record.scopeText ?? "", stage: record.stage ?? "", sourceType: record.sourceType, sourceUrl: record.sourceUrl, bodyExcerpt: record.bodyExcerpt ?? "", fullText: record.fullText ?? "", basisText: record.basisText, enteredBy: "", isFixture: record.isFixture }
}

function errorCode(error: unknown): string {
  const e = error as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
  return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? "unknown_error"
}

export function PoliciesPage() {
  const client = useQueryClient()
  const [filter, setFilter] = useState({ country: "", platform: "", category: "", status: "", effectiveFrom: "", effectiveTo: "", q: "" })
  const [selectedId, setSelectedId] = useState("")
  const [revisionId, setRevisionId] = useState("")
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDetailsElement>(null)
  const [mode, setMode] = useState<"create" | "revise">("create")
  const [form, setForm] = useState<FormState>(emptyForm)
  const [message, setMessage] = useState("")
  const [repeal, setRepeal] = useState({ actor: "", changeSummary: "", sourceUrl: "" })
  const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString()
  const list = useQuery({ queryKey: ["policies", params], queryFn: () => myFetch<PolicyListResponse>(`/shipping/policies${params ? `?${params}` : ""}`), retry: false, refetchOnWindowFocus: false })
  const records = list.data?.records ?? []
  const activeId = records.find(r => r.id === selectedId)?.id ?? records[0]?.id ?? ""
  const detail = useQuery({ queryKey: ["policy", activeId], queryFn: () => myFetch<PolicyDetail>(`/shipping/policies/${encodeURIComponent(activeId)}`), enabled: Boolean(activeId) && !list.isError, retry: false, refetchOnWindowFocus: false })
  const set = (key: string, value: string | boolean) => setForm(current => ({ ...current, [key]: value }))

  async function submit() {
    if (saving) return
    setSaving(true)
    setMessage("")
    const body: Record<string, unknown> = { ...form }
    for (const key of Object.keys(body)) {
      if (body[key] === "") delete body[key]
    }
    try {
      const saved = mode === "revise"
        ? await myFetch<PolicyRecordView>(`/shipping/policies/${encodeURIComponent(revisionId)}/revise`, { method: "POST", body })
        : await myFetch<PolicyRecordView>("/shipping/policies", { method: "POST", body })
      setMessage(`已保存：${saved.title}（v${saved.currentVersionNumber}）`)
      setSelectedId(saved.id)
      setMode("create")
      setRevisionId("")
      setForm(emptyForm)
      await client.invalidateQueries({ queryKey: ["policies"] })
      await client.invalidateQueries({ queryKey: ["policy"] })
    } catch (error) {
      setMessage(`保存失败：${errorCode(error)}`)
    } finally {
      setSaving(false)
    }
  }

  function startRevise(record: PolicyRecordView) {
    setMode("revise")
    setRevisionId(record.id)
    setForm(formFrom(record))
    openForm()
  }

  function cancelRevise() {
    setMode("create")
    setRevisionId("")
    setForm(emptyForm)
  }

  async function submitRepeal() {
    setMessage("")
    try {
      await myFetch(`/shipping/policies/${encodeURIComponent(activeId)}/repeal`, { method: "POST", body: repeal })
      setMessage("已废止（旧版本与原依据保留）")
      await client.invalidateQueries({ queryKey: ["policies"] })
      await client.invalidateQueries({ queryKey: ["policy"] })
    } catch (error) {
      setMessage(`废止失败：${errorCode(error)}`)
    }
  }

  function openForm() {
    if (formRef.current) {
      formRef.current.open = true
      formRef.current.scrollIntoView({ block: "start" })
      formRef.current.querySelector<HTMLSelectElement>("select")?.focus()
    }
  }

  const d = !list.isError && activeId ? detail.data : undefined
  const text = (key: string, label: string, type = "text") => (
    <label className="annual-option" key={key}>
      {label}
      <input data-testid={`pf-${key}`} type={type} value={String(form[key] ?? "")} onChange={e => set(key, e.target.value)} />
    </label>
  )
  const select = (key: string, label: string, options: Record<string, string>, allowEmpty = false) => (
    <label className="annual-option" key={key}>
      {label}
      <select data-testid={`pf-${key}`} value={String(form[key] ?? "")} onChange={e => set(key, e.target.value)}>
        {allowEmpty && <option value="">（无）</option>}
        {Object.entries(options).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </label>
  )

  return (
    <ShippingShell title="政策库">
      <div className="annual-calendar policy-console" data-testid="policies-page">
        <div className="annual-heading">
          <div>

            <h1>政策库</h1>
            <p>各国海关、税收、贸易政策和电商平台规则，长期留存，可按国家、平台、时间查。</p>
          </div>
          <div className="pol-actions">
            <button
              type="button"
              onClick={() => {
                cancelRevise()
                openForm()
              }}
            >
              录入一条新规
            </button>
            <a data-testid="policy-export" href={`/api/shipping/policies/export${params ? `?${params}` : ""}`}>导出表格（当前筛选 CSV）</a>
          </div>
        </div>
        <section className="annual-panel pol-stats" aria-label="当前筛选统计">
          <div>
            <b data-testid="policy-count">{list.isError ? "读取失败" : list.isPending ? "读取中…" : list.data?.total ?? "未知"}</b>
            <span>当前筛选记录数</span>
          </div>
          <div>
            <b>{list.isError || list.isPending ? "—" : records.filter(r => r.displayStatus === "published").length}</b>
            <span>已发布待生效（当前筛选）</span>
          </div>
          <div>
            <b>{list.isError || list.isPending ? "—" : records.filter(r => r.isFixture).length}</b>
            <span>示例记录（当前筛选）</span>
          </div>
        </section>
        <div className="annual-notice" data-testid="policy-clock">
          {list.data ? `当前时刻按各政策「适用时区」的当地日历日判断（UTC+8 参考日 ${list.data.today}）${list.data.clock === "test" ? " · 测试时钟 TEST_NOW" : " · 系统时钟"}` : list.isError ? "时钟信息读取失败" : "读取中…"}
          。只有「已发布待生效」会在生效日自动显示为已生效；传闻、征求意见、已修订、已废止不会自动生效。
        </div>
        <section className="annual-panel pol-filters" aria-label="筛选">
          {(["category", "country", "platform"] as const).map((key) => {
            const options: Record<string, string> = key === "country" ? policyCountries : key === "platform" ? policyPlatforms : policyCategories
            const label = { category: "类别", country: "国家", platform: "平台" }[key]
            return (
              <div className="pol-filter-row" key={key}>
                <span>{label}</span>
                <div className="pol-tabs">
                  <button type="button" aria-pressed={!filter[key]} onClick={() => setFilter(f => ({ ...f, [key]: "" }))}>全部</button>
                  {Object.entries(options).map(([v, name]) => <button type="button" key={v} aria-pressed={filter[key] === v} onClick={() => setFilter(f => ({ ...f, [key]: v }))}>{name}</button>)}
                </div>
              </div>
            )
          })}
          <div className="annual-controls" style={{ flexWrap: "wrap", gap: 8 }}>
            {(["status"] as const).map((key) => {
              const options: Record<string, string> = policyDisplayLabels
              return (
                <select key={key} data-testid={`filter-${key}`} aria-label="政策状态" value={filter[key]} onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}>
                  <option value="">全部状态</option>
                  {Object.entries(options).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              )
            })}
            <input data-testid="filter-effectiveFrom" type="date" aria-label="生效日起" value={filter.effectiveFrom} onChange={e => setFilter(f => ({ ...f, effectiveFrom: e.target.value }))} />
            <input data-testid="filter-effectiveTo" type="date" aria-label="生效日止" value={filter.effectiveTo} onChange={e => setFilter(f => ({ ...f, effectiveTo: e.target.value }))} />
            <input data-testid="filter-q" aria-label="搜索标题、文号、发布方" placeholder="搜索标题/文号/发布方" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
            <button type="button" onClick={() => setFilter({ country: "", platform: "", category: "", status: "", effectiveFrom: "", effectiveTo: "", q: "" })}>重置筛选</button>
          </div>
        </section>
        <div className="pol-cols">
          <section className="annual-panel pol-list-panel" aria-label="政策列表">
            <PolicyRows records={records} selectedId={activeId} state={list.isError ? "error" : list.isPending ? "loading" : "ready"} onSelect={setSelectedId} />
            {list.isError && <button type="button" onClick={() => list.refetch()}>重试列表</button>}
          </section>
          {activeId && !list.isError && detail.isPending && <section className="annual-panel" role="status">正在读取政策详情…</section>}
          {activeId && !list.isError && detail.isError && (
            <section className="annual-panel" role="alert">
              政策详情读取失败。
              <button type="button" onClick={() => detail.refetch()}>重试详情</button>
            </section>
          )}
          {d && (
            <section className="annual-panel" data-testid="policy-detail" aria-label="政策详情">
              <div className="pol-detail-head">
                <span className={`ps ${d.record.displayStatus}`}>{policyDisplayLabels[d.record.displayStatus]}</span>
                <span className="pol-id">{d.record.id}</span>
              </div>
              <h2>{d.record.title}</h2>
              <PolicyFacts record={d.record} />
              {d.record.isFixture && <p className="annual-evidence-pending" data-testid="policy-fixture-label">示例（fixture）：仅用于验收，不是真实官方公告。</p>}
              <p data-testid="policy-detail-status">{`录入状态：${policyDeclaredStatuses[d.record.status]} · 当前状态：${policyDisplayLabels[d.record.displayStatus]}${d.record.autoActivated ? "（⚙ 到生效日自动）" : ""} · 发布日 ${d.record.publishedAt ?? "未填"} · 生效日 ${d.record.effectiveAt ?? "未定"}（${d.record.applicableTimezone ?? "适用时区未确认"}，当地判断日 ${d.record.localToday ?? "无"} · ${positionLabels[d.record.datePosition]}） · 失效日 ${d.record.expiresAt ?? "未填"}`}</p>
              <p>{`来源类型：${policySourceTypes[d.record.sourceType] ?? d.record.sourceType} · 录入方式：人工 · 录入人：${d.record.enteredBy}`}</p>
              <a href={d.record.sourceUrl} target="_blank" rel="noreferrer">{`来源链接 ↗ ${d.record.sourceUrl}`}</a>
              <p>{`依据：${d.record.basisText}`}</p>
              {d.record.scopeText && <p>{`适用范围：${d.record.scopeText}`}</p>}
              {d.record.bodyExcerpt && <p>{`原文摘录：${d.record.bodyExcerpt}`}</p>}
              {d.record.fullText && (
                <details>
                  <summary>{`政府公告全文副本（${d.record.fullText.length} 字）`}</summary>
                  <pre style={{ whiteSpace: "pre-wrap" }}>{d.record.fullText}</pre>
                </details>
              )}
              <p className="pol-unopened">🤖 AI 影响分析 / 自动政策匹配未开放（R3）。此页仅保存人工政策依据，不推断风险或停工。</p>
              <PolicyHistory record={d.record} versions={d.versions} />
              <h3>变更记录</h3>
              <ul data-testid="policy-changelog">
                {d.changeLog.map(c => <li key={c.id}>{`${c.createdAt.slice(0, 19)}Z · ${c.action} · ${c.actor} · ${c.summary}`}</li>)}
              </ul>
              {!["revised", "repealed"].includes(d.record.status) && (
                <div>
                  <button
                    type="button"
                    data-testid="policy-start-revise"
                    disabled={saving}
                    onClick={() => startRevise(d.record)}
                  >
                    修订（新增版本）
                  </button>
                  <div>
                    <input data-testid="repeal-actor" aria-label="废止录入人" placeholder="录入人" value={repeal.actor} onChange={e => setRepeal(r => ({ ...r, actor: e.target.value }))} />
                    <input data-testid="repeal-reason" aria-label="废止原因" placeholder="废止原因" value={repeal.changeSummary} onChange={e => setRepeal(r => ({ ...r, changeSummary: e.target.value }))} />
                    <input data-testid="repeal-source" aria-label="废止依据链接" placeholder="废止依据 https 链接" value={repeal.sourceUrl} onChange={e => setRepeal(r => ({ ...r, sourceUrl: e.target.value }))} />
                    <button type="button" data-testid="policy-repeal" onClick={submitRepeal}>废止（无替代）</button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
        <details ref={formRef} className="annual-panel pol-form" data-testid="policy-form" aria-label="政策录入表单">
          <summary>人工录入 / 修订政策</summary>
          <h2>{mode === "revise" ? `修订：${String(form.title)}（提交后新增版本，旧版本保留）` : "人工录入新政策"}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: 8 }}>
            {select("category", "类别", policyCategories)}
            {select("countryCode", "国家", policyCountries)}
            {select("platform", "平台", policyPlatforms, true)}
            {text("title", "标题")}
            {text("documentNumber", "文号")}
            {text("publisher", "发布方")}
            {text("publishedAt", "发布日", "date")}
            {text("effectiveAt", "生效日", "date")}
            {text("expiresAt", "失效日", "date")}
            {select("applicableTimezone", "适用时区（印尼必须选择）", Object.fromEntries(Object.entries(policyTimezones).map(([k, v]) => [k, v.label])), true)}
            {select("status", "状态", Object.fromEntries(entryStatuses.map(s => [s, policyDeclaredStatuses[s]])))}
            {select("sourceType", "来源类型", policySourceTypes)}
            {text("sourceUrl", "来源链接（https）")}
            {text("enteredBy", "录入人")}
            {text("scopeText", "适用范围")}
            {text("stage", "环节")}
            {text("basisText", "依据说明")}
            {text("bodyExcerpt", "原文摘录（平台规则必填）")}
            <label className="annual-option">
              政府公告全文副本（官方必填）
              <textarea data-testid="pf-fullText" rows={4} value={String(form.fullText)} onChange={e => set("fullText", e.target.value)} />
            </label>
            {mode === "create" && (
              <label className="annual-option">
                <input data-testid="pf-isFixture" type="checkbox" checked={Boolean(form.isFixture)} onChange={e => set("isFixture", e.target.checked)} />
                标记为示例（fixture，非真实公告）
              </label>
            )}
            {mode === "create" && (
              <label className="annual-option">
                替代已有政策（可选）
                <select data-testid="pf-supersedesPolicyId" value={String(form.supersedesPolicyId)} onChange={e => set("supersedesPolicyId", e.target.value)}>
                  <option value="">（不替代）</option>
                  {(list.data?.records ?? []).filter(r => !["revised", "repealed"].includes(r.status)).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </label>
            )}
            {mode === "create" && select("relation", "替代关系", { revised: "修订（旧记录标为已修订）", repealed: "废止（旧记录标为已废止）" })}
            {text("changeSummary", mode === "revise" ? "变更说明（必填）" : "录入说明（可选）")}
          </div>
          <button type="button" data-testid="policy-submit" disabled={saving} onClick={submit}>{mode === "revise" ? "提交修订" : "保存"}</button>
          {mode === "revise" && (
            <button
              type="button"
              onClick={cancelRevise}
            >
              取消修订
            </button>
          )}
        </details>
        <p role="status" data-testid="policy-message">{message}</p>
      </div>
    </ShippingShell>
  )
}
