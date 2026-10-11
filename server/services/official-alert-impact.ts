import type { FeedItem, Severity } from "@shared/shipping"
import type { WeatherImpactRuleHit } from "@shared/weather-impact"
import { isOfficialWeatherAlertFeedItem } from "#/providers/shipping"
import {
  type OfficialAlertHazard,
  type OfficialAlertImpactRuleConfig,
  deliveryMajorCities,
  officialAlertHazardKeywords,
  officialAlertImpactRules,
  officialAlertSourceCountry,
} from "#/config/weather-impact-rules"

/**
 * Plan §4.8 official-warning rows (WR-O01 any official warning associated with the port; WR-O02 delivery
 * region). Outputs are always status "potential" with provenance "system" for the judgement; the official
 * alert itself is attached as `officialBasis` (provenance "official"). Nothing in an alert's text can upgrade
 * the status to implemented/port-closed. Fail closed: any missing, unknown or invalid field means no impact.
 */

export interface OfficialAlertImpactContext {
  /** Port the evaluation is for (WR-O01 requires the alert to be associated with this port). */
  portId: string
  /** Country of the port; WR-O02 requires the alert's issuing country to equal it. */
  countryCode?: string
  nowMs: number
  /** Override of the configured delivery major-city list (tests / future approved config). */
  majorCities?: Readonly<Record<string, readonly string[]>>
}

export type OfficialAlertIneligibleReason =
  | "not_official_source"
  | "source_status_invalid"
  | "stale"
  | "event_eligibility_not_true"
  | "weather_detail_missing"
  | "risk_source_not_official"
  | "alert_state_not_active"
  | "severity_invalid"
  | "expiry_invalid"
  | "alert_expired"

const VALID_SEVERITIES: ReadonlySet<Severity> = new Set(["info", "watch", "warning", "critical"])

/** Only current, official, lifecycle-known alerts may drive a potential impact. Missing info => ineligible. */
export function officialAlertIneligibility(item: FeedItem, nowMs: number): OfficialAlertIneligibleReason | undefined {
  if (!isOfficialWeatherAlertFeedItem(item)) return "not_official_source"
  if (item.sourceStatus !== "healthy") return "source_status_invalid"
  if (item.stale !== false) return "stale"
  if (item.eventEligibility !== true) return "event_eligibility_not_true"
  if (!item.weather) return "weather_detail_missing"
  if (item.weather.riskSource !== "official") return "risk_source_not_official"
  if (item.weather.alertState !== "active") return "alert_state_not_active"
  if (!VALID_SEVERITIES.has(item.severity)) return "severity_invalid"
  for (const expiry of [item.expiresAt, item.weather.alertExpiresAt]) {
    if (expiry === undefined) continue
    const expires = Date.parse(expiry)
    if (!Number.isFinite(expires)) return "expiry_invalid"
    if (expires <= nowMs) return "alert_expired"
  }
  return undefined
}

function hazardText(item: FeedItem): string {
  return [item.title, item.summary].filter(Boolean).join(" \n ").toLowerCase()
}

export function matchOfficialAlertHazard(item: FeedItem, hazards: readonly OfficialAlertHazard[]): OfficialAlertHazard | undefined {
  const text = hazardText(item)
  return hazards.find(hazard => officialAlertHazardKeywords[hazard].some(keyword => text.includes(keyword.toLowerCase())))
}

/** Issuing country from the source catalog (sourceId). Aggregate/unknown sources are unresolvable. */
export function officialAlertIssuingCountry(item: FeedItem): string | undefined {
  return officialAlertSourceCountry[item.sourceId]
}

/**
 * Coverage comes ONLY from the structured area field (`weather.alertRegion`), split into area names and
 * compared exactly (case-insensitive). A city merely mentioned in title/summary is not coverage.
 */
export function officialAlertCoveredCity(item: FeedItem, cities: readonly string[]): string | undefined {
  const region = item.weather?.alertRegion
  if (!region) return undefined
  const areas = new Set(region.split(/[,;|/\n]+/).map(part => part.trim().toLowerCase()).filter(Boolean))
  return cities.find(city => city.trim().length > 0 && areas.has(city.trim().toLowerCase()))
}

function hitFor(rule: OfficialAlertImpactRuleConfig, item: FeedItem, extra: Record<string, string>): WeatherImpactRuleHit {
  const severity: Severity = item.severity
  const alertId = item.weather?.alertId ?? item.id
  return {
    ruleId: rule.id,
    object: rule.object,
    severity,
    status: "potential",
    provenance: "system",
    inputValues: { officialSourceId: item.sourceId, officialAlertId: alertId, officialSeverity: severity, ...extra },
    summaryZh: rule.summaryZh.replace("{title}", item.title),
    officialBasis: {
      provenance: "official",
      sourceId: item.sourceId,
      alertId,
      title: item.title,
      sourceUrl: item.sourceUrl,
      severity,
      publishedAt: item.publishedAt,
      expiresAt: item.expiresAt ?? item.weather?.alertExpiresAt,
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
        if (item.relatedPortIds.includes(context.portId)) hits.push(hitFor(rule, item, {}))
        continue
      }
      const country = officialAlertIssuingCountry(item)
      if (!country || !context.countryCode || country !== context.countryCode) continue
      const hazard = matchOfficialAlertHazard(item, rule.hazards)
      if (!hazard) continue
      const city = officialAlertCoveredCity(item, cities)
      if (!city) continue
      hits.push(hitFor(rule, item, { issuingCountry: country, matchedHazard: hazard, matchedCity: city, coverageField: "weather.alertRegion" }))
    }
  }
  return hits
}
