// Deterministic, provider-free fixture seed for the S7 Clean Local Integrated Acceptance.
//
// Usage:
//   node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs \
//     ./scripts/s7-local-seed.ts <isolated-run-dir>
//
// It writes the isolated SQLite database the built Nitro server opens from its
// working directory (db0 resolves `.data/shipping-hot-v3.sqlite3` against cwd)
// plus `s7-local-manifest.json`, the exact expectations the browser run must
// observe.
//
// HONESTY NOTE (also recorded in the manifest): every value below is a
// synthetic deterministic fixture. Rows are written through the same
// repositories the Runtime uses and carry real-lineage provenance labels so the
// Real-Mode read filters are genuinely exercised, but they are NOT captured real
// Provider data and this script makes no Provider, Secret, Runtime or network
// call. The S7 evidence therefore proves integration (SQLite -> API -> browser),
// never live-provider accuracy.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { ArticleBlock, ArticleVersion } from "@shared/article"
import type { DataProvenance, FeedItem, Port, ShippingEvent, ShippingSettings, Vessel } from "@shared/shipping"
import { ArticleRepository } from "#/database/article"
import { AisPositionRepository } from "#/database/ais-positions"
import { defaultShippingSettings } from "#/database/runtime"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { TranslationRepository } from "#/database/translation"
import { VesselMetadataRepository } from "#/database/vessel-search"
import { VoyageRepository } from "#/database/voyages"
import { computeArticleContentHash } from "#/services/article-content-hash"
import { ARTICLE_TRANSLATION_CONTRACT_VERSION, planArticleTranslation } from "#/services/article-translation-source"
import { TranslationService } from "#/services/translation-service"

const TARGET_LANGUAGE = "zh-CN"
const PROVIDER = "deepseek"
const MODEL = "deepseek-v4-flash"
const LEGACY_MODEL = "deepseek-v3-legacy"
const FIXTURE_MARK = "【S7 中译】"
const DB_FILE = "shipping-hot-v3.sqlite3"

/** Wall-clock anchors: the fixture stays fresh/valid whenever the run happens. */
const NOW = new Date()
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const PUBLISHED_AT = iso(-6 * 60 * 60 * 1000)
const FETCHED_AT = iso(-60 * 60 * 1000)
const TRANSLATED_AT = iso(-30 * 60 * 1000)
const ETD_AT = iso(-36 * 60 * 60 * 1000)
const ETA_AT = iso(3 * 24 * 60 * 60 * 1000)

const S7 = {
  vessel: "vessel-s7-anhui-88",
  vesselDecoy: "vessel-s7-anhui-88-other-imo",
  vesselNoMmsi: "vessel-s7-identity-only",
  vesselMockDecoy: "vessel-s7-mock-decoy",
  port: "port-s7-shekou",
  portSecondary: "port-s7-yantian",
  portMockDecoy: "port-s7-mock-decoy",
  voyage: "voyage-s7-anhui-88-current",
  voyageUnknown: "voyage-s7-identity-only-unknown",
  feedArticle: "feed-s7-article",
  feedWeather: "feed-s7-weather",
  feedMockDecoy: "feed-s7-mock-decoy",
  sourceId: "s7-fixture-source",
} as const

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

function assertIsolatedRunDir(runDir: string): void {
  if (process.env.S7_SEED_ALLOW_OUTSIDE_TMP === "1") return
  const inTmp = runDir.toLowerCase().includes(`${sep}.tmp${sep}`)
  if (!inTmp) {
    throw new Error(
      `refusing to seed ${runDir}: S7 fixtures must not be written outside .tmp `
      + "(set S7_SEED_ALLOW_OUTSIDE_TMP=1 only for a throwaway database)",
    )
  }
}

/* ------------------------------------------------------------------ fixtures */

function thirdParty(sourceId: string, sourceUrl: string, evidence: string[] = [sourceId]): { provenance: DataProvenance, evidence: { provenance: DataProvenance, sourceUpdatedAt: string }[] } {
  const provenance: DataProvenance = { sourceType: "third_party", dataNature: "observed", sourceId, sourceUrl, verified: true }
  return {
    provenance,
    evidence: evidence.map(id => ({
      provenance: { sourceType: "third_party" as const, dataNature: "observed" as const, sourceId: id, sourceUrl, verified: true },
      sourceUpdatedAt: FETCHED_AT,
    })),
  }
}

