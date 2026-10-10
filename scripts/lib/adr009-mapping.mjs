// ADR-009 acceptance mapping for R1.5-1 (pure, no I/O).
// Approved by dots 2026-10-10 14:11 UTC+8 (Slack ts 1791612673.820639).
// VNSGN passes R1.5-1 only with: origin 7-day land (checked by the coverage_ check) + an independent reference
// 7-day marine that is fresh and complete in SQLite and the restarted API, rendered in the browser with labels,
// isolated from the origin rows, and an explicit disclosure that the origin marine is unavailable.
import { evaluateForecastWindowCoverage } from "./forecast-window-coverage.mjs"

export const ADR009_CONCLUSION_ZH = "R1.5-1按ADR-009映射PASS；VNSGN原点海况不可用"
export const REFERENCE_SOURCE_ID = "open-meteo-marine-reference"
export const REFERENCE_NAME_ZH = "胡志明关联海域海况参考（工程取点）"

const isNum = v => typeof v === "number" && Number.isFinite(v)

export function evaluateAdr009Mapping(input) {
  const { refKey, syncNowMs, apiNowMs, refSqliteRows = [], apiRef, apiRefRows = [], apiPortRows = [], apiPortMeta, browserChecks } = input
  const checks = []
  const add = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail })
  add("reference_present", Boolean(apiRef), apiRef ? "marineReference returned after restart" : "API returned no marineReference")
  add("reference_labelled", apiRef?.nameZh === REFERENCE_NAME_ZH && apiRef?.kind === "engineering_reference_point" && apiRef?.officialRepresentativePoint === false && apiRef?.berthConditions === false && apiRef?.model === "best_match" && String(apiRef?.labelZh ?? "").includes("非官方代表点"), JSON.stringify({ name: apiRef?.nameZh, kind: apiRef?.kind, official: apiRef?.officialRepresentativePoint, berth: apiRef?.berthConditions, model: apiRef?.model }))
  add("reference_fresh", apiRef?.status === "fresh" && apiRef?.showingHistoricalData === false, `status=${apiRef?.status} historical=${apiRef?.showingHistoricalData} lastSuccess=${apiRef?.lastSuccessAt}`)
  const sqlite = evaluateForecastWindowCoverage(refSqliteRows, syncNowMs, { requireLand: false })
  add("reference_sqlite_7d", sqlite.pass, sqlite.failed.join(",") || `${sqlite.hourlyInWindow}/${sqlite.window.expectedHours}`)
  const api = Number.isFinite(apiNowMs) ? evaluateForecastWindowCoverage(apiRefRows, apiNowMs, { requireLand: false }) : undefined
  add("reference_api_7d", api?.pass, api ? (api.failed.join(",") || `${api.hourlyInWindow}/${api.window.expectedHours}`) : "no API asOf")
  add("reference_grid_recorded", isNum(apiRef?.grid?.returnedLatitude) && isNum(apiRef?.grid?.returnedLongitude) && isNum(apiRef?.grid?.requestedToReturnedKm), JSON.stringify(apiRef?.grid ?? null))
  const pollutedOrigin = apiPortRows.filter(r => r.sourceId === REFERENCE_SOURCE_ID || r.portId === refKey)
  const foreignRef = apiRefRows.filter(r => r.sourceId !== REFERENCE_SOURCE_ID || r.portId !== refKey || isNum(r.windGustKmh) || isNum(r.precipitationMm) || isNum(r.visibilityM))
  add("reference_isolated", pollutedOrigin.length === 0 && foreignRef.length === 0 && apiRef?.berthConditions === false, `originRowsFromReference=${pollutedOrigin.length} referenceRowsNotPureReference=${foreignRef.length}`)
  const originHourly = apiPortRows.filter(r => r.horizon !== "current")
  const originMarineAvailable = originHourly.length > 0 && originHourly.every(r => isNum(r.waveHeightM) || isNum(r.swellWaveHeightM))
  add("origin_marine_disclosed", originMarineAvailable || Boolean(apiPortMeta?.marineCoverageNote), `originMarineAvailable=${originMarineAvailable} coverageNote=${Boolean(apiPortMeta?.marineCoverageNote)}`)
  for (const id of ["browser_shows_marine_reference_label", "browser_shows_marine_reference_status", "browser_shows_marine_reference_grid"]) {
    const found = (browserChecks ?? []).find(c => c.id === id)
    add(id, found?.pass, found ? found.detail : "browser check missing")
  }
  return { checks, pass: checks.every(c => c.pass), originMarineAvailable, sqlite, api }
}
