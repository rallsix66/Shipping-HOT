/**
 * Provenance-safe candidate trim for DeepSeek Search/Fetch.
 * third_party_markdown is provenance, NOT contentScope — never store snippet/summary/content
 * in receipts, logs, or cache DTOs. Search keeps URL/title/provider date (+ hash) only.
 */
import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import type { DeepSeekFetchResponse, DeepSeekSearchResultItem } from "#/providers/deepseek/search-fetch-client"

export interface TrimmedSearchCandidate {
  url: string
  title: string
  /** Provider-supplied date label when present; opaque string, not reinterpreted. */
  providerDate: string | null
  /** SHA-256 of normalized title|url for provenance without body. */
  titleUrlHash: string
}

export interface TrimmedFetchMeta {
  url: string
  titleLength: number
  contentByteLength: number
  titleHash: string
  contentHash: string
  empty: boolean
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

/** Drop snippet/summary/content; keep URL/title/provider date + hash. Dedup by URL (first wins). */
export function trimSearchCandidates(items: readonly DeepSeekSearchResultItem[]): TrimmedSearchCandidate[] {
  const seen = new Set<string>()
  const out: TrimmedSearchCandidate[] = []
  for (const item of items) {
    const url = asNonEmptyString(item.url)
    if (!url) continue
    let normalized: string
    try {
      normalized = new URL(url).toString()
    } catch {
      continue
    }
    if (seen.has(normalized)) continue
    seen.add(normalized)
    const title = asNonEmptyString(item.title) ?? ""
    const providerDate = asNonEmptyString(item.date)
    out.push({
      url: normalized,
      title,
      providerDate,
      titleUrlHash: sha256Hex(`${title}\n${normalized}`),
    })
  }
  return out
}

/** Metadata-only DTO for receipt/cache. Never include title or content text. */
export function trimFetchMeta(url: string, response: DeepSeekFetchResponse): TrimmedFetchMeta {
  const title = typeof response.title === "string" ? response.title : ""
  const content = typeof response.content === "string" ? response.content : ""
  const contentBytes = Buffer.byteLength(content, "utf8")
  return {
    url,
    titleLength: [...title].length,
    contentByteLength: contentBytes,
    titleHash: sha256Hex(title),
    contentHash: sha256Hex(content),
    empty: contentBytes === 0,
  }
}

/** Redact anything that looks like a bearer / key from a string for log assertions. */
export function containsSecretLike(text: string, apiKey?: string): boolean {
  if (apiKey && apiKey.length > 0 && text.includes(apiKey)) return true
  if (/Bearer\s+[\w.\-]+/i.test(text)) return true
  if (/sk-[A-Za-z0-9]{8,}/.test(text)) return true
  return false
}

export function receiptPayloadHasBodyLeak(payload: unknown): boolean {
  if (payload == null) return false
  const json = JSON.stringify(payload)
  // Trimmed Search DTO keys only; Fetch meta never has content/snippet/summary/markdown.
  if (/"snippet"\s*:/.test(json)) return true
  if (/"summary"\s*:/.test(json)) return true
  if (/"content"\s*:/.test(json)) return true
  if (/"markdown"\s*:/.test(json)) return true
  if (/"third_party_markdown"\s*:/.test(json)) return true
  return false
}
