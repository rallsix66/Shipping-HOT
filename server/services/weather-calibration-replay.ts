import { portClosureReplayEvents } from "#/data/weather-calibration/port-closure-replay-events"
import { evaluateWeatherImpactRules } from "#/services/weather-impact-engine"

export interface ReplayHitResult {
  eventId: string
  portUnlocode: string
  hit: boolean
  topRuleId?: string
  evidence: string
}

/** True when peak inputs would trigger at least one high/medium port shipping rule during the cited closure window. */
export function replayPortClosureEvent(event: typeof portClosureReplayEvents[number]): ReplayHitResult {
  const hits = evaluateWeatherImpactRules(event.peakInputs)
  const portRules = hits.filter(h => h.object === "shipping_port" && (h.severity === "critical" || h.severity === "warning"))
  return {
    eventId: event.id,
    portUnlocode: event.portUnlocode,
    hit: portRules.length > 0,
    topRuleId: portRules[0]?.ruleId,
    evidence: event.evidence,
  }
}

export function replayAllPortClosureEvents(): { results: ReplayHitResult[], hitRate: number } {
  const results = portClosureReplayEvents.map(replayPortClosureEvent)
  const hitRate = results.filter(r => r.hit).length / results.length
  return { results, hitRate }
}
