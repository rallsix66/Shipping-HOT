import { describe, expect, it } from "vitest"
import { PRECIP_24H_MIN_HOURLY_SAMPLES, precipitation24hEndingAt, precipitation24hEndingAtDetailed } from "./precipitation-window"

describe("precipitation24hEndingAt", () => {
  it("sums hourly samples within real 24h window (non-index-based)", () => {
    const end = "2026-08-15T12:30:00.000Z"
    const samples = [
      { timestamp: "2026-08-14T12:31:00.000Z", precipitationMm: 10, horizon: "hourly" as const },
      { timestamp: "2026-08-15T11:00:00.000Z", precipitationMm: 40, horizon: "hourly" as const },
      { timestamp: "2026-08-15T12:00:00.000Z", precipitationMm: 50, horizon: "hourly" as const },
      { timestamp: "2026-08-15T12:30:00.000Z", precipitationMm: 999, horizon: "hourly" as const },
    ]
    expect(precipitation24hEndingAt(samples, end)).toBeUndefined()
    const dense = Array.from({ length: PRECIP_24H_MIN_HOURLY_SAMPLES }, (_, index) => ({
      timestamp: new Date(Date.parse("2026-08-14T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(),
      precipitationMm: index < PRECIP_24H_MIN_HOURLY_SAMPLES - 1 ? 0 : 100,
      horizon: "hourly" as const,
    }))
    expect(precipitation24hEndingAt(dense, "2026-08-15T12:00:00.000Z")).toBe(100)
  })

  it("does not double-count current overlap (99 mm stays 99, not 101)", () => {
    const end = "2026-08-15T12:00:00.000Z"
    const hourly = Array.from({ length: PRECIP_24H_MIN_HOURLY_SAMPLES }, (_, index) => ({
      timestamp: new Date(Date.parse("2026-08-14T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(),
      precipitationMm: index === PRECIP_24H_MIN_HOURLY_SAMPLES - 1 ? 99 : 0,
      horizon: "hourly" as const,
    }))
    const withCurrent = [
      ...hourly,
      { timestamp: end, precipitationMm: 2, horizon: "current" as const },
    ]
    expect(precipitation24hEndingAt(withCurrent, end)).toBe(99)
  })

  it("returns undefined when hourly coverage is sparse inside 24h", () => {
    const samples = [
      { timestamp: "2026-08-15T11:00:00.000Z", precipitationMm: 200, horizon: "hourly" as const },
    ]
    const detailed = precipitation24hEndingAtDetailed(samples, "2026-08-15T12:00:00.000Z")
    expect(detailed.coverageSufficient).toBe(false)
    expect(detailed.totalMm).toBeUndefined()
  })

  it("hits WR-S05 boundary at exactly 100 mm with full hourly coverage", () => {
    const samples = Array.from({ length: PRECIP_24H_MIN_HOURLY_SAMPLES }, (_, index) => ({
      timestamp: new Date(Date.parse("2026-08-14T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(),
      precipitationMm: index === PRECIP_24H_MIN_HOURLY_SAMPLES - 1 ? 100 : 0,
      horizon: "hourly" as const,
    }))
    expect(precipitation24hEndingAt(samples, "2026-08-15T12:00:00.000Z")).toBe(100)
  })
})
