// Deterministic, provider-free seed for the S5 targeted browser acceptance.
//
// Usage:
//   node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs \
//     ./scripts/s5-article-browser-seed.ts <isolated-run-dir> [db-file-name]
//
// It writes the isolated SQLite database the built Nitro server will open from
// its working directory (db0 resolves `.data/<name>.sqlite3` against cwd) and a
// JSON manifest of the exact expectations the browser run must observe.
//
// No Provider, Secret, Runtime or network access is used: `translation_cache`
// rows are written directly through the same repository the Runtime uses, with
// the sourceHash produced by the real TranslationService.prepare(), so the
// provider-free read view resolves them exactly as it would resolve real work.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { ArticleBlock, ArticleBlockType, ArticleSourcePolicy, ArticleVersion } from "@shared/article"
import type { FeedCategory, FeedItem, ShippingSettings } from "@shared/shipping"
import { ArticleRepository } from "#/database/article"
import { defaultShippingSettings } from "#/database/runtime"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { TranslationRepository } from "#/database/translation"
import { extractArticle } from "#/providers/article-extractor"
import { computeArticleContentHash } from "#/services/article-content-hash"
import {
  ARTICLE_TRANSLATION_CONTRACT_VERSION,
  planArticleTranslation,
} from "#/services/article-translation-source"
import { TranslationService } from "#/services/translation-service"

const TARGET_LANGUAGE = "zh-CN"
const PROVIDER = "deepseek"
const MODEL = "deepseek-v4-flash"
const PUBLISHED_AT = "2026-09-10T00:00:00.000Z"
const FETCHED_AT = "2026-09-11T02:00:00.000Z"
const FETCHED_AT_OLDER = "2026-09-09T02:00:00.000Z"
const TRANSLATED_AT = "2026-09-11T03:00:00.000Z"
const TRANSLATED_AT_OLDER = "2026-09-09T03:00:00.000Z"
const FIXTURE_MARK = "【中译】"

