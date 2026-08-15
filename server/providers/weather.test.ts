import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { createOpenMeteoWeatherProvider } from "./shipping"

function weatherPayload(url: string, severe = true) {
  const times = ["2026-08-15T00:00:00.000Z", "2026-08-15T01:00:00.000Z", "2026-08-15T02:00:00.000Z"]
  return url.includes("marine-api")
    ? { current: { time: times[0], wave_height: 1, swell_wave_height: 1, swell_wave_period: 8 }, hourly: { time: times, wave_height: severe ? [1, 3, 4.5] : [1, 1, 1], swell_wave_height: [1, 2, 3], swell_wave_period: [8, 10, 12] } }
    : { current: { time: times[0], wind_speed_10m: 20, wind_gusts_10m: 25 }, hourly: { time: times, wind_speed_10m: severe ? [20, 50, 70] : [20, 20, 20], wind_gusts_10m: [25, 55, 75] } }
}

describe("open-meteo weather intelligence", () => {
  it("normalizes a future model-risk window with swell fields", async () => {
    const provider = createOpenMeteoWeatherProvider({ fetcher: async url => ({ ok: true, status: 200, json: async () => weatherPayload(url) }) })
    const [item] = await provider.getFeedItems([mockPorts[0]])
    expect(item).toMatchObject({
      severity: "critical",
      title: "Shekou 未来 72 小时天气严重",
      weather: { riskSource: "model", forecastWindowHours: 72, forecastStartAt: "2026-08-15T01:00:00.000Z", forecastEndAt: "2026-08-15T02:00:00.000Z", waveHeightM: 4.5, swellWaveHeightM: 3, swellPeriodSeconds: 12, windGustKmh: 75 },
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
