import { describe, expect, it } from "vitest"
import type { FeedItem } from "@shared/shipping"
import type { WeatherImpactRuleHit } from "@shared/weather-impact"
import { deliveryMajorCities, officialAlertImpactRules, officialAlertSourceCountry } from "#/config/weather-impact-rules"
import { evaluateOfficialAlertImpactRules, officialAlertIneligibility } from "#/services/official-alert-impact"
import { assertNoImplementedWeatherImpact, evaluateWeatherImpactRules, listAllWeatherImpactRuleIds } from "#/services/weather-impact-engine"

const NOW = Date.parse("2026-10-10T04:00:00.000Z")
const CITIES = { TH: ["Bangkok"], ID: ["Jakarta"] } as const
const TH = { portId: "port-laem-chabang", countryCode: "TH", nowMs: NOW, majorCities: CITIES }

function alert(patch: Partial<FeedItem> = {}, weather: Record<string, unknown> = {}): FeedItem {
  return {
    id: "tmd-cap-001",
    sourceId: "tmd",
    category: "weather",
    type: "weather_alert",
    title: "Heavy rain warning",
    summary: "TMD warns of heavy rain and flash floods.",
    sourceUrl: "https://www.tmd.go.th/en/api/xml/CAP",
    publishedAt: "2026-10-10T01:00:00.000Z",
    expiresAt: "2026-10-11T00:00:00.000Z",
    severity: "warning",
    eventEligibility: true,
    relatedPortIds: ["port-laem-chabang"],
    relatedVesselIds: [],
    updatedAt: "2026-10-10T01:00:00.000Z",
    fetchedAt: "2026-10-10T01:05:00.000Z",
    stale: false,
    sourceStatus: "healthy",
    weather: { riskSource: "official", alertState: "active", alertId: "CAP-001", alertRegion: "Bangkok, Chon Buri", ...weather },
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
  it("rule set: WR-S01..S05 + WR-O01/O02", () => {
    expect(listAllWeatherImpactRuleIds()).toEqual(["WR-S01", "WR-S02", "WR-S03", "WR-S04", "WR-S05", "WR-O01", "WR-O02"])
    expect(officialAlertImpactRules.map(r => r.id)).toEqual(["WR-O01", "WR-O02"])
  })

  describe("eligibility is fail-closed (missing / unknown / invalid => no impact)", () => {
    const cases: [string, Partial<FeedItem>, Record<string, unknown>, string][] = [
      ["non-official source", { sourceId: "open-meteo-marine" }, {}, "not_official_source"],
      ["source degraded", { sourceStatus: "degraded" }, {}, "source_status_invalid"],
      ["source failed", { sourceStatus: "failed" }, {}, "source_status_invalid"],
      ["source disabled", { sourceStatus: "disabled" }, {}, "source_status_invalid"],
      ["source status missing", { sourceStatus: undefined }, {}, "source_status_invalid"],
      ["stale", { stale: true }, {}, "stale"],
      ["stale missing", { stale: undefined }, {}, "stale"],
      ["eventEligibility false", { eventEligibility: false }, {}, "event_eligibility_not_true"],
      ["eventEligibility missing", { eventEligibility: undefined }, {}, "event_eligibility_not_true"],
      ["weather detail missing", { weather: undefined }, {}, "weather_detail_missing"],
      ["riskSource model", {}, { riskSource: "model" }, "risk_source_not_official"],
      ["alertState missing", {}, { alertState: undefined }, "alert_state_not_active"],
      ["alertState unknown", {}, { alertState: "unknown" }, "alert_state_not_active"],
      ["alertState expired", {}, { alertState: "expired" }, "alert_state_not_active"],
      ["severity invalid", { severity: "extreme" as never }, {}, "severity_invalid"],
      ["expiresAt unparseable", { expiresAt: "soon" }, {}, "expiry_invalid"],
      ["expiresAt in the past", { expiresAt: "2026-10-10T03:59:59.000Z" }, {}, "alert_expired"],
      ["alertExpiresAt in the past", {}, { alertExpiresAt: "2026-10-10T03:00:00.000Z" }, "alert_expired"],
    ]
    it.each(cases)("%s => %s and no hits", (_label, patch, weather, reason) => {
      const item = alert(patch, weather)
      expect(officialAlertIneligibility(item, NOW)).toBe(reason)
      expect(evaluateOfficialAlertImpactRules([item], TH)).toEqual([])
    })

    it("fully valid active alert is eligible", () => {
      expect(officialAlertIneligibility(alert(), NOW)).toBeUndefined()
    })
  })

  describe("wR-O01 official warning associated with the port", () => {
    it("hits with the official severity, potential/system, rule id and inputs", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ severity: "critical" })], { ...TH, majorCities: {} })
      expect(hits.map(h => h.ruleId)).toEqual(["WR-O01"])
      expectPotential(hits)
      expect(hits[0]).toMatchObject({ object: "shipping_port", severity: "critical", summaryZh: "以官方原文为准：Heavy rain warning" })
      expect(hits[0].inputValues).toMatchObject({ officialSourceId: "tmd", officialAlertId: "CAP-001" })
    })

    it("misses when the alert is not associated with the port", () => {
      expect(evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] })], { ...TH, majorCities: {} })).toEqual([])
    })
  })

  describe("wR-O02 delivery region: issuing country + structured coverage area + hazard", () => {
    it("positive: TMD (TH) heavy-rain alert whose coverage area lists Bangkok", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] })], TH)
      expectPotential(hits)
      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({ ruleId: "WR-O02", object: "delivery_region", severity: "warning" })
      expect(hits[0].inputValues).toMatchObject({ issuingCountry: "TH", matchedHazard: "rainstorm", matchedCity: "Bangkok", coverageField: "weather.alertRegion" })
    })

    it("positive: BMKG (ID) flood alert covering Jakarta", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ sourceId: "bmkg", title: "Peringatan banjir", summary: "", relatedPortIds: [] }, { alertRegion: "Jakarta; Bogor" })], { portId: "port-jakarta", countryCode: "ID", nowMs: NOW, majorCities: CITIES })
      expect(hits.map(h => [h.ruleId, h.inputValues.matchedHazard])).toEqual([["WR-O02", "flood"]])
    })

    it("negative: true coverage area does not include the city", () => {
      const hits = evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] }, { alertRegion: "Chon Buri, Rayong" })], TH)
      expect(hits).toEqual([])
    })

    it("negative: city only mentioned in title/summary, coverage area elsewhere", () => {
      const item = alert({ title: "Heavy rain warning near Bangkok", summary: "Rain spreading towards Bangkok.", relatedPortIds: [] }, { alertRegion: "Nan" })
      expect(evaluateOfficialAlertImpactRules([item], TH)).toEqual([])
    })

    it("negative: body says the city is not affected", () => {
      const item = alert({ summary: "Heavy rain in the east; Bangkok is not affected.", relatedPortIds: [] }, { alertRegion: "Chanthaburi, Trat" })
      expect(evaluateOfficialAlertImpactRules([item], TH)).toEqual([])
    })

    it("negative: coverage area missing", () => {
      expect(evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] }, { alertRegion: undefined })], TH)).toEqual([])
    })

    it("negative: cross-country source (BMKG alert evaluated for a Thai port)", () => {
      const item = alert({ sourceId: "bmkg", relatedPortIds: [] }, { alertRegion: "Bangkok" })
      expect(evaluateOfficialAlertImpactRules([item], TH)).toEqual([])
    })

    it("negative: issuing country unresolvable (aggregate source id)", () => {
      expect(officialAlertSourceCountry["official-weather-alerts"]).toBeUndefined()
      const item = alert({ sourceId: "official-weather-alerts", relatedPortIds: [] })
      expect(evaluateOfficialAlertImpactRules([item], TH)).toEqual([])
    })

    it("negative: port country unknown", () => {
      expect(evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] })], { ...TH, countryCode: undefined })).toEqual([])
    })

    it("negative: hazard not rainstorm/flood/tropical cyclone", () => {
      const item = alert({ title: "Extreme heat advisory", summary: "", relatedPortIds: [] })
      expect(evaluateOfficialAlertImpactRules([item], TH)).toEqual([])
    })

    it("shipped config (empty by user decision) cannot fire", () => {
      expect(deliveryMajorCities).toEqual({})
      expect(evaluateOfficialAlertImpactRules([alert({ relatedPortIds: [] })], { ...TH, majorCities: undefined })).toEqual([])
    })
  })
})

