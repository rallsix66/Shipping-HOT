import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { MarineReferenceAttempt, PortWeatherForecastRow, PortWeatherImpactRow } from "@shared/shipping"
import { getPortWeatherPanel } from "./port-weather-panel"
import { MARINE_REFERENCE_SOURCE_ID, marineReferenceForPort } from "#/config/port-marine-reference"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createOpenMeteoWeatherProvider } from "#/providers/shipping"

/**
 * ADR-009 reference status (fixed clock). Scope: repository meta + panel SERVICE layer + provider attempt batch.
 * Statuses: not_run / failed / fresh / stale / insufficient; last attempt and last success kept separately.
 */
const ref = marineReferenceForPort("port-ho-chi-minh")!
const H = 3600_000
const T0 = Date.parse("2026-10-10T04:00:00.000Z")
const grid = { requestedLatitude: 10.2917, requestedLongitude: 107.0417, returnedLatitude: 10.25, returnedLongitude: 107.0, requestedToReturnedKm: 6.4, modelRequested: "best_match", fetchedAt: new Date(T0).toISOString() }

function memoryRepository() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

async function setup() {
  const { database, native } = memoryRepository()
  await initShippingTables(database, "mock")
  return { repository: new ShippingRepository(database, "mock"), native }
}

function refRows(fetchedAtMs: number, wave: number | null = 3): PortWeatherForecastRow[] {
  const rows: PortWeatherForecastRow[] = []
  for (let t = T0 - 2 * H; t <= T0 + 8 * 24 * H; t += H) {
    rows.push({ id: `wf-${ref.refKey}-hourly-${t}`, portId: ref.refKey, forecastAt: new Date(t).toISOString(), horizon: "hourly", waveHeightM: wave ?? undefined, sourceId: MARINE_REFERENCE_SOURCE_ID, fetchedAt: new Date(fetchedAtMs).toISOString() })
  }
  return rows
}

function refImpact(): PortWeatherImpactRow {
  return { id: "wi-ref-1", portId: ref.refKey, validFrom: new Date(T0).toISOString(), validUntil: new Date(T0 + 24 * H).toISOString(), ruleId: "WR-S02", severity: "warning", status: "potential", provenance: "system", summaryZh: "浪高", inputValues: { waveHeightM: 3 }, computedAt: new Date(T0).toISOString() }
}

const success = (atMs: number): MarineReferenceAttempt => ({ refKey: ref.refKey, attemptedAt: new Date(atMs).toISOString(), outcome: "success", grid: { ...grid, fetchedAt: new Date(atMs).toISOString() } })
const failure = (atMs: number): MarineReferenceAttempt => ({ refKey: ref.refKey, attemptedAt: new Date(atMs).toISOString(), outcome: "failed", error: "Open-Meteo reference marine request failed (503)" })

async function panelAt(repository: ShippingRepository, nowMs: number) {
  return getPortWeatherPanel(repository, "port-ho-chi-minh", [], "Open-Meteo", "alerts", { now: new Date(nowMs) })
}

