import process from "node:process"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { ArticleService } from "#/services/article-service"
import { resolveArticleSourcePolicy } from "#/services/source-policy"

export const ARTICLE_FETCH_CAPABILITY = "article_fetch"

export interface ArticleFetchJobOptions {
  database: Database
  dataMode: ShippingDataMode
  intervalMs: number
  enabled?: boolean
  now?: () => Date
  batchSize?: number
  service?: Pick<ArticleService, "process">
}

/**
 * Bounded, low-concurrency article refresh on the existing BackgroundRuntime.
 * Only sources whose policy allows fetching are considered; The Loadstar
 * (policy_disallowed) is skipped before any HTTP request. It never calls
 * Translation/DeepSeek and owns no scheduler/retry/circuit state of its own.
 * Page views cannot trigger it.
 */
export function createArticleFetchJob(options: ArticleFetchJobOptions): RuntimeJob {
  const now = options.now ?? (() => new Date())
  const repository = new ShippingRepository(options.database, options.dataMode)
  const service = options.service ?? new ArticleService({ database: options.database, dataMode: options.dataMode, now: options.now })
  const batchSize = Math.max(1, options.batchSize ?? 5)
  return {
    id: "article-fetch",
    providerId: "article-fetch",
    capability: ARTICLE_FETCH_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const current = now()
      const currentIso = current.toISOString()
      const items = await repository.listFeedItems({ now: current, view: "current" })
      const allowed = items.filter((item) => {
        const policy = resolveArticleSourcePolicy(item.sourceId)
        return policy.fetchAllowed && policy.persistence !== "disallowed"
      })
      let read = 0
      let written = 0
      for (const item of allowed.slice(0, batchSize)) {
        read += 1
        const result = await service.process(item.id)
        if (result.fetched && result.created !== false) written += 1
      }
      return { status: "success", recordsRead: read, recordsWritten: written, sourceUpdatedAt: currentIso }
    },
  }
}

export function articleFetchEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.SHIPPING_DATA_MODE === "real" && environment.SHIPPING_ARTICLE_FETCH_PROVIDER?.trim().toLowerCase() === "public"
}

export function articleFetchIntervalMs(environment: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(environment.SHIPPING_ARTICLE_FETCH_INTERVAL_MINUTES ?? 180)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 180) * 60 * 1000
}
