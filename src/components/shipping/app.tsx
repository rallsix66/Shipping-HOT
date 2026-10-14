import { Link, useMatchRoute } from "@tanstack/react-router"
import { type ReactNode, useEffect } from "react"
import { MotionConfig } from "framer-motion"
import { providerSummary, severityTone, statusBadgePresentation, statusLabels } from "./format"
import { MotionToggle, StatusDot } from "./ui"
import { useShipping } from "./data"
import { consoleNavigation } from "./console-navigation"
import { useDark } from "~/hooks/useDark"
import { useReduceMotion } from "~/hooks/useReduceMotion"
import "./risk-console.css"

export { ProvenanceBadge } from "./ui"

function ConsoleLink({ to, label }: { to: "/" | "/events" | "/feed" | "/settings" | "/policies" | "/calendar" | "/ports", label: string }) {
  const matchRoute = useMatchRoute()
  const active = !!matchRoute({ to, fuzzy: to !== "/" })
  return <Link to={to} aria-current={active ? "page" : undefined} activeOptions={{ exact: to === "/" }}>{label}</Link>
}

export function ShippingShell({ children, title, showLegend = true }: { children: ReactNode, title?: string, showLegend?: boolean }) {
  const { isDark, toggleDark } = useDark()
  const { reduced, toggle: toggleReduceMotion } = useReduceMotion()
  const { data, isError } = useShipping()
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])
  const summary = isError ? "读取失败" : data ? providerSummary(data.provider).label : "读取中…"
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div className="shipping-shell risk-console">
        <div className="rc-banner">
          <b>功能逐步开放</b>
          {" "}
          · 国家风险汇总与延误估算尚未开放。未评估不代表正常；模拟、历史和真实数据以条目标注为准。
        </div>
        <a className="rc-skip" href="#shipping-content">跳到页面内容</a>
        <aside className="rc-side">
          <Link className="rc-brand" to="/">
            Shipping HOT
            <small>中国 → 东南亚 航运风险看板</small>
          </Link>
          <nav className="rc-nav" aria-label="主导航">
            {consoleNavigation.map(item => item.available
              ? <ConsoleLink key={item.label} to={item.to} label={item.label} />
              : (
                  <button key={item.label} type="button" disabled title={item.stage} data-testid="unopened-module">
                    <span>{item.label}</span>
                    <small>
                      未开放 ·
                      {item.stage}
                    </small>
                  </button>
                ))}
            <details className="rc-source-help">
              <summary>来源说明</summary>
              <p>🏛 官方：政府与监管机构原文。</p>
              <p>📰 报道：媒体或当事方原文。</p>
              <p>⚙ 系统：按规则生成，需查看规则和输入。</p>
              <p>🤖 AI：需标明模型与依据。风险分析未开放。</p>
              <p>来源健康与采集管理未开放。读取接口存在不代表采集已启用。</p>
            </details>
          </nav>
          <p className="rc-side-note">系统和 AI 的判断仅供参考。参考日历不代表港口停运。</p>
        </aside>
        <div className="rc-main">
          <header className="rc-topbar">
            <span>{title ?? "首页"}</span>
            <span className="rc-data-status" role="status">
              数据源：
              {summary}
            </span>
            <button type="button" aria-label="切换明暗主题" onClick={toggleDark}>{isDark ? "☀ 亮色" : "☾ 暗色"}</button>
            <MotionToggle reduced={reduced} onToggle={toggleReduceMotion} />
          </header>
          {showLegend && (
            <div className="rc-legend" aria-label="来源标记图例">
              <span className="rc-pv official">🏛 官方</span>
              <span className="rc-pv report">📰 报道</span>
              <span className="rc-pv system">⚙ 系统</span>
              <span className="rc-pv ai">🤖 AI</span>
              <p>来源标记说明判断依据；数据是否为模拟、历史或真实记录以各条标注为准。没有数据不等于没有风险。</p>
            </div>
          )}
          <main id="shipping-content" tabIndex={-1}>{children}</main>
          <footer className="rc-footer">Shipping HOT · 仅供参考 · 未开放模块随方案验收逐步开放</footer>
        </div>
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
