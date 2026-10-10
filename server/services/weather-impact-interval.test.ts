import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { CURRENT_IMPACT_DURATION_MS, HOURLY_IMPACT_DURATION_MS, assertValidImpactInterval, impactValidityInterval } from "./weather-impact-interval"
import type { OpenMeteoPortPoint } from "./open-meteo-port-forecast"
import { isWeatherImpactActiveAt } from "./weather-panel-policy"
import { ShippingRepository, initShippingTables } from "#/database/shipping"

function createNativeDatabase() {
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

describe("weather impact validity interval", () => {
  it("uses capped hourly/current horizons and strict ordering at same timestamp", () => {
    const ts = "2026-08-15T12:30:00.000Z"
    const sorted: OpenMeteoPortPoint[] = [
      { timestamp: ts, horizon: "hourly", windGustKmh: 40 },
      { timestamp: ts, horizon: "current", windGustKmh: 45 },
      { timestamp: "2026-08-15T13:00:00.000Z", horizon: "hourly", windGustKmh: 30 },
    ]
    const hourlyInterval = impactValidityInterval(sorted[0], sorted, 0)
    const currentInterval = impactValidityInterval(sorted[1], sorted, 1)
    expect(assertValidImpactInterval(hourlyInterval)).toBe(true)
    expect(assertValidImpactInterval(currentInterval)).toBe(true)
    expect(Date.parse(hourlyInterval.validUntil) - Date.parse(hourlyInterval.validFrom)).toBeLessThanOrEqual(HOURLY_IMPACT_DURATION_MS)
    expect(Date.parse(currentInterval.validUntil) - Date.parse(currentInterval.validFrom)).toBeLessThanOrEqual(CURRENT_IMPACT_DURATION_MS)
  })

  it("treats asOf inside [validFrom, validUntil] as active", () => {
    const from = "2026-08-15T12:00:00.000Z"
    const until = "2026-08-15T13:00:00.000Z"
    expect(isWeatherImpactActiveAt(Date.parse("2026-08-15T12:30:00.000Z"), from, until)).toBe(true)
    expect(isWeatherImpactActiveAt(Date.parse("2026-08-15T13:00:00.000Z"), from, until)).toBe(true)
    expect(isWeatherImpactActiveAt(Date.parse("2026-08-15T13:00:00.001Z"), from, until)).toBe(false)
  })

  it("query excludes ended impacts and includes future intervals (fixed clock)", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "mock")
    const repository = new ShippingRepository(database, "mock")
    const asOf = "2026-08-15T12:00:00.000Z"
    await repository.replaceWeatherPortBatch("port-shekou", [], [
      {
        id: "wi-past",
        portId: "port-shekou",
        validFrom: "2026-08-15T10:00:00.000Z",
        validUntil: "2026-08-15T11:00:00.000Z",
        ruleId: "WR-S01",
        severity: "watch",
        status: "potential",
        provenance: "system",
        summaryZh: "已结束",
        inputValues: {},
        computedAt: asOf,
      },
      {
        id: "wi-current",
        portId: "port-shekou",
        validFrom: "2026-08-15T12:00:00.000Z",
        validUntil: "2026-08-15T13:00:00.000Z",
        ruleId: "WR-S02",
        severity: "warning",
        status: "potential",
        provenance: "system",
        summaryZh: "当前",
        inputValues: {},
        computedAt: asOf,
      },
      {
        id: "wi-future",
        portId: "port-shekou",
        validFrom: "2026-08-16T00:00:00.000Z",
        validUntil: "2026-08-16T01:00:00.000Z",
        ruleId: "WR-S03",
        severity: "critical",
        status: "potential",
        provenance: "system",
        summaryZh: "未来",
        inputValues: {},
        computedAt: asOf,
      },
    ])
    const horizonEnd = "2026-08-22T12:00:00.000Z"
    const matched = await repository.countWeatherImpactsActiveInHorizon("port-shekou", asOf, horizonEnd)
    expect(matched).toBe(2)
    const listed = await repository.listWeatherImpactsForPortRanked("port-shekou", asOf, horizonEnd, 10)
    expect(listed.map(row => row.id)).toEqual(["wi-future", "wi-current"])
    native.close()
  })
})
