import type { Severity } from "@shared/shipping"

export interface WeatherImpactRuleConfig {
  id: string
  object: "shipping_port" | "delivery_region"
  when: WeatherImpactRuleWhen
  severity: Severity
  summaryZh: string
}

export interface WeatherImpactRuleWhen {
  windGustKmhGte?: number
  waveHeightMGte?: number
  visibilityMLt?: number
  precipitationMm24hGte?: number
  typhoonDistanceKmLte?: number
  any?: WeatherImpactRuleWhen[]
}

/** Plan §4.8 initial thresholds — calibrate in R1.5-4 replay. */
export const weatherImpactRules: readonly WeatherImpactRuleConfig[] = [
  { id: "WR-S01", object: "shipping_port", when: { windGustKmhGte: 13.9 }, severity: "watch", summaryZh: "港口作业可能放缓" },
  { id: "WR-S02", object: "shipping_port", when: { any: [{ windGustKmhGte: 17.2 }, { waveHeightMGte: 2.5 }] }, severity: "warning", summaryZh: "靠离泊和装卸可能受限" },
  { id: "WR-S03", object: "shipping_port", when: { any: [{ windGustKmhGte: 24.5 }, { waveHeightMGte: 4 }, { typhoonDistanceKmLte: 300 }] }, severity: "critical", summaryZh: "可能停工或封港" },
  { id: "WR-S04", object: "shipping_port", when: { visibilityMLt: 1000 }, severity: "warning", summaryZh: "可能实施进出港管制" },
  { id: "WR-S05", object: "shipping_port", when: { precipitationMm24hGte: 100 }, severity: "warning", summaryZh: "堆场积水，作业可能放缓" },
]
