import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { ArticleBlock } from "@shared/article"
import type { FeedItem, ShippingSettings } from "@shared/shipping"
import { ArticleRepository } from "#/database/article"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { RuntimeRepository } from "#/database/runtime-jobs"
import { TranslationRepository } from "#/database/translation"
import type { SecretSource, SecretStore, TranslationRequest } from "#/providers/contracts"
import { FakeTranslationProvider } from "#/providers/translation/fake-provider"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION } from "#/services/article-translation-source"
import { TranslationService } from "#/services/translation-service"
import { type TranslationWorkItem, createTranslationSyncJob, orderTranslationWork, revalidateArticle, translationDeferralRetryAt } from "#/runtime/translation-sync-job"

function createNativeDatabase() {
  const native = new NativeDatabase(":memory:")
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

class TestSecretStore implements SecretStore {
  async get() {
    return "test-secret"
  }

  async set() {}
  async delete() {}
  async has() {
    return true
  }

  async source(): Promise<SecretSource> {
    return "environment"
  }
}

function settings(monthlyBudget = 1): ShippingSettings {
  return {
    refreshInterval: 15,
    sourceEnabled: true,
    providerEnabled: true,
    eventThresholds: { anchoredHours: 24, delayMinutes: 120, congestionLevel: "high" },
    retentionDays: 30,
    translation: { enabled: true, providerId: "deepseek", model: "deepseek-v4-flash", targetLanguage: "zh-CN", monthlyBudget },
  }
}

function feed(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "feed-art-1",
    sourceId: "public-feed",
    category: "shipping_news",
    type: "news",
    title: "",
    summary: "",
    sourceUrl: "https://example.com/feed-art-1",
    publishedAt: "2026-09-02T00:00:00.000Z",
    currentUntil: "2026-09-03T00:00:00.000Z",
    visibility: "current",
    stale: false,
    sourceStatus: "healthy",
    severity: "warning",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    provenance: { sourceType: "official", dataNature: "reported", sourceId: "public-feed", verified: false },
    source_type: "real",
    ...overrides,
  }
}

const CLOCK = new Date("2026-09-02T00:30:00.000Z")
const NOW_ISO = CLOCK.toISOString()

function blocks(): ArticleBlock[] {
  return [
    { id: "b0", blockKey: "0", order: 0, type: "paragraph", text: "Paragraph zero." },
    { id: "b1", blockKey: "1", order: 1, type: "paragraph", text: "Paragraph one." },
  ]
}

async function preparedState(inputFeed = feed(), monthlyBudget = 1, dataMode: "mock" | "real" = "real") {
  const state = createNativeDatabase()
  await initShippingTables(state.database, dataMode)
  const shippingRepository = new ShippingRepository(state.database, dataMode)
  await shippingRepository.saveSettings(settings(monthlyBudget))
  await shippingRepository.upsertFeedItem(inputFeed)
  return { ...state, shippingRepository, articleRepository: new ArticleRepository(state.database), translationRepository: new TranslationRepository(state.database), runtimeRepository: new RuntimeRepository(state.database) }
}

async function seedVersion(repository: ArticleRepository, input: { feedItemId: string, versionId: string, language?: string | null, completenessStatus?: string, redistributionPolicy?: string }) {
  const completenessStatus = (input.completenessStatus ?? "complete") as never
  await repository.saveFetchState({
    feedItemId: input.feedItemId,
    sourceId: "public-feed",
    originalUrl: `https://example.com/${input.feedItemId}`,
    completenessStatus,
    lastAttemptAt: NOW_ISO,
    updatedAt: NOW_ISO,
  })
  await repository.saveVersionWithBlocks({
    id: input.versionId,
    feedItemId: input.feedItemId,
    contentHash: input.versionId.replace(/[^a-z0-9]/g, "").padEnd(64, "0").slice(0, 64),
    language: input.language ?? "en",
    fetchedAt: NOW_ISO,
    extractorVersion: "article-extractor-v1",
    completenessStatus,
    accessPolicy: "allowed",
    redistributionPolicy: input.redistributionPolicy ?? "full",
    createdAt: NOW_ISO,
  }, blocks())
}

