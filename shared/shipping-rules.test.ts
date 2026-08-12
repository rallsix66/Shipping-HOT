import { describe, expect, it } from "vitest"
import { calculateDelayMinutes, reconcileEvent, statusDurationMinutes, updateVesselStatus } from "./shipping-rules"
import { mockEvents, mockVessels } from "./shipping-fixtures"

describe("Shipping HOT deterministic rules", () => {
  it("calculates ETA delay and keeps unknown values unknown", () => {
    expect(calculateDelayMinutes("2026-01-01T00:00:00.000Z", "2026-01-01T02:00:00.000Z")).toBe(120)
    expect(calculateDelayMinutes(undefined, "2026-01-01T02:00:00.000Z")).toBeUndefined()
  })

  it("updates statusChangedAt only when navigation status changes", () => {
    const vessel = mockVessels[0]
    const same = updateVesselStatus(vessel, { navigationStatus: vessel.navigationStatus }, "2026-01-01T00:00:00.000Z")
    const changed = updateVesselStatus(vessel, { navigationStatus: "under_way" }, "2026-01-01T00:00:00.000Z")
    expect(same.statusChangedAt).toBe(vessel.statusChangedAt)
    expect(changed.statusChangedAt).toBe("2026-01-01T00:00:00.000Z")
  })

  it("calculates anchored duration from statusChangedAt", () => {
    expect(statusDurationMinutes({ statusChangedAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-01-01T02:00:00.000Z"))).toBe(120)
  })

  it("deduplicates recurring events and resolves them explicitly", () => {
    const event = mockEvents[0]
    const { id: _id, firstDetectedAt: _first, lastDetectedAt: _last, resolvedAt: _resolved, ...incoming } = event
    const update = reconcileEvent(event, { ...incoming, status: "active" }, "2026-01-01T03:00:00.000Z")
    expect(update.id).toBe(event.id)
    expect(update.firstDetectedAt).toBe(event.firstDetectedAt)
    expect(update.lastDetectedAt).toBe("2026-01-01T03:00:00.000Z")
    const { id: _updateId, firstDetectedAt: _updateFirst, lastDetectedAt: _updateLast, resolvedAt: _updateResolved, ...resolvedIncoming } = update
    const resolved = reconcileEvent(update, { ...resolvedIncoming, status: "resolved" }, "2026-01-01T04:00:00.000Z")
    expect(resolved.status).toBe("resolved")
    expect(resolved.resolvedAt).toBe("2026-01-01T04:00:00.000Z")
  })
})
