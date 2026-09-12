import process from "node:process"
import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { ArticleRepository } from "#/database/article"
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
  const articleRepository = new ArticleRepository(options.database)
  const service = options.service ?? new ArticleService({ database: options.database, dataMode: options.dataMode, now: options.now })
  const batchSize = Math.max(1, options.batchSize ?? 5)
  const retryAgeMs = Math.max(options.intervalMs, 1)
  return {
    id: "article-fetch",
    providerId: "article-fetch",
    capability: ARTICLE_FETCH_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const current = now()
      const currentIso = current.toISOString()
      const nowMs = current.getTime()
      const items = await repository.listFeedItems({ now: current, view: "current" })
      // Rotate fairly instead of re-processing the same head each tick: never
      // attempted first, then the oldest attempt; skip anything younger than the
      // retry age so a Runtime tick cannot immediately refetch its own batch.
      const candidates: Array<{ id: string, lastAttempt: number }> = []
      for (const item of items) {
        const policy = resolveArticleSourcePolicy(item.sourceId)
        if (!policy.fetchAllowed || policy.persistence === "disallowed") continue
        const state = await articleRepository.getState(item.id)
        const parsed = state?.lastAttemptAt ? Date.parse(state.lastAttemptAt) : Number.NaN
        if (Number.isFinite(parsed) && nowMs - parsed < retryAgeMs) continue
        candidates.push({ id: item.id, lastAttempt: Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY })
      }
      candidates.sort((a, b) => a.lastAttempt - b.lastAttempt)
      let read = 0
      let written = 0
      for (const candidate of candidates.slice(0, batchSize)) {
        read += 1
        const result = await service.process(candidate.id)
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
