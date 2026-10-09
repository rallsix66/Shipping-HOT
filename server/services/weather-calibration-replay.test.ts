import { describe, expect, it } from "vitest"
import { replayAllPortClosureEvents } from "./weather-calibration-replay"
import { portClosureReplayEvents } from "#/data/weather-calibration/port-closure-replay-events"

describe("r1.5-4 historical port closure replay", () => {
  it("uses at least 10 sourced historical events (no synthetic-only set)", () => {
    expect(portClosureReplayEvents.length).toBeGreaterThanOrEqual(10)
    for (const event of portClosureReplayEvents) {
      expect(event.evidence.length).toBeGreaterThan(20)
      expect(event.closureStartUtc).toMatch(/^\d{4}-/)
    }
  })

  it("meets ≥80% rule hit rate against cited closure peaks (calibration gate)", () => {
    const { results, hitRate } = replayAllPortClosureEvents()
    if (hitRate < 0.8) {
      const misses = results.filter(r => !r.hit).map(r => r.eventId)
      expect.fail(`hit rate ${(hitRate * 100).toFixed(1)}% < 80%; misses: ${misses.join(", ")}`)
    }
    expect(hitRate).toBeGreaterThanOrEqual(0.8)
  })
})
