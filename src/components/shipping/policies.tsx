import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type PolicyDetail, type PolicyListResponse, type PolicyRecordView, policyCategories, policyCountries, policyDeclaredStatuses, policyDisplayLabels, policyPlatforms, policySourceTypes } from "@shared/policy"
import { ShippingShell } from "./app"
import { myFetch } from "~/utils"
import "./annual-calendar.css"

const positionLabels: Record<PolicyRecordView["datePosition"], string> = { future: "未来生效", in_effect: "生效期内", past_expiry: "已过失效日", undated: "生效日未定", not_applicable: "不适用自动生效" }
const entryStatuses = ["rumor", "draft", "published", "effective"] as const

interface FormState {
  [key: string]: string | boolean
}
const emptyForm: FormState = { category: "customs_tax", countryCode: "VN", platform: "", title: "", documentNumber: "", publisher: "", publishedAt: "", effectiveAt: "", expiresAt: "", status: "published", scopeText: "", stage: "", sourceType: "official", sourceUrl: "", bodyExcerpt: "", fullText: "", basisText: "", enteredBy: "", isFixture: false, supersedesPolicyId: "", relation: "revised", changeSummary: "" }

function formFrom(record: PolicyRecordView): FormState {
  return { ...emptyForm, category: record.category, countryCode: record.countryCode, platform: record.platform ?? "", title: record.title, documentNumber: record.documentNumber ?? "", publisher: record.publisher ?? "", publishedAt: record.publishedAt ?? "", effectiveAt: record.effectiveAt ?? "", expiresAt: record.expiresAt ?? "", status: entryStatuses.includes(record.status as never) ? record.status : "published", scopeText: record.scopeText ?? "", stage: record.stage ?? "", sourceType: record.sourceType, sourceUrl: record.sourceUrl, bodyExcerpt: record.bodyExcerpt ?? "", fullText: record.fullText ?? "", basisText: record.basisText, enteredBy: "", isFixture: record.isFixture }
}

function errorCode(error: unknown): string {
  const e = error as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
  return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? "unknown_error"
}

