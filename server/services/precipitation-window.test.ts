import { describe, expect, it } from "vitest"
import { precipitation24hEndingAt } from "./precipitation-window"

describe("precipitation24hEndingAt", () => {
  it("sums hourly samples within real 24h window (non-index-based)", () => {
    const end = "2026-08-15T12:30:00.000Z"
    const samples = [
      { timestamp: "2026-08-14T12:31:00.000Z", precipitationMm: 10, horizon: "hourly" as const },
      { timestamp: "2026-08-15T11:00:00.000Z", precipitationMm: 40, horizon: "hourly" as const },
      { timestamp: "2026-08-15T12:00:00.000Z", precipitationMm: 50, horizon: "hourly" as const },
      { timestamp: "2026-08-15T12:30:00.000Z", precipitationMm: 999, horizon: "hourly" as const },
    ]
    expect(precipitation24hEndingAt(samples, end)).toBe(1099)
    expect(precipitation24hEndingAt(samples.slice(0, 3), end)).toBe(100)
  })

  it("prefers hourly over current for duplicate timestamps", () => {
    const samples = [
      { timestamp: "2026-08-15T12:00:00.000Z", precipitationMm: 60, horizon: "current" as const },
      { timestamp: "2026-08-15T12:00:00.000Z", precipitationMm: 40, horizon: "hourly" as const },
    ]
    expect(precipitation24hEndingAt(samples, "2026-08-15T12:00:00.000Z")).toBe(40)
  })

  it("ignores missing hours and returns undefined when no samples in window", () => {
    const samples = [
      { timestamp: "2026-08-10T00:00:00.000Z", precipitationMm: 200, horizon: "hourly" as const },
    ]
    expect(precipitation24hEndingAt(samples, "2026-08-15T12:00:00.000Z")).toBeUndefined()
  })

  it("hits WR-S05 boundary at exactly 100 mm", () => {
    const samples = Array.from({ length: 24 }, (_, index) => ({
      timestamp: new Date(Date.parse("2026-08-14T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(),
      precipitationMm: index === 23 ? 100 : 0,
      horizon: "hourly" as const,
    }))
    expect(precipitation24hEndingAt(samples, "2026-08-15T12:00:00.000Z")).toBe(100)
  })
})
