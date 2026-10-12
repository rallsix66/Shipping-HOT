import { createHash } from "node:crypto"
import type { ArticleSourcePolicy } from "@shared/article"
import type { IntelBlock, IntelContentScope, IntelPersistence, IntelRepository } from "#/database/intel"
import { parseFeedEntries } from "#/providers/feed"
import { type ArticleLookup, type ArticleTransport, secureFetchArticle } from "#/services/article-fetch-security"
import type { IntelSourceSeed } from "#/intel/sources"

export const INTEL_EXTRACTOR_VERSION = "intel-feed-v1"
export const INTEL_BACKOFF_BASE_MS = 15 * 60 * 1000
export const INTEL_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000
const BLOCK_CHARS = 2000
const EXCERPT_CHARS = 280

/** Offline-capable fetch dependencies. Both are required: there is no implicit network default. */
export interface IntelFetchDeps {
  lookup: ArticleLookup
  transport: ArticleTransport
}

export type IntelCollectOutcome =
  | { status: "ok_items" | "ok_empty", runId: string, itemsSeen: number, itemsNew: number, itemsRevised: number }
  /** Finalized failure: the run row is closed as failed and the source entered backoff. Committed entries are kept. */
  | { status: "failed", runId: string, errorCode: string, itemsCommitted: number }
  /** Storage could not record the outcome: the run may still read 'running'. Reported explicitly, never as finished. */
  | { status: "storage_unavailable", runId: string | null, errorCode: string, storageError: string }
  | { status: "skipped", errorCode: "source_run_in_flight" }

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback).slice(0, 300)

/** Exponential backoff: base * 2^(failures-1), capped. */
export function computeBackoffMs(consecutiveFailures: number, baseMs = INTEL_BACKOFF_BASE_MS, maxMs = INTEL_BACKOFF_MAX_MS): number {
  if (consecutiveFailures <= 0) return 0
  return Math.min(maxMs, baseMs * 2 ** Math.min(consecutiveFailures - 1, 30))
}

export function contentScopeFor(persistence: IntelPersistence): IntelContentScope {
  return persistence === "full" ? "full_text" : persistence === "excerpt_only" ? "excerpt" : "metadata_only"
}

/** Blocks kept for one version, limited to what the source license allows. */
export function licensedBlocks(scope: IntelContentScope, title: string, bodyText: string): IntelBlock[] {
  const blocks: IntelBlock[] = [{ blockKey: "title", order: 0, type: "title", text: title }]
  if (scope === "metadata_only" || !bodyText) return blocks
  if (scope === "excerpt") {
    const excerpt = bodyText.length <= EXCERPT_CHARS ? bodyText : `${bodyText.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`
    blocks.push({ blockKey: "excerpt", order: 1, type: "excerpt", text: excerpt })
    return blocks
  }
  for (let offset = 0, index = 0; offset < bodyText.length; offset += BLOCK_CHARS, index++) {
    blocks.push({ blockKey: `p${index}`, order: index + 1, type: "paragraph", text: bodyText.slice(offset, offset + BLOCK_CHARS) })
  }
  return blocks
}

export function sourcePolicy(seed: IntelSourceSeed): ArticleSourcePolicy {
  return {
    sourceId: seed.id,
    status: "allowed",
    fetchAllowed: true,
    persistence: seed.persistence,
    allowedHosts: seed.allowedHosts,
    allowedContentTypes: seed.allowedContentTypes,
  }
}

/**
 * One source: secure fetch (existing article-fetch-security, all protections kept) → feed.ts parse →
 * dedupe / license-scoped version → SQLite → per-source run result and health. Failure never deletes items.
 */
