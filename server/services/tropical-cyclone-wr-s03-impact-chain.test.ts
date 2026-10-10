import { describe, expect, it } from "vitest"
import type { TropicalCycloneSyncMeta } from "@shared/shipping"
import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import { computePortWeatherImpacts } from "#/services/open-meteo-port-forecast"
import type { OpenMeteoPortPoint } from "#/services/open-meteo-port-forecast"
import { filterActiveCyclonesForRules, minTyphoonDistanceKmForPortInInterval } from "#/services/tropical-cyclone-display"
import { isJmaTyphoonSyncTrustworthyForWrS03 } from "#/services/tropical-cyclone-freshness"
import { typhoonInputFromSyncAndDistance } from "#/services/weather-rule-evaluation"

const shekou = { portId: "port-shekou", unlocode: "CNSHK", latitude: 22.48, longitude: 113.91 }

describe("wr-s03 impact interval chain", () => {
  it("does not hit now when typhoon only approaches after 48h", () => {
    const nowMs = Date.parse("2026-08-15T12:00:00.000Z")
    const cyclone: NormalizedTropicalCyclone = {
      id: "tc-test",
      basin: "NW_PACIFIC",
      jmaId: "TC1",
      lifecycleStatus: "active",
      current: { lat: 18.0, lon: 140.0, at: "2026-08-15T11:00:00.000Z" },
      trackHistory: [],
      forecast: [{ lat: 22.49, lon: 113.92, at: "2026-08-17T12:00:00.000Z" }],
      rawForecastJson: [],
    }
    const sync: TropicalCycloneSyncMeta = {
      sourceId: "jma-typhoon",
      outcome: "ok",
      lastFullSuccessAt: "2026-08-17T11:00:00.000Z",
      lastCheckedAt: "2026-08-17T11:00:00.000Z",
    }
    const active = filterActiveCyclonesForRules([cyclone])
    const points: OpenMeteoPortPoint[] = [
      { timestamp: "2026-08-15T12:00:00.000Z", horizon: "hourly", windGustKmh: 20 },
      { timestamp: "2026-08-17T12:00:00.000Z", horizon: "hourly", windGustKmh: 20 },
    ]
    const resolveTyphoon = (validFrom: string, validUntil: string) => {
      const fromMs = Date.parse(validFrom)
      const untilMs = Date.parse(validUntil)
      const distanceKm = minTyphoonDistanceKmForPortInInterval(active, shekou, fromMs, untilMs, true)
      return typhoonInputFromSyncAndDistance(distanceKm, sync, untilMs)
    }
    const impacts = computePortWeatherImpacts("port-shekou", points, "2026-08-15T10:00:00.000Z", undefined, resolveTyphoon)
    const nowImpacts = impacts.filter(row => row.ruleId === "WR-S03" && row.validFrom.startsWith("2026-08-15"))
    const futureImpacts = impacts.filter(row => row.ruleId === "WR-S03" && row.validFrom.startsWith("2026-08-17"))
    expect(nowImpacts).toHaveLength(0)
    expect(futureImpacts.length).toBeGreaterThan(0)
    expect(isJmaTyphoonSyncTrustworthyForWrS03(sync, nowMs)).toBe(true)
  })
})
