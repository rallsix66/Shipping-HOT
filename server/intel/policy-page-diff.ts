/**
 * R3-8 TikTok Shop offline whole-page compare (§4.11).
 * Hashes dated paragraphs; detects added / modified / removed / unchanged.
 * No network. Fixtures only in tests.
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

/** Prefer explicit data-date sections; fall back to blocks whose text contains an ISO date. */
export function extractDatedParagraphs(html: string): DatedParagraph[] {
  const out: DatedParagraph[] = []
  const sectionRe = /<section\s[^>]*class=["'][^"']*dated-block[^"']*["'][^>]*data-date=["'](20\d{2}-\d{2}-\d{2})["'][^>]*>([\s\S]*?)<\/section>/gi
  let m: RegExpExecArray | null = sectionRe.exec(html)
  while (m) {
    const date = m[1]!
    const inner = m[2]!.replace(/<[^>]+>/g, " ")
    const text = normalizeText(inner)
    if (text) out.push({ date, text, hash: hashText(`${date}\n${text}`) })
    m = sectionRe.exec(html)
  }
  if (out.length) {
    out.sort((a, b) => a.date.localeCompare(b.date) || a.hash.localeCompare(b.hash))
    return out
  }
  // Fallback: split on blank lines / headings after stripping tags
  const plain = normalizeText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n"))
  const blocks = plain.split(/\n+/).map(normalizeText).filter(Boolean)
  for (const block of blocks) {
    const dm = block.match(ISO_DATE)
    if (!dm) continue
    const date = dm[1]
    out.push({ date, text: block, hash: hashText(`${date}\n${block}`) })
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
    // Pair by hash first, then leftover as modified/added/removed
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
