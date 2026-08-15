import { Link, useMatchRoute } from "@tanstack/react-router"
import { MotionConfig, motion } from "framer-motion"
import { type ReactNode, useEffect, useRef } from "react"
import type { ShippingEvent, ShippingSnapshot, Voyage } from "@shared/shipping"
import { AuroraBackground } from "./aurora"
import { type DotTone, formatDate, formatStatus, severityTone, statusLabels } from "./format"
import { AnimatedNumber, GradientText, ProvenanceBadge, StatusDot } from "./ui"
import { useDark } from "~/hooks/useDark"

export { ProvenanceBadge } from "./ui"

const navLinks = [
  { to: "/", label: "HOT", icon: "i-ph-fire" },
  { to: "/vessels", label: "船舶", icon: "i-ph-anchor" },
  { to: "/ports", label: "港口", icon: "i-ph-lighthouse" },
  { to: "/voyages", label: "航次", icon: "i-ph-compass" },
  { to: "/events", label: "事件", icon: "i-ph-bell-ringing" },
  { to: "/feed", label: "资讯", icon: "i-ph-newspaper" },
  { to: "/calendar", label: "国家日历", icon: "i-ph-calendar-blank" },
  { to: "/settings", label: "设置", icon: "i-ph-gear" },
] as const

function NavItem({ to, label, icon }: { to: (typeof navLinks)[number]["to"], label: string, icon: string }) {
  const matchRoute = useMatchRoute()
  const ref = useRef<HTMLAnchorElement>(null)
  const isActive = !!matchRoute({ to, fuzzy: to !== "/" })
  useEffect(() => {
    if (isActive) {
      ref.current?.scrollIntoView({ inline: "nearest", block: "nearest" })
    }
  }, [isActive])
  return (
    <Link
      ref={ref}
      to={to}
      className="nav-link-sh"
      activeOptions={{ exact: to === "/" }}
      activeProps={{ className: "nav-link-sh active" }}
    >
      {isActive && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", bounce: 0.18, duration: 0.55 }} />}
      <span className={`${icon} relative z-1 text-base`} />
      <span className="relative z-1">{label}</span>
    </Link>
  )
}

export function ShippingShell({ children }: { children: ReactNode }) {
  const { isDark, toggleDark } = useDark()
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])
  return (
    <MotionConfig reducedMotion="user">
      <div className="shipping-shell min-h-dvh">
        <AuroraBackground />
        <header className="sticky top-4 z-30 px-4">
          <nav className="glass-nav mx-auto flex max-w-1200px items-center gap-1 px-3 py-2">
            <Link to="/" className="mr-2 flex shrink-0 items-center gap-2.5">
              <span className="brand-mark h-9 w-9 overflow-hidden rounded-xl">
                <img src="/shipping-hot-icon.svg" alt="Shipping HOT" className="h-full w-full rounded-xl" />
              </span>
              <span className="font-brand text-lg font-bold tracking-tight">
                <span className="hidden sm:inline">Shipping </span>
                <GradientText>HOT</GradientText>
              </span>
            </Link>
            <div className="flex flex-1 items-center gap-0.5 overflow-x-auto">
              {navLinks.map(link => <NavItem key={link.to} {...link} />)}
            </div>
            <button
              type="button"
              aria-label="切换明暗主题"
              title="切换明暗主题"
              onClick={toggleDark}
              className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            >
              <motion.span
                key={isDark ? "moon" : "sun"}
                initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className={`${isDark ? "i-ph-moon-stars" : "i-ph-sun"} block`}
              />
            </button>
          </nav>
        </header>
        <main className="mx-auto max-w-1200px px-4 pb-16 pt-8 md:px-6">
          {children}
        </main>
        <footer className="mx-auto max-w-1200px px-4 pb-10 text-center text-xs op-55">
          Shipping HOT · 本地指挥台 V2 · AISStream / Open-Meteo Marine / Calendar / Mock
        </footer>
      </div>
    </MotionConfig>
  )
}

