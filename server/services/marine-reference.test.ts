import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { Port } from "@shared/shipping"
import { mockPorts } from "@shared/shipping-fixtures"
import { getPortWeatherPanel } from "./port-weather-panel"
import { MARINE_REFERENCE_SOURCE_ID, marineReferenceForPort, portMarineReferences } from "#/config/port-marine-reference"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createOpenMeteoWeatherProvider } from "#/providers/shipping"
import { computePortWeatherImpacts, mergeOpenMeteoPortPoints, openMeteoPointsToForecastRows } from "#/services/open-meteo-port-forecast"

/**
 * ADR-009 VNSGN area-reference marine. Scope: provider request/persistence batch and panel SERVICE layer;
 * the live harness separately checks API/SQLite/browser label. Not an HTTP route unit test.
 */
const NOW = new Date("2026-10-10T04:00:00.000Z")
const ref = marineReferenceForPort("port-ho-chi-minh")!
const hours = Array.from({ length: 6 }, (_, i) => Date.parse("2026-10-10T03:00:00Z") / 1000 + i * 3600)

function port(id: string, unlocode: string): Port {
  return { ...mockPorts[0], id, unlocode, name: id, nameEn: id } as Port
}

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

function fakeOpenMeteo(options: { referenceStatus?: number } = {}) {
  const calls: string[] = []
  const fetcher = async (raw: string) => {
    calls.push(raw)
    const url = new URL(raw)
    const lat = Number(url.searchParams.get("latitude"))
    if (url.hostname.startsWith("marine")) {
      if (lat === ref.latitude) {
        if (options.referenceStatus) return json({ error: true }, options.referenceStatus)
        return json({ hourly: { time: hours, wave_height: hours.map(() => 3.0), swell_wave_height: hours.map(() => 1.2) } })
      }
      // port coordinate: cell_selection=sea returns no wave/swell (the real VNSGN situation)
      return json({ hourly: { time: hours, wave_height: hours.map(() => null), swell_wave_height: hours.map(() => null) } })
    }
    return json({ hourly: { time: hours, wind_speed_10m: hours.map(() => 10), wind_gusts_10m: hours.map(() => 20), precipitation: hours.map(() => 0), visibility: hours.map(() => 20000) } })
  }
  return { fetcher, calls }
}

const directory = {
  getPortCoordinate: async (unlocode: string) => unlocode === "VNSGN" ? { latitude: 10.77, longitude: 106.75 } : { latitude: 22.48, longitude: 113.91 },
}

describe("aDR-009 reference config", () => {
  it("vNSGN reference is the approved engineering point with honest labels", () => {
    expect(portMarineReferences).toHaveLength(1)
    expect(ref).toMatchObject({ portId: "port-ho-chi-minh", nameZh: "胡志明关联海域海况参考（工程取点）", latitude: 10.2917, longitude: 107.0417, model: "best_match", approxDistanceKm: 62, kind: "engineering_reference_point", officialRepresentativePoint: false, berthConditions: false })
    expect(ref.labelZh).toContain("非官方代表点")
    expect(ref.labelZh).toContain("不代表泊位")
    expect(ref.refKey.startsWith("marine-ref:")).toBe(true)
  })
})