function vessel(input: {
  id: string
  name: string
  imo?: string
  mmsi?: string
  callSign?: string
  carrier?: string
  shipType?: string
  isWatched?: boolean
  navigationStatus: Vessel["navigationStatus"]
  latitude?: number
  longitude?: number
  speed?: number
  course?: number
  destination?: string
  eta?: string
}): Vessel {
  const trust = thirdParty("gfw", "https://api.globalfishingwatch.org/v3/vessels/search")
  return {
    ...input,
    isWatched: input.isWatched ?? false,
    statusChangedAt: iso(-4 * 60 * 60 * 1000),
    updatedAt: FETCHED_AT,
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: FETCHED_AT,
    stale: false,
    sourceStatus: "healthy",
    ...trust,
  }
}

function port(input: {
  id: string
  name: string
  nameEn: string
  unlocode: string
  congestionLevel: NonNullable<Port["congestionLevel"]>
  waitingVessels: number
  waitingHours: number
  operationalStatus: NonNullable<Port["operationalStatus"]>
}): Port {
  const trust = thirdParty("portcast", `https://api.portcast.io/v1/ports/${input.unlocode}`)
  return {
    ...input,
    country: "CN",
    isWatched: false,
    congestionDetail: { coverageStatus: "public", congestionCategory: input.congestionLevel, medianWaitingHours: input.waitingHours, longTailCongestion: false },
    updatedAt: FETCHED_AT,
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: FETCHED_AT,
    stale: false,
    sourceStatus: "healthy",
    ...trust,
  }
}

function feedItem(input: Partial<FeedItem> & { id: string, title: string, category: FeedItem["category"] }): FeedItem {
  return {
    sourceId: S7.sourceId,
    freshnessPolicy: "official",
    type: "advisory",
    summary: `${input.title} — deterministic S7 integration fixture.`,
    sourceUrl: `https://example.com/s7/${input.id}`,
    canonicalUrl: `https://example.com/s7/${input.id}`,
    publishedAt: PUBLISHED_AT,
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: PUBLISHED_AT,
    stale: false,
    sourceStatus: "healthy",
    severity: "watch",
    relatedPortIds: [],
    relatedVesselIds: [],
    relatedVoyageIds: [],
    ...thirdParty(S7.sourceId, `https://example.com/s7/${input.id}`),
    ...input,
  }
}

/* ------------------------------------------------------------- flow B article */

function articleBlocks(): ArticleBlock[] {
  return [
    { id: "b0", blockKey: "0", order: 0, type: "heading", text: "Shekou berth congestion eases after schedule recovery", metadata: { level: 2 } },
    { id: "b1", blockKey: "1", order: 1, type: "paragraph", text: "Terminal operators reported that waiting times at Shekou fell to 18 hours as the backlog from last week's typhoon closure cleared." },
    { id: "b2", blockKey: "2", order: 2, type: "paragraph", text: "Two feeder services were re-sequenced, and the port authority expects normal window availability from Thursday." },
    { id: "b3", blockKey: "3", order: 3, type: "list", text: "Berth 8 reopened • Yard density 78% • Rail connection normal", metadata: { ordered: false } },
    { id: "b4", blockKey: "4", order: 4, type: "table", text: "Berth | Status | Waiting hours\n8 | Open | 6\n9 | Open | 12", metadata: { header: true, columns: 3 } },
    { id: "b5", blockKey: "5", order: 5, type: "paragraph", text: "Carriers were advised to keep the original cut-off until the next advisory." },
  ]
}

/** Skeleton-preserving fixture translation so structure protection accepts it. */
function fixtureTranslation(block: ArticleBlock): string {
  if (block.type === "list") {
    return block.text.split(" • ").map(item => `${FIXTURE_MARK}${item}`).join(" • ")
  }
  if (block.type === "table") {
    return block.text.split("\n").map(row => row.split(" | ").map(cell => `${FIXTURE_MARK}${cell}`).join(" | ")).join("\n")
  }
  return `${FIXTURE_MARK}${block.text}`
}