export function PoliciesPage() {
  const client = useQueryClient()
  const [filter, setFilter] = useState({ country: "", platform: "", category: "", status: "", effectiveFrom: "", effectiveTo: "", q: "" })
  const [selectedId, setSelectedId] = useState("")
  const [mode, setMode] = useState<"create" | "revise">("create")
  const [form, setForm] = useState<FormState>(emptyForm)
  const [message, setMessage] = useState("")
  const [repeal, setRepeal] = useState({ actor: "", changeSummary: "", sourceUrl: "" })
  const params = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString()
  const list = useQuery({ queryKey: ["policies", params], queryFn: () => myFetch<PolicyListResponse>(`/shipping/policies${params ? `?${params}` : ""}`), retry: false, refetchOnWindowFocus: false })
  const detail = useQuery({ queryKey: ["policy", selectedId], queryFn: () => myFetch<PolicyDetail>(`/shipping/policies/${encodeURIComponent(selectedId)}`), enabled: Boolean(selectedId), retry: false, refetchOnWindowFocus: false })
  const set = (key: string, value: string | boolean) => setForm(current => ({ ...current, [key]: value }))

  async function submit() {
    setMessage("")
    const body: Record<string, unknown> = { ...form }
    for (const key of Object.keys(body)) {
      if (body[key] === "") delete body[key]
    }
    try {
      const saved = mode === "revise"
        ? await myFetch<PolicyRecordView>(`/shipping/policies/${encodeURIComponent(selectedId)}/revise`, { method: "POST", body })
        : await myFetch<PolicyRecordView>("/shipping/policies", { method: "POST", body })
      setMessage(`已保存：${saved.title}（v${saved.currentVersionNumber}）`)
      setSelectedId(saved.id)
      setMode("create")
      setForm(emptyForm)
      await client.invalidateQueries({ queryKey: ["policies"] })
      await client.invalidateQueries({ queryKey: ["policy"] })
    } catch (error) {
      setMessage(`保存失败：${errorCode(error)}`)
    }
  }

  function startRevise(record: PolicyRecordView) {
    setMode("revise")
    setForm(formFrom(record))
  }

  function cancelRevise() {
    setMode("create")
    setForm(emptyForm)
  }

  async function submitRepeal() {
    setMessage("")
    try {
      await myFetch(`/shipping/policies/${encodeURIComponent(selectedId)}/repeal`, { method: "POST", body: repeal })
      setMessage("已废止（旧版本与原依据保留）")
      await client.invalidateQueries({ queryKey: ["policies"] })
      await client.invalidateQueries({ queryKey: ["policy"] })
    } catch (error) {
      setMessage(`废止失败：${errorCode(error)}`)
    }
  }

  const d = detail.data
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
      <div className="annual-calendar" data-testid="policies-page">
        <div className="annual-heading">
          <div>
            <p className="eyebrow-sh">POLICY LIBRARY / R1.5-7</p>
            <h1>政策库</h1>
            <p>人工录入 · 版本永久保留 · 不推断停工或风险事件 · 未接入自动抓取/匹配（R3）</p>
          </div>
        </div>
        <div className="annual-notice" data-testid="policy-clock">
          {list.data ? `判断日：${list.data.today}（UTC+8 日历日）${list.data.clock === "test" ? " · 测试时钟 TEST_NOW" : " · 系统时钟"}` : "读取中…"}
          。只有「已发布待生效」会在生效日自动显示为已生效；传闻、征求意见、已修订、已废止不会自动生效。
        </div>
        <section className="annual-panel" aria-label="筛选">
          <div className="annual-controls" style={{ flexWrap: "wrap", gap: 8 }}>
            {(["country", "platform", "category", "status"] as const).map((key) => {
              const options: Record<string, string> = key === "country" ? policyCountries : key === "platform" ? policyPlatforms : key === "category" ? policyCategories : policyDisplayLabels
              return (
                <select key={key} data-testid={`filter-${key}`} aria-label={key} value={filter[key]} onChange={e => setFilter(f => ({ ...f, [key]: e.target.value }))}>
                  <option value="">{`全部${{ country: "国家", platform: "平台", category: "类别", status: "状态" }[key]}`}</option>
                  {Object.entries(options).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              )
            })}
            <input data-testid="filter-effectiveFrom" type="date" aria-label="生效日起" value={filter.effectiveFrom} onChange={e => setFilter(f => ({ ...f, effectiveFrom: e.target.value }))} />
            <input data-testid="filter-effectiveTo" type="date" aria-label="生效日止" value={filter.effectiveTo} onChange={e => setFilter(f => ({ ...f, effectiveTo: e.target.value }))} />
            <input data-testid="filter-q" placeholder="搜索标题/文号/发布方" value={filter.q} onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
            <a data-testid="policy-export" href={`/api/shipping/policies/export${params ? `?${params}` : ""}`}>导出表格（CSV，与当前筛选一致）</a>
          </div>
          <div data-testid="policy-count">{list.isError ? "读取失败" : `${list.data?.total ?? 0} 条`}</div>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>标题</th>
                <th>国家</th>
                <th>平台</th>
                <th>类别</th>
                <th>当前状态</th>
                <th>生效日</th>
                <th>来源</th>
                <th>版本</th>
              </tr>
            </thead>
            <tbody>
              {(list.data?.records ?? []).map(r => (
                <tr key={r.id} data-testid="policy-row" data-id={r.id} data-status={r.displayStatus} onClick={() => setSelectedId(r.id)} style={{ cursor: "pointer", fontWeight: r.id === selectedId ? 700 : 400 }}>
                  <td>
                    {r.isFixture && <strong className="annual-evidence-pending">[示例 fixture，非真实公告] </strong>}
                    {r.title}
                  </td>
                  <td>{r.countryCode}</td>
                  <td>{r.platform ? policyPlatforms[r.platform] : "—"}</td>
                  <td>{policyCategories[r.category]}</td>
                  <td>{`${policyDisplayLabels[r.displayStatus]}${r.autoActivated ? "（⚙ 到生效日自动）" : ""}`}</td>
                  <td>{`${r.effectiveAt ?? "未定"} · ${positionLabels[r.datePosition]}`}</td>
                  <td>{policySourceTypes[r.sourceType] ?? r.sourceType}</td>
                  <td>{`v${r.currentVersionNumber}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {d && (
          <section className="annual-panel" data-testid="policy-detail" aria-label="政策详情">
            <h2>{d.record.title}</h2>
            {d.record.isFixture && <p className="annual-evidence-pending" data-testid="policy-fixture-label">示例（fixture）：仅用于验收，不是真实官方公告。</p>}
            <p>{`${policyCountries[d.record.countryCode]} · ${d.record.platform ? policyPlatforms[d.record.platform] : "无平台"} · ${policyCategories[d.record.category]} · 文号 ${d.record.documentNumber ?? "无"} · 发布方 ${d.record.publisher ?? "未填"}`}</p>
            <p data-testid="policy-detail-status">{`录入状态：${policyDeclaredStatuses[d.record.status]} · 当前状态：${policyDisplayLabels[d.record.displayStatus]}${d.record.autoActivated ? "（⚙ 到生效日自动）" : ""} · 发布日 ${d.record.publishedAt ?? "未填"} · 生效日 ${d.record.effectiveAt ?? "未定"} · 失效日 ${d.record.expiresAt ?? "未填"}`}</p>
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
            {(d.record.supersedesPolicyId || d.record.supersededByPolicyId) && (
              <p data-testid="policy-relation">
                {d.record.supersedesPolicyId && `替代：${d.record.supersedesPolicyId}（${d.record.relationKind === "repealed" ? "废止" : "修订"}） `}
                {d.record.supersededByPolicyId && `已被 ${d.record.supersededByPolicyId} ${d.record.relationKind === "repealed" ? "废止" : "修订"}`}
              </p>
            )}
            <h3>{`版本（${d.versions.length}，旧版本永久保留）`}</h3>
            {d.versions.map(v => (
              <article key={v.id} data-testid="policy-version" data-version={v.versionNumber}>
                <strong>{`v${v.versionNumber} · ${policyDeclaredStatuses[v.status]} · 生效日 ${v.effectiveAt ?? "未定"} · ${v.createdAt.slice(0, 19)}Z · ${v.enteredBy ?? ""}${v.supersededByVersionId ? " · 已被新版本取代" : " · 当前版本"}`}</strong>
                <p>{`标题：${v.title} · 变更：${v.changeSummary ?? ""}`}</p>
                {v.snapshot && <p>{`该版本依据：${v.snapshot.basisText} · 来源：${v.sourceUrl}`}</p>}
              </article>
            ))}
            <h3>变更记录</h3>
            <ul data-testid="policy-changelog">
              {d.changeLog.map(c => <li key={c.id}>{`${c.createdAt.slice(0, 19)}Z · ${c.action} · ${c.actor} · ${c.summary}`}</li>)}
            </ul>
            {!["revised", "repealed"].includes(d.record.status) && (
              <div>
                <button
                  type="button"
                  data-testid="policy-start-revise"
                  onClick={() => startRevise(d.record)}
                >
                  修订（新增版本）
                </button>
                <div>
                  <input data-testid="repeal-actor" placeholder="录入人" value={repeal.actor} onChange={e => setRepeal(r => ({ ...r, actor: e.target.value }))} />
                  <input data-testid="repeal-reason" placeholder="废止原因" value={repeal.changeSummary} onChange={e => setRepeal(r => ({ ...r, changeSummary: e.target.value }))} />
                  <input data-testid="repeal-source" placeholder="废止依据 https 链接" value={repeal.sourceUrl} onChange={e => setRepeal(r => ({ ...r, sourceUrl: e.target.value }))} />
                  <button type="button" data-testid="policy-repeal" onClick={submitRepeal}>废止（无替代）</button>
                </div>
              </div>
            )}
          </section>
        )}
        <section className="annual-panel" data-testid="policy-form" aria-label="政策录入表单">
          <h2>{mode === "revise" ? `修订：${d?.record.title ?? ""}（提交后新增版本，旧版本保留）` : "人工录入新政策"}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {select("category", "类别", policyCategories)}
            {select("countryCode", "国家", policyCountries)}
            {select("platform", "平台", policyPlatforms, true)}
            {text("title", "标题")}
            {text("documentNumber", "文号")}
            {text("publisher", "发布方")}
            {text("publishedAt", "发布日", "date")}
            {text("effectiveAt", "生效日", "date")}
            {text("expiresAt", "失效日", "date")}
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
          <button type="button" data-testid="policy-submit" onClick={submit}>{mode === "revise" ? "提交修订" : "保存"}</button>
          {mode === "revise" && (
            <button
              type="button"
              onClick={cancelRevise}
            >
              取消修订
            </button>
          )}
          <p role="status" data-testid="policy-message">{message}</p>
        </section>
      </div>
    </ShippingShell>
  )
}
