import type { FeedItem, Severity } from "@shared/shipping"
import type { WeatherImpactRuleHit } from "@shared/weather-impact"
import { isOfficialWeatherAlertFeedItem } from "#/providers/shipping"
import {
  type OfficialAlertHazard,
  type OfficialAlertImpactRuleConfig,
  deliveryMajorCities,
  officialAlertHazardKeywords,
  officialAlertImpactRules,
} from "#/config/weather-impact-rules"

/**
 * Plan §4.8 official-warning rows (WR-O01 any official warning hit; WR-O02 delivery-region warning).
 * Outputs are always status "potential" with provenance "system" for the judgement; the official alert itself
 * is attached as `officialBasis` (provenance "official"). Nothing in an alert's text can upgrade the status to
 * implemented/port-closed — that requires a separate official or operator notice, which rules never produce.
 */

export interface OfficialAlertImpactContext {
  /** Port the panel/evaluation is for (WR-O01 requires the alert to be associated with this port). */
  portId: string
  /** Country of the port; WR-O02 only uses major cities configured for this country. */
  countryCode?: string
  nowMs: number
  /** Override of the configured delivery major-city list (tests / future approved config). */
  majorCities?: Readonly<Record<string, readonly string[]>>
}

export type OfficialAlertIneligibleReason =
  | "not_official_source"
  | "stale"
  | "event_ineligible"
  | "alert_expired"
  | "alert_lifecycle_unknown"

/** Only current, official, lifecycle-known alerts may drive a potential impact. */
export function officialAlertIneligibility(item: FeedItem, nowMs: number): OfficialAlertIneligibleReason | undefined {
  if (!isOfficialWeatherAlertFeedItem(item)) return "not_official_source"
  if (item.stale) return "stale"
  if (item.eventEligibility === false) return "event_ineligible"
  if (item.weather?.alertState === "expired") return "alert_expired"
  if (item.weather?.alertState === "unknown") return "alert_lifecycle_unknown"
  if (item.expiresAt) {
    const expires = Date.parse(item.expiresAt)
    if (Number.isFinite(expires) && expires <= nowMs) return "alert_expired"
  }
  return undefined
}

function alertText(item: FeedItem): string {
  return [item.title, item.summary, item.weather?.alertRegion].filter(Boolean).join(" \n ").toLowerCase()
}

export function matchOfficialAlertHazard(item: FeedItem, hazards: readonly OfficialAlertHazard[]): OfficialAlertHazard | undefined {
  const text = alertText(item)
  return hazards.find(hazard => officialAlertHazardKeywords[hazard].some(keyword => text.includes(keyword.toLowerCase())))
}

function matchMajorCity(item: FeedItem, cities: readonly string[]): string | undefined {
  const text = alertText(item)
  return cities.find(city => city.trim().length > 0 && text.includes(city.toLowerCase()))
}

function hitFor(rule: OfficialAlertImpactRuleConfig, item: FeedItem, extra: Record<string, string>): WeatherImpactRuleHit {
  const severity: Severity = item.severity
  return {
    ruleId: rule.id,
    object: rule.object,
    // §4.8: level is taken from the official warning
    severity,
    status: "potential",
    provenance: "system",
    inputValues: {
      officialSourceId: item.sourceId,
      officialAlertId: item.weather?.alertId ?? item.id,
      officialSeverity: severity,
      ...extra,
    },
    summaryZh: rule.summaryZh.replace("{title}", item.title),
    officialBasis: {
      provenance: "official",
      sourceId: item.sourceId,
      alertId: item.weather?.alertId ?? item.id,
      title: item.title,
      sourceUrl: item.sourceUrl,
      severity,
      publishedAt: item.publishedAt,
      expiresAt: item.expiresAt,
    },
  }
}

export function evaluateOfficialAlertImpactRules(alerts: readonly FeedItem[], context: OfficialAlertImpactContext): WeatherImpactRuleHit[] {
  const hits: WeatherImpactRuleHit[] = []
  const cityConfig = context.majorCities ?? deliveryMajorCities
  const cities = context.countryCode ? cityConfig[context.countryCode] ?? [] : []
  for (const item of alerts) {
    if (officialAlertIneligibility(item, context.nowMs)) continue
    for (const rule of officialAlertImpactRules) {
      if (rule.kind === "official_alert_port") {
        if (!item.relatedPortIds.includes(context.portId)) continue
        hits.push(hitFor(rule, item, {}))
        continue
      }
      const hazard = matchOfficialAlertHazard(item, rule.hazards)
      if (!hazard) continue
      const city = matchMajorCity(item, cities)
      if (!city) continue
      hits.push(hitFor(rule, item, { matchedHazard: hazard, matchedCity: city }))
    }
  }
  return hits
}
