import { Link } from "@tanstack/react-router"
import { demoFocusPorts } from "./port-focus"
import { ShippingShell, StatusBadge } from "./app"
import { useShipping } from "./data"
import { PortWeatherPanelSection } from "./port-weather"
import { ProvenanceBadge } from "./ui"
import { TropicalCyclonePanelSection, WatchChip } from "./pages"
import { formatStatus } from "./format"

export function DemoPortsPage({ id = "port-yantian" }: { id?: string }) {
  const { data, isLoading, isError, refetch } = useShipping()
  const scope = demoFocusPorts.find(p => p.shippingPortId === id)
  const port = data?.ports.find(p => p.id === id)
  const relatedFeed = data?.feedItems.filter(item => item.relatedPortIds.includes(id)) ?? []
  return (
    <ShippingShell title="港口">
      <div className="ports-demo">
        <div className="view-head">
          <div>
            <h1>港口</h1>
            <p className="sub">选一个港口，查看已缓存的运营资料与天气；未同步不代表正常。</p>
          </div>
        </div>
        <nav className="tabs" aria-label="选择港口">
          {demoFocusPorts.map(p => (
            <Link key={p.shippingPortId} to="/ports/$id" params={{ id: p.shippingPortId }} aria-current={id === p.shippingPortId ? "page" : undefined}>
              {p.nameZh}
              <span className="code">{p.unlocode}</span>
            </Link>
          ))}
        </nav>
        {!scope
          ? <p role="alert">不在批准的八港范围内。</p>
          : (
              <>
                <section className="panel">
                  <h2>
                    {scope.nameZh}
                    {" "}
                    <span className="mono muted">{scope.unlocode}</span>
                    {" "}
                    ·
                    {" "}
                    {scope.countryCode}
                  </h2>
                  <p className="muted">八港目录是关注范围，不证明已取得该港当前数据。</p>
                  {isLoading
                    ? <p role="status">读取港口资料…</p>
                    : isError
                      ? <p role="alert">港口资料读取失败，状态未知。</p>
                      : !port
                          ? <p>本港尚无可读缓存，状态未知；未发起外部同步。</p>
                          : (
                              <>
                                <div>
                                  <StatusBadge stale={port.stale} sourceStatus={port.sourceStatus} />
                                  <ProvenanceBadge provenance={port.provenance} />
                                  <WatchChip id={id} watched={port.isWatched} onSaved={() => refetch()} />
                                </div>
                                <dl className="kv">
                                  <dt>运营情况</dt>
                                  <dd>
                                    {port.stale ? "历史 / 已过期记录：" : "缓存记录："}
                                    {formatStatus(port.operationalStatus ?? "unknown")}
                                  </dd>
                                  <dt>近期停工日</dt>
                                  <dd>港口停工日汇总未开放。节假日不能视作停工通知。</dd>
                                </dl>
                              </>
                            )}
                </section>
                <div className="cols">
                  <section className="panel">
                    <h2>港口公告与报道</h2>
                    {isError
                      ? <p role="alert">来源资料读取失败。</p>
                      : isLoading
                        ? <p>读取中…</p>
                        : relatedFeed.length
                          ? relatedFeed.map(item => (
                              <article className="ev" key={item.id}>
                                <h3>{item.title}</h3>
                                <ProvenanceBadge provenance={item.provenance} />
                                <p>{item.summary}</p>
                                <Link to="/feed/$id" params={{ id: item.id }}>查看资料与原文依据</Link>
                              </article>
                            ))
                          : <p className="muted">未缓存相关公告；不表示没有公告或风险。</p>}
                  </section>
                  <section className="panel">
                    <h2>港口天气 · 七天窗口</h2>
                    <p className="muted">预报数值、系统潜在影响和官方预警分开展示。潜在影响不是已实施停工；区域天气与风险汇总尚未开放。</p>
                    {!isError && !isLoading ? <PortWeatherPanelSection key={id} portId={id} /> : <p>{isLoading ? "等待港口资料…" : "缺少本港可读记录，天气尚不可用。"}</p>}
                  </section>
                </div>
                <TropicalCyclonePanelSection />
              </>
            )}
      </div>
    </ShippingShell>
  )
}