async function seedArticle(input: {
  database: ReturnType<typeof createNativeDatabase>["database"]
  shipping: ShippingRepository
  settings: ShippingSettings
}): Promise<{ versionId: string, translatedBlocks: number, historicalBlocks: number, sentinel: string, articleTitle: string }> {
  const { database, shipping, settings } = input
  const articles = new ArticleRepository(database)
  const translations = new TranslationRepository(database)
  const service = new TranslationService(translations, undefined, {
    targetLanguage: TARGET_LANGUAGE,
    contractVersion: ARTICLE_TRANSLATION_CONTRACT_VERSION,
  })
  const item = feedItem({ id: S7.feedArticle, title: "Shekou berth congestion eases after schedule recovery", category: "shipping_news" })
  await shipping.seed([], [], [], [item], [], settings)

  const blocks = articleBlocks()
  const hash = computeArticleContentHash(blocks)
  const version: ArticleVersion = {
    id: `article-version:${item.id}:${hash.slice(0, 16)}`,
    feedItemId: item.id,
    contentHash: hash,
    language: "en",
    sourcePublishedAt: PUBLISHED_AT,
    sourceUpdatedAt: PUBLISHED_AT,
    fetchedAt: FETCHED_AT,
    extractorVersion: "s7-integration-fixture",
    completenessStatus: "complete",
    accessPolicy: "allowed",
    redistributionPolicy: "full",
    createdAt: FETCHED_AT,
  }
  await articles.saveFetchState({
    feedItemId: item.id,
    sourceId: item.sourceId,
    originalUrl: item.sourceUrl,
    completenessStatus: "complete",
    lastAttemptAt: FETCHED_AT,
    lastSuccessAt: FETCHED_AT,
    updatedAt: FETCHED_AT,
  })
  await articles.saveVersionWithBlocks(version, blocks)

  const plan = planArticleTranslation({
    version,
    blocks,
    targetLanguage: TARGET_LANGUAGE,
    prepare: service.prepare.bind(service),
  })
  if (!plan.eligible) throw new Error("s7 article fixture is not translation-eligible")

  // Blocks 0..4 come from the current model; the last block only has a legacy
  // model row, so the view must label it 历史缓存（非当前模型）rather than claim
  // it as the configured model's output.
  let translatedBlocks = 0
  let historicalBlocks = 0
  for (const source of plan.pending) {
    const block = blocks.find(candidate => candidate.blockKey === source.fieldName)
    const legacy = source.fieldName === "5"
    const model = legacy ? LEGACY_MODEL : MODEL
    const translatedText = block ? fixtureTranslation(block) : undefined
    await translations.save({
      id: `translation:s7:${version.id}:${source.fieldName}:${model}`,
      entityType: source.entityType,
      entityId: source.entityId,
      fieldName: source.fieldName,
      sourceText: source.sourceText,
      sourceHash: source.sourceHash,
      sourceLanguage: source.sourceLanguage,
      targetLanguage: source.targetLanguage,
      provider: PROVIDER,
      model,
      translatedText,
      translatedAt: TRANSLATED_AT,
      status: "succeeded",
      preferred: false,
      createdAt: TRANSLATED_AT,
      updatedAt: TRANSLATED_AT,
    })
    if (legacy) historicalBlocks += 1
    else translatedBlocks += 1
  }

  return {
    versionId: version.id,
    translatedBlocks,
    historicalBlocks,
    sentinel: FIXTURE_MARK,
    articleTitle: item.title,
  }
}

/* --------------------------------------------------------------------- main */

