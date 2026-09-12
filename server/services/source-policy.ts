import type { ArticleSourcePolicy } from "@shared/article"
import { shippingFeedSources } from "#/providers/feed"
import { officialWeatherAlertSources } from "#/providers/weather-alerts"

/**
 * Thin adapter that resolves one unified article policy from the two existing
 * source definitions. It is NOT a third source registry: it only reads the
 * optional `articlePolicy` already attached to a source. Unconfigured or
 * disabled sources fail closed.
 */
export function resolveArticleSourcePolicy(sourceId: string): ArticleSourcePolicy {
  const feedSource = shippingFeedSources.find(source => source.id === sourceId)
  const alertSource = officialWeatherAlertSources.find(source => source.id === sourceId)
  const config = feedSource?.articlePolicy ?? alertSource?.articlePolicy
  const enabled = feedSource ? feedSource.enabled : alertSource ? alertSource.enabled : false
  if (!config || !enabled) {
    return {
      sourceId,
      status: "unconfigured",
      fetchAllowed: false,
      persistence: "disallowed",
      allowedHosts: [],
      allowedContentTypes: [],
      policyCheckedAt: null,
      notes: config ? "Source is disabled; article fetch fails closed." : "No article policy configured; fail closed.",
    }
  }
  return { ...config, sourceId }
}

export function articlePolicyHostResolves(policy: ArticleSourcePolicy, hostname: string): boolean {
  const host = hostname.toLowerCase()
  return policy.allowedHosts.some(allowed => allowed.toLowerCase() === host)
}
