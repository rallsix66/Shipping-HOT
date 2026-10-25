import { createHash } from "node:crypto"
import type { ArticleSourcePolicy } from "@shared/article"
import { adaptiveIntervalMs, adaptiveWindow } from "#/intel/adaptive"
import type { IntelRepository } from "#/database/intel"
import { parseFeedEntries } from "#/providers/feed"
import { type ArticleLookup, type ArticleTransport, secureFetchArticle } from "#/services/article-fetch-security"
import type { IntelSourceSeed } from "#/intel/sources"
import { WEB_LIST_DUPLICATE_CONFLICT, type WebListEntry, fromHtml } from "#/intel/sources/web-list"
import { assertSupportedConfig } from "#/intel/sources/config-keys"
import { JSON_LIST_HTML_MAX_BYTES, assertJsonListConfig, fromJson } from "#/intel/sources/json-list"

import { contentScopeFor, licensedBlocks } from "#/intel/content-license"

export { contentScopeFor, licensedBlocks } from "#/intel/content-license"

export const INTEL_EXTRACTOR_VERSION = "intel-feed-v1"
export const INTEL_BACKOFF_BASE_MS = 15 * 60 * 1000
export const INTEL_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000

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
  if (seed.kind === "web_list") {
    try {
      assertSupportedConfig(seed.webList)
    } catch (error) {
      return await fail("config_invalid", message(error, "web_list config invalid"))
    }
  }
  if (seed.kind === "json_list") {
    try {
      assertJsonListConfig(seed.jsonList)
      const pattern = seed.jsonList.htmlScriptSelector ? /^(?:text\/html|application\/xhtml\+xml)$/i : /^application\/(?:json|[\w.-]+\+json)$/i
      if (!seed.allowedContentTypes.length || seed.allowedContentTypes.some(type => !pattern.test(type))) throw new Error("json_list content types do not match configured input")
    } catch (error) {
      return await fail("config_invalid", message(error, "json_list config invalid"))
    }
  }
  try {
    const response = await secureFetchArticle(seed.url, { policy: sourcePolicy(seed), sourceCa: seed.sourceCa, sourceHeaderLimit: seed.sourceHeaderLimit, lookup: deps.lookup, transport: deps.transport, ...(seed.kind === "json_list" && seed.jsonList?.htmlScriptSelector ? { maxBytes: JSON_LIST_HTML_MAX_BYTES } : {}) })
    if (!response.ok) return await fail(response.code, response.message)
    body = response.body
    finalUrl = response.finalUrl
  } catch (error) {
    return await fail("fetch_failed", message(error, "fetch failed"))
  }

  let entries: (ReturnType<typeof parseFeedEntries>["entries"][number] | WebListEntry)[]
  try {
    entries = seed.kind === "json_list" ? fromJson(body, finalUrl, seed.jsonList!, sourcePolicy(seed)) : seed.kind === "web_list" ? fromHtml(body, finalUrl, seed.webList!, sourcePolicy(seed)) : parseFeedEntries(body, finalUrl).entries
  } catch (error) {
    if (seed.kind === "web_list" && error instanceof Error && error.message === WEB_LIST_DUPLICATE_CONFLICT) return await fail(WEB_LIST_DUPLICATE_CONFLICT, WEB_LIST_DUPLICATE_CONFLICT)
    return await fail("parse_failed", message(error, "parse failed"))
  }

  const scope = contentScopeFor(seed.persistence)
  let itemsNew = 0
  let itemsRevised = 0
  let committed = 0
  for (const entry of entries) {
    const dateEvidence = "dateEvidence" in entry ? entry.dateEvidence : undefined
    // Existing RSS and web_list identities are unchanged. JSON has its own date-scoped contract.
    const extractorVersion = seed.kind === "json_list" ? "intel-json-list-v1" : seed.kind === "web_list" ? "intel-web-list-v1" : INTEL_EXTRACTOR_VERSION
    const identity = seed.kind === "web_list" || seed.kind === "json_list" ? JSON.stringify([extractorVersion, entry.title, entry.bodyText, dateEvidence]) : `${entry.title}\n${entry.bodyText}`
    const contentHash = createHash("sha256").update(identity).digest("hex")
    try {
      const written = await repository.writeEntry({
        sourceId: seed.id,
        canonicalUrl: entry.canonicalUrl,
        title: entry.title,
        publishedAt: entry.publishedAt,
        sourceUpdatedAt: entry.sourceUpdatedAt,
        dateEvidence,
        contentHash,
        contentScope: scope,
        extractorVersion,
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
    const window = adaptiveWindow(now)
    const intervalMs = seed.adaptive ? adaptiveIntervalMs(await repository.countAdaptiveDiscoveries(seed.id, window.from, window.until), seed.adaptive) : seed.intervalMs
    // One transaction: if the source-state write fails, the run row stays 'running' and is then closed as failed with backoff.
    await repository.finishRunSuccess(activeRunId, seed.id, { status, finishedAt: nowIso, itemsSeen: entries.length, itemsNew, itemsRevised }, {
      status: status === "ok_empty" ? "ok_empty" : "ok",
      now: nowIso,
      nextSyncAt: new Date(now.getTime() + intervalMs).toISOString(),
    })
  } catch (error) {
    return await fail("finalize_failed", message(error, "finalize failed"), committed, { seen: entries.length, created: itemsNew, revised: itemsRevised })
  }
  return { status, runId: activeRunId, itemsSeen: entries.length, itemsNew, itemsRevised }
}