describe("aDR-009 reference status (fixed clock)", () => {
  it("not_run: no attempt recorded", async () => {
    const { repository, native } = await setup()
    const panel = await panelAt(repository, T0)
    expect(panel.marineReference).toMatchObject({ status: "not_run", showingHistoricalData: false, impacts: [], historicalImpactCount: 0, lastAttemptAt: undefined, lastSuccessAt: undefined })
    native.close()
  })

  it("fresh: success within 6 h and complete 7-day grid; current rule hits counted; grid metadata passed through", async () => {
    const { repository, native } = await setup()
    await repository.replaceWeatherPortBatch(ref.refKey, refRows(T0), [refImpact()])
    await repository.recordMarineReferenceAttempt(success(T0))
    const panel = await panelAt(repository, T0 + 30 * 60_000)
    expect(panel.marineReference).toMatchObject({ status: "fresh", showingHistoricalData: false, historicalImpactCount: 0, lastAttemptOutcome: "success", lastSuccessAt: new Date(T0).toISOString(), grid: { returnedLatitude: 10.25, returnedLongitude: 107.0, requestedToReturnedKm: 6.4, modelRequested: "best_match" } })
    expect(panel.marineReference!.coverage.complete).toBe(true)
    expect(panel.marineReference!.impacts).toHaveLength(1)
    native.close()
  })

  it("success then failure: failed, old values labelled historical, old rules not current, last success + grid kept, port status unaffected", async () => {
    const { repository, native } = await setup()
    await repository.replaceWeatherPortBatch(ref.refKey, refRows(T0), [refImpact()])
    await repository.recordMarineReferenceAttempt(success(T0))
    const before = await panelAt(repository, T0 + 60 * 60_000)
    await repository.recordMarineReferenceAttempt(failure(T0 + 60 * 60_000))
    const panel = await panelAt(repository, T0 + 60 * 60_000)
    expect(panel.marineReference).toMatchObject({ status: "failed", showingHistoricalData: true, impacts: [], historicalImpactCount: 1, lastAttemptOutcome: "failed", lastAttemptAt: new Date(T0 + H).toISOString(), lastSuccessAt: new Date(T0).toISOString(), grid: { returnedLatitude: 10.25 } })
    expect(panel.marineReference!.lastAttemptError).toContain("503")
    expect(panel.marineReference!.statusNoteZh).toContain("历史参考")
    expect(panel.state).toBe(before.state)
    expect(panel.forecasts).toEqual(before.forecasts)
    expect(panel.impacts).toEqual(before.impacts)
    native.close()
  })

  it("stale: last success beyond the 6 h freshness window", async () => {
    const { repository, native } = await setup()
    await repository.replaceWeatherPortBatch(ref.refKey, refRows(T0), [refImpact()])
    await repository.recordMarineReferenceAttempt(success(T0))
    const panel = await panelAt(repository, T0 + 7 * H)
    expect(panel.marineReference).toMatchObject({ status: "stale", showingHistoricalData: true, impacts: [], historicalImpactCount: 1 })
    native.close()
  })

  it("first failure: failed, no data, nothing historical", async () => {
    const { repository, native } = await setup()
    await repository.recordMarineReferenceAttempt(failure(T0))
    const panel = await panelAt(repository, T0)
    expect(panel.marineReference).toMatchObject({ status: "failed", showingHistoricalData: false, hourlyReturned: 0, lastSuccessAt: undefined, grid: undefined, impacts: [] })
    native.close()
  })

  it("empty values: success but no wave/swell -> insufficient (not fresh)", async () => {
    const { repository, native } = await setup()
    await repository.replaceWeatherPortBatch(ref.refKey, refRows(T0, null), [])
    await repository.recordMarineReferenceAttempt(success(T0))
    const panel = await panelAt(repository, T0)
    expect(panel.marineReference).toMatchObject({ status: "insufficient", maxWaveHeightM: undefined })
    expect(panel.marineReference!.coverage).toMatchObject({ hourlyWithMarine: 0, complete: false })
    native.close()
  })

  it("provider records the attempt with provider-returned grid (success) and the error (failure)", async () => {
    const hours = [T0 / 1000, T0 / 1000 + 3600]
    const make = (refStatus: number) => async (raw: string) => {
      const url = new URL(raw)
      const isRef = url.searchParams.get("latitude") === "10.2917"
      if (isRef && refStatus !== 200) return { ok: false, status: refStatus, json: async () => ({}) }
      const body = url.hostname.startsWith("marine")
        ? { latitude: isRef ? 10.25 : 10.75, longitude: isRef ? 107.0 : 106.75, generationtime_ms: 1.5, hourly: { time: hours, wave_height: hours.map(() => isRef ? 1 : null) } }
        : { hourly: { time: hours, wind_gusts_10m: hours.map(() => 20) } }
      return { ok: true, status: 200, json: async () => body }
    }
    const port = { id: "port-ho-chi-minh", unlocode: "VNSGN", name: "HCM", nameEn: "HCM" } as never
    const directory = { getPortCoordinate: async () => ({ latitude: 10.77, longitude: 106.75 }) } as never
    const ok = createOpenMeteoWeatherProvider({ fetcher: make(200), now: () => new Date(T0), portDirectory: directory })
    await ok.getFeedItems([port], [])
    const [attempt] = ok.drainForecastPersistence!().marineReferenceAttempts!
    expect(attempt).toMatchObject({ outcome: "success", grid: { requestedLatitude: 10.2917, requestedLongitude: 107.0417, returnedLatitude: 10.25, returnedLongitude: 107.0, modelRequested: "best_match", providerGenerationTimeMs: 1.5 } })
    expect(attempt.grid!.requestedToReturnedKm).toBeGreaterThan(6)
    expect(attempt.grid!.requestedToReturnedKm).toBeLessThan(7)
    const bad = createOpenMeteoWeatherProvider({ fetcher: make(503), now: () => new Date(T0), portDirectory: directory })
    await bad.getFeedItems([port], [])
    const batch = bad.drainForecastPersistence!()
    expect(batch.marineReferenceAttempts).toEqual([{ refKey: ref.refKey, attemptedAt: new Date(T0).toISOString(), outcome: "failed", error: expect.stringContaining("503") }])
    expect(batch.forecastsByPortId.has(ref.refKey)).toBe(false)
    bad.ackForecastPersistence!()
    expect(bad.drainForecastPersistence!().marineReferenceAttempts).toEqual([])
  })
})