async function main() {
  const runDir = resolve(process.argv[2] ?? join(process.cwd(), ".tmp", "s7-local"))
  assertIsolatedRunDir(runDir)
  const databasePath = join(runDir, ".data", DB_FILE)
  mkdirSync(dirname(databasePath), { recursive: true })

  const { database, native } = createNativeDatabase(databasePath)
  await initShippingTables(database, "real")
  const shipping = new ShippingRepository(database, "real")

  const settings: ShippingSettings = {
    ...structuredClone(defaultShippingSettings),
    refreshInterval: 30,
    eventThresholds: { anchoredHours: 36, delayMinutes: 360, congestionLevel: "high" },
    translation: {
      enabled: true,
      providerId: "deepseek",
      model: MODEL,
      targetLanguage: TARGET_LANGUAGE,
      monthlyBudget: 5,
    },
  }

  const vessels: Vessel[] = [
    vessel({
      id: S7.vessel,
      name: "AN HUI 88",
      imo: "9876543",
      mmsi: "413000111",
      callSign: "BQXS7",
      carrier: "COSCO SHIPPING",
      shipType: "Container Ship",
      isWatched: true,
      navigationStatus: "under_way",
      latitude: 22.4707,
      longitude: 113.9207,
      speed: 14.2,
      course: 118,
      destination: "SHEKOU",
      eta: ETA_AT,
    }),
    vessel({
      id: S7.vesselDecoy,
      name: "AN HUI 88",
      imo: "9876551",
      mmsi: "413000222",
      callSign: "BQXS8",
      carrier: "SITC",
      shipType: "General Cargo",
      navigationStatus: "moored",
      latitude: 31.2304,
      longitude: 121.4737,
      speed: 0,
      course: 0,
      destination: "SHANGHAI",
    }),
    vessel({
      id: S7.vesselNoMmsi,
      name: "IDENTITY ONLY TRADER",
      imo: "9111111",
      shipType: "Bulk Carrier",
      isWatched: true,
      navigationStatus: "unknown",
    }),
  ]

  const ports: Port[] = [
    port({ id: S7.port, name: "蛇口", nameEn: "SHEKOU", unlocode: "CNSHK", congestionLevel: "high", waitingVessels: 7, waitingHours: 18, operationalStatus: "disrupted" }),
    port({ id: S7.portSecondary, name: "盐田", nameEn: "YANTIAN", unlocode: "CNYTN", congestionLevel: "low", waitingVessels: 2, waitingHours: 4, operationalStatus: "normal" }),
  ]

  const weatherItem = feedItem({
    id: S7.feedWeather,
    title: "Swell and wind risk window for Shekou approaches",
    category: "weather",
    severity: "warning",
    relatedPortIds: [S7.port],
    weather: {
      riskSource: "model",
      forecastWindowHours: 72,
      forecastStartAt: FETCHED_AT,
      forecastEndAt: iso(72 * 60 * 60 * 1000),
      waveHeightM: 2.4,
      swellWaveHeightM: 1.8,
      swellPeriodSeconds: 9,
      windSpeedKmh: 42,
      windGustKmh: 58,
      windows: {
        h24: { severity: "warning", maxWaveHeightM: 2.4, maxSwellWaveHeightM: 1.8, maxSwellPeriodSeconds: 9, maxWindSpeedKmh: 42 },
        h72: { severity: "warning", maxWaveHeightM: 3.1, maxSwellWaveHeightM: 2.2, maxSwellPeriodSeconds: 11, maxWindSpeedKmh: 51 },
        d7: { severity: "warning", maxWaveHeightM: 3.4, maxSwellWaveHeightM: 2.5, maxSwellPeriodSeconds: 12, maxWindSpeedKmh: 55 },
      },
    },
  })

  const events: ShippingEvent[] = [{
    id: "event-s7-shekou-congestion",
    type: "port_congestion",
    severity: "warning",
    status: "active",
    title: "Shekou congestion above threshold",
    summary: "Waiting vessels remain above the configured congestion threshold.",
    occurredAt: FETCHED_AT,
    detectedAt: FETCHED_AT,
    dedupeKey: "s7:port_congestion:port-s7-shekou",
    firstDetectedAt: FETCHED_AT,
    lastDetectedAt: FETCHED_AT,
    portId: S7.port,
    vesselId: S7.vessel,
    evidenceJson: { waitingVessels: 7, waitingHours: 18 },
    updatedAt: FETCHED_AT,
    sourceUpdatedAt: FETCHED_AT,
    fetchedAt: FETCHED_AT,
    stale: false,
    sourceStatus: "healthy",
    ...thirdParty("portcast", "https://api.portcast.io/v1/ports/CNSHK"),
  } as ShippingEvent]

  await shipping.seed(vessels, ports, [], [weatherItem], events, settings)

  const voyages = new VoyageRepository(database, "real")
  const voyageWrite = await voyages.saveVoyages([
    {
      id: S7.voyage,
      vesselId: S7.vessel,
      imo: "9876543",
      mmsi: "413000111",
      voyageNumber: "S7E",
      originPortId: "CNYTN",
      destinationPortId: "CNSHK",
      status: "in_transit",
      etd: ETD_AT,
      eta: ETA_AT,
      source: "vesselapi",
      sourceType: "real",
      timestamp: FETCHED_AT,
      lastUpdatedAt: FETCHED_AT,
      episodeState: "current",
    },
    {
      id: S7.voyageUnknown,
      vesselId: S7.vesselNoMmsi,
      imo: "9111111",
      status: "unknown",
      source: "vesselapi",
      sourceType: "real",
      timestamp: FETCHED_AT,
      lastUpdatedAt: FETCHED_AT,
      episodeState: "current",
    },
  ], FETCHED_AT)

  // `saveVoyages` owns the episode id shape, so the manifest records the id the
  // repository actually accepted rather than the requested one.
  const currentVoyageId = voyageWrite.acceptedIds.find(id => id.includes(S7.vessel)) ?? S7.voyage

  const ais = new AisPositionRepository(database, "real")
  await ais.savePositions(
    [
      { id: `${S7.vessel}:3`, vesselId: S7.vessel, mmsi: "413000111", latitude: 22.1804, longitude: 113.5402, speed: 15.8, course: 62, heading: 60, navigationStatus: "under_way", timestamp: iso(-3 * 60 * 60 * 1000), source: "aisstream", sourceType: "real" },
      { id: `${S7.vessel}:2`, vesselId: S7.vessel, mmsi: "413000111", latitude: 22.3105, longitude: 113.7103, speed: 15.1, course: 74, heading: 72, navigationStatus: "under_way", timestamp: iso(-2 * 60 * 60 * 1000), source: "aisstream", sourceType: "real" },
      { id: `${S7.vessel}:1`, vesselId: S7.vessel, mmsi: "413000111", latitude: 22.4707, longitude: 113.9207, speed: 14.2, course: 118, heading: 116, navigationStatus: "under_way", timestamp: iso(-2 * 60 * 1000), source: "aisstream", sourceType: "real" },
    ],
    [{ vesselId: S7.vessel, mmsi: "413000111" }],
    FETCHED_AT,
  )

  const article = await seedArticle({ database, shipping, settings })

  // Provider-free canonical-identity path. This machine holds no Vessel Search
  // credential, so `configureVesselSearchProvider()` reports the `unavailable`
  // provider and a live search can only fail closed. The cache row below stands
  // in for an already-captured provider result: the search endpoint must serve
  // it without any live call, and it must merge with the seeded canonical vessel
  // identity instead of creating a second vessel for the same ship.
  const searchCache = await new VesselMetadataRepository(database, "real").saveSearch(
    { query: "AN HUI 88", field: "name" },
    [{
      id: S7.vessel,
      name: "AN HUI 88",
      imo: "9876543",
      mmsi: "413000111",
      callsign: "BQXS7",
      type: "Container Ship",
      flag: "CN",
      source: "GFW",
      fetchedAt: FETCHED_AT,
      source_type: "real",
      providerRecordId: "s7-fixture-gfw-9876543",
      matchField: "name",
    }],
    "unavailable",
    "real",
    NOW,
    24 * 60 * 60 * 1000,
  )

  // User-owned follow state. `insertVessel` deliberately resets `isWatched` on
  // write and the read path derives it from `vessel_watchlist`, so a fixture that
  // must render the tracking panel has to own that row. This is local user state,
  // not Provider evidence.
  native.prepare("INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES (?, ?, 1)")
    .run(S7.vessel, FETCHED_AT)
  native.prepare("INSERT INTO vessel_watchlist (vessel_id, watched_at, ais_enabled) VALUES (?, ?, 0)")
    .run(S7.vesselNoMmsi, FETCHED_AT)

  // Real-Mode contamination decoys: inserted with raw SQL so the write-time
  // guard cannot drop them. The read path must still keep them invisible.
  const decoyData = (id: string, name: string) => JSON.stringify({
    id,
    name,
    isWatched: false,
    navigationStatus: "unknown",
    source_type: "mock",
    provenance: { sourceType: "mock", dataNature: "estimated", sourceId: "mock-vessel", verified: false },
    updatedAt: FETCHED_AT,
    fetchedAt: FETCHED_AT,
    sourceUpdatedAt: FETCHED_AT,
  })
  native.prepare("INSERT INTO vessels (id, data, source_type, navigation_status, status_changed_at, last_updated_at) VALUES (?, ?, 'mock', 'unknown', NULL, ?)")
    .run(S7.vesselMockDecoy, decoyData(S7.vesselMockDecoy, "MOCK DECOY VESSEL"), FETCHED_AT)
  native.prepare("INSERT INTO ports (id, data, source_type, congestion_level, last_updated_at) VALUES (?, ?, 'mock', 'low', ?)")
    .run(S7.portMockDecoy, JSON.stringify({ id: S7.portMockDecoy, name: "MOCK DECOY PORT", nameEn: "MOCK DECOY PORT", country: "CN", unlocode: "CNXXX", isWatched: false, source_type: "mock", provenance: { sourceType: "mock", dataNature: "estimated", sourceId: "mock-port", verified: false } }), FETCHED_AT)
  native.prepare(`INSERT INTO feed_items (id, source_id, category, type, title, summary, source_url, published_at, fetched_at, severity, related_port_ids, related_vessel_ids, related_voyage_ids, data, source_type)
    VALUES (?, 'mock-feed', 'shipping_news', 'advisory', ?, ?, ?, ?, ?, 'info', '[]', '[]', '[]', ?, 'mock')`)
    .run(S7.feedMockDecoy, "MOCK DECOY FEED ITEM", "decoy row for the zero-Mock-leakage assertion", "https://example.com/s7/mock-decoy", PUBLISHED_AT, FETCHED_AT, JSON.stringify({ id: S7.feedMockDecoy, sourceId: "mock-feed", category: "shipping_news", title: "MOCK DECOY FEED ITEM", source_type: "mock", provenance: { sourceType: "mock", dataNature: "estimated", sourceId: "mock-feed", verified: false } }))

  const manifest = {
    generatedAt: new Date().toISOString(),
    runDir,
    databasePath,
    dataMode: "real",
    fixtureDataProvenance: "synthetic deterministic fixture with real-lineage source_type (exercises Real-Mode read filters); not captured real Provider data, and no Provider/Secret/Runtime/network call was made",
    seededAt: NOW.toISOString(),
    expectations: {
      vesselId: S7.vessel,
      vesselName: "AN HUI 88",
      vesselImo: "9876543",
      vesselMmsi: "413000111",
      vesselDestination: "SHEKOU",
      vesselEta: ETA_AT,
      decoyVesselId: S7.vesselDecoy,
      decoyVesselName: "AN HUI 88",
      decoyVesselImo: "9876551",
      identityOnlyVesselId: S7.vesselNoMmsi,
      identityOnlyVesselName: "IDENTITY ONLY TRADER",
      portId: S7.port,
      portUnlocode: "CNSHK",
      voyageId: currentVoyageId,
      voyageNumber: "S7E",
      voyageEta: ETA_AT,
      unknownVoyageVesselId: S7.vesselNoMmsi,
      aisPositionCount: 3,
      aisLatestTimestamp: iso(-2 * 60 * 1000),
      weatherFeedId: S7.feedWeather,
      articleFeedId: S7.feedArticle,
      articleVersionId: article.versionId,
      articleTitle: article.articleTitle,
      translationSentinel: article.sentinel,
      translatedBlocks: article.translatedBlocks,
      historicalBlocks: article.historicalBlocks,
      mockDecoyVesselId: S7.vesselMockDecoy,
      mockDecoyPortId: S7.portMockDecoy,
      mockDecoyFeedId: S7.feedMockDecoy,
      searchFixture: {
        query: "AN HUI 88",
        providerId: "unavailable",
        canonicalVesselId: searchCache[0]?.id ?? S7.vessel,
        canonicalImo: searchCache[0]?.imo ?? "9876543",
        canonicalMmsi: searchCache[0]?.mmsi ?? "413000111",
        cacheHitExpected: true,
        note: "cache fixture under the provider id an unconfigured Real-Mode Vessel Search reports; serves a previously captured identity with no live call",
      },
      providerUnavailableQuery: "ZZZ NOPE S7",
    },
    requestedPaths: [
      "/",
      "/vessels",
      `/vessels/${S7.vessel}`,
      `/vessels/${S7.vesselDecoy}`,
      `/vessels/${S7.vesselNoMmsi}`,
      "/ports",
      `/ports/${S7.port}`,
      "/voyages",
      `/voyages/${currentVoyageId}`,
      "/feed",
      `/feed/${S7.feedArticle}`,
      `/feed/${S7.feedWeather}`,
      "/calendar",
      "/events",
      "/settings",
    ],
  }
  writeFileSync(join(runDir, "s7-local-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  native.close()
  console.log(`S7 seed complete: ${databasePath}`)
  console.log(`S7 fixtures: vessels=3(+1 decoy) ports=2(+1 decoy) voyages=2 ais=3 feed=2(+1 decoy) article=${article.versionId}`)
}

main().catch((error) => {
  console.error(`S7 seed failed: ${error instanceof Error ? error.message : String(error)}`)
  if (error instanceof Error && error.stack) console.error(error.stack.split("\n").slice(1, 6).join("\n"))
  process.exitCode = 1
})