export function StatusBadge({ stale, sourceStatus, unknown = false }: { stale: boolean, sourceStatus: string, unknown?: boolean }) {
  const statusClass = unknown ? "stale" : sourceStatus === "healthy" && !stale ? "fresh" : sourceStatus === "failed" ? "failed" : "stale"
  const dotTone: DotTone = unknown ? "dim" : statusClass === "fresh" ? "fresh" : statusClass === "failed" ? "failed" : "watch"
  const label = unknown ? "状态未知" : sourceStatus === "healthy" && !stale ? "最新" : sourceStatus === "failed" ? "数据源失败" : stale ? "已过期" : sourceStatus === "degraded" ? "数据源降级" : sourceStatus === "disabled" ? "已禁用" : sourceStatus === "never_succeeded" ? "尚未成功" : sourceStatus
  return (
    <span className={`status-badge status-${statusClass}`}>
      <StatusDot tone={dotTone} pulse={statusClass === "fresh"} />
      {label}
    </span>
  )
}

export function Severity({ value }: { value: string }) {
  return (
    <span className={`severity severity-${value}`}>
      <StatusDot tone={severityTone(value)} />
      {statusLabels[value] ?? value}
    </span>
  )
}

export function PageHero({ eyebrow, title, description, children }: { eyebrow: string, title: ReactNode, description: string, children?: ReactNode }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mb-8"
    >
      <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-teal-600 dark:text-teal-300">
        <span className="h-px w-8 bg-gradient-to-r from-teal-400 to-transparent" />
        {eyebrow}
      </p>
      <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm op-75 md:text-base">{description}</p>
      {children && <div className="mt-5">{children}</div>}
    </motion.header>
  )
}

export function LoadingState() {
  return (
    <div className="glass-panel flex flex-col items-center gap-4 p-12 text-center">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500/30 border-t-teal-500" />
      <p className="op-75">正在加载 Shipping HOT 数据…</p>
    </div>
  )
}

export function ErrorState() {
  return (
    <div className="glass-panel border-rose-400/30 p-12 text-center text-rose-600 dark:text-rose-300">
      <p className="text-lg font-bold">航运数据暂不可用</p>
      <p className="mt-2 text-sm op-80">请检查本地 Provider 与运行环境。</p>
    </div>
  )
}

const statToneClass = {
  default: "",
  warning: "text-orange-500 dark:text-amber-300",
  critical: "text-rose-500 dark:text-rose-300",
  accent: "gradient-text",
}

export function StatCard({ label, value, tone = "default", hint }: { label: string, value: string | number, tone?: keyof typeof statToneClass, hint?: string }) {
  return (
    <div className="glass-panel tile flex flex-col gap-1.5 p-4">
      <span className="text-xs font-semibold uppercase tracking-wider op-65">{label}</span>
      <strong className={`tabular-nums ${typeof value === "number" ? "text-2xl md:text-3xl" : "text-base md:text-lg"} ${statToneClass[tone]}`}>
        {typeof value === "number" ? <AnimatedNumber value={value} /> : value}
      </strong>
      {hint && <small className="op-60">{hint}</small>}
    </div>
  )
}

function Field({ label, value }: { label: string, value: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs op-60">{label}</span>
      <span className="block truncate text-sm font-semibold">{value}</span>
    </div>
  )
}

export function VoyageCard({ voyage, vessels, ports, onClick }: { voyage: Voyage, vessels: ShippingSnapshot["vessels"], ports: ShippingSnapshot["ports"], onClick?: () => void }) {
  const vessel = vessels.find(v => v.id === voyage.vesselId)
  const destination = ports.find(p => p.id === voyage.destinationPortId)
  const delay = voyage.delayMinutes
  const delayClass = delay === undefined ? "op-65" : delay > 0 ? "text-orange-500 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"
  const delayLabel = delay === undefined ? "未知" : delay > 0 ? `+${delay} 分钟` : "准点"
  return (
    <article className="glass-panel tile h-full cursor-pointer p-5" onClick={onClick}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-lg text-sky-600 dark:text-sky-300">
            <span className="i-ph-compass" />
          </span>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider op-65">航次</p>
            <h3 className="truncate text-lg font-bold leading-tight">{voyage.voyageNumber}</h3>
            <p className="truncate text-xs op-70">
              {vessel?.name ?? "—"}
              {" "}
              →
              {" "}
              {destination?.name ?? "—"}
            </p>
          </div>
        </div>
        <span className={`chip shrink-0 font-bold ${delayClass}`}>{delayLabel}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Field label="基准 ETA" value={formatDate(voyage.baselineEta)} />
        <Field label="最新 ETA" value={formatDate(voyage.latestEta)} />
        <Field
          label="来源 / 新鲜度"
          value={(
            <div className="flex flex-wrap gap-1.5">
              <ProvenanceBadge provenance={voyage.provenance} />
              <StatusBadge stale={voyage.stale} sourceStatus={voyage.sourceStatus} />
            </div>
          )}
        />
      </div>
    </article>
  )
}

