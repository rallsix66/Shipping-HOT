import { useEffect, useMemo, useRef, useState } from "react"
import { useBlocker } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  LabelDecisionFields,
  LabelDetailResponse,
  LabelListResponse,
} from "@shared/intel-label"
import { ShippingShell } from "./app"
import { myFetch } from "~/utils"
import "./manual-intel.css"

function emptyDecision(): LabelDecisionFields {
  return {
    prefilterKeep: null,
    eventType: null,
    countries: [],
    ports: [],
    effectiveFrom: null,
    isOfficialStatement: null,
    notes: "",
  }
}

function decisionEqual(a: LabelDecisionFields, b: LabelDecisionFields): boolean {
  return JSON.stringify({
    ...a,
    countries: [...a.countries].sort(),
    ports: [...a.ports].sort(),
    notes: a.notes ?? "",
  }) === JSON.stringify({
    ...b,
    countries: [...b.countries].sort(),
    ports: [...b.ports].sort(),
    notes: b.notes ?? "",
  })
}

function errorCode(error: unknown): string {
  const e = error as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
  return e?.data?.statusMessage ?? e?.statusMessage ?? e?.message ?? "unknown_error"
}

function newRequestId(labelItemId: string): string {
  return `ui-${labelItemId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function IntelLabelPage() {
  const client = useQueryClient()
  const [filter, setFilter] = useState({ queueStatus: "all", category: "all", language: "all" })
  const [selectedId, setSelectedId] = useState("")
  const [operator, setOperator] = useState("")
  const [draft, setDraft] = useState<LabelDecisionFields>(emptyDecision())
  const [baseline, setBaseline] = useState<LabelDecisionFields>(emptyDecision())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [pendingNav, setPendingNav] = useState<null | (() => void)>(null)
  const dirty = useMemo(() => !decisionEqual(draft, baseline), [draft, baseline])
  const seededForId = useRef<string>("")
  const seededHashRef = useRef<string>("")
  const saveGen = useRef(0)
  const activeItemRef = useRef<string>("")
  const requestIdRef = useRef<string>("")

  const params = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v && v !== "all"),
  ).toString()
  const list = useQuery({
    queryKey: ["intel-labels", params],
    queryFn: () => myFetch<LabelListResponse>(`/shipping/intel/labels${params ? `?${params}` : ""}`),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const items = list.data?.items ?? []
  const coverage = list.data?.coverage
  const activeId = items.find(i => i.id === selectedId)?.id ?? items[0]?.id ?? ""
  activeItemRef.current = activeId

  const detail = useQuery({
    queryKey: ["intel-label", activeId, params],
    queryFn: () => myFetch<LabelDetailResponse>(
      `/shipping/intel/labels/${encodeURIComponent(activeId)}${params ? `?${params}` : ""}`,
    ),
    enabled: Boolean(activeId),
    retry: false,
    refetchOnWindowFocus: false,
  })

  // Seed draft only when label id / contentHash changes — never on save refetch updatedAt,
  // and never while dirty/saving, so late responses cannot clobber edits or wipe save messages.
  useEffect(() => {
    const d = detail.data
    if (!d) return
    if (d.item.id !== activeItemRef.current) return
    if (saving) return
    if (dirty) return
    // Same identity already seeded: ignore refetch after save (preserves success message).
    if (
      seededForId.current === d.item.id
      && seededHashRef.current === d.item.contentHash
    ) {
      return
    }
    const seed = d.humanDecision?.decision
      ?? d.aiPrelabel?.decision
      ?? emptyDecision()
    setDraft({ ...seed, notes: seed.notes ?? "" })
    setBaseline({ ...seed, notes: seed.notes ?? "" })
    seededForId.current = d.item.id
    seededHashRef.current = d.item.contentHash
    requestIdRef.current = newRequestId(d.item.id)
    setMessage("")
  }, [detail.data?.item.id, detail.data?.item.contentHash, activeId, dirty, saving, detail.data])

  const blockLeave = dirty || saving
  const blocker = useBlocker({
    shouldBlockFn: () => blockLeave,
    withResolver: true,
    enableBeforeUnload: blockLeave,
  })

  useEffect(() => {
    if (blocker.status !== "blocked") return
    setPendingNav(() => () => {
      blocker.proceed?.()
    })
  }, [blocker, blocker.status])

  function guardNav(next: () => void) {
    if (saving) {
      setMessage("保存进行中，请稍候再切换")
      return
    }
    if (!dirty) {
      next()
      return
    }
    setPendingNav(() => next)
  }

  function patchDraft(updater: (d: LabelDecisionFields) => LabelDecisionFields) {
    if (saving) return
    setDraft(updater)
  }

  async function save(kind: "human_confirm" | "human_correct") {
    if (!detail.data || saving) return
    if (!operator.trim()) {
      setMessage("请填写操作者（真实人工确认，不接受 system: 前缀）")
      return
    }
    const itemId = detail.data.item.id
    const contentHash = detail.data.item.contentHash
    const snapshot = draft
    const reqId = requestIdRef.current || newRequestId(itemId)
    const gen = ++saveGen.current
    setSaving(true)
    setMessage("")
    try {
      await myFetch(`/shipping/intel/labels/${encodeURIComponent(itemId)}/decision`, {
        method: "POST",
        body: {
          kind,
          operator: operator.trim(),
          expectedContentHash: contentHash,
          decision: snapshot,
          clientRequestId: reqId,
        },
      })
      // Superseded save generation: drop. Do not require activeItemRef match for the
      // status message — list invalidation can briefly clear items and flicker the ref.
      if (gen !== saveGen.current) return
      const stillOnItem = activeItemRef.current === itemId || selectedId === itemId || selectedId === ""
      setMessage(kind === "human_confirm" ? "已确认并保存（计为人工标注）" : "已纠正并保存（计为人工标注）")
      if (stillOnItem) {
        setBaseline(snapshot)
        seededForId.current = itemId
        seededHashRef.current = contentHash
        requestIdRef.current = newRequestId(itemId)
      }
      await client.invalidateQueries({ queryKey: ["intel-labels"] })
      await client.invalidateQueries({ queryKey: ["intel-label", itemId] })
    } catch (error) {
      if (gen !== saveGen.current) return
      setMessage(`保存失败：${errorCode(error)}（可重试，草稿仍保留）`)
    } finally {
      if (gen === saveGen.current) setSaving(false)
    }
  }

  function go(id: string | null) {
    if (!id) return
    guardNav(() => {
      seededForId.current = ""
      seededHashRef.current = ""
      setSelectedId(id)
    })
  }

  return (
    <ShippingShell title="情报标注">
      <div className="manual-intel" data-testid="intel-label-page" data-saving={saving ? "1" : "0"} data-dirty={dirty ? "1" : "0"}>
        <p>§4.9 人工复核 · 只存 URL/摘录/标注 · 浏览不触发模型</p>
        <section className="manual-intel__panel">
          <h2>覆盖（如实显示，不编造）</h2>
          {coverage
            ? (
                <div data-testid="label-coverage">
                  <p>
                    合计
                    {" "}
                    {coverage.total}
                    {" "}
                    · 已人工确认
                    {" "}
                    {coverage.humanConfirmed}
                    {" "}
                    · AI 预标
                    {" "}
                    {coverage.aiPrelabeled}
                    {" "}
                    · 未审
                    {" "}
                    {coverage.unreviewed}
                  </p>
                  <p>
                    类别：
                    {coverage.byCategory.map(b => `${b.key}:${b.total}`).join(" / ") || "—"}
                  </p>
                  <p>
                    语言：
                    {coverage.byLanguage.map(b => `${b.key}:${b.total}`).join(" / ") || "—"}
                  </p>
                  {coverage.missingNotes.length > 0 && (
                    <p data-testid="label-missing-notes">
                      缺口：
                      {coverage.missingNotes.join("；")}
                    </p>
                  )}
                </div>
              )
            : <p>加载中…</p>}
        </section>

        <section className="manual-intel__panel">
          <h2>队列</h2>
          <div className="manual-intel__row">
            <label>
              状态
              <select
                disabled={saving}
                value={filter.queueStatus}
                onChange={e => guardNav(() => {
                  seededForId.current = ""
                  seededHashRef.current = ""
                  setFilter(f => ({ ...f, queueStatus: e.target.value }))
                })}
              >
                <option value="all">全部</option>
                <option value="unreviewed">未审</option>
                <option value="ai_prelabeled">AI 预标</option>
                <option value="human_confirmed">已人工确认</option>
              </select>
            </label>
            <label>
              类别
              <select
                disabled={saving}
                value={filter.category}
                onChange={e => guardNav(() => {
                  seededForId.current = ""
                  seededHashRef.current = ""
                  setFilter(f => ({ ...f, category: e.target.value }))
                })}
              >
                <option value="all">全部</option>
                <option value="policy">政策</option>
                <option value="weather">天气</option>
                <option value="port">港口</option>
                <option value="lastmile">末端</option>
                <option value="other">其他</option>
                <option value="unknown">未知</option>
              </select>
            </label>
            <label>
              语言
              <select
                disabled={saving}
                value={filter.language}
                onChange={e => guardNav(() => {
                  seededForId.current = ""
                  seededHashRef.current = ""
                  setFilter(f => ({ ...f, language: e.target.value }))
                })}
              >
                <option value="all">全部</option>
                <option value="zh">zh</option>
                <option value="en">en</option>
                <option value="vi">vi</option>
                <option value="th">th</option>
                <option value="id">id</option>
                <option value="unset">未设</option>
              </select>
            </label>
          </div>
          <ul data-testid="label-queue">
            {items.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  data-testid={`label-queue-item-${item.id}`}
                  data-selected={item.id === activeId ? "1" : "0"}
                  disabled={saving}
                  onClick={() => guardNav(() => {
                    seededForId.current = ""
                    seededHashRef.current = ""
                    setSelectedId(item.id)
                  })}
                >
                  [
                  {item.queueStatus}
                  ]
                  {" "}
                  {item.title || item.sourceUrl}
                  {" "}
                  ·
                  {" "}
                  {item.category}
                  /
                  {item.language ?? "unset"}
                </button>
              </li>
            ))}
            {items.length === 0 && <li data-testid="label-queue-empty">当前无样本（未自动拉新源）</li>}
          </ul>
        </section>

        {detail.data && (
          <section className="manual-intel__panel" data-testid="label-detail">
            <h2>条目审阅</h2>
            <p data-testid="label-identity">
              label=
              {detail.data.item.id}
              {" "}
              · item=
              {detail.data.item.itemId}
              {" "}
              · version=
              {detail.data.item.versionId}
              {" "}
              · hash=
              {detail.data.item.contentHash.slice(0, 12)}
            </p>
            <p><a href={detail.data.material.sourceUrl} target="_blank" rel="noreferrer">{detail.data.material.sourceUrl}</a></p>
            <p><strong>{detail.data.material.title}</strong></p>
            <pre data-testid="label-excerpt">{detail.data.material.excerpt ?? "（无许可摘录）"}</pre>
            <p data-testid="label-material-scope">
              内容范围：
              {detail.data.material.contentScope}
              {detail.data.material.bodyAvailable ? "" : " · 正文不可读"}
              {detail.data.material.materialReadFailed ? ` · 读取失败(${detail.data.material.materialReadCode})` : ""}
            </p>

            <h3>AI 预标注（不计人工完成）</h3>
            {detail.data.aiPrelabel
              ? (
                  <pre data-testid="label-ai-prelabel">{JSON.stringify(detail.data.aiPrelabel.decision, null, 2)}</pre>
                )
              : (
                  <p data-testid="label-ai-missing">无 AI 预标注（仅展示已有分析，不触发模型）</p>
                )}
            {detail.data.analysisSummaries.length > 0 && (
              <details>
                <summary>
                  既有分析结果（
                  {detail.data.analysisSummaries.length}
                  ）
                </summary>
                <pre>{JSON.stringify(detail.data.analysisSummaries, null, 2)}</pre>
              </details>
            )}

            <h3>人工标注</h3>
            {detail.data.humanDecision && (
              <p data-testid="label-human-meta">
                上次人工：
                {detail.data.humanDecision.kind}
                {" "}
                ·
                {" "}
                {detail.data.humanDecision.operator}
                {" "}
                ·
                {" "}
                {detail.data.humanDecision.createdAt}
              </p>
            )}
            <label>
              操作者
              <input
                data-testid="label-operator"
                disabled={saving}
                value={operator}
                onChange={e => setOperator(e.target.value)}
                placeholder="真实姓名/工号"
              />
            </label>
            <label>
              预筛保留
              <select
                data-testid="label-prefilter"
                disabled={saving}
                value={draft.prefilterKeep === null ? "" : draft.prefilterKeep ? "1" : "0"}
                onChange={e => patchDraft(d => ({ ...d, prefilterKeep: e.target.value === "" ? null : e.target.value === "1" }))}
              >
                <option value="">未定</option>
                <option value="1">保留</option>
                <option value="0">丢弃</option>
              </select>
            </label>
            <label>
              事件类型
              <input
                data-testid="label-event-type"
                disabled={saving}
                value={draft.eventType ?? ""}
                onChange={e => patchDraft(d => ({ ...d, eventType: e.target.value || null }))}
              />
            </label>
            <label>
              国家（逗号分隔）
              <input
                data-testid="label-countries"
                disabled={saving}
                value={draft.countries.join(",")}
                onChange={e => patchDraft(d => ({ ...d, countries: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
              />
            </label>
            <label>
              港口 UN/LOCODE（逗号分隔）
              <input
                data-testid="label-ports"
                disabled={saving}
                value={draft.ports.join(",")}
                onChange={e => patchDraft(d => ({ ...d, ports: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
              />
            </label>
            <label>
              生效时间
              <input
                data-testid="label-effective"
                disabled={saving}
                value={draft.effectiveFrom ?? ""}
                onChange={e => patchDraft(d => ({ ...d, effectiveFrom: e.target.value || null }))}
              />
            </label>
            <label>
              官方通知
              <select
                data-testid="label-official"
                disabled={saving}
                value={draft.isOfficialStatement === null ? "" : draft.isOfficialStatement ? "1" : "0"}
                onChange={e => patchDraft(d => ({ ...d, isOfficialStatement: e.target.value === "" ? null : e.target.value === "1" }))}
              >
                <option value="">未定</option>
                <option value="1">是</option>
                <option value="0">否</option>
              </select>
            </label>
            <label>
              备注
              <textarea
                data-testid="label-notes"
                disabled={saving}
                value={draft.notes ?? ""}
                onChange={e => patchDraft(d => ({ ...d, notes: e.target.value }))}
              />
            </label>

            <div className="manual-intel__row">
              <button type="button" data-testid="label-prev" disabled={saving || !detail.data.neighbors.prevId} onClick={() => go(detail.data!.neighbors.prevId)}>上一条</button>
              <button type="button" data-testid="label-next" disabled={saving || !detail.data.neighbors.nextId} onClick={() => go(detail.data!.neighbors.nextId)}>下一条</button>
              <button
                type="button"
                data-testid="label-cancel"
                disabled={saving}
                onClick={() => {
                  setDraft(baseline)
                  setMessage("已取消未保存修改")
                }}
              >
                取消修改
              </button>
              <button type="button" data-testid="label-confirm" disabled={saving} onClick={() => void save("human_confirm")}>确认 AI（人工）</button>
              <button type="button" data-testid="label-correct" disabled={saving} onClick={() => void save("human_correct")}>纠正并保存</button>
            </div>
            {dirty && <p data-testid="label-dirty">有未保存修改</p>}
            {pendingNav && (
              <div data-testid="label-leave-confirm" className="manual-intel__leave">
                <p>有未保存的标注修改，确定离开？</p>
                <button
                  type="button"
                  data-testid="label-leave-yes"
                  onClick={() => {
                    const goNext = pendingNav
                    setPendingNav(null)
                    seededForId.current = ""
                    seededHashRef.current = ""
                    goNext?.()
                  }}
                >
                  离开
                </button>
                <button
                  type="button"
                  data-testid="label-leave-no"
                  onClick={() => {
                    setPendingNav(null)
                    blocker.reset?.()
                  }}
                >
                  留下
                </button>
              </div>
            )}
            {message && <p data-testid="label-message">{message}</p>}
          </section>
        )}
      </div>
    </ShippingShell>
  )
}
