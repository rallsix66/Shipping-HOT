import { describe, expect, it } from "vitest"
import type { FeedItem } from "@shared/shipping"
import type { WeatherImpactRuleHit } from "@shared/weather-impact"
import { deliveryMajorCities, officialAlertImpactRules } from "#/config/weather-impact-rules"
import { evaluateOfficialAlertImpactRules, officialAlertIneligibility } from "#/services/official-alert-impact"
import { assertNoImplementedWeatherImpact, evaluateWeatherImpactRules, listAllWeatherImpactRuleIds } from "#/services/weather-impact-engine"

const NOW = Date.parse("2026-10-10T04:00:00.000Z")
const CITIES = { TH: ["Bangkok"], ID: ["Jakarta"] } as const

function alert(patch: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "tmd-cap-001",
    sourceId: "tmd",
    category: "weather",
    type: "weather_alert",
    title: "Heavy rain warning for Bangkok and Chon Buri",
    summary: "TMD warns of heavy rain and flash floods.",
    sourceUrl: "https://www.tmd.go.th/en/api/xml/CAP",
    publishedAt: "2026-10-10T01:00:00.000Z",
    expiresAt: "2026-10-11T00:00:00.000Z",
    severity: "warning",
    relatedPortIds: ["port-laem-chabang"],
    relatedVesselIds: [],
    updatedAt: "2026-10-10T01:00:00.000Z",
    fetchedAt: "2026-10-10T01:05:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    weather: { riskSource: "official", alertState: "active", alertId: "CAP-001", alertRegion: "Bangkok" },
    ...patch,
  } as FeedItem
}

function expectPotential(hits: WeatherImpactRuleHit[]) {
  expect(hits.length).toBeGreaterThan(0)
  for (const hit of hits) {
    expect(hit.status).toBe("potential")
    expect(hit.provenance).toBe("system")
    expect(hit.officialBasis?.provenance).toBe("official")
    expect(hit.inputValues.officialSourceId).toBeDefined()
    expect(hit.inputValues.officialSeverity).toBe(hit.severity)
  }
  expect(() => assertNoImplementedWeatherImpact(hits)).not.toThrow()
}