function translationProvider(): FakeTranslationProvider {
  return new FakeTranslationProvider({ providerId: "deepseek", model: "deepseek-v4-flash", translateText: (request: TranslationRequest) => `zh:${request.sourceText}` })
}

function jobFor(state: Awaited<ReturnType<typeof preparedState>>, provider: FakeTranslationProvider, maxFieldsPerRun = 5) {
  return createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: () => CLOCK, maxFieldsPerRun })
}

describe("translation-sync article blocks (C-5..C-10)", () => {
  it("enqueues eligible current article blocks and records sourceScope=article", async () => {
    const state = await preparedState()
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    const provider = translationProvider()
    await expect(jobFor(state, provider).run()).resolves.toMatchObject({ status: "success", recordsWritten: 2 })
    expect(provider.calls.filter(call => call.entityType === "article_block").map(call => call.fieldName).sort()).toEqual(["0", "1"])
    const scopes = (state.native.prepare("select distinct source_scope as s from provider_usage").all() as Array<{ s: string }>).map(row => row.s)
    expect(scopes).toEqual(["article"])
    await expect(state.runtimeRepository.aggregateProviderUsage({ providerId: "deepseek", capability: "translation" })).resolves.toMatchObject({ requestCount: 2, successCount: 2, recordsCount: 2 })
  })

  it("excludes same-language, incomplete/restricted and historical versions", async () => {
    const sameLanguage = await preparedState(feed({ id: "feed-zh" }))
    await seedVersion(sameLanguage.articleRepository, { feedItemId: "feed-zh", versionId: "version-zh", language: "zh-CN" })
    const provider1 = translationProvider()
    await expect(jobFor(sameLanguage, provider1).run()).resolves.toMatchObject({ recordsWritten: 0 })
    expect(provider1.calls).toHaveLength(0)

    const restricted = await preparedState(feed({ id: "feed-restricted" }))
    await seedVersion(restricted.articleRepository, { feedItemId: "feed-restricted", versionId: "version-r", completenessStatus: "summary_only", redistributionPolicy: "excerpt_only" })
    const provider2 = translationProvider()
    await expect(jobFor(restricted, provider2).run()).resolves.toMatchObject({ recordsWritten: 0 })
    expect(provider2.calls).toHaveLength(0)

    const historical = await preparedState(feed({ id: "feed-hist" }))
    await seedVersion(historical.articleRepository, { feedItemId: "feed-hist", versionId: "version-old" })
    await seedVersion(historical.articleRepository, { feedItemId: "feed-hist", versionId: "version-current" })
    const provider3 = translationProvider()
    await jobFor(historical, provider3).run()
    const entityIds = provider3.calls.map(call => call.entityId)
    expect(entityIds.every(id => id === "version-current")).toBe(true)
  })

  it("hits exact cache on restart with zero provider calls", async () => {
    const state = await preparedState()
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    const provider = translationProvider()
    const job = jobFor(state, provider)
    await expect(job.run()).resolves.toMatchObject({ recordsWritten: 2 })
    expect(provider.calls).toHaveLength(2)
    await expect(job.run()).resolves.toMatchObject({ status: "success", recordsWritten: 0 })
    expect(provider.calls).toHaveLength(2)
  })

  it("recovers a stale lease without re-translating unknown work and continues untouched blocks", async () => {
    const state = await preparedState()
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    const provider = translationProvider()
    const service = new TranslationService(state.translationRepository, provider, { targetLanguage: "zh-CN", contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
    const prepared = service.prepare({ entityType: "article_block", entityId: "version-a", fieldName: "0", sourceText: "Paragraph zero.", sourceLanguage: "en", targetLanguage: "zh-CN" })
    // Simulate a process interrupted mid-run: a stale pending claim for block 0.
    const claimed = await state.translationRepository.claimTranslationWork({ entityType: "article_block", entityId: "version-a", fieldName: "0", sourceHash: prepared.sourceHash, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash", sourceText: prepared.sourceText, sourceLanguage: "en", now: "2026-09-02T00:00:00.000Z", leaseUntil: "2026-09-02T00:00:30.000Z" })
    expect(claimed).toBeTruthy()
    const job = jobFor(state, provider)
    // The unknown-attempt block is not silently re-billed; the untouched block still advances.
    await expect(job.run()).resolves.toMatchObject({ recordsWritten: 1 })
    expect(provider.calls.filter(call => call.fieldName === "0")).toHaveLength(0)
    expect(provider.calls.filter(call => call.fieldName === "1")).toHaveLength(1)
    await expect(job.run()).resolves.toMatchObject({ recordsWritten: 0 })
    expect(provider.calls).toHaveLength(1)
  })

  it("blocks an article call on the projected budget guard without recording projected spend", async () => {
    const state = await preparedState(feed(), 0.000001)
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    const provider = translationProvider()
    await expect(jobFor(state, provider).run()).resolves.toMatchObject({ status: "skipped", errorCode: "translation_budget_projected_exceeded" })
    expect(provider.calls).toHaveLength(0)
    const usage = state.native.prepare("select count(*) as n from provider_usage").get() as { n: number }
    expect(usage.n).toBe(0)
  })

  it("rejects a changed version and a changed source hash before any call", async () => {
    const state = await preparedState()
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-b" })
    const service = new TranslationService(state.translationRepository, translationProvider(), { targetLanguage: "zh-CN", contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
    const staleItem: TranslationWorkItem = { scope: "article", feedItemId: "feed-art-1", source: service.prepare({ entityType: "article_block", entityId: "version-a", fieldName: "0", sourceText: "Paragraph zero.", sourceLanguage: "en", targetLanguage: "zh-CN" }) }
    await expect(revalidateArticle(state.shippingRepository, state.articleRepository, staleItem, service, () => CLOCK)).resolves.toMatchObject({ ok: false, errorCode: "translation_article_version_changed" })

    const currentItem: TranslationWorkItem = { scope: "article", feedItemId: "feed-art-1", source: service.prepare({ entityType: "article_block", entityId: "version-b", fieldName: "0", sourceText: "A different body.", sourceLanguage: "en", targetLanguage: "zh-CN" }) }
    await expect(revalidateArticle(state.shippingRepository, state.articleRepository, currentItem, service, () => CLOCK)).resolves.toMatchObject({ ok: false, errorCode: "translation_source_changed" })
  })

  it("treats a superseded version as a retryable, backed-off deferral so an A -> B -> A revert recovers", async () => {
    const state = await preparedState()
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-b" })
    const provider = translationProvider()
    const service = new TranslationService(state.translationRepository, provider, { targetLanguage: "zh-CN", contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION })
    const item: TranslationWorkItem = { scope: "article", feedItemId: "feed-art-1", source: service.prepare({ entityType: "article_block", entityId: "version-a", fieldName: "0", sourceText: "Paragraph zero.", sourceLanguage: "en", targetLanguage: "zh-CN" }) }
    await expect(revalidateArticle(state.shippingRepository, state.articleRepository, item, service, () => CLOCK)).resolves.toMatchObject({ ok: false, errorCode: "translation_article_version_changed", retryable: true })

    // The job's own deferral release shape: retryable AND backed off, so the row is
    // not re-claimed on every run while retry_count grows.
    const identity = { entityType: "article_block", entityId: "version-a", fieldName: "0", sourceHash: item.source.sourceHash, targetLanguage: "zh-CN", provider: "deepseek", model: "deepseek-v4-flash" }
    const claimed = await state.translationRepository.claimTranslationWork({ ...identity, sourceText: item.source.sourceText, sourceLanguage: "en", now: NOW_ISO, leaseUntil: "2026-09-02T00:31:00.000Z" })
    if (!claimed?.leaseUntil) throw new Error("deferral claim missing lease")
    const retryAt = translationDeferralRetryAt(claimed.retryCount ?? 0, CLOCK)
    expect(Date.parse(retryAt)).toBeGreaterThan(Date.parse(NOW_ISO))
    await expect(state.translationRepository.releaseTranslationClaim({
      ...identity,
      leaseUntil: claimed.leaseUntil,
      errorCode: "translation_article_version_changed",
      errorMessage: "article version is no longer current",
      retryable: true,
      nextRetryAt: retryAt,
    })).resolves.toMatchObject({ status: "failed", retryable: true, lastErrorCode: "translation_article_version_changed" })
    await expect(state.translationRepository.claimTranslationWork({ ...identity, sourceText: item.source.sourceText, sourceLanguage: "en", now: NOW_ISO, leaseUntil: "2026-09-02T00:32:00.000Z" })).resolves.toBeUndefined()
    const reclaimed = await state.translationRepository.claimTranslationWork({ ...identity, sourceText: item.source.sourceText, sourceLanguage: "en", now: new Date(Date.parse(retryAt) + 1000).toISOString(), leaseUntil: "2026-09-02T00:33:00.000Z" })
    expect(reclaimed).toMatchObject({ retryCount: 1 })
    if (!reclaimed?.leaseUntil) throw new Error("reclaim missing lease")
    // Hand the row back to the same deferred state so the assertions below see the
    // real job behaviour (a live lease would simply look like another worker).
    await state.translationRepository.releaseTranslationClaim({ ...identity, leaseUntil: reclaimed.leaseUntil, errorCode: "translation_article_version_changed", errorMessage: "article version is no longer current", retryable: true, nextRetryAt: retryAt })

    // The supported A -> B -> A revert makes version A current again, and the job
    // then translates it instead of leaving the block terminal. The deferred block
    // waits for its own backoff, so the two blocks are translated 1 then 2.
    await seedVersion(state.articleRepository, { feedItemId: "feed-art-1", versionId: "version-a" })
    await expect(revalidateArticle(state.shippingRepository, state.articleRepository, item, service, () => CLOCK)).resolves.toMatchObject({ ok: true })
    await expect(jobFor(state, provider).run()).resolves.toMatchObject({ recordsWritten: 1 })
    expect(provider.calls.map(call => `${call.entityId}:${call.fieldName}`)).toEqual(["version-a:1"])

    const afterBackoff = () => new Date(Date.parse(retryAt) + 1000)
    const recovered = createTranslationSyncJob({ database: state.database, dataMode: "real", provider, secretStore: new TestSecretStore(), now: afterBackoff, maxFieldsPerRun: 5 })
    await expect(recovered.run()).resolves.toMatchObject({ recordsWritten: 1 })
    expect(provider.calls.map(call => `${call.entityId}:${call.fieldName}`).sort()).toEqual(["version-a:0", "version-a:1"])
  })

  it("orders Feed before Article and interleaves without starvation", () => {
    const item = (scope: "feed" | "article", id: string): TranslationWorkItem => ({ scope, feedItemId: id, source: { entityType: scope === "article" ? "article_block" : "feed_item", entityId: id, fieldName: "0", sourceText: "x", sourceLanguage: "en", targetLanguage: "zh-CN", sourceHash: id } })
    const ordered = orderTranslationWork([item("feed", "f1"), item("feed", "f2"), item("feed", "f3")], [item("article", "a1"), item("article", "a2"), item("article", "a3")])
    expect(ordered).toHaveLength(6)
    expect(ordered.slice(0, 2).map(entry => entry.scope)).toEqual(["feed", "article"])
    expect(ordered.filter(entry => entry.scope === "feed")).toHaveLength(3)
    expect(ordered.filter(entry => entry.scope === "article")).toHaveLength(3)
    expect(orderTranslationWork([item("feed", "f1")], [item("article", "a1"), item("article", "a2")]).map(e => e.scope)).toEqual(["feed", "article", "article"])
  })
})
