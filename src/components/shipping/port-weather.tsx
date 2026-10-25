import type { PortWeatherForecastRow, PortWeatherPanelResponse } from "@shared/shipping"
import { ruleCoverageReasonLabelZh } from "@shared/weather-rule-coverage-display"
import { usePortWeather } from "./data"
import { formatDate, severityTone } from "./format"
import { StatusDot } from "./ui"
import { portWeatherImpactEmptyCopy } from "./weather-copy"

export function ForecastTable({ rows }: { rows: PortWeatherForecastRow[] }) {
  return (
    <div className="tablewrap" data-testid="port-weather-forecast-list">
      <table>
        <caption>逐小时 / 当前记录；降水保留 API 原始 mm 值，不是日累计。原点海况与独立参考点分开。</caption>
        <thead>
          <tr>
            <th>时间 / 类型</th>
            <th>阵风 km/h</th>
            <th>浪高 m</th>
            <th>降水 mm（原值）</th>
            <th>能见度 m</th>
            <th>来源 / 获取时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td>
                {formatDate(row.forecastAt)}
                {" "}
                ·
                {" "}
                {row.horizon === "current" ? "当前" : "小时"}
              </td>
              <td>{row.windGustKmh ?? "缺测"}</td>
              <td>{row.waveHeightM ?? "缺测"}</td>
              <td>{row.precipitationMm ?? "缺测"}</td>
              <td>{row.visibilityM ?? "缺测"}</td>
              <td>
                {row.sourceId}
                {" "}
                ·
                {" "}
                {formatDate(row.fetchedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PortWeatherPanelSection({ portId }: { portId: string }) {
  const { data, isLoading, isError } = usePortWeather(portId)
  if (isLoading) return <p role="status">加载港口天气…</p>
  if (isError || !data) return <p role="alert">港口天气 API 不可用；不能判断本港天气状态。</p>
  return <PortWeatherPanelView data={data} />
}

export function PortWeatherPanelView({ data }: { data: PortWeatherPanelResponse }) {
  const nextImpacts = data.impacts
  const forecastEmptyCopy = data.state === "data_stale"
    ? "预报数据已过期，请重新同步。"
    : data.state === "sync_failed"
      ? "天气同步失败，暂无可靠预报数值。"
      : "暂无 7 天持久化预报；Open-Meteo 同步后会写入 SQLite。"
  return (
    <div className="demo-weather mt-4 flex flex-col gap-4">
      {data.panelNotice && (
        <p className="text-sm op-80 glass-panel d-panel py-2 px-3" data-testid="port-weather-notice">
          {data.panelNotice.messageZh}
        </p>
      )}
      {(data.precipCoverage.status !== "full" || data.ruleCoverage.some(r => r.evaluation === "unevaluated")) && (
        <p className="text-sm op-75 glass-panel d-panel py-2 px-3" data-testid="port-weather-coverage">
          24h 降水覆盖
          {" "}
          {data.precipCoverage.hourlySamplesInWindow}
          /
          {data.precipCoverage.fullRequired}
          {" "}
          小时（
          {data.precipCoverage.status === "full" ? "完整" : data.precipCoverage.status === "partial" ? "部分" : "不足"}
          ）
          {data.precipCoverage.status === "partial" && data.precipCoverage.partialSumMm !== undefined
            ? ` · 参考累计 ${data.precipCoverage.partialSumMm.toFixed(1)} mm（不可用于 WR-S05）`
            : null}
          {data.ruleCoverage.filter(r => r.evaluation === "unevaluated").map(r => (
            <span key={r.ruleId} className="block text-xs op-70 mt-1">
              {r.ruleId}
              {" "}
              未评估：
              {ruleCoverageReasonLabelZh(r.reason)}
            </span>
          ))}
        </p>
      )}
      {data.impactMeta.truncated && (
        <p className="text-xs op-60">
          共
          {" "}
          {data.impactMeta.totalMatched}
          {" "}
          条命中，展示
          {" "}
          {data.displayMeta.impactsReturned}
          /
          {data.displayMeta.impactLimit}
          {" "}
          条（近期高等级优先）。
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass-panel d-panel">
          <div className="panel-h">
            <h3>预报数值（7 天）</h3>
            <span className="text-xs op-60">{data.sources.forecast}</span>
          </div>
          {data.forecastMeta && (
            <p className="text-xs op-65 mb-2" data-testid="port-weather-forecast-meta">
              目标窗口
              {" "}
              {formatDate(data.forecastMeta.targetWindow.start)}
              {" → "}
              {formatDate(data.forecastMeta.targetWindow.end)}
              {" · 实际返回 "}
              {data.forecastMeta.actualCoverage.totalReturned}
              {" 条（hourly "}
              {data.forecastMeta.actualCoverage.hourlyReturned}
              {" / current "}
              {data.forecastMeta.actualCoverage.currentReturned}
              ）
              {data.forecastMeta.actualCoverage.firstInstant && data.forecastMeta.actualCoverage.lastInstant
                ? ` · 覆盖 ${formatDate(data.forecastMeta.actualCoverage.firstInstant)} → ${formatDate(data.forecastMeta.actualCoverage.lastInstant)}`
                : null}
              {data.forecastMeta.fetchedAt ? ` · 更新 ${formatDate(data.forecastMeta.fetchedAt)}` : null}
              {(data.forecastMeta.missingCounts.windGust > 0 || data.forecastMeta.missingCounts.wave > 0)
                ? ` · 缺测 阵风${data.forecastMeta.missingCounts.windGust} 浪${data.forecastMeta.missingCounts.wave} 降水${data.forecastMeta.missingCounts.precipitation} 能见度${data.forecastMeta.missingCounts.visibility}`
                : null}
              {data.forecastMeta.marineCoverageNote
                ? (
                    <span className="block mt-1 op-70">{data.forecastMeta.marineCoverageNote}</span>
                  )
                : null}
            </p>
          )}
          {data.marineReference
            ? (
                <div className="mb-3 rounded border border-amber-400/30 p-2 text-xs" data-testid="port-weather-marine-reference">
                  <p className="font-medium">{data.marineReference.nameZh}</p>
                  <p className="op-70">{data.marineReference.labelZh}</p>
                  <p data-testid="port-weather-marine-reference-status">
                    {`参考状态：${data.marineReference.status} · ${data.marineReference.statusNoteZh}`}
                    {` · 最近尝试 ${data.marineReference.lastAttemptAt ? formatDate(data.marineReference.lastAttemptAt) : "无"}（${data.marineReference.lastAttemptOutcome ?? "未运行"}）`}
                    {` · 最近成功 ${data.marineReference.lastSuccessAt ? formatDate(data.marineReference.lastSuccessAt) : "无"}`}
                  </p>
                  <p className="op-80" data-testid="port-weather-marine-reference-grid">
                    {`请求点 ${data.marineReference.latitude}N ${data.marineReference.longitude}E（距港口约 ${data.marineReference.approxDistanceKm} km） · 请求模型 ${data.marineReference.model}`}
                    {data.marineReference.grid?.returnedLatitude !== undefined && data.marineReference.grid?.returnedLongitude !== undefined
                      ? ` · 实际返回网格 ${data.marineReference.grid.returnedLatitude}N ${data.marineReference.grid.returnedLongitude}E（距请求点 ${data.marineReference.grid.requestedToReturnedKm ?? "?"} km，获取于 ${formatDate(data.marineReference.grid.fetchedAt)}）`
                      : " · 实际返回网格：无记录"}
                  </p>
                  <p className="op-80">
                    {data.marineReference.showingHistoricalData ? `历史参考（更新于 ${data.marineReference.lastSuccessAt ? formatDate(data.marineReference.lastSuccessAt) : "未知"}）：` : ""}
                    {`7 天整点含海况 ${data.marineReference.coverage.hourlyWithMarine}/${data.marineReference.coverage.expectedHours}`}
                    {data.marineReference.maxWaveHeightM !== undefined ? ` · 7 天最大浪高 ${data.marineReference.maxWaveHeightM.toFixed(1)} m` : " · 暂无参考海况测值"}
                    {` · 当前参考规则命中 ${data.marineReference.impacts.length}`}
                    {data.marineReference.historicalImpactCount > 0 ? ` · 历史命中 ${data.marineReference.historicalImpactCount}（不计入当前）` : ""}
                  </p>
                </div>
              )
            : null}
          {data.forecasts.length === 0
            ? <p className="text-sm op-60">{forecastEmptyCopy}</p>
            : (
                <ForecastTable rows={data.forecasts} />
              )}
        </div>
        <div className="glass-panel d-panel">
          <div className="panel-h">
            <h3>潜在影响</h3>
            <span className="text-xs op-60">
              ⚙
              {data.sources.impacts}
            </span>
          </div>
          {nextImpacts.length === 0
            ? <p className="text-sm op-60">{portWeatherImpactEmptyCopy(data.state)}</p>
            : (
                <ul className="space-y-2 text-sm" data-testid="port-weather-impacts">
                  {nextImpacts.map(row => (
                    <li key={row.id} className="flex items-start gap-2">
                      <StatusDot tone={severityTone(row.severity)} />
                      <div>
                        <p className="font-medium">{row.summaryZh}</p>
                        <p className="text-xs op-60">
                          潜在影响 · ⚙ 系统 · 输入
                          {" "}
                          {JSON.stringify(row.inputValues)}
                          {" "}
                          · 有效至
                          {" "}
                          {formatDate(row.validUntil)}
                          {" "}
                          ·
                          {row.ruleId}
                          {" "}
                          ·
                          {" "}
                          {formatDate(row.validFrom)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </div>
        <div className="glass-panel d-panel">
          <div className="panel-h">
            <h3>官方预警</h3>
            <span className="text-xs op-60">{data.sources.alerts}</span>
          </div>
          {data.officialAlerts.length === 0
            ? <p className="text-sm op-60">未配置或未同步到本港相关官方预警。</p>
            : (
                <ul className="space-y-2 text-sm">
                  {data.officialAlerts.map(alert => (
                    <li key={alert.id} className="flex items-start gap-2">
                      <StatusDot tone={severityTone(alert.severity)} />
                      <div>
                        <p className="font-medium">{alert.title}</p>
                        <p className="text-xs op-60">
                          {formatDate(alert.publishedAt)}
                          {" "}
                          ·
                          {" "}
                          {alert.sourceId}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </div>
    </div>
  )
}
