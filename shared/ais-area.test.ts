import { describe, expect, it } from "vitest"
import { aggregateAisPortMetric, assignAisAreaObservation, getPortAisAreaConfig, normalizeAisAreaPositionReport, portAisAreaConfig, pruneAisAreaObservations } from "./ais-area"

const config = getPortAisAreaConfig("port-shekou")!
const observedAt = "2026-08-19T00:00:00.000Z"

function observation(mmsi: string, overrides: Partial<ReturnType<typeof normalizeAisAreaPositionReport> & { portId: string, areaAmbiguous: boolean }> = {}) {
  return {
    mmsi,
    portId: "port-shekou",
    latitude: config.center.latitude,
    longitude: config.center.longitude,
    speed: 0.5,
    course: 10,
    navigationStatus: "anchored" as const,
    sourceUpdatedAt: observedAt,
    fetchedAt: observedAt,
    areaAmbiguous: false,
    ...overrides,
  }
}

describe("aIS area domain", () => {
  it("normalizes only valid PositionReport coordinates and preserves timestamp provenance", () => {
    const result = normalizeAisAreaPositionReport({
      MessageType: "PositionReport",
      MetaData: { MMSI: "477123400", time_utc: observedAt },
      Message: { PositionReport: { UserID: 477123400, Latitude: 22.48, Longitude: 113.91, Sog: 0.5, NavigationalStatus: 1 } },
    }, observedAt)
    expect(result).toMatchObject({ mmsi: "477123400", latitude: 22.48, longitude: 113.91, sourceUpdatedAt: observedAt, navigationStatus: "anchored" })
    expect(normalizeAisAreaPositionReport({ MessageType: "PositionReport", Message: { PositionReport: { UserID: 1, Latitude: 91, Longitude: 0 } } }, observedAt)).toBeUndefined()
    expect(normalizeAisAreaPositionReport({ MessageType: "ShipStaticData", Message: { PositionReport: { UserID: 1, Latitude: 0, Longitude: 0 } } }, observedAt)).toBeUndefined()
  })

  it("uses configured heuristic boxes and assigns overlap to the nearest center", () => {
    expect(config.boundarySource).toBe("configured_heuristic")
    const second = { ...config, portId: "port-nearby", center: { latitude: config.center.latitude + 0.01, longitude: config.center.longitude + 0.01 } }
    const assigned = assignAisAreaObservation(observation("1", { latitude: second.center.latitude, longitude: second.center.longitude }), [config, second])
    expect(assigned).toMatchObject({ portId: "port-nearby", areaAmbiguous: true })
    expect(Object.keys(portAisAreaConfig)).toHaveLength(8)
  })

  it("prunes observations by the fifteen-minute TTL", () => {
    const current = observation("1", { fetchedAt: "2026-08-19T00:14:00.000Z" })
    const expired = observation("2", { fetchedAt: "2026-08-18T23:59:00.000Z", sourceUpdatedAt: undefined })
    expect(pruneAisAreaObservations([current, expired], "2026-08-19T00:15:00.000Z")).toEqual([current])
  })

  it("marks insufficient samples unknown and counts stationary/ambiguous samples", () => {
    const metric = aggregateAisPortMetric(config, [observation("1"), observation("2", { navigationStatus: "moored", areaAmbiguous: true })], { now: observedAt })
    expect(metric).toMatchObject({ sampleSize: 2, activeVesselCount: 2, anchoredCount: 1, mooredCount: 1, lowSpeedCount: 2, ambiguousSampleCount: 1, coverage: "insufficient_samples", trend: "unknown" })
    expect(metric.stationaryRatio).toBe(1)
  })

  it("keeps only the latest observation for each MMSI", () => {
    const metric = aggregateAisPortMetric(config, [
      observation("1", { navigationStatus: "under_way", speed: 10, fetchedAt: "2026-08-19T00:00:00.000Z" }),
      observation("1", { navigationStatus: "anchored", speed: 0.2, fetchedAt: observedAt }),
    ], { now: observedAt, minimumSampleSize: 1 })
    expect(metric).toMatchObject({ sampleSize: 1, anchoredCount: 1, lowSpeedCount: 1, observationWindow: { endAt: observedAt } })
  })

  it("requires three consecutive rising windows before the Event layer can act", () => {
    const base = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { navigationStatus: "under_way", speed: 10 })), { now: observedAt, minimumSampleSize: 5 })
    const risingOne = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { navigationStatus: index < 2 ? "anchored" : "under_way" })), { now: observedAt, previous: base, minimumSampleSize: 5 })
    const risingTwo = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { navigationStatus: index < 3 ? "anchored" : "under_way" })), { now: observedAt, previous: risingOne, minimumSampleSize: 5 })
    const risingThree = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { navigationStatus: index < 4 ? "anchored" : "under_way" })), { now: observedAt, previous: risingTwo, minimumSampleSize: 5 })
    expect(risingOne).toMatchObject({ trend: "rising", consecutiveRisingWindows: 1 })
    expect(risingTwo).toMatchObject({ trend: "rising", consecutiveRisingWindows: 2 })
    expect(risingThree).toMatchObject({ trend: "rising", consecutiveRisingWindows: 3 })
  })
})