export async function collectIntelSource(repository: IntelRepository, seed: IntelSourceSeed, deps: IntelFetchDeps, now: Date, executorId: string | null = null): Promise<IntelCollectOutcome> {
  const nowIso = now.toISOString()
  let runId: string | null
  try {
    runId = await repository.beginRun(seed.id, nowIso, executorId)
  } catch (error) {
    return { status: "storage_unavailable", runId: null, errorCode: "run_start_failed", storageError: message(error, "beginRun failed") }
  }
  if (!runId) return { status: "skipped", errorCode: "source_run_in_flight" }
  const activeRunId = runId

  const fail = async (errorCode: string, errorMessage: string, itemsCommitted = 0, counts: { seen?: number, created?: number, revised?: number } = {}): Promise<IntelCollectOutcome> => {
    try {
      const current = await repository.getSource(seed.id)
      const failures = (current?.consecutiveFailures ?? 0) + 1
      await repository.finishRunFailure(activeRunId, seed.id, { status: "failed", finishedAt: nowIso, errorCode, errorMessage: errorMessage.slice(0, 300), itemsSeen: counts.seen, itemsNew: counts.created, itemsRevised: counts.revised }, {
        now: nowIso,
        consecutiveFailures: failures,
        errorCode,
        nextSyncAt: new Date(now.getTime() + computeBackoffMs(failures)).toISOString(),
      })
      return { status: "failed", runId: activeRunId, errorCode, itemsCommitted }
    } catch (storageError) {
      return { status: "storage_unavailable", runId: activeRunId, errorCode, storageError: message(storageError, "failure could not be recorded") }
    }
  }

  let body: string
  let finalUrl: string
  try {
    const response = await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), lookup: deps.lookup, transport: deps.transport })
    if (!response.ok) return await fail(response.code, response.message)
    body = response.body
    finalUrl = response.finalUrl
  } catch (error) {
    return await fail("fetch_failed", message(error, "fetch failed"))
  }

  let entries: ReturnType<typeof parseFeedEntries>["entries"]
  try {
    entries = parseFeedEntries(body, finalUrl).entries
  } catch (error) {
    return await fail("parse_failed", message(error, "parse failed"))
  }

  const scope = contentScopeFor(seed.persistence)
  let itemsNew = 0
  let itemsRevised = 0
  let committed = 0
  for (const entry of entries) {
    const contentHash = createHash("sha256").update(`${entry.title}\n${entry.bodyText}`).digest("hex")
    try {
      const written = await repository.writeEntry({
        sourceId: seed.id,
        canonicalUrl: entry.canonicalUrl,
        title: entry.title,
        publishedAt: entry.publishedAt,
        sourceUpdatedAt: entry.sourceUpdatedAt,
        contentHash,
        contentScope: scope,
        extractorVersion: INTEL_EXTRACTOR_VERSION,
        blocks: licensedBlocks(scope, entry.title, entry.bodyText),
        fetchedAt: nowIso,
      })
      committed++
      if (written.created) itemsNew++
      else if (written.revised) itemsRevised++
    } catch (error) {
      // Each entry is its own transaction: entries committed before this one stay; the run closes as failed.
      return await fail("store_failed", message(error, "write failed"), committed, { seen: entries.length, created: itemsNew, revised: itemsRevised })
    }
  }
  const status = entries.length === 0 ? "ok_empty" : "ok_items"
  try {
    // One transaction: if the source-state write fails, the run row stays 'running' and is then closed as failed with backoff.
    await repository.finishRunSuccess(activeRunId, seed.id, { status, finishedAt: nowIso, itemsSeen: entries.length, itemsNew, itemsRevised }, {
      status: status === "ok_empty" ? "ok_empty" : "ok",
      now: nowIso,
      nextSyncAt: new Date(now.getTime() + seed.intervalMs).toISOString(),
    })
  } catch (error) {
    return await fail("finalize_failed", message(error, "finalize failed"), committed, { seen: entries.length, created: itemsNew, revised: itemsRevised })
  }
  return { status, runId: activeRunId, itemsSeen: entries.length, itemsNew, itemsRevised }
}
