import { Link } from "@tanstack/react-router"
import { motion } from "framer-motion"
import { type ReactNode, useEffect, useState } from "react"
import { type CalendarEvent, calendarCountries, daysUntilCalendarEvent } from "@shared/calendar"
import type { AisDerivedPortMetric } from "@shared/ais-area"
import type { Severity as SeverityValue, ShippingEvent, WeatherDetail } from "@shared/shipping"
import type { VoyageRecord } from "@shared/voyage"
import type { VesselSearchResponse, VesselSearchResult, VesselWatchlistItem } from "@shared/vessel-search"
import { ErrorState, LoadingState, Severity, ShippingShell, StatusBadge } from "./app"
import { type ShippingResponse, useAisLatestPosition, useLatestVoyage, useShipping } from "./data"
import { formatDate, formatPortMetric, formatStatus, navTone, severityTone } from "./format"
import { AnimatedNumber, EmptyState, Marquee, ProvenanceBadge, ProviderChip, Reveal, Segmented, StatusDot } from "./ui"
import { myFetch } from "~/utils"

const countryFlags: Record<string, string> = {
  TH: "🇹🇭",
  ID: "🇮🇩",
  MY: "🇲🇾",
  PH: "🇵🇭",
  VN: "🇻🇳",
}

/* ================= 共享子组件 ================= */

function SecHead({ eyebrow, title, description, right }: { eyebrow?: string, title: string, description?: string, right?: ReactNode }) {
  return (
    <div className="console-head">
      <div>
        {eyebrow && <p className="eyebrow-sh">{eyebrow}</p>}
        <h2 className="console-title">{title}</h2>
        {description && <p className="console-desc">{description}</p>}
      </div>
      {right && <div className="console-head-right">{right}</div>}
    </div>
  )
}

function StatCell({ label, value, tone = "" }: { label: string, value: number | string, tone?: "" | "stat-critical" | "stat-warning" }) {
  return (
    <div className="glass-panel stat-cell">
      <span className={`v ${tone}`}>{typeof value === "number" ? <AnimatedNumber value={value} /> : value}</span>
      <span className="l">{label}</span>
    </div>
  )
}

const congestionLevels = { low: 25, medium: 50, high: 75, critical: 100 } as const

