import { load } from "cheerio"
import {
  type ArticleBlock,
  type ArticleBlockType,
  type ArticleCompletenessStatus,
  type ArticleSourcePolicy,
  canonicalizeArticleUrl,
  normalizeArticleBlockLines,
  normalizeArticleBlockText,
} from "@shared/article"

export const ARTICLE_EXTRACTOR_VERSION = "article-extractor-v1"

export interface ExtractedArticle {
  blocks: ArticleBlock[]
  status: ArticleCompletenessStatus
  title?: string
  /** Provenance only: read from `<html lang>`; undefined when absent. Never guessed. */
  language?: string
}

const NON_CONTENT_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "button",
  "[role=navigation]",
  "[aria-hidden=true]",
  ".ad",
  ".ads",
  ".advert",
  ".advertisement",
  ".advertising",
  ".recommend",
  ".recommendation",
  ".recommended",
  ".related",
  ".read-more",
  ".share",
  ".social",
  ".breadcrumb",
  ".comment",
  ".comments",
  ".sidebar",
]

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

interface WalkContext {
  blocks: ArticleBlock[]
  order: number
  sourceUrl: string
  $: ReturnType<typeof load>
}

function pushBlock(context: WalkContext, type: ArticleBlockType, text: string, metadata?: Record<string, unknown>, options?: { preserveLines?: boolean }): void {
  // Multi-row tables store one row per line; collapsing every whitespace run
  // would merge all rows into a single line and destroy the rendered structure.
  const normalized = options?.preserveLines ? normalizeArticleBlockLines(text) : normalizeArticleBlockText(text)
  if (!normalized) return
  const order = context.order++
  context.blocks.push({
    id: `b${order}`,
    blockKey: `${order}`,
    order,
    type,
    text: normalized,
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
  })
}

function firstHref(context: WalkContext, element: unknown): Record<string, unknown> | undefined {
  const anchor = context.$(element as never).find("a[href]").first()
  const raw = anchor.attr("href")
  const canonical = raw ? canonicalizeArticleUrl(raw, context.sourceUrl) : null
  return canonical ? { href: canonical } : undefined
}

function listBlock(context: WalkContext, element: unknown, ordered: boolean): void {
  const items = context.$(element as never).children("li").map((_, item) => context.$(item).text()).get() as string[]
  const text = items.map(item => normalizeArticleBlockText(item)).filter(Boolean).join(" • ")
  if (text) pushBlock(context, "list", text, { ordered })
}

function tableBlock(context: WalkContext, element: unknown): void {
  const $table = context.$(element as never)
  // A cell's own text is whitespace-normalized (a pretty-printed `<td>` contains
  // newlines around its child elements), because row boundaries are stored as
  // "\n": an un-normalized cell newline would be indistinguishable from a row
  // boundary and would render as a phantom row containing a stray "|".
  const rows = $table.find("tr").map((_, row) => context.$(row).find("th, td").map((__, cell) => normalizeArticleBlockText(context.$(cell).text())).get().join(" | ")).get() as string[]
  const text = rows.join("\n")
  if (!text.trim()) return
  const headers = $table.find("thead th").length
  const columns = $table.find("tr").first().find("th, td").length
  pushBlock(context, "table", text, { header: headers > 0, columns: columns || undefined }, { preserveLines: true })
}

function walk(context: WalkContext, element: unknown): void {
  context.$(element as never).children().each((_, child) => {
    const tag = String((child as { tagName?: string }).tagName ?? "").toLowerCase()
    if (HEADING_TAGS.has(tag)) {
      const level = Number(tag.slice(1))
      // Heading href is not part of the semantic hash allowlist, so it is not
      // persisted (avoiding silently dropped data on dedupe).
      pushBlock(context, "heading", context.$(child).text(), { level })
      return
    }
    if (tag === "p") {
      pushBlock(context, "paragraph", context.$(child).text(), firstHref(context, child))
      return
    }
    if (tag === "ul" || tag === "ol") {
      listBlock(context, child, tag === "ol")
      return
    }
    if (tag === "table") {
      tableBlock(context, child)
      return
    }
    if (tag === "figure") {
      const caption = context.$(child).find("figcaption").first()
      const rest = context.$(child).clone()
      rest.find("figcaption").remove()
      walk(context, rest.get(0))
      if (caption.length) pushBlock(context, "caption", caption.text(), firstHref(context, caption))
      return
    }
    if (tag === "blockquote") {
      pushBlock(context, "paragraph", context.$(child).text(), firstHref(context, child))
      return
    }
    walk(context, child)
  })
}

function completenessOf(blocks: readonly ArticleBlock[], policy: ArticleSourcePolicy): ArticleCompletenessStatus {
  if (blocks.length === 0) return "source_unavailable"
  const paragraphs = blocks.filter(block => block.type === "paragraph").length
  const characters = blocks.reduce((sum, block) => sum + block.text.length, 0)
  const rule = policy.completeness ?? {}
  if (rule.minParagraphs !== undefined && paragraphs < rule.minParagraphs) return "incomplete"
  if (rule.minCharacters !== undefined && characters < rule.minCharacters) return "incomplete"
  if (rule.requireHeading && !blocks.some(block => block.type === "heading")) return "incomplete"
  return "complete"
}

/**
 * Deterministic, provider-free article extraction from already-fetched HTML.
 * Never persists raw HTML; only structured blocks with canonical safe links.
 * `complete` is proven by the source's own completeness rule, never by HTTP 200.
 */
export function extractArticle(html: string, sourceUrl: string, policy: ArticleSourcePolicy): ExtractedArticle {
  const $ = load(html)
  for (const selector of NON_CONTENT_SELECTORS) $(selector).remove()
  for (const selector of policy.selectors?.remove ?? []) {
    try {
      $(selector).remove()
    } catch {
      // ignore invalid policy selector
    }
  }
  const containerSelector = policy.selectors?.container
  const context: WalkContext = { blocks: [], order: 0, sourceUrl, $ }
  let root = containerSelector ? $(containerSelector).first() : $("article").first()
  if (containerSelector && !root.length) {
    // A configured container that no longer matches is a structure failure; do
    // not fall back to the whole page and never mark it complete.
    return { blocks: [], status: "source_unavailable" }
  }
  if (!containerSelector) {
    if (!root.length) root = $("main").first()
    if (!root.length) root = $("body")
  }
  walk(context, root.get(0))
  if (containerSelector) {
    if (context.blocks.length === 0) return { blocks: [], status: "source_unavailable" }
  } else if (context.blocks.length === 0) {
    context.order = 0
    walk(context, $("body").get(0))
  }
  const titleSelector = policy.selectors?.title
  const titleText = titleSelector ? $(titleSelector).first().text() : root.find("h1").first().text() || $("title").text()
  const title = titleText ? normalizeArticleBlockText(titleText) : undefined
  const htmlLang = $("html").attr("lang")?.trim()
  return { blocks: context.blocks, status: completenessOf(context.blocks, policy), title, language: htmlLang || undefined }
}
