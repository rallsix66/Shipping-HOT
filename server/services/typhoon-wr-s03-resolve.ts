import type { TropicalCycloneSyncMeta } from "@shared/shipping"
import type { TyphoonInputState } from "#/services/weather-rule-coverage"
import { TYPHOON_NO_STORM_DISTANCE_KM } from "#/services/weather-rule-coverage"
import { isJmaTyphoonSyncTrustworthyForWrS03 } from "#/services/tropical-cyclone-freshness"
import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import { type PortCoordinate, filterActiveCyclonesForRules, minTyphoonDistanceKmForPortInInterval } from "#/services/tropical-cyclone-display"

/** Freshness uses evaluation `now`; distance uses impact interval only. */
export function resolveTyphoonInputForImpactInterval(
  sync: TropicalCycloneSyncMeta,
  cyclones: readonly NormalizedTropicalCyclone[],
  port: PortCoordinate,
  validFrom: string,
  validUntil: string,
  evaluationNowMs: number,
): TyphoonInputState {
  if (!isJmaTyphoonSyncTrustworthyForWrS03(sync, evaluationNowMs)) {
    return { status: "unavailable" }
  }
  if (sync.outcome === "ok_empty") {
    return { status: "checked", distanceKm: TYPHOON_NO_STORM_DISTANCE_KM }
  }
  const fromMs = Date.parse(validFrom)
  const untilMs = Date.parse(validUntil)
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) {
    return { status: "unavailable" }
  }
  const active = filterActiveCyclonesForRules(cyclones)
  const distanceKm = minTyphoonDistanceKmForPortInInterval(active, port, fromMs, untilMs, true)
  if (distanceKm === undefined) {
    return { status: "unavailable" }
  }
  return { status: "checked", distanceKm }
}
