import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { FeedItem } from "@shared/shipping"
import { ShippingRepository, initShippingTables } from "#/database/shipping"

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

const current: FeedItem = {
  id: "feed-p3-smoke-current",
  sourceId: "mock-port-notice",
  category: "port_notice",
  freshnessPolicy: "official",
  type: "port_disruption",
  title: "P3 Feed current smoke",
  summary: "Current Feed persistence smoke",
  sourceUrl: "https://example.com/p3/current",
  publishedAt: "2026-01-10T00:00:00.000Z",
  severity: "warning",
  relatedPortIds: [],
  relatedVesselIds: [],
  relatedVoyageIds: [],
  fetchedAt: "2026-01-10T00:01:00.000Z",
  stale: false,
  sourceStatus: "healthy",
  provenance: { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice" },
}

const expired: FeedItem = { ...current, id: "feed-p3-smoke-expired", title: "P3 Feed history smoke", publishedAt: "2025-12-01T00:00:00.000Z" }
const now = new Date("2026-01-11T00:00:00.000Z")

async function runStage(stage: "A" | "B", path: string) {
  const { database, native } = createNativeDatabase(path)
  await initShippingTables(database, "mock")
  const repository = new ShippingRepository(database)
  if (stage === "A") {
    await repository.upsertFeedItem(current)
    await repository.upsertFeedItem({ ...current, fetchedAt: "2026-01-10T00:02:00.000Z", summary: "Current Feed persistence update" })
    await repository.upsertFeedItem(expired)
  } else {
    const currentItems = await repository.listFeedItems({ now })
    const history = await repository.listFeedHistory({ query: "Feed", limit: 20 })
    if (currentItems.length !== 1 || currentItems[0].id !== current.id || history.length !== 3) throw new Error("p3_feed_freshness_persistence_failed")
    console.log(JSON.stringify({ process: "B", persisted: true, current: currentItems.length, history: history.length, visibility: currentItems[0].visibility }))
  }
  native.close()
}

const stage = process.env.P3_FEED_FRESHNESS_SMOKE_STAGE
const databasePath = process.env.P3_FEED_FRESHNESS_SMOKE_DB
if (stage === "A" || stage === "B") {
  if (!databasePath) throw new Error("p3_feed_freshness_smoke_database_missing")
  await runStage(stage, databasePath)
} else {
  const root = mkdtempSync(join(process.env.TEMP ?? ".", "shipping-hot-p3-feed-"))
  const path = join(root, "feed.sqlite3")
  const script = fileURLToPath(import.meta.url)
  const loader = resolve("scripts/tsx-alias-loader.mjs")
  try {
    for (const childStage of ["A", "B"] as const) {
      const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-loader", pathToFileURL(loader).href, script], {
        cwd: process.cwd(),
        env: { ...process.env, P3_FEED_FRESHNESS_SMOKE_STAGE: childStage, P3_FEED_FRESHNESS_SMOKE_DB: path },
        encoding: "utf8",
      })
      if (result.status !== 0) throw new Error(`${childStage} failed: ${result.stderr || result.stdout}`)
      if (result.stdout) process.stdout.write(result.stdout)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
