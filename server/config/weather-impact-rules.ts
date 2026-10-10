import type { Severity } from "@shared/shipping"

export interface WeatherImpactRuleConfig {
  id: string
  object: "shipping_port" | "delivery_region"
  when: WeatherImpactRuleWhen
  severity: Severity
  summaryZh: string
}

export interface WeatherImpactRuleWhen {
  /** Gust threshold in m/s (plan §4.8). */
  windGustMsGte?: number
  waveHeightMGte?: number
  visibilityMLt?: number
  precipitationMm24hGte?: number
  typhoonDistanceKmLte?: number
  any?: WeatherImpactRuleWhen[]
}

/** Plan §4.8 initial thresholds (m/s for wind). Official-warning rows: see `officialAlertImpactRules` below. */
export const weatherImpactRules: readonly WeatherImpactRuleConfig[] = [
  { id: "WR-S01", object: "shipping_port", when: { windGustMsGte: 13.9 }, severity: "watch", summaryZh: "港口作业可能放缓" },
  { id: "WR-S02", object: "shipping_port", when: { any: [{ windGustMsGte: 17.2 }, { waveHeightMGte: 2.5 }] }, severity: "warning", summaryZh: "靠离泊和装卸可能受限" },
  { id: "WR-S03", object: "shipping_port", when: { any: [{ windGustMsGte: 24.5 }, { waveHeightMGte: 4 }, { typhoonDistanceKmLte: 300 }] }, severity: "critical", summaryZh: "可能停工或封港" },
  { id: "WR-S04", object: "shipping_port", when: { visibilityMLt: 1000 }, severity: "warning", summaryZh: "可能实施进出港管制" },
  { id: "WR-S05", object: "shipping_port", when: { precipitationMm24hGte: 100 }, severity: "warning", summaryZh: "堆场积水，作业可能放缓" },
]

export const PLAN_WIND_GUST_MS = {
  wrS01: 13.9,
  wrS02: 17.2,
  wrS03: 24.5,
} as const

export function listWeatherImpactRuleIds(): string[] {
  return weatherImpactRules.map(rule => rule.id)
}

export type OfficialAlertHazard = "rainstorm" | "flood" | "tropical_cyclone"

export interface OfficialAlertImpactRuleConfig {
  id: string
  kind: "official_alert_port" | "official_alert_delivery_region"
  object: "shipping_port" | "delivery_region"
  /** WR-O02 only: hazards named by plan §4.8 (暴雨 / 洪水 / 热带气旋). */
  hazards: readonly OfficialAlertHazard[]
  summaryZh: string
}

/**
 * Plan §4.8 official-warning rows. Severity is always the official warning's level; the impact stays
 * "potential" (⚙ judgement) with the official alert attached as 🏛 basis.
 */
export const officialAlertImpactRules: readonly OfficialAlertImpactRuleConfig[] = [
  { id: "WR-O01", kind: "official_alert_port", object: "shipping_port", hazards: [], summaryZh: "以官方原文为准：{title}" },
  { id: "WR-O02", kind: "official_alert_delivery_region", object: "delivery_region", hazards: ["rainstorm", "flood", "tropical_cyclone"], summaryZh: "⚙ 潜在影响：该地区派送可能受影响（依据为 🏛 官方预警）" },
]

/** Keyword classifier for the hazard named in an official alert (title/summary/region; case-insensitive). */
export const officialAlertHazardKeywords: Readonly<Record<OfficialAlertHazard, readonly string[]>> = {
  rainstorm: ["heavy rain", "rainstorm", "torrential rain", "暴雨", "hujan lebat", "hujan sangat lebat", "mưa lớn", "ฝนตกหนัก"],
  flood: ["flood", "洪水", "banjir", "lũ", "ngập", "น้ำท่วม"],
  tropical_cyclone: ["tropical cyclone", "typhoon", "tropical storm", "tropical depression", "台风", "热带气旋", "siklon tropis", "bão", "áp thấp nhiệt đới", "พายุ"],
}

/**
 * Issuing country of each official-alert source, from docs/intel-source-catalog.md (TH-W01 TMD, ID-W01 BMKG,
 * XX-W01 JMA). The aggregate id "official-weather-alerts" has no single country and is unresolvable on purpose.
 */
export const officialAlertSourceCountry: Readonly<Record<string, string>> = {
  tmd: "TH",
  bmkg: "ID",
  jma: "JP",
}

/**
 * WR-O02 "major cities" per country. Plan §4.8 does not enumerate them and last-mile cities are out of scope
 * this round. Kept EMPTY by user decision: user guoyong lai, Grok Bot chat, 2026-10-10 12:21 UTC+8, original
 * words "先保持空值", in reply to whether to provide the WR-O02 major-city list or keep it empty.
 * Mapping alert coverage areas (official area names / codes) to cities is still pending. With this config
 * WR-O02 cannot fire in production; it is verified by fixtures only.
 */
export const deliveryMajorCities: Readonly<Record<string, readonly string[]>> = {}