function CongestionGauge({ level }: { level?: "low" | "medium" | "high" | "critical" }) {
  return (
    <div className="gauge-track">
      <motion.div
        className={`gauge-fill gauge-${level ?? "unknown"}`}
        initial={{ width: 0 }}
        whileInView={{ width: `${level ? congestionLevels[level] : 0}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
    </div>
  )
}

function eventTimestampLabel(event: ShippingEvent) {
  const labels = [`首次发现：${formatDate(event.firstDetectedAt)}`]
  if (event.firstDetectedAt !== event.lastDetectedAt) labels.push(`最近确认：${formatDate(event.lastDetectedAt)}`)
  if (event.resolvedAt) labels.push(`解决于：${formatDate(event.resolvedAt)}`)
  return labels.join(" · ")
}

function EventMini({ event }: { event: ShippingEvent }) {
  return (
    <article className={`glass-panel hot-glow ${event.severity} mini-event`}>
      <div className="hot-top">
        <Severity value={event.severity} />
        <StatusBadge stale={event.stale ?? event.sourceStatus !== "healthy"} sourceStatus={event.sourceStatus} />
      </div>
      <h4>{event.title}</h4>
      <p>{event.summary}</p>
      <p className="hot-meta">
        <span className="i-ph-clock" />
        <span>{eventTimestampLabel(event)}</span>
      </p>
    </article>
  )
}

function WeatherChips({ weather }: { weather: WeatherDetail }) {
  const [weatherWindow, setWeatherWindow] = useState<"h24" | "h72" | "d7">("h72")
  const selected = weather.windows?.[weatherWindow]
  const waveHeightM = selected?.maxWaveHeightM ?? weather.waveHeightM
  const swellWaveHeightM = selected?.maxSwellWaveHeightM ?? weather.swellWaveHeightM
  const swellPeriodSeconds = selected?.maxSwellPeriodSeconds ?? weather.swellPeriodSeconds
  const windSpeedKmh = selected?.maxWindSpeedKmh ?? weather.windSpeedKmh
  const windGustKmh = selected?.maxWindGustKmh ?? weather.windGustKmh
  const waveDirectionDeg = selected?.waveDirectionDeg ?? weather.waveDirectionDeg
  const swellDirectionDeg = selected?.swellDirectionDeg ?? weather.swellDirectionDeg ?? weather.swellWaveDirectionDeg
  return (
    <div className="weather-chips">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip">{weather.riskSource === "official" ? "官方预警" : "模型预报"}</span>
        {weather.windows && (
          ([
            ["h24", "24 小时"],
            ["h72", "72 小时"],
            ["d7", "7 天"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip${weatherWindow === key ? " on" : ""}`}
              onClick={() => setWeatherWindow(key)}
            >
              {label}
            </button>
          ))
        )}
        {weather.forecastWindowHours && !weather.windows && (
          <span className="chip">
            未来
            {" "}
            {weather.forecastWindowHours}
            {" "}
            小时
          </span>
        )}
        {weather.alertState && (
          <span className="chip">
            预警状态：
            {weather.alertState === "active" ? "生效" : weather.alertState === "expired" ? "已过期" : "未知"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs op-70">
        {waveHeightM !== undefined && (
          <span>
            浪高
            {waveHeightM.toFixed(1)}
            {" "}
            m
          </span>
        )}
        {swellWaveHeightM !== undefined && (
          <span>
            涌浪
            {swellWaveHeightM.toFixed(1)}
            {" "}
            m
          </span>
        )}
        {swellPeriodSeconds !== undefined && (
          <span>
            涌浪周期
            {swellPeriodSeconds.toFixed(1)}
            {" "}
            s
          </span>
        )}
        {windSpeedKmh !== undefined && (
          <span>
            风速
            {windSpeedKmh.toFixed(1)}
            {" "}
            km/h
          </span>
        )}
        {windGustKmh !== undefined && (
          <span>
            阵风
            {windGustKmh.toFixed(1)}
            {" "}
            km/h
          </span>
        )}
        {waveDirectionDeg !== undefined && (
          <span>
            浪向
            {waveDirectionDeg.toFixed(0)}
            °
          </span>
        )}
        {swellDirectionDeg !== undefined && (
          <span>
            涌浪向
            {swellDirectionDeg.toFixed(0)}
            °
          </span>
        )}
        {(selected?.forecastStartAt ?? weather.forecastStartAt) && (selected?.forecastEndAt ?? weather.forecastEndAt) && (
          <span>
            风险窗
            {" "}
            {formatDate(selected?.forecastStartAt ?? weather.forecastStartAt)}
            {" – "}
            {formatDate(selected?.forecastEndAt ?? weather.forecastEndAt)}
          </span>
        )}
        {weather.alertExpiresAt && (
          <span>
            截至
            {formatDate(weather.alertExpiresAt)}
          </span>
        )}
      </div>
    </div>
  )
}

function WatchChip({ kind, id, watched, onSaved }: { kind: "vessel" | "port", id: string, watched: boolean, onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      disabled={busy}
      className={`watch-chip ${watched ? "on" : ""}`}
      onClick={async () => {
        setBusy(true)
        try {
          await myFetch("/shipping/watch", { method: "POST", body: { kind, id } })
          await onSaved()
        } finally {
          setBusy(false)
        }
      }}
    >
      <span className={`${watched ? "i-ph-star-fill" : "i-ph-star"} text-sm`} />
      {watched ? "已关注" : "关注"}
    </motion.button>
  )
}

function delayCell(delay?: number) {
  if (delay === undefined) return <span className="delay op-50">未知</span>
  if (delay > 0) return <span className="delay on">{`+${delay} 分钟`}</span>
  return <span className="delay ok">准点</span>
}

function AisAreaPanel({ metric }: { metric?: AisDerivedPortMetric }) {
  const usable = metric?.coverage === "usable" && !metric.stale && metric.sourceStatus === "healthy"
  const trendLabel = metric?.trend === "rising" ? "上升" : metric?.trend === "falling" ? "下降" : metric?.trend === "stable" ? "稳定" : "未知"
  return (
    <div className="glass-panel d-panel">
      <div className="panel-h">
        <div>
          <span className="eyebrow-sh">AIS 衍生信息</span>
          <h3>AIS 区域估算</h3>
        </div>
        <StatusBadge stale={!usable} sourceStatus={metric?.sourceStatus ?? "never_succeeded"} unknown={!metric || metric.coverage !== "usable"} />
      </div>
      {!usable
        ? <p className="text-sm op-70">当前 AIS 区域样本不足，不能判断趋势。</p>
        : (
            <dl className="kv">
              <dt>区域趋势</dt>
              <dd>{trendLabel}</dd>
              <dt>区域活跃船舶</dt>
              <dd>
                {metric.activeVesselCount}
                {" "}
                艘
              </dd>
              <dt>锚泊 / 靠泊</dt>
              <dd>
                {metric.anchoredCount}
                {" "}
                /
                {" "}
                {metric.mooredCount}
              </dd>
              <dt>低速船舶</dt>
              <dd>
                {metric.lowSpeedCount}
                {" "}
                艘（≤
                {" "}
                {metric.lowSpeedThresholdKnots}
                {" "}
                kn）
              </dd>
              <dt>样本 / 歧义样本</dt>
              <dd>
                {metric.sampleSize}
                {" "}
                /
                {" "}
                {metric.ambiguousSampleCount}
              </dd>
              <dt>观察窗口</dt>
              <dd>{formatDate(metric.observationWindow?.endAt)}</dd>
            </dl>
          )}
      <p className="mt-3 text-xs op-55">区域观察范围：配置启发式 bbox；非港口官方统计，不等同等待时间或港口拥堵等级。</p>
    </div>
  )
}

function relatedLabel(event: ShippingEvent, data: ShippingResponse) {
  if (event.vesselId) return data.vessels.find(v => v.id === event.vesselId)?.name
  if (event.portId) return data.ports.find(p => p.id === event.portId)?.name
  if (event.voyageId) return data.voyages.find(v => v.id === event.voyageId)?.voyageNumber
  return undefined
}

/* ================= HOT 首页 ================= */

export function HotPage() {
  const { data, isLoading, isError } = useShipping()
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const watchedVessels = data.vessels.filter(v => v.isWatched)
  const watchedPorts = data.ports.filter(p => p.isWatched)
  const feed = data.feedItems.slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const upcomingCalendar = (data.calendarEvents ?? []).filter((event) => {
    const days = daysUntilCalendarEvent(event.date, today)
    return days >= 0 && days <= 14
  }).slice(0, 5)
  const stats = [
    { label: "活跃 HOT", value: data.hot.length as number, tone: "stat-critical" as const },
    { label: "关注船舶", value: watchedVessels.length as number, tone: "" as const },
    { label: "关注港口", value: watchedPorts.length as number, tone: "stat-warning" as const },
    { label: "数据源", value: `${data.provider.vessel} / ${data.provider.weather} / 预警 ${data.provider.weatherAlerts}` as string, tone: "" as const },
  ]
  return (
    <ShippingShell title="运营态势 · 首页">
      <div className="console-dash">
        <section>
          <SecHead
            eyebrow="优先信号"
            title="需要关注的事项"
            description="按严重程度排序的运营信号，聚合事件与资讯去重后的关键项。"
            right={(
              <span className="chip">
                {data.hot.length}
                {" "}
                项
              </span>
            )}
          />
          {data.hot.length === 0
            ? <div className="glass-panel"><EmptyState icon="i-ph-check-circle" text="当前没有需要关注的事项" /></div>
            : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {data.hot.map((item, index) => (
                    <Reveal key={item.id} delay={Math.min(index, 6) * 0.06}>
                      <article className={`glass-panel hot-glow ${item.severity} hot-card`}>
                        <div className="hot-top">
                          <Severity value={item.severity} />
                          <div className="hot-badges">
                            <ProvenanceBadge provenance={item.provenance} />
                            <StatusBadge stale={item.freshness === "stale"} sourceStatus={item.sourceStatus} unknown={item.freshness === "unknown"} />
                          </div>
                        </div>
                        <h3>{item.title}</h3>
                        <p className="hot-sum">{item.summary}</p>
                        <p className="hot-meta">
                          <span className="i-ph-clock" />
                          {item.relatedLabel ?? "航运信号"}
                          {" · "}
                          {formatDate(item.occurredAt)}
                        </p>
                      </article>
                    </Reveal>
                  ))}
                </div>
              )}
        </section>

        <div className="stat-strip">
          {stats.map(stat => <StatCell key={stat.label} label={stat.label} value={stat.value} tone={stat.tone} />)}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal className="glass-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">关注的船舶</h2>
              <Link to="/vessels" className="link-more">
                查看全部
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {watchedVessels.length === 0
              ? <EmptyState icon="i-ph-anchor" text="还没有关注的船舶" />
              : watchedVessels.map(v => (
                  <Link key={v.id} to="/vessels/$id" params={{ id: v.id }} className="list-row group">
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      <StatusDot tone={navTone(v.navigationStatus)} />
                      <span className="truncate">{v.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 op-70">
                      <span className="hidden sm:inline">{formatStatus(v.navigationStatus)}</span>
                      <span className="i-ph-arrow-right transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
          </Reveal>
          <Reveal delay={0.08} className="glass-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">关注的港口</h2>
              <Link to="/ports" className="link-more">
                查看全部
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {watchedPorts.length === 0
              ? <EmptyState icon="i-ph-lighthouse" text="还没有关注的港口" />
              : watchedPorts.map(p => (
                  <Link key={p.id} to="/ports/$id" params={{ id: p.id }} className="list-row group">
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      <StatusDot tone={p.congestionLevel === undefined ? "dim" : p.congestionLevel === "critical" ? "failed" : p.congestionLevel === "high" ? "watch" : "fresh"} />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="gauge-cell">
                      <CongestionGauge level={p.congestionLevel} />
                      <span className={`g-lbl ${p.congestionLevel ?? "unknown"}`}>{formatStatus(p.congestionLevel ?? "unknown")}</span>
                    </span>
                  </Link>
                ))}
          </Reveal>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Reveal delay={0.12} className="glass-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">资讯快讯</h2>
              <Link to="/feed" className="link-more">
                查看全部
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {feed.length === 0
              ? <EmptyState icon="i-ph-newspaper" text="暂无资讯" />
              : (
                  <Marquee>
                    {feed.map(item => (
                      <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 whitespace-nowrap text-sm">
                        <StatusDot tone={severityTone(item.severity)} />
                        <span className="font-semibold">{item.title}</span>
                        <span className="op-60">{item.publicationTimeKnown === false ? "发布时间未知" : formatDate(item.publishedAt)}</span>
                      </a>
                    ))}
                  </Marquee>
                )}
          </Reveal>
          <Reveal delay={0.16} className="glass-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">近期国家日历</h2>
              <Link to="/calendar" className="link-more">
                查看日历
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {upcomingCalendar.length === 0
              ? <EmptyState icon="i-ph-calendar-blank" text="未来 14 天暂无已缓存日历提醒" />
              : upcomingCalendar.map(event => <CalendarListRow key={event.id} event={event} today={today} />)}
          </Reveal>
        </div>
      </div>
    </ShippingShell>
  )
}

/* ================= 船舶 ================= */

const vesselStatusOptions = [
  { value: "all", label: "全部" },
  { value: "under_way", label: "航行中" },
  { value: "anchored", label: "锚泊" },
  { value: "moored", label: "靠泊" },
  { value: "aground", label: "搁浅" },
  { value: "unknown", label: "未知" },
]

function sameVessel(left: Pick<VesselSearchResult, "id" | "imo" | "mmsi">, right: Pick<VesselSearchResult, "id" | "imo" | "mmsi">) {
  return left.id === right.id
    || Boolean(left.imo && right.imo && left.imo === right.imo)
    || Boolean(left.mmsi && right.mmsi && left.mmsi === right.mmsi)
}

function VesselSearchPanel() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<VesselSearchResult[]>([])
  const [watchlist, setWatchlist] = useState<VesselWatchlistItem[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string>()
  const [message, setMessage] = useState("")

  useEffect(() => {
    let active = true
    myFetch<VesselWatchlistItem[]>("/shipping/search/vessels/watchlist")
      .then((items) => {
        if (active) setWatchlist(items)
      })
      .catch(() => {
        if (active) setMessage("关注列表暂时无法加载")
      })
    return () => {
      active = false
    }
  }, [])

  async function search() {
    if (!query.trim()) {
      setMessage("请输入船名、IMO、MMSI 或 Call Sign")
      return
    }
    setSearching(true)
    setMessage("")
    try {
      const response = await myFetch<VesselSearchResponse>(`/shipping/search/vessels?q=${encodeURIComponent(query.trim())}`)
      setResults(response.results)
      if (!response.results.length) setMessage("没有找到匹配船舶")
    } catch {
      setResults([])
      setMessage("搜索暂时不可用，请检查 Provider 配置")
    } finally {
      setSearching(false)
    }
  }

  async function toggleWatch(result: VesselSearchResult, watched?: VesselWatchlistItem) {
    setBusyId(result.id)
    setMessage("")
    try {
      if (watched) {
        await myFetch(`/shipping/search/vessels/watch`, { method: "DELETE", body: { id: watched.id } })
        setWatchlist(items => items.filter(item => !sameVessel(item, result)))
      } else {
        const added = await myFetch<VesselWatchlistItem>("/shipping/search/vessels/watch", { method: "POST", body: { id: result.id } })
        setWatchlist(items => [...items.filter(item => !sameVessel(item, added)), added])
      }
    } catch {
      setMessage("关注操作失败，请稍后重试")
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <div className="glass-panel mb-4 p-5">
      <div className="mb-4">
        <p className="eyebrow-sh">Vessel Search</p>
        <h3 className="text-lg font-bold">搜索并关注船舶</h3>
        <p className="mt-1 text-sm op-65">搜索结果写入 user-owned 关注列表；没有 MMSI 的船舶可保存，但暂不可进行 AIS Tracking。</p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <input
          className="setting-input min-w-0 flex-1"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="DONG FANG FU / IMO / MMSI"
          aria-label="搜索船舶"
        />
        <button type="submit" className="btn-gradient" disabled={searching}>{searching ? "搜索中…" : "搜索"}</button>
      </form>
      {message && <p className="mt-3 text-sm op-70">{message}</p>}
      {results.length > 0 && (
        <div className="mt-4 grid gap-2">
          {results.map((result) => {
            const watched = watchlist.find(item => sameVessel(item, result))
            return (
              <div key={result.id} className="list-row flex-wrap gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{result.name}</p>
                  <p className="text-xs op-65">
                    {result.imo ? `IMO ${result.imo}` : "IMO —"}
                    {" · "}
                    {result.mmsi ? `MMSI ${result.mmsi}` : "MMSI —"}
                    {" · "}
                    {result.callsign ?? "Call Sign —"}
                    {" · "}
                    {result.source}
                  </p>
                  <p className="mt-1 text-xs op-60">{watched ? (result.mmsi ? "Tracking: Active" : "Unavailable (No MMSI)") : result.mmsi ? "MMSI 可用于 AIS lookup" : "暂无 MMSI，暂不可进行 AIS Tracking"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {watched && <span className="chip">已关注</span>}
                  <button
                    type="button"
                    className={watched ? "btn-ghost" : "watch-chip"}
                    disabled={busyId === result.id}
                    onClick={() => void toggleWatch(result, watched)}
                  >
                    {watched ? "取消关注" : "关注"}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function VesselsPage() {
  const { data, isLoading, isError } = useShipping()
  const [filter, setFilter] = useState("all")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const vessels = data.vessels.filter(v => filter === "all" || v.navigationStatus === filter)
  return (
    <ShippingShell title="我的船舶">
      <SecHead
        eyebrow="运营数据"
        title="我的船舶"
        description="关注船队的航行状态、目的港与数据新鲜度，一行一船快速扫描。"
        right={<Segmented id="vessel-status" options={vesselStatusOptions} value={filter} onChange={setFilter} />}
      />
      <VesselSearchPanel />
      {vessels.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-anchor" text="当前筛选条件下没有船舶" /></div>
        : (
            <div className="glass-panel vt">
              <div className="vt-head">
                <span className="c-name">船舶</span>
                <span className="c-status">状态</span>
                <span className="c-speed">航速</span>
                <span className="c-dest">目的港</span>
                <span className="c-eta">ETA</span>
                <span className="c-fresh">数据</span>
              </div>
              {vessels.map(v => (
                <div key={v.id} className="vt-row">
                  <Link to="/vessels/$id" params={{ id: v.id }} className="nm c-name">
                    {v.name}
                    <small>
                      {v.carrier ?? "未知船公司"}
                      {" · "}
                      {v.shipType ?? "船舶"}
                      {v.isWatched && (
                        <>
                          {" · "}
                          {v.mmsi ? "Tracking: Active" : "Unavailable (No MMSI)"}
                        </>
                      )}
                    </small>
                  </Link>
                  <span className="st-c c-status">
                    <StatusDot tone={navTone(v.navigationStatus)} />
                    {formatStatus(v.navigationStatus)}
                  </span>
                  <span className="c-speed">{v.speed === undefined ? "—" : `${v.speed} 节`}</span>
                  <span className="c-dest">{v.destination ?? "—"}</span>
                  <span className="eta c-eta">{formatDate(v.eta)}</span>
                  <span className="fr c-fresh">
                    <ProvenanceBadge provenance={v.provenance} />
                    <StatusBadge stale={v.stale} sourceStatus={v.sourceStatus} />
                    <span className="i-ph-arrow-right op-50" />
                  </span>
                </div>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

export function VesselDetailPage({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = useShipping()
  const { data: latestPosition, isLoading: isPositionLoading } = useAisLatestPosition(id)
  const { data: latestVoyage, isLoading: isVoyageLoading } = useLatestVoyage(id)
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const vessel = data.vessels.find(v => v.id === id)
  if (!vessel) return <ShippingShell><ErrorState /></ShippingShell>
  const relatedEvents = data.events.filter(e => e.vesselId === id)
  const relatedVoyages = data.voyages.filter(v => v.vesselId === id)
  const weatherItems = data.feedItems.filter(item => item.weather && item.relatedVesselIds.includes(id)).slice(0, 2)
  const voyagePortName = (portId: string) => data.ports.find(port => port.id === portId || port.unlocode === portId)?.name ?? portId
  return (
    <ShippingShell title={`船舶详情 · ${vessel.name}`}>
      <Link to="/vessels" className="back-link">
        <span className="i-ph-arrow-left" />
        返回船舶列表
      </Link>
      <div className="detail-two">
        <div className="glass-panel d-panel">
          <div className="d-head">
            <span className="d-avatar"><span className="i-ph-anchor" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="d-title">{vessel.name}</h2>
              <p className="d-sub">
                {vessel.carrier ?? "未知船公司"}
                {" · "}
                {vessel.shipType ?? "船舶"}
                {vessel.imo ? ` · IMO ${vessel.imo}` : ""}
              </p>
            </div>
            <div className="d-chips">
              <StatusBadge stale={vessel.stale} sourceStatus={vessel.sourceStatus} />
              <ProvenanceBadge provenance={vessel.provenance} />
              <WatchChip kind="vessel" id={vessel.id} watched={vessel.isWatched} onSaved={() => refetch()} />
            </div>
          </div>
          <dl className="kv">
            <dt>MMSI</dt>
            <dd>{vessel.mmsi ?? "—"}</dd>
            <dt>呼号</dt>
            <dd>{vessel.callSign ?? "—"}</dd>
            <dt>位置</dt>
            <dd>
              {vessel.latitude ?? "—"}
              {", "}
              {vessel.longitude ?? "—"}
            </dd>
            <dt>航向</dt>
            <dd>{vessel.course === undefined ? "—" : `${vessel.course}°`}</dd>
            <dt>航速</dt>
            <dd>{vessel.speed === undefined ? "—" : `${vessel.speed} 节`}</dd>
            <dt>目的港</dt>
            <dd>{vessel.destination ?? "—"}</dd>
            <dt>ETA</dt>
            <dd>{formatDate(vessel.eta)}</dd>
            <dt>状态开始于</dt>
            <dd>{formatDate(vessel.statusChangedAt)}</dd>
          </dl>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="panel-h">
              <h3>AIS Tracking</h3>
              <StatusBadge stale={latestPosition?.stale ?? true} sourceStatus={latestPosition?.sourceStatus ?? "never_succeeded"} unknown={!latestPosition} />
            </div>
            {!vessel.isWatched
              ? <p className="text-sm op-70">未加入关注列表。</p>
              : !vessel.mmsi
                  ? <p className="text-sm op-70">Unavailable (No MMSI)</p>
                  : isPositionLoading
                    ? <p className="text-sm op-70">正在读取最新位置…</p>
                    : !latestPosition
                        ? <p className="text-sm op-70">暂无 AIS 位置。</p>
                        : (
                            <dl className="kv">
                              {(latestPosition.sourceStatus === "degraded" || latestPosition.sourceStatus === "failed") && (
                                <>
                                  <dt>数据状态</dt>
                                  <dd className="text-amber-700 dark:text-amber-300">
                                    数据源异常，当前显示上次真实位置
                                  </dd>
                                </>
                              )}
                              <dt>最新位置</dt>
                              <dd>
                                {latestPosition.latitude.toFixed(4)}
                                ,
                                {" "}
                                {latestPosition.longitude.toFixed(4)}
                              </dd>
                              <dt>更新时间</dt>
                              <dd>{formatDate(latestPosition.timestamp)}</dd>
                              <dt>数据来源</dt>
                              <dd>
                                {latestPosition.source === "aisstream" ? "AISStream" : latestPosition.source}
                                {latestPosition.stale ? " · stale" : ""}
                              </dd>
                            </dl>
                          )}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="glass-panel d-panel">
            <div className="panel-h"><h3>Voyage</h3></div>
            {isVoyageLoading
              ? <p className="text-sm op-60">正在读取航次…</p>
              : !latestVoyage
                  ? <p className="text-sm op-60">暂无航次数据</p>
                  : <VoyageSummary voyage={latestVoyage} portName={voyagePortName} />}
          </div>
          <div className="glass-panel d-panel">
            <div className="panel-h">
              <h3>关联事件</h3>
              <Link to="/events" className="link-more">
                全部
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {relatedEvents.length === 0
              ? <p className="text-sm op-60">暂无关联事件</p>
              : relatedEvents.slice(0, 3).map(event => <EventMini key={event.id} event={event} />)}
          </div>
          {weatherItems.length > 0 && (
            <div className="glass-panel d-panel">
              <div className="panel-h"><h3>关联天气资讯</h3></div>
              {weatherItems.map(item => (
                <div key={item.id}>
                  <h4 className="text-sm font-bold">{item.title}</h4>
                  {item.weather && <WeatherChips weather={item.weather} />}
                </div>
              ))}
            </div>
          )}
          <div className="glass-panel d-panel">
            <div className="panel-h">
              <h3>关联航次</h3>
              <Link to="/voyages" className="link-more">
                航次
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {relatedVoyages.length === 0
              ? <p className="text-sm op-60">暂无关联航次</p>
              : relatedVoyages.map(voyage => (
                  <Link key={voyage.id} to="/voyages/$id" params={{ id: voyage.id }} className="list-row">
                    <span className="font-bold">{voyage.voyageNumber}</span>
                    <span className="flex items-center gap-2 op-70">
                      {delayCell(voyage.delayMinutes)}
                      <span className="i-ph-arrow-right" />
                    </span>
                  </Link>
                ))}
          </div>
        </div>
      </div>
    </ShippingShell>
  )
}

function VoyageSummary({ voyage, portName }: { voyage: VoyageRecord, portName: (portId: string) => string }) {
  return (
    <dl className="kv">
      <dt>Origin</dt>
      <dd>{portName(voyage.originPortId)}</dd>
      <dt>Destination</dt>
      <dd>{portName(voyage.destinationPortId)}</dd>
      <dt>ETA</dt>
      <dd>{formatDate(voyage.eta)}</dd>
      <dt>Status</dt>
      <dd>{formatStatus(voyage.status)}</dd>
      <dt>Source</dt>
      <dd>{voyage.source}</dd>
      <dt>更新时间</dt>
      <dd>{formatDate(voyage.lastUpdatedAt)}</dd>
    </dl>
  )
}

/* ================= 港口 ================= */

const congestionOptions = [
  { value: "all", label: "全部" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "critical", label: "严重" },
]

export function PortsPage() {
  const { data, isLoading, isError, refetch } = useShipping()
  const [filter, setFilter] = useState("all")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const ports = data.ports.filter(p => filter === "all" || p.congestionLevel === filter)
  return (
    <ShippingShell title="港口">
      <SecHead
        eyebrow="运营数据"
        title="港口"
        description="关注港口的拥堵态势、等待船舶与数据新鲜度，拥堵以量表内联展示。"
        right={<Segmented id="port-congestion" options={congestionOptions} value={filter} onChange={setFilter} />}
      />
      {ports.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-lighthouse" text="当前筛选条件下没有港口" /></div>
        : (
            <div className="glass-panel vt ports">
              <div className="vt-head">
                <span className="c-name">港口</span>
                <span className="c-country">国家</span>
                <span className="c-cong">拥堵</span>
                <span className="c-vessels">等待</span>
                <span className="c-watch">关注</span>
                <span className="c-fresh">数据</span>
              </div>
              {ports.map(p => (
                <div key={p.id} className="vt-row">
                  <Link to="/ports/$id" params={{ id: p.id }} className="nm c-name">
                    {p.name}
                    <small>
                      {p.nameEn}
                      {" · "}
                      {p.unlocode}
                    </small>
                    {data.aisPortMetrics?.find(metric => metric.portId === p.id) && (
                      <small>
                        AIS 区域：
                        {data.aisPortMetrics.find(metric => metric.portId === p.id)?.trend === "rising" ? "上升" : data.aisPortMetrics.find(metric => metric.portId === p.id)?.trend === "falling" ? "下降" : "未知"}
                      </small>
                    )}
                  </Link>
                  <span className="c-country">{p.country}</span>
                  <span className="gauge-cell c-cong">
                    <CongestionGauge level={p.congestionLevel} />
                    <span className={`g-lbl ${p.congestionLevel ?? "unknown"}`}>{formatStatus(p.congestionLevel ?? "unknown")}</span>
                  </span>
                  <span className="c-vessels">
                    {formatPortMetric(p.waitingVessels, "艘")}
                  </span>
                  <span className="c-watch">
                    <WatchChip kind="port" id={p.id} watched={p.isWatched} onSaved={() => refetch()} />
                  </span>
                  <span className="fr c-fresh">
                    <ProvenanceBadge provenance={p.provenance} />
                    <StatusBadge stale={p.stale} sourceStatus={p.sourceStatus} />
                    <span className="i-ph-arrow-right op-50" />
                  </span>
                </div>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

export function PortDetailPage({ id }: { id: string }) {
  const { data, isLoading, isError, refetch } = useShipping()
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const port = data.ports.find(p => p.id === id)
  if (!port) return <ShippingShell><ErrorState /></ShippingShell>
  const relatedEvents = data.events.filter(e => e.portId === id)
  const relatedFeed = data.feedItems.filter(item => item.relatedPortIds.includes(id)).slice(0, 4)
  const aisAreaMetric = data.aisPortMetrics?.find(metric => metric.portId === id)
  return (
    <ShippingShell title={`港口详情 · ${port.name}`}>
      <Link to="/ports" className="back-link">
        <span className="i-ph-arrow-left" />
        返回港口列表
      </Link>
      <div className="detail-two">
        <div className="glass-panel d-panel">
          <div className="d-head">
            <span className="d-avatar"><span className="i-ph-lighthouse" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="d-title">{port.name}</h2>
              <p className="d-sub">
                {port.nameEn}
                {" · "}
                {port.country}
                {" · "}
                {port.unlocode}
              </p>
            </div>
            <div className="d-chips">
              <StatusBadge stale={port.stale} sourceStatus={port.sourceStatus} />
              <ProvenanceBadge provenance={port.provenance} />
              <WatchChip kind="port" id={port.id} watched={port.isWatched} onSaved={() => refetch()} />
            </div>
          </div>
          <dl className="kv">
            <dt>运营状态</dt>
            <dd className="flex items-center gap-2">
              <StatusDot tone={port.operationalStatus === undefined ? "dim" : port.operationalStatus === "normal" ? "fresh" : port.operationalStatus === "closed" ? "failed" : "watch"} />
              {formatStatus(port.operationalStatus ?? "unknown")}
            </dd>
            <dt>拥堵态势</dt>
            <dd>
              <span className="gauge-cell">
                <CongestionGauge level={port.congestionLevel} />
                <span className={`g-lbl ${port.congestionLevel ?? "unknown"}`}>{formatStatus(port.congestionLevel ?? "unknown")}</span>
              </span>
            </dd>
            <dt>等待船舶</dt>
            <dd>
              {formatPortMetric(port.waitingVessels, "艘")}
            </dd>
            <dt>其中集装箱船</dt>
            <dd>
              {formatPortMetric(port.containerWaitingVessels, "艘")}
            </dd>
            <dt>等待时长</dt>
            <dd>
              {formatPortMetric(port.waitingHours, "小时")}
            </dd>
            <dt>公开拥堵数据</dt>
            <dd>
              {port.congestionDetail?.coverageStatus === "no_public_data"
                ? "无公开数据"
                : port.congestionDetail?.coverageStatus === "public"
                  ? "Portcast 公共页面"
                  : "未记录"}
            </dd>
            <dt>中位等待</dt>
            <dd>{port.congestionDetail?.medianWaitingHours === undefined ? "—" : `${port.congestionDetail.medianWaitingHours.toFixed(1)} 小时`}</dd>
            <dt>上周中位等待</dt>
            <dd>{port.congestionDetail?.previousMedianWaitingHours === undefined ? "—" : `${port.congestionDetail.previousMedianWaitingHours.toFixed(1)} 小时`}</dd>
            <dt>周变化</dt>
            <dd>{port.congestionDetail?.weekOverWeekChangePct === undefined ? "—" : `${port.congestionDetail.weekOverWeekChangePct > 0 ? "+" : ""}${port.congestionDetail.weekOverWeekChangePct.toFixed(0)}%`}</dd>
            <dt>最后更新</dt>
            <dd>{formatDate(port.updatedAt)}</dd>
            <dt>来源更新时间</dt>
            <dd>{formatDate(port.sourceUpdatedAt)}</dd>
            {port.provenance?.sourceUrl && (
              <>
                <dt>来源链接</dt>
                <dd>
                  <a className="text-teal-600 underline decoration-teal-500/40 underline-offset-3 dark:text-teal-300" href={port.provenance.sourceUrl} target="_blank" rel="noreferrer">
                    Portcast 公共页面
                  </a>
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="flex flex-col gap-4">
          <AisAreaPanel metric={aisAreaMetric} />
          <div className="glass-panel d-panel">
            <div className="panel-h">
              <h3>关联事件</h3>
              <Link to="/events" className="link-more">
                全部
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {relatedEvents.length === 0
              ? <p className="text-sm op-60">暂无关联事件</p>
              : relatedEvents.slice(0, 3).map(event => <EventMini key={event.id} event={event} />)}
          </div>
          <div className="glass-panel d-panel">
            <div className="panel-h">
              <h3>关联资讯</h3>
              <Link to="/feed" className="link-more">
                资讯
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {relatedFeed.length === 0
              ? <p className="text-sm op-60">暂无关联资讯</p>
              : relatedFeed.map(item => (
                  <a key={item.id} href={item.sourceUrl} target="_blank" rel="noreferrer" className="list-row">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusDot tone={severityTone(item.severity)} />
                      <span className="truncate font-semibold">{item.title}</span>
                    </span>
                    <span className="shrink-0 text-xs op-60">{item.publicationTimeKnown === false ? "发布时间未知" : formatDate(item.publishedAt)}</span>
                  </a>
                ))}
          </div>
        </div>
      </div>
    </ShippingShell>
  )
}

/* ================= 航次 ================= */

const voyageDelayOptions = [
  { value: "all", label: "全部" },
  { value: "delay", label: "延误" },
  { value: "ontime", label: "准点" },
]

export function VoyagesPage() {
  const { data, isLoading, isError } = useShipping()
  const [filter, setFilter] = useState("all")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const voyages = data.voyages.filter(v => filter === "all" || (filter === "delay" ? v.delayMinutes !== undefined && v.delayMinutes > 0 : v.delayMinutes !== undefined && v.delayMinutes <= 0))
  const vesselName = (vesselId: string) => data.vessels.find(v => v.id === vesselId)?.name ?? vesselId
  const portName = (portId: string) => data.ports.find(p => p.id === portId)?.name ?? portId
  return (
    <ShippingShell title="航次">
      <SecHead
        eyebrow="航次计划"
        title="航次"
        description="对比跟踪基线与本地可用的最新计划时间，延误内联展示、一键筛选。"
        right={<Segmented id="voyage-delay" options={voyageDelayOptions} value={filter} onChange={setFilter} />}
      />
      {voyages.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-compass" text="当前筛选条件下没有航次" /></div>
        : (
            <div className="glass-panel vt voyages">
              <div className="vt-head">
                <span className="c-no">航次</span>
                <span className="c-vessel">船舶</span>
                <span className="c-route">航线</span>
                <span className="c-eta">最新 ETA</span>
                <span className="c-delay">延误</span>
                <span className="c-fresh">数据</span>
              </div>
              {voyages.map(v => (
                <div key={v.id} className="vt-row">
                  <Link to="/voyages/$id" params={{ id: v.id }} className="nm c-no">
                    {v.voyageNumber}
                    <small>
                      基准
                      {" "}
                      {formatDate(v.baselineEta)}
                    </small>
                  </Link>
                  <span className="c-vessel">{vesselName(v.vesselId)}</span>
                  <span className="c-route">
                    {portName(v.originPortId)}
                    {" → "}
                    {portName(v.destinationPortId)}
                  </span>
                  <span className="eta c-eta">{v.status === "arrived" ? "已到港" : formatDate(v.latestEta)}</span>
                  <span className="c-delay">{delayCell(v.delayMinutes)}</span>
                  <span className="fr c-fresh">
                    <ProvenanceBadge provenance={v.provenance} />
                    <StatusBadge stale={v.stale} sourceStatus={v.sourceStatus} />
                    <span className="i-ph-arrow-right op-50" />
                  </span>
                </div>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

export function VoyageDetailPage({ id }: { id: string }) {
  const { data, isLoading, isError } = useShipping()
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const voyage = data.voyages.find(v => v.id === id)
  if (!voyage) return <ShippingShell><ErrorState /></ShippingShell>
  const vessel = data.vessels.find(v => v.id === voyage.vesselId)
  const origin = data.ports.find(p => p.id === voyage.originPortId)
  const destination = data.ports.find(p => p.id === voyage.destinationPortId)
  const relatedEvents = data.events.filter(e => e.voyageId === id)
  const weatherItems = data.feedItems.filter(item => item.weather && item.relatedVoyageIds.includes(id)).slice(0, 2)
  return (
    <ShippingShell title={`航次详情 · ${voyage.voyageNumber}`}>
      <Link to="/voyages" className="back-link">
        <span className="i-ph-arrow-left" />
        返回航次列表
      </Link>
      <div className="detail-two">
        <div className="glass-panel d-panel">
          <div className="d-head">
            <span className="d-avatar"><span className="i-ph-compass" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="d-title">{voyage.voyageNumber}</h2>
              <p className="d-sub">
                {origin?.name ?? voyage.originPortId}
                {" → "}
                {destination?.name ?? voyage.destinationPortId}
              </p>
            </div>
            <div className="d-chips">
              <StatusBadge stale={voyage.stale} sourceStatus={voyage.sourceStatus} />
              <ProvenanceBadge provenance={voyage.provenance} />
              <span className="chip">{formatStatus(voyage.status)}</span>
            </div>
          </div>
          <dl className="kv">
            <dt>船舶</dt>
            <dd>
              {vessel
                ? (
                    <Link to="/vessels/$id" params={{ id: vessel.id }} className="link-more">
                      {vessel.name}
                      <span className="i-ph-arrow-right" />
                    </Link>
                  )
                : voyage.vesselId}
            </dd>
            <dt>基准 ETD</dt>
            <dd>
              {formatDate(voyage.baselineEtd)}
              {" · "}
              {voyage.baselineEtdSource ?? "—"}
            </dd>
            <dt>基准 ETA</dt>
            <dd>
              {formatDate(voyage.baselineEta)}
              {" · "}
              {voyage.baselineEtaSource ?? "—"}
            </dd>
            <dt>最新 ETD</dt>
            <dd>
              {formatDate(voyage.latestEtd)}
              {" · "}
              {voyage.latestEtdSource ?? "—"}
            </dd>
            <dt>最新 ETA</dt>
            <dd>
              {formatDate(voyage.latestEta)}
              {" · "}
              {voyage.latestEtaSource ?? "—"}
            </dd>
            <dt>延误</dt>
            <dd>{delayCell(voyage.delayMinutes)}</dd>
            <dt>观测时间</dt>
            <dd>{formatDate(voyage.latestEtaObservedAt)}</dd>
          </dl>
        </div>
        <div className="flex flex-col gap-4">
          <div className="glass-panel d-panel">
            <div className="panel-h">
              <h3>关联事件</h3>
              <Link to="/events" className="link-more">
                全部
                <span className="i-ph-arrow-right" />
              </Link>
            </div>
            {relatedEvents.length === 0
              ? <p className="text-sm op-60">暂无关联事件</p>
              : relatedEvents.slice(0, 3).map(event => <EventMini key={event.id} event={event} />)}
          </div>
          {weatherItems.length > 0 && (
            <div className="glass-panel d-panel">
              <div className="panel-h"><h3>航线天气资讯</h3></div>
              {weatherItems.map(item => (
                <div key={item.id}>
                  <h4 className="text-sm font-bold">{item.title}</h4>
                  {item.weather && <WeatherChips weather={item.weather} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ShippingShell>
  )
}

/* ================= 事件 ================= */

const eventStatusOptions = [
  { value: "active", label: "进行中" },
  { value: "resolved", label: "已解决" },
]

const eventSeverityOptions: { value: "all" | SeverityValue, label: string }[] = [
  { value: "all", label: "全部严重度" },
  { value: "critical", label: "严重" },
  { value: "warning", label: "警告" },
  { value: "watch", label: "关注" },
  { value: "info", label: "信息" },
]

export function EventsPage() {
  const { data, isLoading, isError } = useShipping()
  const [tab, setTab] = useState("active")
  const [severity, setSeverity] = useState<"all" | SeverityValue>("all")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const events = data.events.filter(e => e.status === tab && (severity === "all" || e.severity === severity))
  return (
    <ShippingShell title="事件">
      <SecHead
        eyebrow="事件生命周期"
        title="事件"
        description="包含证据、去重、严重程度变化和明确解决状态的运营异常，按时间线展示。"
        right={(
          <>
            <Segmented id="event-status" options={eventStatusOptions} value={tab} onChange={setTab} />
            <Segmented id="event-severity" options={eventSeverityOptions} value={severity} onChange={setSeverity} />
          </>
        )}
      />
      {events.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-bell-ringing" text={tab === "active" ? "当前没有进行中的事件" : "暂无已解决的事件"} /></div>
        : (
            <div className="glass-panel tl">
              {events.map(e => (
                <div key={e.id} className={`tl-item${e.status === "resolved" ? " resolved" : ""}`}>
                  <div className="tl-sev">
                    <StatusDot tone={severityTone(e.severity)} pulse={e.status === "active" && e.severity === "critical"} />
                    <span className="tl-line" />
                  </div>
                  <div className="tl-body">
                    <div className="tl-title-row">
                      <h4>{e.title}</h4>
                      <span className="chip">{e.status === "active" ? "进行中" : "已解决"}</span>
                    </div>
                    <p className="tl-sum">{e.summary}</p>
                    <div className="tl-chips">
                      <Severity value={e.severity} />
                      <ProvenanceBadge provenance={e.provenance} />
                      <StatusBadge stale={e.stale ?? e.sourceStatus !== "healthy"} sourceStatus={e.sourceStatus} />
                      <span className="tl-time">
                        {eventTimestampLabel(e)}
                      </span>
                      {relatedLabel(e, data) && <span className="chip">{relatedLabel(e, data)}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

/* ================= 资讯 ================= */

const categoryOptions = [
  { value: "all", label: "全部" },
  { value: "shipping_news", label: "航运新闻" },
  { value: "carrier_notice", label: "船公司通知" },
  { value: "weather", label: "天气" },
  { value: "port_notice", label: "港口通知" },
]

export function FeedPage() {
  const { data, isLoading, isError } = useShipping()
  const [filter, setFilter] = useState("all")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const items = data.feedItems.filter(item => filter === "all" || item.category === filter)
  const countOf = (value: string) => value === "all" ? data.feedItems.length : data.feedItems.filter(item => item.category === value).length
  const sourceRows = [
    { label: "官方", tone: "failed" as const, count: data.feedItems.filter(item => item.provenance?.sourceType === "official").length },
    { label: "第三方", tone: "info" as const, count: data.feedItems.filter(item => item.provenance?.sourceType === "third_party").length },
    { label: "模拟数据", tone: "dim" as const, count: data.feedItems.filter(item => item.provenance?.sourceType === "mock").length },
  ]
  return (
    <ShippingShell title="航运资讯">
      <SecHead
        eyebrow="信息资讯"
        title="航运资讯"
        description="普通航运资讯留在 Feed；明确运营影响的官方公告和预警才会进入 HOT。"
      />
      <div className="feed-wrap">
        <aside className="filter-panel">
          <h4>分类</h4>
          {categoryOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${filter === option.value ? " active" : ""}`} onClick={() => setFilter(option.value)}>
              {option.label}
              <em>{countOf(option.value)}</em>
            </button>
          ))}
          <h4>来源</h4>
          {sourceRows.map(row => (
            <div key={row.label} className="sf-row frow">
              <StatusDot tone={row.tone} />
              <span className="lbl grow">{row.label}</span>
              <span className="val">{row.count}</span>
            </div>
          ))}
        </aside>
        {items.length === 0
          ? <div className="glass-panel"><EmptyState icon="i-ph-newspaper" text="当前分类下暂无资讯" /></div>
          : (
              <div className="glass-panel tl">
                {items.map(item => (
                  <div key={item.id} className="tl-item">
                    <div className="tl-sev">
                      <StatusDot tone={severityTone(item.severity)} pulse={item.severity === "critical"} />
                      <span className="tl-line" />
                    </div>
                    <div className="tl-body">
                      <div className="tl-title-row">
                        <h4>{item.title}</h4>
                        <a className="src-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                          打开来源
                          <span className="i-ph-arrow-up-right" />
                        </a>
                      </div>
                      <p className="tl-sum">{item.summary}</p>
                      <div className="tl-chips">
                        <span className="chip">{formatStatus(item.category)}</span>
                        <ProvenanceBadge provenance={item.provenance} />
                        <StatusBadge stale={item.stale} sourceStatus={item.sourceStatus} />
                        <span className="tl-time">
                          {item.publicationTimeKnown === false ? "发布时间未知" : formatDate(item.publishedAt)}
                        </span>
                        {item.hotReason && (
                          <span className="chip text-amber-600 dark:text-amber-300">
                            HOT 原因：
                            {item.hotReason}
                          </span>
                        )}
                        {item.tags?.map(tag => <span key={tag} className="chip">{tag}</span>)}
                      </div>
                      {item.weather && <WeatherChips weather={item.weather} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
      </div>
    </ShippingShell>
  )
}

/* ================= 国家日历 ================= */

const calendarCountryOptions = [
  { value: "all", label: "全部国家" },
  ...Object.entries(calendarCountries).map(([value, label]) => ({ value, label: `${countryFlags[value] ?? ""} ${label}` })),
]
const calendarYearOptions = (() => {
  const currentYear = new Date().getUTCFullYear()
  return [currentYear - 1, currentYear, currentYear + 1].map(value => ({ value: String(value), label: `${value} 年` }))
})()
const calendarMonthOptions = [
  { value: "all", label: "全年" },
  ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1).padStart(2, "0"), label: `${index + 1} 月` })),
]
const calendarTypeOptions = [
  { value: "all", label: "全部类型" },
  { value: "public_holiday", label: "公共假日" },
  { value: "religious", label: "宗教日期" },
  { value: "government_special", label: "政府临时" },
  { value: "observance", label: "纪念/观察日" },
  { value: "company_custom", label: "公司自定义" },
]
const calendarImpactOptions = [
  { value: "all", label: "全部影响" },
  { value: "low", label: "低影响" },
  { value: "medium", label: "中影响" },
  { value: "high", label: "高影响" },
  { value: "critical", label: "关键影响" },
]
const calendarVerificationOptions = [
  { value: "all", label: "全部验证" },
  { value: "verified", label: "已验证" },
  { value: "unverified", label: "待核验" },
]

export function CalendarPage() {
  const { data, isLoading, isError, refetch } = useShipping()
  const [country, setCountry] = useState("all")
  const [selectedYear, setSelectedYear] = useState(String(new Date().getUTCFullYear()))
  const [month, setMonth] = useState("all")
  const [type, setType] = useState("all")
  const [impact, setImpact] = useState("all")
  const [verification, setVerification] = useState("all")
  const [publicOnly, setPublicOnly] = useState(false)
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle")
  const year = Number(selectedYear)
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const today = new Date().toISOString().slice(0, 10)
  const events = (data.calendarEvents ?? []).filter(event => event.date.startsWith(String(year)) && (month === "all" || event.date.slice(5, 7) === month) && (country === "all" || event.countryCode === country) && (type === "all" || event.type === type) && (impact === "all" || event.businessImpact === impact) && (verification === "all" || (verification === "verified" ? event.verified : !event.verified)) && (!publicOnly || event.isPublicHoliday))
  const sync = async () => {
    setSyncState("syncing")
    try {
      await myFetch("/shipping/calendar/sync", { method: "POST", body: { year, countries: country === "all" ? undefined : [country] } })
      await refetch()
      setSyncState("done")
    } catch {
      setSyncState("error")
    }
  }
  return (
    <ShippingShell title="国家日历">
      <SecHead
        eyebrow="市场日历"
        title="国家日历"
        description="缓存 TH / ID / MY / PH / VN 的国家假日与运营提醒；宗教日期不默认等同于停工。"
        right={(
          <button type="button" className="btn-gradient" disabled={syncState === "syncing"} onClick={sync}>
            <span className="i-ph-cloud-arrow-down" />
            {syncState === "syncing" ? "同步中…" : "同步年度缓存"}
          </button>
        )}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs op-65">
        <span>{data.provider.calendar === "mock" ? "当前为 Mock 日历；配置 Calendarific Key 后可同步年度第三方缓存。" : `Provider：${data.provider.calendar}${data.provider.calendarSourceIds?.length ? `（${data.provider.calendarSourceIds.join(" + ")}）` : ""}`}</span>
        {data.calendarAttribution && <a className="text-teal-600 underline decoration-teal-500/40 underline-offset-3 dark:text-teal-300" href="https://calendarific.com/" target="_blank" rel="noreferrer">{data.calendarAttribution}</a>}
      </div>
      {syncState === "error" && <p className="mb-4 text-sm text-rose-600 dark:text-rose-300">同步失败，继续显示本地缓存。</p>}
      <div className="cal-wrap">
        <aside className="filter-panel">
          <h4>国家</h4>
          {calendarCountryOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${country === option.value ? " active" : ""}`} onClick={() => setCountry(option.value)}>
              {option.label}
            </button>
          ))}
          <h4>年份</h4>
          {calendarYearOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${selectedYear === option.value ? " active" : ""}`} onClick={() => setSelectedYear(option.value)}>
              {option.label}
            </button>
          ))}
          <h4>月份</h4>
          {calendarMonthOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${month === option.value ? " active" : ""}`} onClick={() => setMonth(option.value)}>
              {option.label}
            </button>
          ))}
          <h4>类型</h4>
          {calendarTypeOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${type === option.value ? " active" : ""}`} onClick={() => setType(option.value)}>
              {option.label}
            </button>
          ))}
          <h4>影响</h4>
          {calendarImpactOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${impact === option.value ? " active" : ""}`} onClick={() => setImpact(option.value)}>
              {option.label}
            </button>
          ))}
          <h4>验证状态</h4>
          {calendarVerificationOptions.map(option => (
            <button key={option.value} type="button" className={`fbtn${verification === option.value ? " active" : ""}`} onClick={() => setVerification(option.value)}>
              {option.label}
            </button>
          ))}
          <button type="button" className={`fbtn${publicOnly ? " active" : ""}`} onClick={() => setPublicOnly(value => !value)}>
            仅公共假日
          </button>
        </aside>
        {events.length === 0
          ? <div className="glass-panel"><EmptyState icon="i-ph-calendar-blank" text="当前筛选下暂无已缓存事件" /></div>
          : <div className="cal-grid">{events.map(event => <CalendarCard key={event.id} event={event} today={today} />)}</div>}
      </div>
    </ShippingShell>
  )
}

/* ================= 设置 ================= */

const settingsCongestionOptions = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "critical", label: "严重" },
]

export function SettingsPage() {
  const { data, isLoading, isError, refetch } = useShipping()
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [refreshInterval, setRefreshInterval] = useState(15)
  const [anchoredHours, setAnchoredHours] = useState(2)
  const [delayMinutes, setDelayMinutes] = useState(60)
  const [retentionDays, setRetentionDays] = useState(30)
  const [congestionLevel, setCongestionLevel] = useState("high")
  useEffect(() => {
    if (data) {
      setRefreshInterval(data.settings.refreshInterval)
      setAnchoredHours(data.settings.eventThresholds.anchoredHours)
      setDelayMinutes(data.settings.eventThresholds.delayMinutes)
      setRetentionDays(data.settings.retentionDays)
      setCongestionLevel(data.settings.eventThresholds.congestionLevel)
    }
  }, [data])
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const weatherAlertLabel = data.provider.weatherAlerts === "public" && data.providerFreshness?.weatherAlerts?.sourceStatus === "never_succeeded"
    ? "public · 无已验证来源"
    : data.provider.weatherAlerts
  return (
    <ShippingShell title="设置">
      <SecHead eyebrow="本地配置" title="设置" description="配置刷新间隔和确定性的事件阈值。船舶与港口的关注状态单独保存。" />
      <div className="glass-panel max-w-2xl p-6">
        <label className="setting-row">
          <span>
            <strong>刷新间隔</strong>
            <small>本地数据刷新间隔（分钟）</small>
          </span>
          <input className="setting-input" value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))} type="number" min="1" />
        </label>
        <label className="setting-row">
          <span>
            <strong>锚泊告警阈值</strong>
            <small>锚泊多少小时后生成事件</small>
          </span>
          <input className="setting-input" value={anchoredHours} onChange={e => setAnchoredHours(Number(e.target.value))} type="number" min="1" />
        </label>
        <label className="setting-row">
          <span>
            <strong>ETA 延误阈值</strong>
            <small>航次延误多少分钟后升级提醒</small>
          </span>
          <input className="setting-input" value={delayMinutes} onChange={e => setDelayMinutes(Number(e.target.value))} type="number" min="1" />
        </label>
        <label className="setting-row">
          <span>
            <strong>拥堵阈值</strong>
            <small>达到或超过此港口等级时告警</small>
          </span>
          <Segmented id="settings-congestion" options={settingsCongestionOptions} value={congestionLevel} onChange={setCongestionLevel} />
        </label>
        <label className="setting-row">
          <span>
            <strong>数据保留</strong>
            <small>事件和资讯的保留天数</small>
          </span>
          <input className="setting-input" value={retentionDays} onChange={e => setRetentionDays(Number(e.target.value))} type="number" min="1" />
        </label>
        <div className="mt-7 flex flex-wrap items-center gap-4">
          <motion.button
            whileTap={{ scale: 0.96 }}
            disabled={saveState === "saving"}
            className={`btn-gradient ${saveState === "saved" ? "saved" : saveState === "error" ? "error" : ""}`}
            onClick={async () => {
              setSaveState("saving")
              try {
                await myFetch("/shipping/settings", { method: "POST", body: { refreshInterval, retentionDays, eventThresholds: { anchoredHours, delayMinutes, congestionLevel } } })
                await refetch()
                setSaveState("saved")
              } catch {
                setSaveState("error")
              }
            }}
          >
            {saveState === "saved"
              ? (
                  <>
                    <span className="i-ph-check-circle" />
                    已在本地保存
                  </>
                )
              : saveState === "error"
                ? (
                    <>
                      <span className="i-ph-warning-circle" />
                      保存失败，点击重试
                    </>
                  )
                : saveState === "saving"
                  ? (
                      <>
                        <span className="i-ph-circle-notch animate-spin" />
                        保存中…
                      </>
                    )
                  : (
                      <>
                        <span className="i-ph-floppy-disk" />
                        保存设置
                      </>
                    )}
          </motion.button>
          <div className="flex flex-wrap gap-2">
            <ProviderChip label="船位" value={data.provider.vessel} />
            <ProviderChip label="天气" value={data.provider.weather} />
            <ProviderChip label="官方预警" value={weatherAlertLabel} />
            <ProviderChip label="港口" value={data.provider.port} />
            <ProviderChip label="AIS 区域" value={data.provider.aisArea ?? "off"} />
            <ProviderChip label="班期" value={data.provider.schedule} />
            <ProviderChip label="资讯" value={data.provider.feed} />
            <ProviderChip label="日历" value={data.provider.calendar} />
          </div>
        </div>
        <p className="mt-4 text-xs op-60">数据源：AISStream（船位，可选 key）、AISStream 区域 PositionReport（显式开启后提供派生趋势）、Open-Meteo Marine（天气模型）、JMA / TMD / BMKG（官方天气预警，可选 public / experimental）、Portcast 公共港口页面（低频公开字段）、Shipping Feed（默认 Mock，可选公开 RSS/官方公告）与 Mock Schedule。</p>
      </div>
    </ShippingShell>
  )
}

/* ================= 日历共享子组件 ================= */

const calendarTypeLabels: Record<string, string> = {
  public_holiday: "公共假日",
  observance: "观察日",
  religious: "宗教日期",
  commercial: "商业日期",
  government_special: "政府临时假日",
  company_custom: "公司自定义",
}

const calendarImpactLabels: Record<string, string> = { low: "低影响", medium: "中影响", high: "高影响", critical: "关键" }
const calendarScopeLabels: Record<string, string> = { national: "全国范围", subdivision: "地方范围", unknown: "范围待核实" }

function formatCalendarDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
}

function CalendarListRow({ event, today }: { event: CalendarEvent, today: string }) {
  const days = daysUntilCalendarEvent(event.date, today)
  return (
    <div className="list-row">
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot tone={event.businessImpact === "critical" || event.businessImpact === "high" ? "failed" : event.businessImpact === "medium" ? "watch" : "info"} />
        <span className="truncate font-semibold">{event.name}</span>
      </span>
      <span className="shrink-0 text-xs op-65">
        {days === 0 ? "今天" : `${days} 天后`}
        {" · "}
        {event.countryCode}
      </span>
    </div>
  )
}

function CalendarCard({ event, today }: { event: CalendarEvent, today: string }) {
  const days = daysUntilCalendarEvent(event.date, today)
  const parts = event.date.split("-")
  return (
    <div className="glass-panel tile cal-card">
      <div className="cal-head">
        <span className="cal-date">
          {parts[2]}
          <span>
            {Number(parts[1])}
            月
          </span>
        </span>
        <span className="cal-flag">
          {countryFlags[event.countryCode] ?? ""}
          {" "}
          {calendarCountries[event.countryCode]}
        </span>
      </div>
      <h4>{event.name}</h4>
      <div className="cal-chips">
        <span className="chip">{calendarTypeLabels[event.type] ?? event.type}</span>
        {event.scope && (
          <span className="chip">
            {calendarScopeLabels[event.scope] ?? event.scope}
            {event.scope === "subdivision" && event.scopeLabel ? ` · ${event.scopeLabel}` : ""}
          </span>
        )}
        <span className="chip">{calendarImpactLabels[event.businessImpact] ?? event.businessImpact}</span>
        <span className="chip">{event.verified ? "已验证" : "待核验"}</span>
      </div>
      <p className="cal-note">
        {formatCalendarDate(event.date)}
        {" · "}
        {days < 0 ? "已过期" : days === 0 ? "今天" : `${days} 天后`}
        {event.scope === "national" ? " · 全国公共假日" : event.scope === "subdivision" ? " · 地方公共假日" : event.scope === "unknown" ? " · 范围待核实" : event.isPublicHoliday ? " · 公共假日" : ""}
        {event.conflictFlag ? " · 存在来源冲突" : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs op-70">
        <ProvenanceBadge provenance={event.provenance} />
        <StatusBadge stale={event.stale} sourceStatus={event.sourceStatus} />
        {event.sourceUrl && <a className="text-teal-600 underline decoration-teal-500/40 underline-offset-3 dark:text-teal-300" href={event.sourceUrl} target="_blank" rel="noreferrer">来源</a>}
      </div>
    </div>
  )
}
