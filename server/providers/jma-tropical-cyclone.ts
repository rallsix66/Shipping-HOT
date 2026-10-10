import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import { parseJmaForecastJson, parseJmaTargetTcList } from "#/services/jma-typhoon-parse"

export const JMA_TYPHOON_SOURCE_ID = "jma-typhoon" as const
export const JMA_TARGET_TC_URL = "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json"

export type JmaFetcher = (url: string) => Promise<Response>

export interface JmaTropicalCycloneSyncResult {
  cyclones: NormalizedTropicalCyclone[]
  outcome: "ok" | "ok_empty"
  fetchedAt: string
}

export interface JmaTropicalCycloneSyncFailure {
  outcome: "failed"
  fetchedAt: string
  errorCode: string
  errorMessage: string
}

export async function syncJmaTropicalCyclones(
  fetcher: JmaFetcher,
  now = new Date(),
): Promise<JmaTropicalCycloneSyncResult | JmaTropicalCycloneSyncFailure> {
  const fetchedAt = now.toISOString()
  try {
    const listResponse = await fetcher(JMA_TARGET_TC_URL)
    if (!listResponse.ok) {
      return {
        outcome: "failed",
        fetchedAt,
        errorCode: "provider_unavailable",
        errorMessage: `JMA targetTc HTTP ${listResponse.status}`,
      }
    }
    const targetPayload = await listResponse.json()
    const targets = parseJmaTargetTcList(targetPayload)
    if (!targets.length) {
      return { cyclones: [], outcome: "ok_empty", fetchedAt }
    }
    const cyclones: NormalizedTropicalCyclone[] = []
    for (const target of targets) {
      const forecastUrl = `https://www.jma.go.jp/bosai/typhoon/data/${target.tropicalCyclone}/forecast.json`
      const forecastResponse = await fetcher(forecastUrl)
      if (!forecastResponse.ok) continue
      const forecastPayload = await forecastResponse.json()
      const parsed = parseJmaForecastJson(target.tropicalCyclone, forecastPayload)
      if (parsed) {
        parsed.category = target.category ?? parsed.category
        cyclones.push(parsed)
      }
    }
    return { cyclones, outcome: cyclones.length ? "ok" : "ok_empty", fetchedAt }
  } catch (error) {
    return {
      outcome: "failed",
      fetchedAt,
      errorCode: "provider_unavailable",
      errorMessage: error instanceof Error ? error.message : "JMA typhoon sync failed",
    }
  }
}
