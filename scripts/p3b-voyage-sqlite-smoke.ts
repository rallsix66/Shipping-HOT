import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { VoyageRecord } from "@shared/voyage"
import { initShippingTables } from "#/database/shipping"
import { VoyageRepository } from "#/database/voyages"

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

const record: VoyageRecord = {
  id: "voyage-smoke-1",
  vesselId: "vessel-smoke-1",
  imo: "9162423",
  mmsi: "413393620",
  originPortId: "CNSHK",
  destinationPortId: "PHMNL",
  voyageNumber: "SMOKE-001",
  status: "in_transit",
  eta: "2026-09-01T00:00:00.000Z",
  source: "mock-voyage",
  sourceType: "mock",
  timestamp: "2026-08-24T00:00:00.000Z",
  lastUpdatedAt: "2026-08-24T00:00:00.000Z",
}

async function runStage(stage: "A" | "B", path: string) {
  const { database, native } = createNativeDatabase(path)
  await initShippingTables(database, "mock")
  const repository = new VoyageRepository(database, "mock")
  if (stage === "A") {
    await repository.saveVoyages([record])
  } else {
    const voyage = await repository.getLatestVoyage(record.vesselId)
    const history = await repository.listEtaHistory(record.id)
    if (!voyage || voyage.eta !== record.eta || history.length !== 1) throw new Error("p3b_voyage_persistence_failed")
    console.log(JSON.stringify({ process: "B", persisted: true, voyageId: voyage.id, eta: voyage.eta, history: history.length }))
  }
  native.close()
}

const stage = process.env.P3B_VOYAGE_SMOKE_STAGE
const databasePath = process.env.P3B_VOYAGE_SMOKE_DB
if (stage === "A" || stage === "B") {
  if (!databasePath) throw new Error("p3b_voyage_smoke_database_missing")
  await runStage(stage, databasePath)
} else {
  const root = mkdtempSync(join(process.env.TEMP ?? ".", "shipping-hot-p3b-"))
  const path = join(root, "voyage.sqlite3")
  const script = fileURLToPath(import.meta.url)
  const loader = resolve("scripts/tsx-alias-loader.mjs")
  try {
    for (const childStage of ["A", "B"] as const) {
      const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-loader", pathToFileURL(loader).href, script], {
        cwd: process.cwd(),
        env: { ...process.env, P3B_VOYAGE_SMOKE_STAGE: childStage, P3B_VOYAGE_SMOKE_DB: path },
        encoding: "utf8",
      })
      if (result.status !== 0) throw new Error(`${childStage} failed: ${result.stderr || result.stdout}`)
      if (result.stdout) process.stdout.write(result.stdout)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