export function EventCard({ event, label }: { event: ShippingEvent, label?: string }) {
  return (
    <article className={`glass-panel hot-glow ${event.severity} tile p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Severity value={event.severity} />
            <span className="text-xs font-semibold uppercase tracking-wider op-65">{formatStatus(event.status)}</span>
          </div>
          <h3 className="text-lg font-bold">{event.title}</h3>
          <p className="mt-1 text-sm op-80">{event.summary}</p>
        </div>
        {label && <span className="chip shrink-0">{label}</span>}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs op-70">
        <span className="flex items-center gap-1">
          <span className="i-ph-clock" />
          发现于
          {" "}
          {formatDate(event.lastDetectedAt)}
        </span>
        <ProvenanceBadge provenance={event.provenance} />
        <StatusBadge stale={event.stale ?? event.sourceStatus !== "healthy"} sourceStatus={event.sourceStatus} />
        {event.resolvedAt && (
          <span className="flex items-center gap-1">
            <span className="i-ph-check-circle" />
            解决于
            {" "}
            {formatDate(event.resolvedAt)}
          </span>
        )}
      </div>
    </article>
  )
}

export function FeedCard({ item }: { item: ShippingSnapshot["feedItems"][number] }) {
  return (
    <article className="glass-panel tile flex h-full flex-col p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Severity value={item.severity} />
          <span className="chip">{formatStatus(item.category)}</span>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <ProvenanceBadge provenance={item.provenance} />
          <StatusBadge stale={item.stale} sourceStatus={item.sourceStatus} />
        </div>
      </div>
      <h2 className="mt-3 text-xl font-bold">{item.title}</h2>
      <p className="mt-2 flex-1 op-80">{item.summary}</p>
      {item.weather && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs op-70">
          <span className="chip">
            {item.weather.riskSource === "official" ? "官方预警" : "模型预报"}
          </span>
          {item.weather.forecastWindowHours && (
            <span className="chip">
              未来
              {" "}
              {item.weather.forecastWindowHours}
              {" "}
              小时
            </span>
          )}
          {item.weather.waveHeightM !== undefined && (
            <span>
              浪高
              {" "}
              {item.weather.waveHeightM.toFixed(1)}
              {" "}
              m
            </span>
          )}
          {item.weather.swellWaveHeightM !== undefined && (
            <span>
              涌浪
              {" "}
              {item.weather.swellWaveHeightM.toFixed(1)}
              {" "}
              m
            </span>
          )}
          {item.weather.swellPeriodSeconds !== undefined && (
            <span>
              涌浪周期
              {" "}
              {item.weather.swellPeriodSeconds.toFixed(1)}
              {" "}
              s
            </span>
          )}
          {item.weather.forecastStartAt && item.weather.forecastEndAt && (
            <span>
              风险窗
              {" "}
              {formatDate(item.weather.forecastStartAt)}
              {" – "}
              {formatDate(item.weather.forecastEndAt)}
            </span>
          )}
          {item.weather.alertExpiresAt && (
            <span>
              截至
              {" "}
              {formatDate(item.weather.alertExpiresAt)}
            </span>
          )}
        </div>
      )}
      {(item.hotReason || item.tags?.length) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs op-70">
          {item.hotReason && (
            <span className="chip text-amber-600 dark:text-amber-300">
              HOT 原因：
              {item.hotReason}
            </span>
          )}
          {item.tags?.map(tag => <span key={tag} className="chip">{tag}</span>)}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs op-70">
          <span className="flex items-center gap-1">
            <span className="i-ph-clock" />
            {formatDate(item.publishedAt)}
          </span>
          <ProvenanceBadge provenance={item.provenance} />
        </div>
        <a className="flex items-center gap-1 text-sm font-semibold text-teal-600 transition-colors hover:text-teal-500 dark:text-teal-300" href={item.sourceUrl} target="_blank" rel="noreferrer">
          打开来源
          <span className="i-ph-arrow-up-right" />
        </a>
      </div>
    </article>
  )
}