describe("r1.5-3 rules never produce an implemented / port-closed state", () => {
  it("an alert that says the port is closed still yields only a potential impact", () => {
    const closed = alert({ title: "Typhoon: port closed, operations suspended", summary: "港口关闭 已停工 已封港", severity: "critical" }, { alertRegion: "Bangkok" })
    const hits = evaluateOfficialAlertImpactRules([closed], TH)
    expect(hits.map(h => h.ruleId)).toEqual(["WR-O01", "WR-O02"])
    expectPotential(hits)
    for (const hit of hits) expect(JSON.stringify(hit)).not.toMatch(/"status":"(implemented|enacted|closed)"/)
  })

  it("all automatic rules only emit potential, even at extreme inputs", () => {
    const forecast = evaluateWeatherImpactRules({ windGustMs: 60, waveHeightM: 12, visibilityM: 10, precipitationMm24h: 900, typhoonDistanceKm: 0 })
    const official = evaluateOfficialAlertImpactRules([alert({ severity: "critical" })], TH)
    const all = [...forecast, ...official]
    expect(new Set(all.map(h => h.ruleId))).toEqual(new Set(listAllWeatherImpactRuleIds()))
    expect(() => assertNoImplementedWeatherImpact(all)).not.toThrow()
  })

  it("the guard rejects a forged implemented status", () => {
    const forged = { ...evaluateWeatherImpactRules({ windGustMs: 30 })[0], status: "implemented" } as unknown as WeatherImpactRuleHit
    expect(() => assertNoImplementedWeatherImpact([forged])).toThrow(/non-potential/)
  })
})
