import { Link } from "@tanstack/react-router"
import { motion } from "framer-motion"
import { type ReactNode, useEffect, useState } from "react"
import { type CalendarEvent, calendarCountries, daysUntilCalendarEvent } from "@shared/calendar"
import { ErrorState, EventCard, FeedCard, LoadingState, PageHero, ProvenanceBadge, Severity, ShippingShell, StatCard, StatusBadge, VoyageCard } from "./app"
import { useShipping } from "./data"
import { formatDate, formatStatus, navTone, severityTone } from "./format"
import { EmptyState, GradientText, Marquee, ProviderChip, Reveal, SectionHeading, Segmented, SpotlightCard, StatusDot } from "./ui"
import { myFetch } from "~/utils"

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
    { label: "活跃 HOT", value: data.hot.length, tone: "critical" as const },
    { label: "关注船舶", value: watchedVessels.length, tone: "default" as const },
    { label: "关注港口", value: watchedPorts.length, tone: "warning" as const },
    { label: "数据源", value: `${data.provider.vessel} / ${data.provider.weather}`, tone: "default" as const },
  ]
  return (
    <ShippingShell>
      <section className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Reveal className="glass-panel relative overflow-hidden p-6 md:p-10">
          <div className="hero-sheen" />
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">
            <StatusDot tone="fresh" pulse />
            运营态势 · Operations
          </p>
          <h1 className="font-brand mt-4 text-4xl font-bold tracking-tight md:text-6xl">
            Shipping
            {" "}
            <GradientText>HOT</GradientText>
          </h1>
          <p className="mt-4 max-w-xl text-sm op-75 md:text-base">
            面向关注船舶、港口、航次和航运信号的本地指挥台 —— 优先信号、拥堵态势与延误对比一目了然。
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ProviderChip label="船位" value={data.provider.vessel} tone={data.provider.vessel === "mock" ? "dim" : "info"} />
            <ProviderChip label="天气" value={data.provider.weather} tone={data.provider.weather === "mock" ? "dim" : "info"} />
            <ProviderChip label="港口" value={data.provider.port} tone={data.provider.port === "mock" ? "dim" : "info"} />
            <ProviderChip label="班期" value={data.provider.schedule} tone={data.provider.schedule === "mock" ? "dim" : "info"} />
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/vessels" className="btn-gradient">
              查看船队
              <span className="i-ph-arrow-right" />
            </Link>
            <Link to="/events" className="btn-ghost">运营事件</Link>
            <Link to="/voyages" className="btn-ghost">航次计划</Link>
          </div>
        </Reveal>
        <div className="grid grid-cols-2 gap-4">
          {stats.map((stat, index) => (
            <Reveal key={stat.label} delay={0.05 + index * 0.08} className="h-full">
              <StatCard label={stat.label} value={stat.value} tone={stat.tone} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <SectionHeading
          eyebrow="优先信号"
          title="需要关注的事项"
          description="按严重程度排序的运营信号，聚合事件与资讯去重后的关键项。"
          right={<span className="chip hidden md:inline-flex">V1 Provider：AISStream / Open-Meteo Marine</span>}
        />
        {data.hot.length === 0
          ? <div className="glass-panel"><EmptyState icon="i-ph-check-circle" text="当前没有需要关注的事项" /></div>
          : (
              <div className="grid gap-4 lg:grid-cols-2">
                {data.hot.map((item, index) => (
                  <Reveal key={item.id} delay={Math.min(index, 6) * 0.06}>
                    <article className={`glass-panel hot-glow ${item.severity} tile p-5`}>
                      <div className="flex items-center justify-between gap-2">
                        <Severity value={item.severity} />
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <ProvenanceBadge provenance={item.provenance} />
                          <StatusBadge stale={item.freshness === "stale"} sourceStatus={item.sourceStatus} unknown={item.freshness === "unknown"} />
                        </div>
                      </div>
                      <h3 className="mt-3 text-xl font-bold">{item.title}</h3>
                      <p className="mt-1.5 op-80">{item.summary}</p>
                      <p className="mt-4 flex items-center gap-1.5 text-sm op-65">
                        <span className="i-ph-clock" />
                        {item.relatedLabel ?? "航运信号"}
                        {" "}
                        ·
                        {formatDate(item.occurredAt)}
                      </p>
                    </article>
                  </Reveal>
                ))}
              </div>
            )}
      </section>

      <section className="mt-12 grid gap-4 lg:grid-cols-2">
        <Reveal className="glass-panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold">关注的船舶</h2>
            <Link to="/vessels" className="flex items-center gap-1 text-sm font-semibold text-teal-600 dark:text-teal-300">
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
            <Link to="/ports" className="flex items-center gap-1 text-sm font-semibold text-teal-600 dark:text-teal-300">
              查看全部
              <span className="i-ph-arrow-right" />
            </Link>
          </div>
          {watchedPorts.length === 0
            ? <EmptyState icon="i-ph-lighthouse" text="还没有关注的港口" />
            : watchedPorts.map(p => (
                <Link key={p.id} to="/ports/$id" params={{ id: p.id }} className="list-row group">
                  <span className="flex min-w-0 items-center gap-2 font-semibold">
                    <StatusDot tone={p.congestionLevel === "critical" ? "failed" : p.congestionLevel === "high" ? "watch" : "fresh"} />
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 op-70">
                    <span className="hidden sm:inline">
                      拥堵：
                      {formatStatus(p.congestionLevel)}
                    </span>
                    <span className="i-ph-arrow-right transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
        </Reveal>
      </section>

      <Reveal delay={0.12} className="glass-panel mt-4 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">资讯快讯</h2>
          <Link to="/feed" className="flex items-center gap-1 text-sm font-semibold text-teal-600 dark:text-teal-300">
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
                    <span className="op-60">{formatDate(item.publishedAt)}</span>
                  </a>
                ))}
              </Marquee>
            )}
      </Reveal>
      <Reveal delay={0.16} className="glass-panel mt-4 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">近期国家日历</h2>
          <Link to="/calendar" className="flex items-center gap-1 text-sm font-semibold text-teal-600 dark:text-teal-300">
            查看日历
            <span className="i-ph-arrow-right" />
          </Link>
        </div>
        {upcomingCalendar.length === 0
          ? <EmptyState icon="i-ph-calendar-blank" text="未来 14 天暂无已缓存日历提醒" />
          : upcomingCalendar.map(event => <CalendarListRow key={event.id} event={event} today={today} />)}
      </Reveal>
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

export function VesselsPage() {
  const { data, isLoading, isError, refetch } = useShipping()
  const [filter, setFilter] = useState("all")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const vessels = data.vessels.filter(v => filter === "all" || v.navigationStatus === filter)
  return (
    <ShippingShell>
      <PageHero eyebrow="运营数据" title="我的船舶" description="查看关注船队的航行状态、位置、目的地和数据新鲜度。">
        <Segmented id="vessel-status" options={vesselStatusOptions} value={filter} onChange={setFilter} />
      </PageHero>
      {vessels.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-anchor" text="当前筛选条件下没有船舶" /></div>
        : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {vessels.map((v, index) => (
                <Reveal key={v.id} delay={Math.min(index, 9) * 0.05} className="relative h-full">
                  <Link to="/vessels/$id" params={{ id: v.id }} className="block h-full">
                    <SpotlightCard className="glass-panel tile h-full cursor-pointer p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-teal-500/30 bg-teal-500/10 text-lg text-teal-600 dark:text-teal-300">
                            <span className="i-ph-anchor" />
                          </span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-xs uppercase tracking-wider op-65">
                              船舶
                              <ProvenanceBadge provenance={v.provenance} />
                              <StatusBadge stale={v.stale} sourceStatus={v.sourceStatus} />
                            </p>
                            <h3 className="mt-0.5 truncate text-lg font-bold leading-tight">{v.name}</h3>
                            <p className="truncate text-xs op-70">
                              {v.carrier ?? "未知船公司"}
                              {" "}
                              ·
                              {" "}
                              {v.shipType ?? "船舶"}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
                        <MiniField
                          label="状态"
                          value={(
                            <span className="flex items-center gap-1.5">
                              <StatusDot tone={navTone(v.navigationStatus)} />
                              {formatStatus(v.navigationStatus)}
                            </span>
                          )}
                        />
                        <MiniField label="航速" value={`${v.speed ?? "—"} 节`} />
                        <MiniField label="目的地" value={v.destination ?? "—"} />
                        <MiniField label="更新" value={formatDate(v.updatedAt)} />
                      </div>
                    </SpotlightCard>
                  </Link>
                  <WatchButton kind="vessel" id={v.id} watched={v.isWatched} onSaved={() => refetch()} />
                </Reveal>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

export function VesselDetailPage({ id }: { id: string }) {
  const { data, isLoading, isError } = useShipping()
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const vessel = data.vessels.find(v => v.id === id)
  if (!vessel) return <ShippingShell><ErrorState /></ShippingShell>
  return (
    <ShippingShell>
      <PageHero eyebrow="船舶详情" title={vessel.name} description={`${vessel.carrier ?? "未知船公司"} · ${vessel.shipType ?? "船舶"}`}>
        <Link to="/vessels" className="btn-ghost text-sm">
          <span className="i-ph-arrow-left" />
          返回列表
        </Link>
      </PageHero>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="航行状态" value={formatStatus(vessel.navigationStatus)} hint={vessel.destination ?? undefined} />
        <StatCard label="航速" value={`${vessel.speed ?? "—"} 节`} />
        <StatCard label="ETA" value={formatDate(vessel.eta)} />
        <StatCard label="更新时间" value={formatDate(vessel.updatedAt)} />
      </div>
      <Reveal className="glass-panel mt-6 p-6">
        <h2 className="mb-4 text-xl font-bold">当前状态</h2>
        <dl className="detail-grid">
          <dt>IMO</dt>
          <dd>{vessel.imo ?? "—"}</dd>
          <dt>MMSI</dt>
          <dd>{vessel.mmsi ?? "—"}</dd>
          <dt>位置</dt>
          <dd>
            {vessel.latitude ?? "—"}
            ,
            {" "}
            {vessel.longitude ?? "—"}
          </dd>
          <dt>航向</dt>
          <dd>{vessel.course === undefined ? "—" : `${vessel.course}°`}</dd>
          <dt>状态开始于</dt>
          <dd>{formatDate(vessel.statusChangedAt)}</dd>
          <dt>数据源</dt>
          <dd>
            <div className="flex flex-wrap gap-1.5">
              <ProvenanceBadge provenance={vessel.provenance} />
              <StatusBadge stale={vessel.stale} sourceStatus={vessel.sourceStatus} />
            </div>
          </dd>
        </dl>
      </Reveal>
    </ShippingShell>
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
    <ShippingShell>
      <PageHero eyebrow="运营数据" title="我的港口" description="查看重点港口的拥堵、等待船舶和运营状态。">
        <Segmented id="port-congestion" options={congestionOptions} value={filter} onChange={setFilter} />
      </PageHero>
      {ports.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-lighthouse" text="当前筛选条件下没有港口" /></div>
        : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ports.map((p, index) => (
                <Reveal key={p.id} delay={Math.min(index, 9) * 0.05} className="relative h-full">
                  <Link to="/ports/$id" params={{ id: p.id }} className="block h-full">
                    <SpotlightCard className="glass-panel tile h-full cursor-pointer p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-lg text-violet-600 dark:text-violet-300">
                            <span className="i-ph-lighthouse" />
                          </span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-xs uppercase tracking-wider op-65">
                              港口
                              <ProvenanceBadge provenance={p.provenance} />
                              <StatusBadge stale={p.stale} sourceStatus={p.sourceStatus} />
                            </p>
                            <h3 className="mt-0.5 truncate text-lg font-bold leading-tight">{p.name}</h3>
                            <p className="truncate text-xs op-70">
                              {p.nameEn}
                              {" "}
                              ·
                              {" "}
                              {p.unlocode}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <MiniField label="拥堵等级" value={formatStatus(p.congestionLevel)} />
                        <MiniField label="等待船舶" value={`${p.waitingVessels} 艘`} />
                        <MiniField label="等待时长" value={`${p.waitingHours} 小时`} />
                      </div>
                      <CongestionGauge level={p.congestionLevel} />
                    </SpotlightCard>
                  </Link>
                  <WatchButton kind="port" id={p.id} watched={p.isWatched} onSaved={() => refetch()} />
                </Reveal>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

export function PortDetailPage({ id }: { id: string }) {
  const { data, isLoading, isError } = useShipping()
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const port = data.ports.find(p => p.id === id)
  if (!port) return <ShippingShell><ErrorState /></ShippingShell>
  return (
    <ShippingShell>
      <PageHero eyebrow="港口详情" title={port.name} description={`${port.nameEn} · ${port.country} · ${port.unlocode}`}>
        <Link to="/ports" className="btn-ghost text-sm">
          <span className="i-ph-arrow-left" />
          返回列表
        </Link>
      </PageHero>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="拥堵等级" value={formatStatus(port.congestionLevel)} tone={port.congestionLevel === "critical" ? "critical" : port.congestionLevel === "high" ? "warning" : "default"} />
        <StatCard label="等待船舶" value={port.waitingVessels} />
        <StatCard label="其中集装箱船" value={port.containerWaitingVessels} />
        <StatCard label="等待时长" value={`${port.waitingHours} 小时`} />
      </div>
      <Reveal className="glass-panel mt-6 p-6">
        <h2 className="mb-4 text-xl font-bold">运营状态</h2>
        <dl className="detail-grid">
          <dt>状态</dt>
          <dd className="flex items-center gap-2">
            <StatusDot tone={port.operationalStatus === "normal" ? "fresh" : port.operationalStatus === "closed" ? "failed" : "watch"} />
            {formatStatus(port.operationalStatus)}
          </dd>
          <dt>拥堵态势</dt>
          <dd><span className="block w-32"><CongestionGauge level={port.congestionLevel} /></span></dd>
          <dt>最后更新</dt>
          <dd>{formatDate(port.updatedAt)}</dd>
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
          <dt>来源更新时间</dt>
          <dd>{formatDate(port.sourceUpdatedAt)}</dd>
          {port.provenance?.sourceUrl && (
            <>
              <dt>来源链接</dt>
              <dd><a className="text-teal-600 underline decoration-teal-500/40 underline-offset-3 dark:text-teal-300" href={port.provenance.sourceUrl} target="_blank" rel="noreferrer">Portcast 公共页面</a></dd>
            </>
          )}
          <dt>数据源</dt>
          <dd>
            <div className="flex flex-wrap gap-1.5">
              <ProvenanceBadge provenance={port.provenance} />
              <StatusBadge stale={port.stale} sourceStatus={port.sourceStatus} />
            </div>
          </dd>
        </dl>
      </Reveal>
    </ShippingShell>
  )
}

/* ================= 航次 ================= */
export function VoyagesPage() {
  const { data, isLoading, isError } = useShipping()
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  return (
    <ShippingShell>
      <PageHero eyebrow="航次计划" title="航次" description="对比跟踪基线与本地可用的最新计划时间，识别延误信号。">
        <span className="chip">
          共
          {data.voyages.length}
          {" "}
          个航次
        </span>
      </PageHero>
      {data.voyages.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-compass" text="暂无航次计划" /></div>
        : (
            <div className="grid gap-4 md:grid-cols-2">
              {data.voyages.map((v, index) => (
                <Reveal key={v.id} delay={Math.min(index, 8) * 0.05} className="h-full">
                  <Link to="/voyages/$id" params={{ id: v.id }} className="block h-full">
                    <VoyageCard voyage={v} vessels={data.vessels} ports={data.ports} />
                  </Link>
                </Reveal>
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
  return (
    <ShippingShell>
      <PageHero eyebrow="航次详情" title={voyage.voyageNumber} description={`${vessel?.name ?? "船舶"} · 计划对比`}>
        <Link to="/voyages" className="btn-ghost text-sm">
          <span className="i-ph-arrow-left" />
          返回列表
        </Link>
      </PageHero>
      <VoyageCard voyage={voyage} vessels={data.vessels} ports={data.ports} />
      <Reveal className="glass-panel mt-6 p-6">
        <h2 className="mb-4 text-xl font-bold">计划时间证据</h2>
        <dl className="detail-grid">
          <dt>基准 ETA</dt>
          <dd>
            {formatDate(voyage.baselineEta)}
            {" "}
            ·
            {" "}
            {voyage.baselineEtaSource ?? "—"}
          </dd>
          <dt>最新 ETA</dt>
          <dd>
            {formatDate(voyage.latestEta)}
            {" "}
            ·
            {" "}
            {voyage.latestEtaSource ?? "—"}
          </dd>
          <dt>基准 ETD</dt>
          <dd>
            {formatDate(voyage.baselineEtd)}
            {" "}
            ·
            {" "}
            {voyage.baselineEtdSource ?? "—"}
          </dd>
          <dt>最新 ETD</dt>
          <dd>
            {formatDate(voyage.latestEtd)}
            {" "}
            ·
            {" "}
            {voyage.latestEtdSource ?? "—"}
          </dd>
          <dt>延误</dt>
          <dd>{voyage.delayMinutes === undefined ? "未知" : `${voyage.delayMinutes} 分钟`}</dd>
          <dt>观测时间</dt>
          <dd>{formatDate(voyage.latestEtaObservedAt)}</dd>
        </dl>
      </Reveal>
    </ShippingShell>
  )
}

/* ================= 事件 ================= */
const eventStatusOptions = [
  { value: "active", label: "进行中" },
  { value: "resolved", label: "已解决" },
]

export function EventsPage() {
  const { data, isLoading, isError } = useShipping()
  const [tab, setTab] = useState("active")
  if (isLoading) return <ShippingShell><LoadingState /></ShippingShell>
  if (isError || !data) return <ShippingShell><ErrorState /></ShippingShell>
  const events = data.events.filter(e => e.status === tab)
  return (
    <ShippingShell>
      <PageHero eyebrow="事件生命周期" title="事件" description="包含证据、去重、严重程度变化和明确解决状态的运营异常。">
        <Segmented id="event-status" options={eventStatusOptions} value={tab} onChange={setTab} />
      </PageHero>
      {events.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-bell-ringing" text={tab === "active" ? "当前没有进行中的事件" : "暂无已解决的事件"} /></div>
        : (
            <div className="grid gap-4 lg:grid-cols-2">
              {events.map((e, index) => (
                <Reveal key={e.id} delay={Math.min(index, 6) * 0.06}>
                  <EventCard event={e} label={e.vesselId ? data.vessels.find(v => v.id === e.vesselId)?.name : e.portId ? data.ports.find(p => p.id === e.portId)?.nameEn : e.voyageId ? data.voyages.find(v => v.id === e.voyageId)?.voyageNumber : undefined} />
                </Reveal>
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
  return (
    <ShippingShell>
      <PageHero eyebrow="信息资讯" title="航运资讯" description="结构化展示港口通知、天气信号和船公司信息。">
        <Segmented id="feed-category" options={categoryOptions} value={filter} onChange={setFilter} />
      </PageHero>
      {items.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-newspaper" text="当前分类下暂无资讯" /></div>
        : (
            <div className="grid gap-4 lg:grid-cols-2">
              {items.map((item, index) => (
                <Reveal key={item.id} delay={Math.min(index, 6) * 0.06} className="h-full">
                  <FeedCard item={item} />
                </Reveal>
              ))}
            </div>
          )}
    </ShippingShell>
  )
}

/* ================= 国家日历 ================= */
const calendarCountryOptions = [
  { value: "all", label: "全部国家" },
  ...Object.entries(calendarCountries).map(([value, label]) => ({ value, label })),
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
    <ShippingShell>
      <PageHero eyebrow="市场日历" title="国家日历" description="缓存 TH / ID / MY / PH / VN 的国家假日与运营提醒；宗教日期不默认等同于停工。">
        <div className="flex flex-wrap gap-2">
          <Segmented id="calendar-country" options={calendarCountryOptions} value={country} onChange={setCountry} />
          <Segmented id="calendar-year" options={calendarYearOptions} value={selectedYear} onChange={setSelectedYear} />
          <Segmented id="calendar-month" options={calendarMonthOptions} value={month} onChange={setMonth} />
          <Segmented id="calendar-type" options={calendarTypeOptions} value={type} onChange={setType} />
          <Segmented id="calendar-impact" options={calendarImpactOptions} value={impact} onChange={setImpact} />
          <Segmented id="calendar-verification" options={calendarVerificationOptions} value={verification} onChange={setVerification} />
          <button type="button" className={`btn-ghost ${publicOnly ? "border-teal-500/50 text-teal-600 dark:text-teal-300" : ""}`} onClick={() => setPublicOnly(value => !value)}>仅公共假日</button>
          <button type="button" className="btn-gradient" disabled={syncState === "syncing"} onClick={sync}>{syncState === "syncing" ? "同步中…" : "同步年度缓存"}</button>
        </div>
      </PageHero>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-xs op-65">
        <span>{data.provider.calendar === "mock" ? "当前为 Mock 日历；配置 Calendarific Key 后可同步年度第三方缓存。" : `Provider：${data.provider.calendar}`}</span>
        <a className="text-teal-600 underline decoration-teal-500/40 underline-offset-3 dark:text-teal-300" href="https://calendarific.com/" target="_blank" rel="noreferrer">Powered by Calendarific</a>
      </div>
      {syncState === "error" && <p className="mb-4 text-sm text-rose-600 dark:text-rose-300">同步失败，继续显示本地缓存。</p>}
      {events.length === 0
        ? <div className="glass-panel"><EmptyState icon="i-ph-calendar-blank" text="当前筛选下暂无已缓存事件" /></div>
        : <div className="grid gap-4 lg:grid-cols-2">{events.map(event => <CalendarCard key={event.id} event={event} today={today} />)}</div>}
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
  return (
    <ShippingShell>
      <PageHero eyebrow="本地配置" title="设置" description="配置刷新间隔和确定性的事件阈值。船舶与港口的关注状态单独保存。" />
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
            <ProviderChip label="港口" value={data.provider.port} />
            <ProviderChip label="班期" value={data.provider.schedule} />
          </div>
        </div>
        <p className="mt-4 text-xs op-60">数据源：AISStream（船位，可选 key）、Open-Meteo Marine（天气）、Portcast 公共港口页面（低频公开字段）与 Mock Schedule。</p>
      </div>
    </ShippingShell>
  )
}

/* ================= 共享子组件 ================= */
const congestionLevels = { low: 25, medium: 50, high: 75, critical: 100 } as const

function CongestionGauge({ level }: { level: "low" | "medium" | "high" | "critical" }) {
  return (
    <div className="gauge-track mt-4">
      <motion.div
        className={`gauge-fill gauge-${level}`}
        initial={{ width: 0 }}
        whileInView={{ width: `${congestionLevels[level]}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
    </div>
  )
}

function MiniField({ label, value }: { label: string, value: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs op-60">{label}</span>
      <span className="block truncate text-sm font-semibold">{value}</span>
    </div>
  )
}

const calendarTypeLabels: Record<string, string> = {
  public_holiday: "公共假日",
  observance: "观察日",
  religious: "宗教日期",
  commercial: "商业日期",
  government_special: "政府临时假日",
  company_custom: "公司自定义",
}

const calendarImpactLabels: Record<string, string> = { low: "低影响", medium: "中影响", high: "高影响", critical: "关键" }

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
        {" "}
        ·
        {" "}
        {event.countryCode}
      </span>
    </div>
  )
}

function CalendarCard({ event, today }: { event: CalendarEvent, today: string }) {
  const days = daysUntilCalendarEvent(event.date, today)
  return (
    <Reveal className="glass-panel tile p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider op-60">
            {event.countryCode}
            {" "}
            ·
            {" "}
            {calendarCountries[event.countryCode]}
          </p>
          <h3 className="mt-1 text-lg font-bold">{event.name}</h3>
        </div>
        <StatusDot tone={event.sourceStatus === "healthy" && !event.stale ? "fresh" : "watch"} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <MiniField label="日期" value={formatCalendarDate(event.date)} />
        <MiniField label="倒计时" value={days < 0 ? "已过期" : days === 0 ? "今天" : `${days} 天后`} />
        <MiniField label="类型" value={calendarTypeLabels[event.type] ?? event.type} />
        <MiniField label="影响" value={calendarImpactLabels[event.businessImpact] ?? event.businessImpact} />
        <MiniField label="公共假日" value={event.isPublicHoliday ? "是" : "否"} />
        <MiniField label="已验证" value={event.verified ? "是" : "待核验"} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs op-70">
        <ProvenanceBadge provenance={event.provenance} />
        <StatusBadge stale={event.stale} sourceStatus={event.sourceStatus} />
        {event.conflictFlag && <span className="status-badge status-stale">存在来源冲突</span>}
        {event.sourceUrl && <a className="text-teal-600 underline decoration-teal-500/40 underline-offset-3 dark:text-teal-300" href={event.sourceUrl} target="_blank" rel="noreferrer">来源</a>}
      </div>
    </Reveal>
  )
}

function WatchButton({ kind, id, watched, onSaved }: { kind: "vessel" | "port", id: string, watched: boolean, onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      disabled={busy}
      className={`watch-chip absolute right-4 top-4 z-2 ${watched ? "on" : ""}`}
      onClick={async (event) => {
        event.preventDefault()
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