describe("r1.5-2 official-warning rows (plan §4.8) — fixtures", () => {
  it("rule set: WR-S01..S05 + WR-O01/O02, each with hit/miss fixtures in this suite or weather-impact-engine.test.ts", () => {
    expect(listAllWeatherImpactRuleIds()).toEqual(["WR-S01", "WR-S02", "WR-S03", "WR-S04", "WR-S05", "WR-O01", "WR-O02"])
    expect(officialAlertImpactRules.map(r => r.id)).toEqual(["WR-O01", "WR-O02"])
  })

  describe("wR-O01 any official warning associated with the port", () => {
    it("hits with the official severity, potential/system, rule id and inputs", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ severity: "critical" })], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW })
        .filter(h => h.ruleId === "WR-O01")
      expectPotential(hits)
      expect(hits[0]).toMatchObject({ object: "shipping_port", severity: "critical", summaryZh: "以官方原文为准：Heavy rain warning for Bangkok and Chon Buri" })
      expect(hits[0].inputValues).toMatchObject({ officialSourceId: "tmd", officialAlertId: "CAP-001" })
    })

    it("misses when the alert is not associated with the port", () => {
      expect(evaluateOfficialAlertImpactRules([alert()], { portId: "port-manila", countryCode: "PH", nowMs: NOW })).toEqual([])
    })

    it("misses for non-official sources (model weather / news)", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ sourceId: "open-meteo-marine" })], { portId: "port-laem-chabang", nowMs: NOW })
      expect(hits).toEqual([])
    })

    it.each([
      ["stale", { stale: true }],
      ["event-ineligible (missing from current index)", { eventEligibility: false }],
      ["expired lifecycle", { weather: { riskSource: "official", alertState: "expired" } }],
      ["unknown lifecycle", { weather: { riskSource: "official", alertState: "unknown" } }],
      ["expiresAt in the past", { expiresAt: "2026-10-10T03:59:59.000Z" }],
    ] as const)("misses for %s alerts", (_label, patch) => {
      const hits = evaluateOfficialAlertImpactRules([alert(patch as Partial<FeedItem>)], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: CITIES })
      expect(hits).toEqual([])
    })
  })

  describe("wR-O02 delivery region (rainstorm / flood / tropical cyclone + major city)", () => {
    it("hits for a heavy-rain warning naming a configured major city", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] })], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: CITIES })
      expectPotential(hits)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({ ruleId: "WR-O02", object: "delivery_region", severity: "warning" })
      expect(hits[0].inputValues).toMatchObject({ matchedHazard: "rainstorm", matchedCity: "Bangkok" })
      expect(hits[0].summaryZh).toContain("潜在影响")
    })

    it.each([
      ["flood", "Banjir di Jakarta Utara", "ID", "flood"],
      ["tropical cyclone", "Siklon tropis mendekati Jakarta", "ID", "tropical_cyclone"],
    ] as const)("hits for %s wording", (_l, title, country, hazard) => {
      const hits = evaluateOfficialAlertImpactRules([alert({ sourceId: "bmkg", title, summary: "", relatedPortIds: [], weather: { riskSource: "official", alertState: "active" } })], { portId: "port-jakarta", countryCode: country, nowMs: NOW, majorCities: CITIES })
      expect(hits.map(h => h.inputValues.matchedHazard)).toEqual([hazard])
    })

    it("misses when the hazard is not rainstorm/flood/tropical cyclone (e.g. heat)", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ title: "Extreme heat advisory for Bangkok", summary: "", relatedPortIds: [] })], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: CITIES })
      expect(hits).toEqual([])
    })

    it("misses when no configured major city is covered", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ title: "Heavy rain in Nan province", summary: "", relatedPortIds: [], weather: { riskSource: "official", alertState: "active", alertRegion: "Nan" } })], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: CITIES })
      expect(hits).toEqual([])
    })

    it("cannot fire with the shipped config: the major-city list is empty pending approval", () => {
      expect(deliveryMajorCities).toEqual({})
      const hits = evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] })], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW })
      expect(hits).toEqual([])
    })
  })
})

describe("r1.5-3 rules never produce an implemented / port-closed state", () => {
  it("an alert that says the port is closed still yields only a potential impact", () => {
    const closed = alert({ title: "Port of Laem Chabang closed due to typhoon; operations suspended", summary: "港口关闭 已停工 已封港", severity: "critical" })
    const hits = evaluateOfficialAlertImpactRules([closed], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: { TH: ["Laem Chabang"] } })
    expectPotential(hits)
    for (const hit of hits) {
      expect(JSON.stringify(hit)).not.toMatch(/"status":"(implemented|enacted|closed)"/)
      expect(Object.keys(hit)).not.toContain("implementedAt")
    }
  })

  it("all automatic rules (forecast + official) only emit potential, even at extreme inputs", () => {
    const forecast = evaluateWeatherImpactRules({ windGustMs: 60, waveHeightM: 12, visibilityM: 10, precipitationMm24h: 900, typhoonDistanceKm: 0 })
    const official = evaluateOfficialAlertImpactRules([alert({ severity: "critical" })], { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: CITIES })
    const all = [...forecast, ...official]
    expect(new Set(all.map(h => h.ruleId))).toEqual(new Set(["WR-S01", "WR-S02", "WR-S03", "WR-S04", "WR-S05", "WR-O01", "WR-O02"]))
    expect(all.every(h => h.status === "potential")).toBe(true)
    expect(() => assertNoImplementedWeatherImpact(all)).not.toThrow()
  })

  it("the guard rejects a forged implemented status", () => {
    const forged = { ...evaluateWeatherImpactRules({ windGustMs: 30 })[0], status: "implemented" } as unknown as WeatherImpactRuleHit
    expect(() => assertNoImplementedWeatherImpact([forged])).toThrow(/non-potential/)
  })

  it("ineligibility reasons are explicit", () => {
    expect(officialAlertIneligibility(alert({ stale: true }), NOW)).toBe("stale")
    expect(officialAlertIneligibility(alert(), NOW)).toBeUndefined()
  })
})
