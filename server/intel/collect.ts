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
  | { status: "failed", runId: string, errorCode: string }
  | { status: "skipped", errorCode: "source_run_in_flight" }

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
export async function collectIntelSource(repository: IntelRepository, seed: IntelSourceSeed, deps: IntelFetchDeps, now: Date): Promise<IntelCollectOutcome> {
  const nowIso = now.toISOString()
  const runId = await repository.beginRun(seed.id, nowIso)
  if (!runId) return { status: "skipped", errorCode: "source_run_in_flight" }

  const fail = async (errorCode: string, errorMessage: string): Promise<IntelCollectOutcome> => {
    const current = await repository.getSource(seed.id)
    const failures = (current?.consecutiveFailures ?? 0) + 1
    await repository.completeRun(runId, { status: "failed", finishedAt: nowIso, errorCode, errorMessage: errorMessage.slice(0, 300) })
    await repository.recordSourceFailure(seed.id, {
      now: nowIso,
      consecutiveFailures: failures,
      errorCode,
      nextSyncAt: new Date(now.getTime() + computeBackoffMs(failures)).toISOString(),
    })
    return { status: "failed", runId, errorCode }
  }

  let body: string
  let finalUrl: string
  try {
    const response = await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), lookup: deps.lookup, transport: deps.transport })
    if (!response.ok) return await fail(response.code, response.message)
    body = response.body
    finalUrl = response.finalUrl
  } catch (error) {
    return await fail("fetch_failed", error instanceof Error ? error.message : "fetch failed")
  }

  let entries: ReturnType<typeof parseFeedEntries>["entries"]
  try {
    entries = parseFeedEntries(body, finalUrl).entries
  } catch (error) {
    return await fail("parse_failed", error instanceof Error ? error.message : "parse failed")
  }

  const scope = contentScopeFor(seed.persistence)
  let itemsNew = 0
  let itemsRevised = 0
  for (const entry of entries) {
    const contentHash = createHash("sha256").update(`${entry.title}\n${entry.bodyText}`).digest("hex")
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
    if (written.created) itemsNew++
    else if (written.revised) itemsRevised++
  }
  const status = entries.length === 0 ? "ok_empty" : "ok_items"
  await repository.completeRun(runId, { status, finishedAt: nowIso, itemsSeen: entries.length, itemsNew, itemsRevised })
  await repository.recordSourceSuccess(seed.id, {
    status: status === "ok_empty" ? "ok_empty" : "ok",
    now: nowIso,
    nextSyncAt: new Date(now.getTime() + seed.intervalMs).toISOString(),
  })
  return { status, runId, itemsSeen: entries.length, itemsNew, itemsRevised }
}
