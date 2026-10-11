import type { NormalizedTropicalCyclone } from "#/services/jma-typhoon-parse"
import { parseJmaForecastJson, parseJmaTargetTcListStrict } from "#/services/jma-typhoon-parse"

export const JMA_TYPHOON_SOURCE_ID = "jma-typhoon" as const
export const JMA_TARGET_TC_URL = "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json"

export type JmaFetcher = (url: string) => Promise<Response>

export interface JmaTropicalCycloneSyncResult {
  cyclones: NormalizedTropicalCyclone[]
  outcome: "ok" | "ok_empty" | "partial"
  fetchedAt: string
  listConfirmedEmpty: boolean
  failedTcIds: string[]
  parseErrorCount: number
  listInvalidCount?: number
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
    let targetPayload: unknown
    try {
      targetPayload = await listResponse.json()
    } catch {
      return {
        outcome: "failed",
        fetchedAt,
        errorCode: "invalid_response",
        errorMessage: "JMA targetTc response is not valid JSON",
      }
    }
    const listParse = parseJmaTargetTcListStrict(targetPayload)
    if (listParse.status === "list_invalid") {
      return {
        outcome: "failed",
        fetchedAt,
        errorCode: "invalid_response",
        errorMessage: listParse.message,
      }
    }
    if (listParse.status === "empty") {
      return {
        cyclones: [],
        outcome: "ok_empty",
        fetchedAt,
        listConfirmedEmpty: true,
        failedTcIds: [],
        parseErrorCount: 0,
      }
    }
    const targets = listParse.entries
    const listInvalidCount = listParse.status === "mixed" ? listParse.invalidCount : undefined
    const cyclones: NormalizedTropicalCyclone[] = []
    const failedTcIds: string[] = []
    let parseErrorCount = 0
    for (const target of targets) {
      const forecastUrl = `https://www.jma.go.jp/bosai/typhoon/data/${target.tropicalCyclone}/forecast.json`
      let forecastResponse: Response
      try {
        forecastResponse = await fetcher(forecastUrl)
      } catch {
        failedTcIds.push(target.tropicalCyclone)
        continue
      }
      if (!forecastResponse.ok) {
        failedTcIds.push(target.tropicalCyclone)
        continue
      }
      let forecastPayload: unknown
      try {
        forecastPayload = await forecastResponse.json()
      } catch {
        failedTcIds.push(target.tropicalCyclone)
        parseErrorCount += 1
        continue
      }
      if (!Array.isArray(forecastPayload)) {
        failedTcIds.push(target.tropicalCyclone)
        parseErrorCount += 1
        continue
      }
      const parsed = parseJmaForecastJson(target.tropicalCyclone, forecastPayload)
      if (parsed) {
        parsed.category = target.category ?? parsed.category
        parsed.pathFetchedAt = fetchedAt
        cyclones.push(parsed)
      } else {
        failedTcIds.push(target.tropicalCyclone)
        parseErrorCount += 1
      }
    }
    if (!cyclones.length) {
      return {
        cyclones: [],
        outcome: "partial",
        fetchedAt,
        listConfirmedEmpty: false,
        failedTcIds,
        parseErrorCount,
        listInvalidCount,
      }
    }
    const outcome = (failedTcIds.length || listInvalidCount) ? "partial" : "ok"
    return {
      cyclones,
      outcome,
      fetchedAt,
      listConfirmedEmpty: false,
      failedTcIds,
      parseErrorCount,
      listInvalidCount,
    }
  } catch (error) {
    return {
      outcome: "failed",
      fetchedAt,
      errorCode: "provider_unavailable",
      errorMessage: error instanceof Error ? error.message : "JMA typhoon sync failed",
    }
  }
}
