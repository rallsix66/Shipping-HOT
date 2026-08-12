import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import type { HotItem, Port, ShippingEvent, ShippingSnapshot, Vessel, Voyage } from "@shared/shipping"
import { myFetch } from "~/utils"

export type ShippingResponse = ShippingSnapshot & { hot: HotItem[], provider: string, realProviders: string }

export function useShipping() {
  return useQuery({
    queryKey: ["shipping"],
    queryFn: () => myFetch<ShippingResponse>("/shipping"),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}

export function ShippingShell({ children }: { children: React.ReactNode }) {
  const links = [["/", "HOT"], ["/vessels", "My Vessels"], ["/ports", "My Ports"], ["/voyages", "Voyages"], ["/events", "Events"], ["/feed", "Feed"], ["/settings", "Settings"]] as const
  return (
    <div className="shipping-shell mx-auto max-w-1400px px-4 pb-8 md:px-8">
      <nav className="sticky top-0 z-20 mb-8 flex flex-wrap items-center gap-2 border-b border-primary/15 bg-base/90 py-4 backdrop-blur-md">
        <Link to="/" className="mr-auto flex items-center gap-3 text-xl font-bold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-white shadow-lg shadow-primary/30">⚓</span>
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
  const label = sourceStatus === "healthy" && !stale ? "Fresh" : sourceStatus === "failed" ? "Provider failed" : stale ? "Stale" : sourceStatus
  return <span className={`status-badge status-${sourceStatus === "healthy" && !stale ? "fresh" : sourceStatus === "failed" ? "failed" : "stale"}`}>{label}</span>
}

export function PageTitle({ eyebrow, title, description }: { eyebrow: string, title: string, description: string }) {
  return <header className="mb-6"><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">{eyebrow}</p><h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-base op-70">{description}</p></header>
}

export function LoadingState() { return <div className="rounded-2xl border border-primary/15 p-8 text-center op-70">Loading local Mock data…</div> }
export function ErrorState() { return <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-8 text-center text-red-700 dark:text-red-200">Shipping data unavailable. The Mock Provider can be restarted locally.</div> }

export function StatCard({ label, value, tone = "default" }: { label: string, value: string | number, tone?: "default" | "warning" | "critical" }) {
  return <div className={`stat-card tone-${tone}`}><span>{label}</span><strong>{value}</strong></div>
}

export function Severity({ value }: { value: string }) { return <span className={`severity severity-${value}`}>{value}</span> }

export function VesselCard({ vessel, onClick }: { vessel: Vessel, onClick?: () => void }) {
  return <article className="data-card" onClick={onClick}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider op-60">Vessel</p><h3 className="text-xl font-bold">{vessel.name}</h3><p className="text-sm op-70">{vessel.carrier} · {vessel.shipType}</p></div><StatusBadge stale={vessel.stale} sourceStatus={vessel.sourceStatus} /></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><span className="op-60">Status</span><p className="font-semibold">{formatStatus(vessel.navigationStatus)}</p></div><div><span className="op-60">Speed</span><p className="font-semibold">{vessel.speed ?? "—"} kn</p></div><div><span className="op-60">Destination</span><p className="font-semibold">{vessel.destination ?? "—"}</p></div><div><span className="op-60">Watch</span><p className="font-semibold">{vessel.isWatched ? "Watching" : "Not watched"}</p></div></div></article>
}

export function PortCard({ port, onClick }: { port: Port, onClick?: () => void }) {
  return <article className="data-card" onClick={onClick}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider op-60">Port</p><h3 className="text-xl font-bold">{port.nameEn}</h3><p className="text-sm op-70">{port.name} · {port.unlocode}</p></div><StatusBadge stale={port.stale} sourceStatus={port.sourceStatus} /></div><div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><span className="op-60">Congestion</span><p className="font-semibold capitalize">{port.congestionLevel}</p></div><div><span className="op-60">Waiting vessels</span><p className="font-semibold">{port.waitingVessels}</p></div><div><span className="op-60">Wait hours</span><p className="font-semibold">{port.waitingHours}h</p></div></div></article>
}

export function VoyageCard({ voyage, vessels, ports, onClick }: { voyage: Voyage, vessels: Vessel[], ports: Port[], onClick?: () => void }) {
  const vessel = vessels.find(v => v.id === voyage.vesselId)
  const destination = ports.find(p => p.id === voyage.destinationPortId)
  return <article className="data-card" onClick={onClick}><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider op-60">Voyage</p><h3 className="text-xl font-bold">{voyage.voyageNumber}</h3><p className="text-sm op-70">{vessel?.name} → {destination?.nameEn}</p></div><StatusBadge stale={voyage.stale} sourceStatus={voyage.sourceStatus} /></div><div className="mt-5 grid grid-cols-3 gap-3 text-sm"><div><span className="op-60">Baseline ETA</span><p className="font-semibold">{formatDate(voyage.baselineEta)}</p></div><div><span className="op-60">Latest ETA</span><p className="font-semibold">{formatDate(voyage.latestEta)}</p></div><div><span className="op-60">Delay</span><p className={`font-semibold ${(voyage.delayMinutes ?? 0) > 0 ? "text-orange-600" : "text-green-600"}`}>{voyage.delayMinutes === undefined ? "Unknown" : `${voyage.delayMinutes} min`}</p></div></div></article>
}

export function EventCard({ event, label }: { event: ShippingEvent, label?: string }) {
  return <article className="data-card"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><Severity value={event.severity} /><span className="text-xs uppercase tracking-wider op-60">{event.status}</span></div><h3 className="text-lg font-bold">{event.title}</h3><p className="mt-1 text-sm op-70">{event.summary}</p></div>{label && <span className="text-sm op-60">{label}</span>}</div><div className="mt-4 flex flex-wrap gap-4 text-xs op-60"><span>Detected {formatDate(event.lastDetectedAt)}</span><span>Source {event.sourceStatus}</span>{event.resolvedAt && <span>Resolved {formatDate(event.resolvedAt)}</span>}</div></article>
}

export function formatDate(value?: string) { return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—" }
export function formatStatus(value: string) { return value.replace(/_/g, " ") }
