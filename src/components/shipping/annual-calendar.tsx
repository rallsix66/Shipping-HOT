import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { annualCountries, annualCountryStatusLabels, annualEventScope, annualEvidenceLabel, annualMonthDays, annualSourceLabel, annualSourcePublishedLabel, annualTypes } from "@shared/annual-calendar"
import type { AnnualCalendarResponse, AnnualCountry } from "@shared/annual-calendar"
import { type PromoCalendarResponse, promoDaysInRange, promoPlatforms, promoStatusLabel } from "@shared/promo-calendar"
import { ShippingShell } from "./app"
import { myFetch } from "~/utils"
import "./annual-calendar.css"

const countryCodes = Object.keys(annualCountries) as AnnualCountry[]
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

export function AnnualCalendarPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [selected, setSelected] = useState("")
  const [countries, setCountries] = useState<AnnualCountry[]>(countryCodes)
  const [showReferenceOnly, setShowReferenceOnly] = useState(false)
  const [showPromos, setShowPromos] = useState(false)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["annual-calendar-reference", year],
    queryFn: () => myFetch<AnnualCalendarResponse>(`/shipping/calendar/reference?year=${year}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const promoQuery = useQuery({
    queryKey: ["promo-calendar", year],
    queryFn: () => myFetch<PromoCalendarResponse>(`/shipping/calendar/promotions?year=${year}`),
    enabled: showPromos,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const promoEvents = showPromos ? (promoQuery.data?.events ?? []).filter(p => countries.includes(p.countryCode as AnnualCountry)) : []
  const promosByDay = new Map<string, typeof promoEvents>()
  for (const promo of promoEvents) {
    for (const day of promoDaysInRange(promo.startsAt, promo.endsAt)) promosByDay.set(day, [...(promosByDay.get(day) ?? []), promo])
  }
  const selectedDate = selected.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)
    ? selected
    : `${year}-${String(month + 1).padStart(2, "0")}-01`
  const datasets = (data?.datasets ?? []).filter(d => countries.includes(d.countryCode))
  const events = datasets.flatMap(d => d.events).filter(e => !showReferenceOnly || !annualTypes[e.type]?.work)
  const eventsByDay = new Map<string, typeof events>()
  for (const event of events) eventsByDay.set(event.date, [...(eventsByDay.get(event.date) ?? []), event])
  const days = annualMonthDays(year, month)
  const details = eventsByDay.get(selectedDate) ?? []
  const promoDetails = promosByDay.get(selectedDate) ?? []
  const monthCount = events.filter(e => e.date.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)).length
  const unavailable = !isPending && !isError && data?.datasets.length === 0
  const availableYears = data?.availableYears ?? [2026, 2027]
  const statuses = data?.statuses ?? []
  const visibleStatuses = statuses.filter(status => status.status !== "available")

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(year, month + offset, 1))
    if (next.getUTCFullYear() < 2026 || next.getUTCFullYear() > 2027) return
    setYear(next.getUTCFullYear())
    setMonth(next.getUTCMonth())
    setSelected("")
  }

  return (
    <ShippingShell title="年度参考日历">
      <div className="annual-calendar">
        <div className="annual-heading">
          <div>
            <p className="eyebrow-sh">SOUTHEAST ASIA / ANNUAL CALENDAR</p>
            <h1>东南亚假日台历</h1>
            <p>固定年度资料 · 假日、补休与工作日调整 · 不代表港口停运</p>
          </div>
        </div>
        <div className="annual-notice">年度参考资料，非实时运营状态。泰国资料不完整；地区、公职和企业适用条件请留意每条标记。未录入不代表没有假日。</div>
        <div className="annual-layout">
          <aside className="annual-panel annual-filters">
            <div className="annual-filter-title">
              <strong>关注国家</strong>
              <button type="button" onClick={() => setCountries(countryCodes)}>全选</button>
            </div>
            {countryCodes.map(code => (
              <label className="annual-country" key={code}>
                <input type="checkbox" checked={countries.includes(code)} onChange={() => setCountries(current => current.includes(code) ? current.filter(c => c !== code) : [...current, code])} />
                <span className={`annual-dot annual-${code}`} />
                <span>{annualCountries[code]}</span>
                <small>{code}</small>
              </label>
            ))}
            <label className="annual-option">
              <input type="checkbox" checked={showReferenceOnly} onChange={e => setShowReferenceOnly(e.target.checked)} />
              隐藏补班／特别工作日
            </label>
            <label className="annual-option">
              <input type="checkbox" data-testid="promo-layer-toggle" checked={showPromos} onChange={e => setShowPromos(e.target.checked)} />
              显示电商大促图层（运营参考，非停工事实）
            </label>
            <div className="annual-filter-note">
              <strong>标记说明</strong>
              <p>
                “班”与“工作”不是休假。
                <br />
                集体休假、政府机关安排和地区限定不会泛化为全国停工。
              </p>
              <ul className="annual-status-list">
                {statuses.map(status => (
                  <li key={status.countryCode}>
                    {annualCountries[status.countryCode]}
                    ：
                    {annualCountryStatusLabels[status.status]}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
          <section className="annual-panel annual-month" aria-label="年度参考月历">
            <div className="annual-toolbar">
              <h2>
                {year}
                {" "}
                年
                {" "}
                {month + 1}
                {" "}
                月
              </h2>
              <div className="annual-controls">
                <button type="button" aria-label="上个月" disabled={year === 2026 && month === 0} onClick={() => moveMonth(-1)}>‹</button>
                <select
                  aria-label="年份"
                  value={year}
                  onChange={(e) => {
                    setYear(Number(e.target.value))
                    setSelected("")
                  }}
                >
                  {[...new Set([...availableYears, year])].sort().map(y => (
                    <option key={y} value={y}>
                      {y}
                      {" "}
                      年
                    </option>
                  ))}
                </select>
                <select
                  aria-label="月份"
                  value={month}
                  onChange={(e) => {
                    setMonth(Number(e.target.value))
                    setSelected("")
                  }}
                >
                  {Array.from({ length: 12 }, (_, m) => (
                    <option key={m} value={m}>
                      {m + 1}
                      {" "}
                      月
                    </option>
                  ))}
                </select>
                <button type="button" aria-label="下个月" disabled={year === 2027 && month === 11} onClick={() => moveMonth(1)}>›</button>
              </div>
            </div>
            <div className="annual-month-meta">
              {countries.length}
              {" "}
              个国家已选 ·
              {" "}
              {isPending ? "读取年度资料…" : `${monthCount} 项本月参考安排`}
              {" "}
              · 周一开始
            </div>
            {isError && (
              <div role="alert" className="annual-notice">
                年度资料读取失败，不代表没有假日。
                <button type="button" onClick={() => refetch()}>重试读取</button>
              </div>
            )}
            {unavailable && (
              <div className="annual-notice">
                {year}
                {" "}
                年暂无已录入的正式年度数据：
                {" "}
                {visibleStatuses.length > 0
                  ? visibleStatuses.map(status => `${annualCountries[status.countryCode]}（${annualCountryStatusLabels[status.status]}）`).join("；")
                  : "判断当地工作安排请以官方来源为准"}
                。
              </div>
            )}
            {!countries.length && <p className="annual-notice">请至少选择一个国家。</p>}
            <div className="annual-scroll">
              <div className="annual-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
              <div className="annual-grid">
                {days.map((day, index) => {
                  const rows = day.outside ? [] : (eventsByDay.get(day.date) ?? [])
                  return (
                    <button key={day.date} type="button" disabled={day.outside} aria-pressed={selectedDate === day.date} aria-label={`${day.date}，${rows.length}项安排`} onClick={() => setSelected(day.date)} className={`annual-day ${day.outside ? "outside" : ""} ${index % 7 > 4 ? "weekend" : ""} ${selectedDate === day.date ? "selected" : ""}`}>
                      <span className="annual-day-number">{day.day}</span>
                      {rows.slice(0, 3).map(event => (
                        <span key={event.id} className={`annual-event annual-${event.countryCode}`}>
                          <span>
                            {event.countryCode}
                            {" "}
                            ·
                            {" "}
                            {annualTypes[event.type]?.work ? "工作" : annualTypes[event.type]?.label}
                          </span>
                          <strong>{event.shortNameZh}</strong>
                          <small>{annualEventScope(event)}</small>
                        </span>
                      ))}
                      {showPromos && !day.outside && (promosByDay.get(day.date)?.length ?? 0) > 0 && (
                        <span className="annual-promo-count" data-testid="promo-day-count">{`大促 ${promosByDay.get(day.date)!.length} 项`}</span>
                      )}
                      {rows.length > 3 && (
                        <span className="annual-more">
                          另有
                          {rows.length - 3}
                          {" "}
                          项 · 点击查看
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
          <aside className="annual-panel annual-details" aria-live="polite">
            <div className="annual-detail-heading">
              <small>当天安排</small>
              <h2>{selectedDate.slice(5).replace("-", " / ")}</h2>
              <span>
                {details.length}
                {" "}
                项所选国家记录
              </span>
            </div>
            {isPending
              ? <p>正在读取年度资料…</p>
              : isError
                ? <p>读取失败，请重试。</p>
                : details.length === 0
                  ? (
                      <p>
                        {unavailable ? "该年度尚未录入。" : "所选日期没有已录入且符合筛选的事项。"}
                        空白不代表没有假日或正常作业。
                      </p>
                    )
                  : details.map((event) => {
                      const dataset = datasets.find(d => d.countryCode === event.countryCode)
                      const evidenceLabel = annualEvidenceLabel(event.verificationStatus)
                      return (
                        <article key={event.id}>
                          <div className="annual-detail-label">
                            <span className={`annual-dot annual-${event.countryCode}`} />
                            {annualCountries[event.countryCode]}
                            {" "}
                            ·
                            {annualTypes[event.type]?.label}
                          </div>
                          <h3>{event.nameZh}</h3>
                          <p>{event.nameLocal}</p>
                          <strong className="annual-scope">{annualEventScope(event)}</strong>
                          {evidenceLabel && <strong className="annual-evidence-pending">{evidenceLabel}</strong>}
                          <p>{event.subjectAndConditionsZh}</p>
                          <p>{event.notesZh}</p>
                          {event.sourceDocumentIds.map((sourceId) => {
                            const source = dataset?.sourceDocuments.find(s => s.id === sourceId)
                            return source
                              ? (
                                  <a key={sourceId} href={source.url} target="_blank" rel="noreferrer">
                                    {`${annualSourceLabel(source)}：`}
                                    {source.documentNumbers.join(" / ")}
                                    {" · "}
                                    {annualSourcePublishedLabel(source)}
                                    {" "}
                                    ↗
                                  </a>
                                )
                              : null
                          })}
                        </article>
                      )
                    })}
            {showPromos && (
              <div className="annual-promo-details" data-testid="promo-details">
                <h3>{`电商大促（运营参考，非停工事实）· ${promoDetails.length} 项`}</h3>
                {promoQuery.isError && <p role="alert">大促资料读取失败，不代表没有大促。</p>}
                {promoQuery.isPending && <p>正在读取大促资料…</p>}
                {!promoQuery.isPending && !promoQuery.isError && promoDetails.length === 0 && <p>所选日期没有已生成或录入的大促记录（未生成不代表没有大促）。</p>}
                {promoDetails.map(promo => (
                  <article key={promo.id} data-testid="promo-detail" data-status={promo.confirmationStatus}>
                    <div className="annual-detail-label">
                      <span className={`annual-dot annual-${promo.countryCode}`} />
                      {`${promo.countryCode} · ${promoPlatforms[promo.platform]}`}
                    </div>
                    <h3>{promo.title}</h3>
                    <p>{promo.windowStatus === "pending" ? `节日锚点日期 ${promo.startsAt} – ${promo.endsAt}（促销窗口待定）` : `日期 ${promo.startsAt} – ${promo.endsAt}`}</p>
                    <strong className={promo.confirmationStatus === "confirmed" ? "annual-scope" : "annual-evidence-pending"} data-testid="promo-status">{promoStatusLabel(promo)}</strong>
                    <p>{`规则：${promo.ruleId ?? "无（人工录入）"} · 来源：${promo.basisRef ?? "未提供"}`}</p>
                    {promo.generationBasis && <p>{`生成依据：${promo.generationBasis}`}</p>}
                    {promo.confirmation && (
                      <a href={promo.confirmation.evidenceRef} target="_blank" rel="noreferrer">
                        {`确认证据：${promo.confirmation.sourceId} · ${promo.confirmation.confirmedAt.slice(0, 10)} ↗`}
                      </a>
                    )}
                    {promo.dataIssue && <p>{`数据异常：${promo.dataIssue}`}</p>}
                  </article>
                ))}
              </div>
            )}
          </aside>
        </div>
        <section className="annual-coverage" aria-label="资料范围与限制">
          <h2>资料范围与限制</h2>
          {datasets.map(dataset => (
            <p key={dataset.countryCode}>
              <strong>
                {annualCountries[dataset.countryCode]}
                ：
              </strong>
              {dataset.warning}
            </p>
          ))}
          {showPromos && (promoQuery.data?.gaps.length ?? 0) > 0 && (
            <div data-testid="promo-gaps">
              <strong>大促规则缺口（待定）：</strong>
              <ul>
                {promoQuery.data!.gaps.map(gap => <li key={`${gap.ruleId}-${gap.countryCode}`}>{`${gap.ruleId} ${gap.countryCode}：${gap.reasonZh}`}</li>)}
              </ul>
            </div>
          )}
          <p>2026 年参考资料截至 2026-09-09 整理；未完成双人人工复核。未自动抓取或更新，后续官方更正需人工核对。具体作业安排请向当地代理确认。</p>
        </section>
      </div>
    </ShippingShell>
  )
}