describe("provider: reference marine is a separate request and a separate batch", () => {
  it("requests the reference point with best_match/sea/8+1 days and keeps the port's own marine missing", async () => {
    const { fetcher, calls } = fakeOpenMeteo()
    const provider = createOpenMeteoWeatherProvider({ fetcher, now: () => NOW, portDirectory: directory as never })
    await provider.getFeedItems([port("port-ho-chi-minh", "VNSGN")], [])
    const refCall = new URL(calls.find(c => c.includes("latitude=10.2917"))!)
    expect(Object.fromEntries(refCall.searchParams)).toMatchObject({ latitude: "10.2917", longitude: "107.0417", models: "best_match", cell_selection: "sea", forecast_days: "8", past_days: "1" })
    const batch = provider.drainForecastPersistence!()
    const own = batch.forecastsByPortId.get("port-ho-chi-minh")!
    expect(own.length).toBeGreaterThan(0)
    expect(own.every(row => row.waveHeightM === undefined && row.swellWaveHeightM === undefined)).toBe(true)
    expect(own.every(row => row.sourceId === "open-meteo-marine")).toBe(true)
    const refRows = batch.forecastsByPortId.get(ref.refKey)!
    expect(refRows.every(row => row.sourceId === MARINE_REFERENCE_SOURCE_ID && row.portId === ref.refKey && row.waveHeightM === 3)).toBe(true)
    expect(refRows.every(row => row.windGustKmh === undefined && row.precipitationMm === undefined)).toBe(true)
    expect(batch.impactsByPortId.get("port-ho-chi-minh")!.some(hit => hit.inputValues.waveHeightM !== undefined)).toBe(false)
  })

  it("a reference failure never fails or alters the port forecast", async () => {
    const { fetcher } = fakeOpenMeteo({ referenceStatus: 500 })
    const provider = createOpenMeteoWeatherProvider({ fetcher, now: () => NOW, portDirectory: directory as never })
    await expect(provider.getFeedItems([port("port-ho-chi-minh", "VNSGN")], [])).resolves.toBeDefined()
    const batch = provider.drainForecastPersistence!()
    expect(batch.forecastsByPortId.has("port-ho-chi-minh")).toBe(true)
    expect(batch.forecastsByPortId.has(ref.refKey)).toBe(false)
  })

  it("ports without a configured reference make no reference request", async () => {
    const { fetcher, calls } = fakeOpenMeteo()
    const provider = createOpenMeteoWeatherProvider({ fetcher, now: () => NOW, portDirectory: directory as never })
    await provider.getFeedItems([port("port-shekou", "CNSHK")], [])
    expect(calls.some(c => c.includes("models="))).toBe(false)
    expect([...provider.drainForecastPersistence!().forecastsByPortId.keys()]).toEqual(["port-shekou"])
  })
})

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

describe("panel service: separate marineReference block, port marine still reported missing", () => {
  it("returns the labelled reference separately and leaves forecasts/forecastMeta/impacts of the port untouched", async () => {
    const { database, native } = memoryRepository()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const fetchedAt = NOW.toISOString()
    const land = { hourly: { time: hours, wind_speed_10m: hours.map(() => 10), wind_gusts_10m: hours.map(() => 20), precipitation: hours.map(() => 0), visibility: hours.map(() => 20000) } }
    const ownPoints = mergeOpenMeteoPortPoints({ hourly: { time: hours } }, land, NOW.getTime())
    await repository.replaceWeatherPortBatch("port-ho-chi-minh", openMeteoPointsToForecastRows("port-ho-chi-minh", "VNSGN", ownPoints, fetchedAt), computePortWeatherImpacts("port-ho-chi-minh", ownPoints, fetchedAt))
    const refPoints = mergeOpenMeteoPortPoints({ hourly: { time: hours, wave_height: hours.map(() => 3.0) } }, {}, NOW.getTime())
    const refImpacts = computePortWeatherImpacts(ref.refKey, refPoints, fetchedAt)
    expect(refImpacts.length).toBeGreaterThan(0)
    await repository.replaceWeatherPortBatch(ref.refKey, openMeteoPointsToForecastRows(ref.refKey, undefined, refPoints, fetchedAt, MARINE_REFERENCE_SOURCE_ID), refImpacts)

    await repository.recordMarineReferenceAttempt({ refKey: ref.refKey, attemptedAt: fetchedAt, outcome: "success" })
    const panel = await getPortWeatherPanel(repository, "port-ho-chi-minh", [], "Open-Meteo", "alerts", { now: NOW })
    expect(panel.forecasts.length).toBeGreaterThan(0)
    expect(panel.forecasts.every(row => row.waveHeightM === undefined && row.sourceId === "open-meteo-marine")).toBe(true)
    expect(panel.forecastMeta.marineCoverageNote).toContain("胡志明")
    expect(panel.forecastMeta.missingCounts.wave).toBe(panel.forecastMeta.actualCoverage.hourlyReturned)
    expect(panel.impacts.every(hit => hit.portId === "port-ho-chi-minh")).toBe(true)
    expect(panel.marineReference).toMatchObject({ nameZh: "胡志明关联海域海况参考（工程取点）", kind: "engineering_reference_point", officialRepresentativePoint: false, berthConditions: false, approxDistanceKm: 62, model: "best_match", sourceId: MARINE_REFERENCE_SOURCE_ID, maxWaveHeightM: 3 })
    expect(panel.marineReference!.hourlyWithMarine).toBe(panel.marineReference!.hourlyReturned)
    expect(panel.marineReference!.impacts.every(hit => hit.portId === ref.refKey)).toBe(true)
    expect(panel.marineReference!.impacts.length).toBeGreaterThan(0)

    const other = await getPortWeatherPanel(repository, "port-shekou", [], "Open-Meteo", "alerts", { now: NOW })
    expect(other.marineReference).toBeUndefined()
    native.close()
  })
})
