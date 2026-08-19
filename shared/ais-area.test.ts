import { describe, expect, it } from "vitest"
import { AIS_AREA_BUCKET_MS, aggregateAisPortMetric, assignAisAreaObservation, getPortAisAreaConfig, normalizeAisAreaPositionReport, portAisAreaConfig, pruneAisAreaObservations } from "./ais-area"

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
    const current = observation("1", { sourceUpdatedAt: undefined, fetchedAt: "2026-08-19T00:14:00.000Z" })
    const expired = observation("2", { fetchedAt: "2026-08-18T23:59:00.000Z", sourceUpdatedAt: undefined })
    expect(pruneAisAreaObservations([current, expired], "2026-08-19T00:15:00.000Z")).toEqual([current])
  })

  it("does not promote fetchedAt into sourceUpdatedAt", () => {
    const metric = aggregateAisPortMetric(config, [observation("1", { sourceUpdatedAt: undefined, fetchedAt: "2026-08-19T10:00:00.000Z" })], { now: "2026-08-19T10:00:00.000Z", minimumSampleSize: 1 })
    expect(metric).toMatchObject({ updatedAt: "2026-08-19T10:00:00.000Z", fetchedAt: "2026-08-19T10:00:00.000Z" })
    expect(metric.sourceUpdatedAt).toBeUndefined()
  })

  it("keeps the latest reliable source timestamp separate from local fetch time", () => {
    const metric = aggregateAisPortMetric(config, [
      observation("1", { sourceUpdatedAt: "2026-08-19T09:59:50.000Z", fetchedAt: "2026-08-19T10:00:00.000Z" }),
      observation("2", { sourceUpdatedAt: undefined, fetchedAt: "2026-08-19T10:00:05.000Z" }),
    ], { now: "2026-08-19T10:00:05.000Z", minimumSampleSize: 1 })
    expect(metric).toMatchObject({ updatedAt: "2026-08-19T09:59:50.000Z", sourceUpdatedAt: "2026-08-19T09:59:50.000Z", fetchedAt: "2026-08-19T10:00:05.000Z" })
    expect(metric.observationWindow).toEqual({ startAt: "2026-08-19T09:59:50.000Z", endAt: "2026-08-19T10:00:05.000Z" })
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

  it("requires three consecutive real five-minute buckets before the Event layer can act", () => {
    const at = (minutes: number) => new Date(Date.parse(observedAt) + minutes * 60 * 1000).toISOString()
    const sample = (timestamp: string, stationary: number, size = 5) => Array.from({ length: size }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: timestamp, navigationStatus: index < stationary ? "anchored" : "under_way" }))
    const base = aggregateAisPortMetric(config, sample(at(0), 1), { now: at(0), minimumSampleSize: 5 })
    const risingOne = aggregateAisPortMetric(config, sample(at(5), 2), { now: at(5), previous: base, minimumSampleSize: 5 })
    const risingTwo = aggregateAisPortMetric(config, sample(at(10), 3), { now: at(10), previous: risingOne, minimumSampleSize: 5 })
    const risingThree = aggregateAisPortMetric(config, sample(at(15), 4), { now: at(15), previous: risingTwo, minimumSampleSize: 5 })
    expect(risingOne).toMatchObject({ trend: "rising", consecutiveRisingWindows: 1 })
    expect(risingTwo).toMatchObject({ trend: "rising", consecutiveRisingWindows: 2 })
    expect(risingThree).toMatchObject({ trend: "rising", consecutiveRisingWindows: 3 })
  })

  it("does not increment inside the same bucket", () => {
    const at = (minutes: number) => new Date(Date.parse(observedAt) + minutes * 60 * 1000).toISOString()
    const base = aggregateAisPortMetric(config, [observation("1", { sourceUpdatedAt: undefined, fetchedAt: at(0), navigationStatus: "under_way" }), observation("2", { sourceUpdatedAt: undefined, fetchedAt: at(0), navigationStatus: "under_way" })], { now: at(0), minimumSampleSize: 1 })
    const rising = aggregateAisPortMetric(config, [observation("1", { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: "anchored" }), observation("2", { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: "under_way" })], { now: at(5), previous: base, minimumSampleSize: 1 })
    const repeated = aggregateAisPortMetric(config, [observation("1", { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: "anchored" }), observation("2", { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: "under_way" })], { now: at(5), previous: rising, minimumSampleSize: 1 })
    expect(rising).toMatchObject({ bucketStartedAt: at(5), consecutiveRisingWindows: 1 })
    expect(repeated).toMatchObject({ trend: "rising", consecutiveRisingWindows: 1 })
  })

  it("resets after a bucket gap, stale previous metric or insufficient current sample", () => {
    const at = (minutes: number) => new Date(Date.parse(observedAt) + minutes * 60 * 1000).toISOString()
    const previous = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(0), navigationStatus: index < 2 ? "anchored" : "under_way" })), { now: at(0), minimumSampleSize: 5 })
    const gap = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(15), navigationStatus: index < 3 ? "anchored" : "under_way" })), { now: at(15), previous, minimumSampleSize: 5 })
    const stale = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: index < 3 ? "anchored" : "under_way" })), { now: at(5), previous: { ...previous, stale: true }, minimumSampleSize: 5 })
    const insufficient = aggregateAisPortMetric(config, Array.from({ length: 4 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: "anchored" })), { now: at(5), previous, minimumSampleSize: 5 })
    const restarted = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(0), navigationStatus: index < 3 ? "anchored" : "under_way" })), { now: at(0), previous: { ...previous, bucketStartedAt: "2026-08-18T22:00:00.000Z", bucketEndedAt: "2026-08-18T22:05:00.000Z", trend: "rising", consecutiveRisingWindows: 2 }, minimumSampleSize: 5 })
    expect(gap).toMatchObject({ trend: "unknown", consecutiveRisingWindows: 0 })
    expect(stale).toMatchObject({ trend: "unknown", consecutiveRisingWindows: 0 })
    expect(insufficient).toMatchObject({ coverage: "insufficient_samples", trend: "unknown", consecutiveRisingWindows: 0 })
    expect(restarted).toMatchObject({ trend: "unknown", consecutiveRisingWindows: 0 })
    expect(AIS_AREA_BUCKET_MS).toBe(300000)
  })

  it("uses stationary count so sample shrink cannot create a false rising trend", () => {
    const at = (minutes: number) => new Date(Date.parse(observedAt) + minutes * 60 * 1000).toISOString()
    const previous = aggregateAisPortMetric(config, Array.from({ length: 10 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(0), navigationStatus: index < 2 ? "anchored" : "under_way" })), { now: at(0), minimumSampleSize: 5 })
    const current = aggregateAisPortMetric(config, Array.from({ length: 6 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: index < 2 ? "anchored" : "under_way" })), { now: at(5), previous, minimumSampleSize: 5 })
    expect(current).toMatchObject({ stationaryRatio: 1 / 3, anchoredCount: 2, trend: "stable", consecutiveRisingWindows: 0 })
  })

  it("marks stationary count rise and fall as rising and falling", () => {
    const at = (minutes: number) => new Date(Date.parse(observedAt) + minutes * 60 * 1000).toISOString()
    const previous = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(0), navigationStatus: index < 2 ? "anchored" : "under_way" })), { now: at(0), minimumSampleSize: 5 })
    const rising = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(5), navigationStatus: index < 3 ? "anchored" : "under_way" })), { now: at(5), previous, minimumSampleSize: 5 })
    const falling = aggregateAisPortMetric(config, Array.from({ length: 5 }, (_, index) => observation(String(index), { sourceUpdatedAt: undefined, fetchedAt: at(10), navigationStatus: index < 2 ? "anchored" : "under_way" })), { now: at(10), previous: rising, minimumSampleSize: 5 })
    expect(rising).toMatchObject({ trend: "rising", consecutiveRisingWindows: 1 })
    expect(falling).toMatchObject({ trend: "falling", consecutiveRisingWindows: 0 })
  })
})
