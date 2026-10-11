import { describe, expect, it } from "vitest"
import { ADR009_CONCLUSION_ZH, REFERENCE_NAME_ZH, REFERENCE_SOURCE_ID, evaluateAdr009Mapping } from "./adr009-mapping.mjs"

const REF = "marine-ref:port-ho-chi-minh:ganh-rai-eng"
const NOW = Date.parse("2026-10-10T04:30:00Z")
const H = 3600_000
function refRows(skip?: number) {
  const rows = []
  for (let t = Date.parse("2026-10-10T04:00:00Z"); t <= NOW + 7 * 24 * H; t += H) {
    if (t === skip) continue
    rows.push({ portId: REF, sourceId: REFERENCE_SOURCE_ID, forecastAt: new Date(t).toISOString(), horizon: "hourly", waveHeightM: 1 })
  }
  return rows
}
const apiRef = { nameZh: REFERENCE_NAME_ZH, kind: "engineering_reference_point", officialRepresentativePoint: false, berthConditions: false, model: "best_match", labelZh: "工程取点…非官方代表点…", status: "fresh", showingHistoricalData: false, lastSuccessAt: "2026-10-10T04:29:00Z", grid: { returnedLatitude: 10.25, returnedLongitude: 107.0, requestedToReturnedKm: 6.4 } }
const portRows = [{ portId: "port-ho-chi-minh", sourceId: "open-meteo-marine", horizon: "hourly", forecastAt: "2026-10-10T05:00:00Z", windGustKmh: 20 }]
const browser = ["browser_shows_marine_reference_label", "browser_shows_marine_reference_status", "browser_shows_marine_reference_grid"].map(id => ({ id, pass: true, detail: "ok" }))
function base(patch: Record<string, unknown> = {}) {
  return { refKey: REF, syncNowMs: NOW, apiNowMs: NOW, refSqliteRows: refRows(), apiRef, apiRefRows: refRows(), apiPortRows: portRows, apiPortMeta: { marineCoverageNote: "未返回浪高" }, browserChecks: browser, ...patch }
}
const failed = (r: ReturnType<typeof evaluateAdr009Mapping>) => r.checks.filter(c => !c.pass).map(c => c.id)

describe("aDR-009 R1.5-1 mapping (approved dots 2026-10-10 14:11 UTC+8)", () => {
  it("passes only with fresh, complete, labelled, isolated reference + origin-missing disclosure + browser", () => {
    const r = evaluateAdr009Mapping(base())
    expect(failed(r)).toEqual([])
    expect(r.pass).toBe(true)
    expect(r.originMarineAvailable).toBe(false)
    expect(ADR009_CONCLUSION_ZH).toBe("R1.5-1按ADR-009映射PASS；VNSGN原点海况不可用")
  })
  it("reference removed blocks", () => {
    expect(failed(evaluateAdr009Mapping(base({ apiRef: undefined, apiRefRows: [], refSqliteRows: [] })))).toEqual(expect.arrayContaining(["reference_present", "reference_sqlite_7d", "reference_api_7d"]))
  })
  it("missing hours block (SQLite and API)", () => {
    const skip = Date.parse("2026-10-12T00:00:00Z")
    expect(failed(evaluateAdr009Mapping(base({ refSqliteRows: refRows(skip), apiRefRows: refRows(skip) })))).toEqual(["reference_sqlite_7d", "reference_api_7d"])
  })
  it("missing label blocks", () => {
    expect(failed(evaluateAdr009Mapping(base({ apiRef: { ...apiRef, labelZh: "参考" } })))).toEqual(["reference_labelled"])
    expect(failed(evaluateAdr009Mapping(base({ apiRef: { ...apiRef, officialRepresentativePoint: true } })))).toEqual(["reference_labelled"])
  })
  it("stale / failed / historical reference blocks", () => {
    expect(failed(evaluateAdr009Mapping(base({ apiRef: { ...apiRef, status: "stale", showingHistoricalData: true } })))).toEqual(["reference_fresh"])
    expect(failed(evaluateAdr009Mapping(base({ apiRef: { ...apiRef, status: "failed", showingHistoricalData: true } })))).toEqual(["reference_fresh"])
  })
  it("reference polluting origin/berth fields blocks", () => {
    const polluted = [...portRows, { portId: "port-ho-chi-minh", sourceId: REFERENCE_SOURCE_ID, horizon: "hourly", forecastAt: "2026-10-10T06:00:00Z", waveHeightM: 1 }]
    expect(failed(evaluateAdr009Mapping(base({ apiPortRows: polluted })))).toContain("reference_isolated")
    expect(failed(evaluateAdr009Mapping(base({ apiRef: { ...apiRef, berthConditions: true } })))).toEqual(expect.arrayContaining(["reference_isolated", "reference_labelled"]))
    const mixed = refRows().map((r, i) => i === 3 ? { ...r, windGustKmh: 30 } : r)
    expect(failed(evaluateAdr009Mapping(base({ apiRefRows: mixed })))).toEqual(["reference_isolated"])
  })
  it("missing origin disclosure, missing grid, skipped browser checks block", () => {
    expect(failed(evaluateAdr009Mapping(base({ apiPortMeta: {} })))).toEqual(["origin_marine_disclosed"])
    expect(failed(evaluateAdr009Mapping(base({ apiRef: { ...apiRef, grid: undefined } })))).toEqual(["reference_grid_recorded"])
    expect(failed(evaluateAdr009Mapping(base({ browserChecks: [] })))).toEqual(["browser_shows_marine_reference_label", "browser_shows_marine_reference_status", "browser_shows_marine_reference_grid"])
  })
})
