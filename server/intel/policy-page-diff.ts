/**
 * R3-8 TikTok Shop offline whole-page compare (§4.11).
 * Hashes dated paragraphs; detects added / modified / removed / unchanged.
 * No network. Fixtures only in tests.
 * Plain HTML: preserve paragraph boundaries, then normalize each block
 * (do not collapse the whole page to one line before split).
 */
import { createHash } from "node:crypto"

const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})\b/

export interface DatedParagraph {
  date: string
  text: string
  hash: string
}

export interface DatedParagraphDiff {
  added: DatedParagraph[]
  modified: Array<{ before: DatedParagraph, after: DatedParagraph }>
  removed: DatedParagraph[]
  unchanged: DatedParagraph[]
}

function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim()
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function pushDated(out: DatedParagraph[], date: string, text: string) {
  const normalized = normalizeText(text)
  if (!normalized) return
  out.push({ date, text: normalized, hash: hashText(`${date}\n${normalized}`) })
}

/** Prefer explicit dated-block sections (attribute order independent); fall back to plain blocks. */
export function extractDatedParagraphs(html: string): DatedParagraph[] {
  const out: DatedParagraph[] = []
  const sectionRe = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi
  let m: RegExpExecArray | null = sectionRe.exec(html)
  while (m) {
    const attrs = m[1] || ""
    const hasDatedClass = /class\s*=\s*["'][^"']*\bdated-block\b[^"']*["']/i.test(attrs)
    const dm = attrs.match(/data-date\s*=\s*["'](20\d{2}-\d{2}-\d{2})["']/i)
    if (hasDatedClass && dm) {
      const inner = m[2]!.replace(/<[^>]+>/g, " ")
      pushDated(out, dm[1]!, inner)
    }
    m = sectionRe.exec(html)
  }
  if (out.length) {
    out.sort((a, b) => a.date.localeCompare(b.date) || a.hash.localeCompare(b.hash))
    return out
  }

  // Fallback: strip tags while keeping block boundaries as newlines, THEN normalize per block.
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr)\b[^>]*>/gi, "\n")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
  const blocks = plain.split(/\n+/).map(normalizeText).filter(Boolean)
  for (const block of blocks) {
    const dm = block.match(ISO_DATE)
    if (!dm) continue
    pushDated(out, dm[1]!, block)
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.hash.localeCompare(b.hash))
  return out
}

export function diffDatedParagraphs(prev: DatedParagraph[], next: DatedParagraph[]): DatedParagraphDiff {
  const prevByDate = new Map<string, DatedParagraph[]>()
  for (const p of prev) {
    const list = prevByDate.get(p.date) ?? []
    list.push(p)
    prevByDate.set(p.date, list)
  }
  const nextByDate = new Map<string, DatedParagraph[]>()
  for (const n of next) {
    const list = nextByDate.get(n.date) ?? []
    list.push(n)
    nextByDate.set(n.date, list)
  }
  const added: DatedParagraph[] = []
  const modified: Array<{ before: DatedParagraph, after: DatedParagraph }> = []
  const removed: DatedParagraph[] = []
  const unchanged: DatedParagraph[] = []
  const dates = new Set([...prevByDate.keys(), ...nextByDate.keys()])
  for (const date of [...dates].sort()) {
    const beforeList = prevByDate.get(date) ?? []
    const afterList = nextByDate.get(date) ?? []
    if (!beforeList.length && afterList.length) {
      added.push(...afterList)
      continue
    }
    if (beforeList.length && !afterList.length) {
      removed.push(...beforeList)
      continue
    }
    const afterLeft = [...afterList]
    const beforeLeft: DatedParagraph[] = []
    for (const b of beforeList) {
      const idx = afterLeft.findIndex(a => a.hash === b.hash)
      if (idx >= 0) {
        unchanged.push(b)
        afterLeft.splice(idx, 1)
      } else {
        beforeLeft.push(b)
      }
    }
    while (beforeLeft.length && afterLeft.length) {
      modified.push({ before: beforeLeft.shift()!, after: afterLeft.shift()! })
    }
    removed.push(...beforeLeft)
    added.push(...afterLeft)
  }
  return { added, modified, removed, unchanged }
}

export function pageContentFingerprint(paragraphs: DatedParagraph[]): string {
  const payload = paragraphs.map(p => `${p.date}:${p.hash}`).join("|")
  return hashText(payload || "empty")
}