function createNativeDatabase(path: string) {
  const native = new NativeDatabase(path)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

/* ------------------------------------------------------------------ fixtures */

const LONG_SENTENCE
  = "The operator confirmed that IMO 9155391 with MMSI 636019825 was holding a draft of 14.2 m and a speed of 18.5 knots, "
    + "and that the reroute added USD 1,250,000 of bunker and charter cost to every 30-day rotation. "

function longParagraph(): string {
  return Array.from({ length: 9 }, () => LONG_SENTENCE).join("").trim()
}

const LIST_SEPARATOR = " • "
const TABLE_ROW_SEPARATOR = "\n"
const TABLE_CELL_SEPARATOR = " | "

function heading(key: string, order: number, level: number, text: string): ArticleBlock {
  return { id: `block:${key}`, blockKey: key, order, type: "heading", text, metadata: { level } }
}
function paragraph(key: string, order: number, text: string, href?: string): ArticleBlock {
  return { id: `block:${key}`, blockKey: key, order, type: "paragraph", text, metadata: href ? { href } : undefined }
}
function list(key: string, order: number, ordered: boolean, items: string[]): ArticleBlock {
  return { id: `block:${key}`, blockKey: key, order, type: "list", text: items.join(LIST_SEPARATOR), metadata: { ordered } }
}
function table(key: string, order: number, header: boolean, rows: string[][]): ArticleBlock {
  return { id: `block:${key}`, blockKey: key, order, type: "table", text: rows.map(cells => cells.join(TABLE_CELL_SEPARATOR)).join(TABLE_ROW_SEPARATOR), metadata: { header } }
}
function caption(key: string, order: number, text: string, href?: string): ArticleBlock {
  return { id: `block:${key}`, blockKey: key, order, type: "caption", text, metadata: href ? { href } : undefined }
}

/**
 * A complete article whose blocks come from the REAL `extractArticle` path
 * instead of hand-written fixtures. This is the only scenario that can prove the
 * table/list skeleton survives extraction, because a hand-written fixture would
 * hide an extraction-time structural loss.
 */
function extractedArticle(): { blocks: ArticleBlock[], completeness: ArticleVersion["completenessStatus"], language?: string } {
  const policy: ArticleSourcePolicy = {
    sourceId: "s5-fixture-real-extractor",
    status: "allowed",
    fetchAllowed: true,
    persistence: "full",
    allowedHosts: ["example.com"],
    allowedContentTypes: ["text/html"],
    selectors: { container: "article", title: "h1" },
    completeness: { minParagraphs: 3, minCharacters: 200, requireHeading: true },
  }
  const html = `<!doctype html><html lang="en"><head><title>ignored</title></head><body>
    <nav>Navigation must be dropped</nav>
    <article>
      <h1>Extracted berth and schedule advisory</h1>
      <p>Berth operations resumed at 06:00 local time after the gale warning was lifted by the harbour master.</p>
      <p>The terminal confirms that IMO 9155391 holds a draft of 14.2 m and will sail at 18.5 knots on the next rotation.</p>
      <p>The reroute adds USD 1,250,000 of bunker and charter cost to every 30-day rotation on the affected loops.</p>
      <table>
        <thead><tr><th>Berth</th><th>Status</th><th>Draft limit (m)</th></tr></thead>
        <tbody>
          <tr><td>AE7</td><td>Open</td><td>16.5</td></tr>
          <tr><td>MD2</td><td>Closed for dredging</td><td>11.0</td></tr>
          <tr><td>MD3</td><td>Open</td><td>12.5</td></tr>
        </tbody>
      </table>
      <ul><li>Re-plan the berth window at Jebel Ali</li><li>Confirm the feeder connection in Piraeus</li><li>Re-issue the bill of lading rider</li></ul>
      <figure><img src="/chart.png" alt=""/><figcaption>Figure 1: revised rotation for the affected loops.</figcaption></figure>
    </article>
    <aside class="ad">Buy our service now</aside>
  </body></html>`
  const extracted = extractArticle(html, "https://example.com/s5/s5-article-extracted", policy)
  if (extracted.status !== "complete" || extracted.blocks.length === 0) {
    throw new Error(`real extractor fixture did not produce a complete article: ${extracted.status}`)
  }
  return { blocks: extracted.blocks, completeness: extracted.status, language: extracted.language }
}

/**
 * A 20-block English article: 14 paragraphs (including one >1200-character
 * paragraph carrying numbers/units/identifiers), 2 headings, an unordered and an
 * ordered list, a table with header, and a caption with a safe link.
 */
function twentyBlockArticle(slug: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [heading("h-01", 1, 1, `Red Sea Transit Advisory — ${slug}`)]
  for (let order = 2; order <= 11; order += 1) {
    const key = `p-${String(order).padStart(2, "0")}`
    blocks.push(paragraph(key, order, order === 11
      ? longParagraph()
      : `Paragraph ${order}: carriers published a revised contingency plan for the ${slug} corridor, effective on the next rotation.`))
  }
  blocks.push(heading("h-12", 12, 2, "Schedule impact by service"))
  blocks.push(list("l-13", 13, false, [
    "Asia to North Europe loops add 9 to 12 days of transit",
    "Mediterranean services add 4 to 6 days and one extra port call",
    "Empty repositioning is deferred by 14 days on the backhaul",
  ]))
  blocks.push(list("l-14", 14, true, [
    "Re-plan the berth window at Jebel Ali",
    "Confirm the feeder connection in Piraeus",
    "Re-issue the bill of lading rider",
  ]))
  blocks.push(table("t-15", 15, true, [
    ["Service", "Added days", "Added cost (USD)"],
    ["AE7", "11", "1,250,000"],
    ["MD2", "5", "480,000"],
    ["AEU1", "9", "910,000"],
  ]))
  blocks.push(caption("c-16", 16, "Figure 1: revised rotation for the affected loops.", "https://example.com/s5/figure-1"))
  for (let order = 17; order <= 20; order += 1) {
    const key = `p-${String(order).padStart(2, "0")}`
    blocks.push(paragraph(key, order, `Closing paragraph ${order}: the ${slug} advisory remains advisory-only until the next carrier bulletin.`))
  }
  return blocks
}

/**
 * Fixture translations. They are deliberately marked with a visible sentinel so
 * no reader can mistake them for real DeepSeek output; list/table separators are
 * reproduced verbatim so the structural re-render stays faithful.
 *
 * `breakShape` deliberately returns a *wrong* skeleton for one block type (a list
 * with an extra item, a table with a dropped row) so the view must refuse to
 * render it. This is a hand-built cache row, not a legal Provider response: the
 * `article-faithful-v1` guard rejects a real response that changes the shape.
 */
function fixtureTranslation(block: ArticleBlock, sentinel: string, breakShape?: ArticleBlockType): string {
  if (block.type === "list") {
    const items = block.text.split(LIST_SEPARATOR).map(item => `${sentinel}${item}`)
    if (breakShape === "list") items.push(`${sentinel}结构不符的额外条目`)
    return items.join(LIST_SEPARATOR)
  }
  if (block.type === "table") {
    const rows = block.text
      .split(TABLE_ROW_SEPARATOR)
      .map(row => row.split(TABLE_CELL_SEPARATOR).map(cell => `${sentinel}${cell}`).join(TABLE_CELL_SEPARATOR))
    if (breakShape === "table" && rows.length > 1) rows.pop()
    return rows.join(TABLE_ROW_SEPARATOR)
  }
  return `${sentinel}${block.text}`
}

function feedItem(id: string, title: string, category: FeedCategory): FeedItem {
  return {
    id,
    sourceId: "s5-fixture-source",
    category,
    freshnessPolicy: "official",
    type: "advisory",
    title,
    summary: `${title} — deterministic S5 acceptance fixture.`,
    sourceUrl: `https://example.com/s5/${id}`,
    canonicalUrl: `https://example.com/s5/${id}`,
    publishedAt: PUBLISHED_AT,
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: PUBLISHED_AT,
    stale: false,
    sourceStatus: "healthy",
    severity: "watch",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
  }
}

/* ------------------------------------------------------------------- seeding */

type CacheState = "succeeded" | "pending" | "failed" | "absent"

interface Scenario {
  id: string
  title: string
  category: FeedCategory
  language: string
  completeness: ArticleVersion["completenessStatus"]
  redistributionPolicy?: string
  blocks: ArticleBlock[]
  /** Per-block cache state; shorter arrays leave the trailing blocks absent. */
  cache: CacheState[]
  fetchedAt?: string
  /** Seed the cache rows under a legacy model so they must be labelled historical. */
  legacyModel?: string
  /**
   * Block types whose cached fixture translation deliberately has a different
   * list/table skeleton, so the view must refuse to render it (`rejected`).
   */
  breakShape?: ArticleBlockType[]
  /** Older version seeded before this one (same feed item). */
  history?: { language: string, blocks: ArticleBlock[], cache: CacheState[], fetchedAt: string, translatedAt: string, hashSalt: string }
}

interface SeededBlockExpectation {
  blockKey: string
  order: number
  type: ArticleBlockType
  text: string
  metadata?: Record<string, unknown>
  expectedTranslatedText?: string
  expectedSource: "translation" | "historical" | "original" | "pending" | "failed" | "rejected" | "missing"
}

interface ScenarioExpectation {
  id: string
  path: string
  title: string
  completeness: ArticleVersion["completenessStatus"]
  language: string
  versionId: string
  contentHash: string
  eligible: boolean
  status: "complete" | "partial" | "untranslated" | "ineligible"
  total: number
  translated: number
  historical: number
  originalSameLanguage: number
  pending: number
  failed: number
  rejected: number
  missing: number
  completedCount: number
  structure: { heading: number, paragraph: number, list: number, table: number, caption: number }
  blocks: SeededBlockExpectation[]
  history?: {
    versionId: string
    contentHash: string
    apiPath: string
    sentinel: string
    currentSentinel: string
    headingText: string
    currentHeadingText: string
  }
  /** Fixture sentinel that must never appear on another version's page. */
  sentinel: string
}

function versionIdFor(feedItemId: string, hash: string): string {
  return `article-version:${feedItemId}:${hash.slice(0, 16)}`
}

/**
 * The fixture rows carry `provider: "deepseek"`, `model: "deepseek-v4-flash"` and
 * `status: "succeeded"`, so writing them into the real database would make the
 * product read path present fixture text as the configured model's own output.
 * The run directory must therefore stay inside the workspace's gitignored `.tmp/`
 * unless the operator explicitly opts out for a throwaway copy.
 */
function assertIsolatedRunDir(runDir: string): void {
  const temporary = resolve(process.cwd(), ".tmp")
  const insideTemporary = runDir === temporary || runDir.startsWith(`${temporary}${sep}`)
  if (insideTemporary || process.env.S5_SEED_ALLOW_OUTSIDE_TMP === "1") return
  throw new Error(`refusing to seed ${runDir}: fixture translations must not be written outside .tmp (set S5_SEED_ALLOW_OUTSIDE_TMP=1 only for a throwaway database)`)
}

async function main() {
  const runDir = resolve(process.argv[2] ?? join(process.cwd(), ".tmp", "s5-browser"))
  assertIsolatedRunDir(runDir)
  const databasePath = join(runDir, ".data", "shipping-hot-v3.sqlite3")
  mkdirSync(dirname(databasePath), { recursive: true })

  const { database, native } = createNativeDatabase(databasePath)
  await initShippingTables(database, "mock")

  const settings: ShippingSettings = {
    ...structuredClone(defaultShippingSettings),
    translation: {
      enabled: true,
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      targetLanguage: TARGET_LANGUAGE,
      monthlyBudget: 5,
    },
  }
  const shipping = new ShippingRepository(database, "mock")
  await shipping.seed([], [], [], [], [], settings)

  // One non-blocked Runtime row so the harness's provider_runtime snapshot is not
  // trivially empty: an accidental in-place UPDATE (for example an unconditional
  // circuit clear on a settings write) changes the recorded state and fails.
  const runtime = new RuntimeRepository(database)
  await runtime.updateProviderRuntime({ providerId: "deepseek", capability: "translation", status: "degraded", updatedAt: FETCHED_AT })

  const articles = new ArticleRepository(database)
  const translations = new TranslationRepository(database)
  const service = new TranslationService(translations, undefined, {
    targetLanguage: TARGET_LANGUAGE,
    contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION,
  })

  const realExtracted = extractedArticle()
  const scenarios: Scenario[] = [
    {
      id: "s5-article-complete",
      title: "S5 complete article with 20/20 translated blocks",
      category: "shipping_news",
      language: "en",
      completeness: "complete",
      blocks: twentyBlockArticle("AE7"),
      cache: Array.from({ length: 20 }, () => "succeeded" as CacheState),
    },
    {
      id: "s5-article-partial",
      title: "S5 partial article with 19/20 translated blocks",
      category: "carrier_notice",
      language: "en",
      completeness: "complete",
      blocks: twentyBlockArticle("MD2"),
      // The last required block stays absent so the view must report 19/20.
      cache: [...Array.from({ length: 19 }, () => "succeeded" as CacheState), "absent"],
    },
    {
      id: "s5-article-untranslated",
      title: "S5 complete article with no translated block yet",
      category: "shipping_news",
      language: "en",
      completeness: "complete",
      blocks: twentyBlockArticle("AEU1"),
      cache: [],
    },
    {
      id: "s5-article-ineligible",
      title: "S5 incomplete article is not eligible for translation",
      category: "shipping_news",
      language: "en",
      completeness: "incomplete",
      blocks: twentyBlockArticle("INCOMPLETE").slice(0, 6),
      cache: [],
    },
    {
      id: "s5-article-excerpt",
      title: "S5 excerpt-only article is not eligible for translation",
      category: "port_notice",
      language: "en",
      completeness: "summary_only",
      redistributionPolicy: "excerpt_only",
      blocks: [paragraph("p-01", 1, "Only a limited excerpt of this notice may be stored under the source policy.")],
      cache: [],
    },
    {
      id: "s5-article-same-language",
      title: "S5 Chinese source is reused as original text",
      category: "shipping_news",
      language: "zh-CN",
      completeness: "complete",
      blocks: [
        heading("h-01", 1, 1, "红海航线调整通知"),
        paragraph("p-02", 2, "承运人确认 IMO 9155391 与 MMSI 636019825 的吃水为 14.2 米，航速 18.5 节。"),
        paragraph("p-03", 3, "改道使每个 30 天往返增加 USD 1,250,000 的燃油与租船成本。"),
        list("l-04", 4, false, ["亚洲至北欧航线增加 9 至 12 天", "地中海航线增加 4 至 6 天", "空箱调运推迟 14 天"]),
      ],
      cache: [],
    },
    {
      id: "s5-article-fallback",
      title: "S5 pending / failed / missing fallbacks keep the original readable",
      category: "shipping_news",
      language: "en",
      completeness: "complete",
      blocks: [
        paragraph("p-01", 1, "Succeeded block: the reroute is confirmed for the next rotation."),
        paragraph("p-02", 2, "Pending block: the carrier has not published the revised window yet."),
        paragraph("p-03", 3, "Failed block: the previous attempt returned a provider error."),
        paragraph("p-04", 4, "Missing block: no translation work has been recorded for this block."),
      ],
      cache: ["succeeded", "pending", "failed", "absent"],
    },
    {
      id: "s5-article-spanish",
      title: "S5 Spanish source article translated into Chinese",
      category: "shipping_news",
      language: "es",
      completeness: "complete",
      blocks: [
        heading("h-01", 1, 1, "Aviso de tránsito en el Mar Rojo"),
        paragraph("p-02", 2, "El operador confirmó que el buque IMO 9155391 navega a 18.5 nudos con un calado de 14.2 m."),
        paragraph("p-03", 3, "El desvío añade USD 1,250,000 de coste por rotación de 30 días."),
        table("t-04", 4, true, [["Servicio", "Días añadidos"], ["AE7", "11"], ["MD2", "5"]]),
      ],
      cache: ["succeeded", "succeeded", "succeeded", "succeeded"],
    },
    {
      id: "s5-article-history",
      title: "S5 newer article version must not leak the older version translation",
      category: "shipping_news",
      language: "en",
      completeness: "complete",
      blocks: [
        heading("h-01", 1, 1, "Revised advisory: version B (current)"),
        paragraph("p-02", 2, "Version B reports 11 added days for the AE7 loop after the latest carrier bulletin."),
        list("l-03", 3, false, ["Version B item one", "Version B item two"]),
      ],
      cache: ["succeeded", "succeeded", "succeeded"],
      history: {
        hashSalt: "version-a",
        language: "en",
        fetchedAt: FETCHED_AT_OLDER,
        translatedAt: TRANSLATED_AT_OLDER,
        blocks: [
          heading("h-01", 1, 1, "Original advisory: version A (superseded)"),
          paragraph("p-02", 2, "Version A reported 9 added days for the AE7 loop before the revision."),
          list("l-03", 3, false, ["Version A item one", "Version A item two"]),
        ],
        cache: ["succeeded", "succeeded", "succeeded"],
      },
    },
    {
      id: "s5-article-extracted",
      title: "S5 real extractor output keeps multi-row table and list structure",
      category: "port_notice",
      language: realExtracted.language ?? "en",
      completeness: realExtracted.completeness,
      blocks: realExtracted.blocks,
      cache: Array.from({ length: realExtracted.blocks.length }, () => "succeeded" as CacheState),
    },
    {
      id: "s5-article-historical",
      title: "S5 cache written by a previous model is labelled historical",
      category: "shipping_news",
      language: "en",
      completeness: "complete",
      blocks: [
        paragraph("p-01", 1, "Cached block from a previous model configuration."),
        paragraph("p-02", 2, "Second cached block from a previous model configuration."),
      ],
      cache: ["succeeded", "succeeded"],
      legacyModel: "deepseek-v3-legacy",
    },
    {
      id: "s5-article-shape-mismatch",
      title: "S5 cached translation that would change the structure is never rendered",
      category: "carrier_notice",
      language: "en",
      completeness: "complete",
      blocks: [
        paragraph("p-01", 1, "Succeeded paragraph that still matches its own skeleton."),
        list("l-02", 2, false, ["First stored item", "Second stored item"]),
        table("t-03", 3, true, [["Service", "Added days"], ["AE7", "11"], ["MD2", "5"]]),
      ],
      cache: ["succeeded", "succeeded", "succeeded"],
      breakShape: ["list", "table"],
    },
  ]

  const expectations: ScenarioExpectation[] = []

  for (const scenario of scenarios) {
    const item = feedItem(scenario.id, scenario.title, scenario.category)
    await shipping.seed([], [], [], [item], [], settings)
    const sourceUrl = item.sourceUrl
    const sourceId = item.sourceId

    // Older version first so the current version is the newest observation.
    let historyExpectation: ScenarioExpectation["history"]
    if (scenario.history) {
      const historyHash = computeArticleContentHash(scenario.history.blocks)
      const historyVersionId = versionIdFor(scenario.id, `${scenario.history.hashSalt}:${historyHash}`)
      const historyVersion: ArticleVersion = {
        id: historyVersionId,
        feedItemId: scenario.id,
        contentHash: historyHash,
        language: scenario.history.language,
        sourcePublishedAt: PUBLISHED_AT,
        sourceUpdatedAt: PUBLISHED_AT,
        fetchedAt: scenario.history.fetchedAt,
        extractorVersion: "article-extractor-fixture",
        completenessStatus: "complete",
        accessPolicy: "allowed",
        redistributionPolicy: "full",
        createdAt: scenario.history.fetchedAt,
      }
      await articles.saveFetchState({
        feedItemId: scenario.id,
        sourceId,
        originalUrl: sourceUrl,
        completenessStatus: "complete",
        lastAttemptAt: scenario.history.fetchedAt,
        lastSuccessAt: scenario.history.fetchedAt,
        updatedAt: scenario.history.fetchedAt,
      })
      await articles.saveVersionWithBlocks(historyVersion, scenario.history.blocks)
      const historyTexts = await seedCache({
        scenario: { ...scenario, blocks: scenario.history.blocks, cache: scenario.history.cache, language: scenario.history.language },
        version: historyVersion,
        translations,
        service,
        translatedAt: scenario.history.translatedAt,
        sentinel: "版本 A 译文",
      })
      historyExpectation = {
        versionId: historyVersionId,
        contentHash: historyHash,
        apiPath: `/api/shipping/feed/${scenario.id}?versionId=${encodeURIComponent(historyVersionId)}`,
        sentinel: historyTexts[0] ?? "",
        currentSentinel: "",
        headingText: scenario.history.blocks[0]?.text ?? "",
        currentHeadingText: scenario.blocks[0]?.text ?? "",
      }
    }

    const hash = computeArticleContentHash(scenario.blocks)
    const versionId = versionIdFor(scenario.id, hash)
    const version: ArticleVersion = {
      id: versionId,
      feedItemId: scenario.id,
      contentHash: hash,
      language: scenario.language,
      sourcePublishedAt: PUBLISHED_AT,
      sourceUpdatedAt: PUBLISHED_AT,
      fetchedAt: scenario.fetchedAt ?? FETCHED_AT,
      extractorVersion: "article-extractor-fixture",
      completenessStatus: scenario.completeness,
      accessPolicy: scenario.redistributionPolicy === "excerpt_only" ? "excerpt_only" : "allowed",
      redistributionPolicy: scenario.redistributionPolicy ?? "full",
      createdAt: scenario.fetchedAt ?? FETCHED_AT,
    }
    await articles.saveFetchState({
      feedItemId: scenario.id,
      sourceId,
      originalUrl: sourceUrl,
      completenessStatus: scenario.completeness,
      lastAttemptAt: scenario.fetchedAt ?? FETCHED_AT,
      lastSuccessAt: scenario.completeness === "complete" || scenario.completeness === "summary_only" ? (scenario.fetchedAt ?? FETCHED_AT) : null,
      updatedAt: scenario.fetchedAt ?? FETCHED_AT,
    })
    await articles.saveVersionWithBlocks(version, scenario.blocks)

    const sentinel = scenario.history ? `版本 B 译文` : FIXTURE_MARK
    const translatedTexts = await seedCache({
      scenario,
      version,
      translations,
      service,
      translatedAt: TRANSLATED_AT,
      sentinel,
    })
    if (historyExpectation) historyExpectation.currentSentinel = translatedTexts[0] ?? ""

    const plan = planArticleTranslation({
      version,
      blocks: scenario.blocks,
      targetLanguage: TARGET_LANGUAGE,
      prepare: service.prepare.bind(service),
    })
    const usable = scenario.blocks.filter(block => block.text.trim().length > 0)
    const structure = { heading: 0, paragraph: 0, list: 0, table: 0, caption: 0 }
    for (const block of usable) structure[block.type] += 1

    const reuse = plan.eligible ? new Set(plan.originalReuseBlockKeys) : new Set<string>()
    const pendingKeys = plan.eligible ? plan.pending.map(source => source.fieldName) : []
    const blockExpectations: SeededBlockExpectation[] = usable
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((block) => {
        const index = pendingKeys.indexOf(block.blockKey)
        const state: CacheState = index >= 0 ? (scenario.cache[index] ?? "absent") : "absent"
        const base = { blockKey: block.blockKey, order: block.order, type: block.type, text: block.text, metadata: block.metadata }
        if (reuse.has(block.blockKey)) return { ...base, expectedSource: "original" as const }
        if (!plan.eligible) return { ...base, expectedSource: "missing" as const }
        const translated = translatedTexts[index]
        // A cached string that would change the stored skeleton is never rendered,
        // so it has no expected translated text and is reported as `rejected`.
        if (state === "succeeded" && translated && scenario.breakShape?.includes(block.type)) return { ...base, expectedSource: "rejected" as const }
        // Rows written by a legacy model are surfaced as historical, never as the
        // configured model's own translation.
        if (state === "succeeded" && translated) return { ...base, expectedTranslatedText: translated, expectedSource: scenario.legacyModel ? "historical" as const : "translation" as const }
        if (state === "pending") return { ...base, expectedSource: "pending" as const }
        if (state === "failed") return { ...base, expectedSource: "failed" as const }
        return { ...base, expectedSource: "missing" as const }
      })

    const translated = blockExpectations.filter(block => block.expectedSource === "translation").length
    const historical = blockExpectations.filter(block => block.expectedSource === "historical").length
    const originalSameLanguage = blockExpectations.filter(block => block.expectedSource === "original").length
    const pending = blockExpectations.filter(block => block.expectedSource === "pending").length
    const failed = blockExpectations.filter(block => block.expectedSource === "failed").length
    const rejected = blockExpectations.filter(block => block.expectedSource === "rejected").length
    const missing = blockExpectations.filter(block => block.expectedSource === "missing").length
    const completedCount = translated + historical + originalSameLanguage
    const status: ScenarioExpectation["status"] = !plan.eligible
      ? "ineligible"
      : completedCount === 0
        ? "untranslated"
        : completedCount >= usable.length ? "complete" : "partial"

    expectations.push({
      id: scenario.id,
      path: `/feed/${scenario.id}`,
      title: scenario.title,
      completeness: scenario.completeness,
      language: scenario.language,
      versionId,
      contentHash: hash,
      eligible: plan.eligible,
      status,
      total: plan.eligible ? plan.total : usable.length,
      translated,
      historical,
      originalSameLanguage,
      pending,
      failed,
      rejected,
      missing,
      completedCount,
      structure,
      blocks: blockExpectations,
      history: historyExpectation,
      sentinel,
    })
  }

  native.close()

  const manifest = {
    generatedFor: "s5-article-targeted-browser-acceptance",
    dataMode: "mock",
    targetLanguage: TARGET_LANGUAGE,
    provider: PROVIDER,
    model: MODEL,
    databasePath,
    settings: { translationEnabled: true, monthlyBudget: 5 },
    expectations,
  }
  const manifestPath = join(runDir, "s5-article-manifest.json")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  console.log(`S5 seed complete: ${databasePath}`)
  console.log(`S5 manifest: ${manifestPath}`)
  console.log(`S5 scenarios: ${expectations.map(entry => `${entry.id}=${entry.status}(${entry.completedCount}/${entry.total}${entry.historical > 0 ? `,historical:${entry.historical}` : ""})`).join(", ")}`)
}

async function seedCache(input: {
  scenario: Scenario
  version: ArticleVersion
  translations: TranslationRepository
  service: TranslationService
  translatedAt: string
  sentinel: string
}): Promise<string[]> {
  const { scenario, version, translations, service, translatedAt, sentinel } = input
  const provider = PROVIDER
  const model = scenario.legacyModel ?? MODEL
  const plan = planArticleTranslation({
    version,
    blocks: scenario.blocks,
    targetLanguage: TARGET_LANGUAGE,
    prepare: service.prepare.bind(service),
  })
  if (!plan.eligible) return []
  const saved: string[] = []
  for (let index = 0; index < plan.pending.length; index += 1) {
    const source = plan.pending[index]
    const state: CacheState = scenario.cache[index] ?? "absent"
    if (state === "absent") {
      saved.push("")
      continue
    }
    const block = scenario.blocks.find(candidate => candidate.blockKey === source.fieldName)
    const translatedText = state === "succeeded" && block ? fixtureTranslation(block, sentinel, scenario.breakShape?.includes(block.type) ? block.type : undefined) : undefined
    await translations.save({
      id: `translation:fixture:${version.id}:${source.fieldName}:${state}:${model}`,
      entityType: source.entityType,
      entityId: source.entityId,
      fieldName: source.fieldName,
      sourceText: source.sourceText,
      sourceHash: source.sourceHash,
      sourceLanguage: source.sourceLanguage,
      targetLanguage: source.targetLanguage,
      provider,
      model,
      translatedText,
      translatedAt: state === "succeeded" ? translatedAt : undefined,
      status: state,
      errorMessage: state === "failed" ? "fixture_provider_error" : undefined,
      retryable: state === "failed",
      lastErrorCode: state === "failed" ? "fixture_provider_error" : undefined,
      leaseUntil: state === "pending" ? "2026-09-11T04:00:00.000Z" : null,
      preferred: false,
      createdAt: translatedAt,
      updatedAt: translatedAt,
    })
    saved.push(translatedText ?? "")
  }
  return saved
}

main().catch((error) => {
  console.error(`S5 seed failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
