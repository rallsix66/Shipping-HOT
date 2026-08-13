import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import type { HotItem, Port, ShippingEvent, ShippingSnapshot, Vessel, Voyage } from "@shared/shipping"
import { myFetch } from "~/utils"

export type ShippingResponse = ShippingSnapshot & { hot: HotItem[], provider: string, realProviders: string }

const statusLabels: Record<string, string> = {
  healthy: "正常",
  degraded: "降级",
  failed: "失败",
  disabled: "已禁用",
  never_succeeded: "尚未成功",
  under_way: "航行中",
  anchored: "锚泊",
  moored: "靠泊",
  aground: "搁浅",
  unknown: "未知",
  normal: "正常",
  disrupted: "受影响",
  closed: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
  active: "进行中",
  resolved: "已解决",
  info: "信息",
  watch: "关注",
  warning: "警告",
  shipping_news: "航运新闻",
  carrier_notice: "船公司通知",
  weather: "天气",
  port_notice: "港口通知",
}

export function useShipping() {
  return useQuery({
    queryKey: ["shipping"],
    queryFn: () => myFetch<ShippingResponse>("/shipping"),
    staleTime: 10_000,
    refetchInterval: data => data.state.data ? data.state.data.settings.refreshInterval * 60 * 1000 : false,
  })
}

export function ShippingShell({ children }: { children: React.ReactNode }) {
  const links = [["/", "HOT"], ["/vessels", "我的船舶"], ["/ports", "我的港口"], ["/voyages", "航次"], ["/events", "事件"], ["/feed", "资讯"], ["/settings", "设置"]] as const
  return (
    <div className="shipping-shell mx-auto max-w-1400px px-4 pb-8 md:px-8">
      <nav className="sticky top-0 z-20 mb-8 flex flex-wrap items-center gap-2 border-b border-primary/15 bg-base/90 py-4 backdrop-blur-md">
        <Link to="/" className="mr-auto flex items-center gap-3 text-xl font-bold tracking-tight">
          <img src="/shipping-hot-icon.svg" alt="Shipping HOT" className="h-10 w-10 rounded-xl shadow-lg shadow-primary/30" />
          <span>Shipping <span className="text-primary">HOT</span></span>
        </Link>
        <div className="flex flex-wrap gap-1 text-sm">
          {links.map(([to, label]) => <Link key={to} to={to} activeProps={{ className: "nav-link active" }} className="nav-link">{label}</Link>)}
        </div>
      </nav>
      {children}
    </div>
  )
}

export function StatusBadge({ stale, sourceStatus }: { stale: boolean, sourceStatus: string }) {
  const label = sourceStatus === "healthy" && !stale ? "最新" : sourceStatus === "failed" ? "数据源失败" : stale ? "已过期" : sourceStatus === "degraded" ? "数据源降级" : sourceStatus === "disabled" ? "已禁用" : sourceStatus === "never_succeeded" ? "尚未成功" : sourceStatus
  return <span className={`status-badge status-${sourceStatus === "healthy" && !stale ? "fresh" : sourceStatus === "failed" ? "failed" : "stale"}`}>{label}</span>
}

export function PageTitle({ eyebrow, title, description }: { eyebrow: string, title: string, description: string }) {
  return <header className="mb-6"><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">{eyebrow}</p><h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-base op-70">{description}</p></header>
}

export function LoadingState() { return <div className="rounded-2xl border border-primary/15 p-8 text-center op-70">正在加载本地 Mock 数据…</div> }
export function ErrorState() { return <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-8 text-center text-red-700 dark:text-red-200">航运数据暂不可用，请在本地重启 Mock Provider。</div> }

export function StatCard({ label, value, tone = "default" }: { label: string, value: string | number, tone?: "default" | "warning" | "critical" }) {
  return <div className={`stat-card tone-${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

export function Severity({ value }: { value: string }) { return <span className={`severity severity-${value}`}>{statusLabels[value] ?? value}</span> }

export function VesselCard({ vessel, onClick }: { vessel: Vessel, onClick?: () => void }) {
  return <article className="data-card" onClick={onClick}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider op-60">船舶</p><h3 className="text-xl font-bold">{vessel.name}</h3><p className="text-sm op-70">{vessel.carrier} · {vessel.shipType}</p></div><StatusBadge stale={vessel.stale} sourceStatus={vessel.sourceStatus} /></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><span className="op-60">状态</span><p className="font-semibold">{formatStatus(vessel.navigationStatus)}</p></div><div><span className="op-60">航速</span><p className="font-semibold">{vessel.speed ?? "—"} 节</p></div><div><span className="op-60">目的地</span><p className="font-semibold">{vessel.destination ?? "—"}</p></div><div><span className="op-60">关注</span><p className="font-semibold">{vessel.isWatched ? "已关注" : "未关注"}</p></div></div></article>
}

export function PortCard({ port, onClick }: { port: Port, onClick?: () => void }) {
  return <article className="data-card" onClick={onClick}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider op-60">港口</p><h3 className="text-xl font-bold">{port.name}</h3><p className="text-sm op-70">{port.nameEn} · {port.unlocode}</p></div><StatusBadge stale={port.stale} sourceStatus={port.sourceStatus} /></div><div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><span className="op-60">拥堵等级</span><p className="font-semibold">{formatStatus(port.congestionLevel)}</p></div><div><span className="op-60">等待船舶</span><p className="font-semibold">{port.waitingVessels} 艘</p></div><div><span className="op-60">等待时长</span><p className="font-semibold">{port.waitingHours} 小时</p></div></div></article>
}

export function VoyageCard({ voyage, vessels, ports, onClick }: { voyage: Voyage, vessels: Vessel[], ports: Port[], onClick?: () => void }) {
  const vessel = vessels.find(v => v.id === voyage.vesselId)
  const destination = ports.find(p => p.id === voyage.destinationPortId)
  return <article className="data-card" onClick={onClick}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider op-60">航次</p><h3 className="text-xl font-bold">{voyage.voyageNumber}</h3><p className="text-sm op-70">{vessel?.name} → {destination?.name}</p></div><StatusBadge stale={voyage.stale} sourceStatus={voyage.sourceStatus} /></div><div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><span className="op-60">基准 ETA</span><p className="font-semibold">{formatDate(voyage.baselineEta)}</p></div><div><span className="op-60">最新 ETA</span><p className="font-semibold">{formatDate(voyage.latestEta)}</p></div><div><span className="op-60">延误</span><p className={`font-semibold ${(voyage.delayMinutes ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>{voyage.delayMinutes === undefined ? "未知" : `${voyage.delayMinutes} 分钟`}</p></div></div></article>
}

export function EventCard({ event, label }: { event: ShippingEvent, label?: string }) {
  return <article className="data-card"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><Severity value={event.severity} /><span className="text-xs uppercase tracking-wider op-60">{formatStatus(event.status)}</span></div><h3 className="text-lg font-bold">{event.title}</h3><p className="mt-1 text-sm op-70">{event.summary}</p></div>{label && <span className="text-sm op-60">{label}</span>}</div><div className="mt-4 flex flex-wrap gap-4 text-xs op-60"><span>发现于 {formatDate(event.lastDetectedAt)}</span><span>数据源：{formatSourceStatus(event.sourceStatus)}</span>{event.resolvedAt && <span>解决于 {formatDate(event.resolvedAt)}</span>}</div></article>
}

export function formatDate(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—" }
export function formatStatus(value: string) { return statusLabels[value] ?? value.replace(/_/g, " ") }
export function formatSourceStatus(value: string) { return statusLabels[value] ?? value }
