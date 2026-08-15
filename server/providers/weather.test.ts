import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { createOpenMeteoWeatherProvider } from "./shipping"

function weatherPayload(url: string, severe = true) {
  const times = Array.from({ length: 169 }, (_, index) => new Date(Date.parse("2026-08-15T00:00:00.000Z") + index * 60 * 60 * 1000).toISOString())
  const wave = times.map((_, index) => severe ? index < 25 ? 1 : index < 73 ? 3 : 4.5 : 1)
  const wind = times.map((_, index) => severe ? index < 25 ? 20 : index < 73 ? 50 : 70 : 20)
  return url.includes("marine-api")
    ? { current: { time: times[0], wave_height: 1, wave_direction: 90, swell_wave_height: 1, swell_wave_direction: 180, swell_wave_period: 8 }, hourly: { time: times, wave_height: wave, wave_direction: times.map(() => 90), swell_wave_height: times.map((_, index) => index < 25 ? 1 : index < 73 ? 2 : 3), swell_wave_direction: times.map(() => 180), swell_wave_period: times.map((_, index) => index < 25 ? 8 : index < 73 ? 10 : 12) } }
    : { current: { time: times[0], wind_speed_10m: 20, wind_gusts_10m: 25 }, hourly: { time: times, wind_speed_10m: wind, wind_gusts_10m: wind.map(value => value + 5) } }
}

describe("open-meteo weather intelligence", () => {
  it("normalizes independent 24-hour, 72-hour and 7-day windows with directions", async () => {
    const provider = createOpenMeteoWeatherProvider({ fetcher: async url => ({ ok: true, status: 200, json: async () => weatherPayload(url) }) })
    const [item] = await provider.getFeedItems([mockPorts[0]])
    expect(item).toMatchObject({
      severity: "critical",
      title: "Shekou 未来 7 天天气严重",
      weather: { riskSource: "model", forecastWindowHours: 72, forecastStartAt: "2026-08-15T00:00:00.000Z", forecastEndAt: "2026-08-18T00:00:00.000Z", waveHeightM: 3, waveDirectionDeg: 90, swellWaveHeightM: 2, swellDirectionDeg: 180, swellPeriodSeconds: 10, windGustKmh: 55, windows: { h24: { severity: "info" }, h72: { severity: "warning" }, d7: { severity: "critical" } } },
      tags: ["model", "weather_risk"],
    })
  })

  it("uses a TTL cache and keeps one failed port stale without dropping another port", async () => {
    let now = new Date("2026-08-15T00:00:00.000Z")
    let failShekou = false
    let requests = 0
    const provider = createOpenMeteoWeatherProvider({
      now: () => now,
      minIntervalMs: 30 * 60 * 1000,
      fetcher: async (url) => {
        requests += 1
        if (failShekou && url.includes("22.48")) return { ok: false, status: 503, json: async () => ({}) }
        return { ok: true, status: 200, json: async () => weatherPayload(url) }
      },
    })
    const first = await provider.getFeedItems([mockPorts[0], mockPorts[1]])
    const firstRequestCount = requests
    const cached = await provider.getFeedItems([mockPorts[0], mockPorts[1]], first)
    expect(requests).toBe(firstRequestCount)
    expect(cached).toHaveLength(first.length)
    now = new Date("2026-08-15T01:00:00.000Z")
    failShekou = true
    const retried = await provider.getFeedItems([mockPorts[0], mockPorts[1]], first)
    expect(retried.find(item => item.relatedPortIds.includes("port-shekou"))).toMatchObject({ stale: true, sourceStatus: "failed", error: "Open-Meteo marine request failed (503)" })
    expect(retried.find(item => item.relatedPortIds.includes("port-yantian"))).toMatchObject({ stale: false, sourceStatus: "healthy" })
  })
})
