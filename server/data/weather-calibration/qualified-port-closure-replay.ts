import type { PortClosureReplayEvent, ReplayWeatherSample } from "@shared/weather-impact"

/**
 * R1.5-4 real replay corpus. Every row must pass C1–C8 admission (`runR15_4Replay`); admission validates
 * fields/consistency only and cannot prove source content is true. Do not add rows without source review.
 *
 * 2026-10-12: ONLY `2022-nalgae-shekou-gate` entered as a post-hoc single-event consistency trial
 * (dots ts 1791787171.126289). One event < 10 → status stays BLOCKED; not evidence of predictive ability.
 * Source record: docs/evidence/r1-5-4-nalgae-source-record-2026-10-12.md
 */

/** Project representative point for CNSHK (shared/shipping-fixtures.ts portWeatherConfig["port-shekou"]); not an official terminal point. */
export const NALGAE_SHEKOU_POINT = { label: "CNSHK project representative point (port-shekou)", latitude: 22.48, longitude: 113.91 } as const

const HKO_NALGAE_URL = "https://www.weather.gov.hk/en/publica/tc/tc2022/six_hrly_data_nalgae.html"

/**
 * HKO six-hourly best track fixes (UTC, original coordinates) inside the closure window — all nine, none omitted,
 * no interpolation. Last fix 2022-11-03T00:00Z; after that the table only lists "Dissipated" with no further fix or
 * explicit dissipation time. Centre "Estimated maximum surface winds" are deliberately NOT mapped (never a port gust).
 * distanceKm = haversine(fix, NALGAE_SHEKOU_POINT), R = 6371 km, rounded to 0.1 km (recomputed in tests).
 */
export const NALGAE_HKO_FIXES_IN_WINDOW: readonly { atUtc: string, latitude: number, longitude: number, distanceKm: number }[] = [
  { atUtc: "2022-11-01T00:00:00Z", latitude: 18.7, longitude: 116.0, distanceKm: 473.3 },
  { atUtc: "2022-11-01T06:00:00Z", latitude: 19.2, longitude: 115.8, distanceKm: 414.2 },
  { atUtc: "2022-11-01T12:00:00Z", latitude: 19.8, longitude: 115.7, distanceKm: 351.1 },
  { atUtc: "2022-11-01T18:00:00Z", latitude: 20.2, longitude: 115.5, distanceKm: 302.3 },
  { atUtc: "2022-11-02T00:00:00Z", latitude: 20.5, longitude: 115.3, distanceKm: 263.0 },
  { atUtc: "2022-11-02T06:00:00Z", latitude: 21.1, longitude: 115.0, distanceKm: 190.3 },
  { atUtc: "2022-11-02T12:00:00Z", latitude: 21.6, longitude: 114.6, distanceKm: 121.0 },
  { atUtc: "2022-11-02T18:00:00Z", latitude: 22.1, longitude: 113.9, distanceKm: 42.3 },
  { atUtc: "2022-11-03T00:00:00Z", latitude: 22.2, longitude: 113.3, distanceKm: 70.0 },
]

const nalgaeSamples: ReplayWeatherSample[] = NALGAE_HKO_FIXES_IN_WINDOW.map(f => ({
  atUtc: f.atUtc,
  inputs: { typhoonDistanceKm: f.distanceKm },
  provenance: {
    productId: "hko-best-track-six-hourly",
    productApproved: true,
    source: `XX-W06 HKO best track (post-hoc offline replay only, user-approved 2026-10-12 14:05 UTC+8); fetched ${HKO_NALGAE_URL}`,
    kind: "derived_distance",
    locationLabel: NALGAE_SHEKOU_POINT.label,
    latitude: NALGAE_SHEKOU_POINT.latitude,
    longitude: NALGAE_SHEKOU_POINT.longitude,
    units: { typhoonDistanceKm: "km" },
    derivation: {
      method: "haversine",
      earthRadiusKm: 6371,
      fixLatitude: f.latitude,
      fixLongitude: f.longitude,
      fixKind: "post_analysis",
      fixSourceUrl: HKO_NALGAE_URL,
      officialPageId: "HKO Tropical Cyclones in 2022 – six-hourly position and intensity data of Nalgae (2222), /en/publica/tc/tc2022/six_hrly_data_nalgae.html",
      interpolated: false,
    },
  },
}))

export const qualifiedPortClosureReplayEvents: readonly PortClosureReplayEvent[] = [
  {
    eventId: "2022-nalgae-shekou-gate",
    weatherSystemId: "TC-2222-NALGAE",
    portUnlocode: "CNSHK",
    // Gate pickup/drop-off only — NOT a port-wide shutdown, berthing, or pilotage suspension.
    operationScope: "SCT/CCT/MCT terminal gate container pickup/drop-off (交提箱) only",
    stopSource: {
      url: "https://www.portshekou.com/ywgg/1200",
      publisher: "operator",
      quote: "SCT，CCT，MCT码头闸口将于11月01日07时00分停止所有交、提箱服务。",
      archivedSha256: "356a5ee06326db67ceccb8cccbad7c2f1190d62b8ae4f231dfc0ed3b4edcee9e",
      hashes: [
        { kind: "fetch_raw_pre_redaction", sha256: "af36144c5844950122d8aa6c19592ea6867c15b8cea12c621d4acb623f62f36e" },
        { kind: "archive_git_blob_redacted", sha256: "356a5ee06326db67ceccb8cccbad7c2f1190d62b8ae4f231dfc0ed3b4edcee9e" },
      ],
    },
    resumeSource: {
      url: "https://www.portshekou.com/ywgg/1199",
      publisher: "operator",
      quote: "SCT，CCT，MCT将于11月03日14时全面恢复交提箱服务。",
      archivedSha256: "5fd4c4e6f3130ab585579ce106ecb068f896bbf1ad35e39c30e0f30070f6bc95",
      hashes: [
        { kind: "fetch_raw_pre_redaction", sha256: "885a7932e7315c365711f5f96241e16ec517f8b751d8f8b3ecccb61c59a0fee1" },
        { kind: "archive_git_blob_redacted", sha256: "5fd4c4e6f3130ab585579ce106ecb068f896bbf1ad35e39c30e0f30070f6bc95" },
      ],
    },
    timeZoneBasis: {
      statedOffset: null,
      inferredOffset: "UTC+8",
      inferenceReason: "Notices give no zone; publisher is the local Shenzhen terminal operator addressing local truck drivers, and the concurrent Shenzhen observatory signal times are local (UTC+8). Inference, not stated in source.",
      ambiguous: false,
    },
    closureStartUtc: "2022-10-31T23:00:00Z",
    closureEndUtc: "2022-11-03T06:00:00Z",
    samples: nalgaeSamples,
  },
]

export const R1_5_4_REQUIRED_QUALIFIED_SAMPLES = 10

/** Plan R1.5-4: replay must meet this rate before acceptance; sample count alone does not PASS. */
export const R1_5_4_MIN_HIT_RATE = 0.8
