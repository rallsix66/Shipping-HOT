import { Link, useMatchRoute } from "@tanstack/react-router"
import { MotionConfig, motion } from "framer-motion"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { AuroraBackground } from "./aurora"
import { severityTone, statusBadgePresentation, statusLabels } from "./format"
import { GradientText, StatusDot } from "./ui"
import { useShipping } from "./data"
import { useDark } from "~/hooks/useDark"

export { ProvenanceBadge } from "./ui"

const navLinks = [
  { to: "/", label: "首页", icon: "i-ph-fire" },
  { to: "/vessels", label: "船舶", icon: "i-ph-anchor" },
  { to: "/ports", label: "港口", icon: "i-ph-lighthouse" },
  { to: "/voyages", label: "航次", icon: "i-ph-compass" },
  { to: "/events", label: "事件", icon: "i-ph-bell-ringing" },
  { to: "/feed", label: "资讯", icon: "i-ph-newspaper" },
  { to: "/calendar", label: "国家日历", icon: "i-ph-calendar-blank" },
  { to: "/settings", label: "设置", icon: "i-ph-gear" },
] as const

const bottomTabLinks = [
  { to: "/", label: "首页", icon: "i-ph-fire" },
  { to: "/vessels", label: "船舶", icon: "i-ph-anchor" },
  { to: "/feed", label: "资讯", icon: "i-ph-newspaper" },
  { to: "/calendar", label: "日历", icon: "i-ph-calendar-blank" },
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
      className={`side-nav-link${isActive ? " active" : ""}`}
      activeOptions={{ exact: to === "/" }}
    >
      {isActive && <motion.span layoutId="side-pill" className="side-pill" transition={{ type: "spring", bounce: 0.18, duration: 0.55 }} />}
      <span className={`${icon} relative z-1 text-base`} />
      <span className="side-label relative z-1">{label}</span>
    </Link>
  )
}

function BottomTabItem({ to, label, icon }: { to: (typeof bottomTabLinks)[number]["to"], label: string, icon: string }) {
  const matchRoute = useMatchRoute()
  const isActive = !!matchRoute({ to, fuzzy: to !== "/" })
  return (
    <Link to={to} className={isActive ? "active" : ""} activeOptions={{ exact: to === "/" }}>
      <span className={`${icon} text-lg`} />
      {label}
    </Link>
  )
}

function formatClock(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

const providerRows = [
  { key: "vessel", label: "船位" },
  { key: "weather", label: "天气" },
  { key: "weatherAlerts", label: "官方预警" },
  { key: "port", label: "港口" },
  { key: "schedule", label: "班期" },
  { key: "feed", label: "资讯" },
] as const

export function ShippingShell({ children, title }: { children: ReactNode, title?: string }) {
  const { isDark, toggleDark } = useDark()
  const { data } = useShipping()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sh-side-collapsed") === "1"
    } catch {
      return false
    }
  })
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])
  useEffect(() => {
    try {
      localStorage.setItem("sh-side-collapsed", collapsed ? "1" : "0")
    } catch {
      // ignore storage failures
    }
  }, [collapsed])

  const hotCount = data?.hot.length
  const fetchedAts = data?.providerFreshness
    ? Object.values(data.providerFreshness).map(freshness => freshness.fetchedAt).filter((value): value is string => Boolean(value))
    : []
  const lastRefresh = fetchedAts.length
    ? formatClock(new Date(Math.max(...fetchedAts.map(value => new Date(value).getTime()))).toISOString())
    : "—"
  const providers = data ? [data.provider.vessel, data.provider.weather, data.provider.port, data.provider.schedule, data.provider.feed] : []
  const allMock = providers.length > 0 && providers.every(provider => provider === "mock") && (data?.provider.weatherAlerts ?? "off") === "off"
  const providerLabel = data ? (allMock ? "全 Mock" : providers.join(" / ")) : "—"

  return (
    <MotionConfig reducedMotion="user">
      <div className={`shipping-shell min-h-dvh${collapsed ? " side-collapsed" : ""}`}>
        <AuroraBackground />
        <aside className="console-sidebar">
          <div className="side-head">
            <Link to="/" className="brand-mark h-9 w-9 shrink-0 overflow-hidden rounded-xl" title="Shipping HOT">
              <img src="/shipping-hot-icon.svg" alt="Shipping HOT" className="h-full w-full rounded-xl" />
            </Link>
            <span className="side-title">
              Shipping
              {" "}
              <GradientText>HOT</GradientText>
            </span>
            <button
              type="button"
              className="icon-btn side-collapse"
              title={collapsed ? "展开侧栏" : "折叠侧栏"}
              onClick={() => setCollapsed(value => !value)}
            >
              <span className={collapsed ? "i-ph-caret-double-right" : "i-ph-caret-double-left"} />
            </button>
          </div>
          <nav className="side-nav">
            {navLinks.map(link => <NavItem key={link.to} {...link} />)}
          </nav>
          <div className="side-foot">
            <button
              type="button"
              className="icon-btn side-collapse-footer"
              title="展开侧栏"
              onClick={() => setCollapsed(value => !value)}
            >
              <span className="i-ph-caret-double-right" />
            </button>
            {providerRows.map(row => (
              <div key={row.key} className="sf-row">
                <StatusDot tone={data?.provider[row.key] && data.provider[row.key] !== "mock" && !(row.key === "weatherAlerts" && data.provider[row.key] === "off") ? "info" : "dim"} />
                <span className="lbl grow">{row.label}</span>
                <span className="val">{data?.provider[row.key] ?? "—"}</span>
              </div>
            ))}
          </div>
        </aside>
        <div className="console-main">
          <header className="console-topbar">
            <h1>{title ?? "运营态势 · 首页"}</h1>
            <span className="topbar-spacer" />
            <span className="tchip">
              <StatusDot tone={hotCount ? "failed" : "fresh"} pulse={Boolean(hotCount)} />
              活跃 HOT
              {" "}
              {hotCount ?? "—"}
            </span>
            <span className="tchip">
              <span className="i-ph-clock" />
              最后刷新
              {" "}
              {lastRefresh}
            </span>
            <span className="tchip">
              数据源
              {" "}
              {providerLabel}
            </span>
            <button
              type="button"
              aria-label="切换明暗主题"
              title="切换明暗主题"
              onClick={toggleDark}
              className="icon-btn"
            >
              <motion.span
                key={isDark ? "moon" : "sun"}
                initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className={`${isDark ? "i-ph-moon-stars" : "i-ph-sun"} block`}
              />
            </button>
          </header>
          <main>
            {children}
          </main>
          <footer className="mt-8 text-center text-xs op-55">
            Shipping HOT · 本地指挥台 V2 · AISStream / Open-Meteo Marine / Calendar / Mock
          </footer>
        </div>
        <nav className="console-bottom-tab">
          {bottomTabLinks.map(link => <BottomTabItem key={link.to} {...link} />)}
        </nav>
      </div>
    </MotionConfig>
  )
}

export function StatusBadge({ stale, sourceStatus, unknown = false }: { stale: boolean, sourceStatus: string, unknown?: boolean }) {
  const priority = statusBadgePresentation({ stale, sourceStatus, unknown })
  return (
    <span className={`status-badge status-${priority.className}`}>
      <StatusDot tone={priority.tone} pulse={priority.className === "fresh"} />
      {priority.label}
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
