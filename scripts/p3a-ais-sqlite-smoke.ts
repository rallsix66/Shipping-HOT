import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { initShippingTables } from "#/database/shipping"
import { AisPositionRepository } from "#/database/ais-positions"

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

async function runStage(stage: "A" | "B", path: string) {
  const { database, native } = createNativeDatabase(path)
  await initShippingTables(database, "mock")
  const repository = new AisPositionRepository(database, "mock")
  if (stage === "A") {
    await repository.savePositions([{
      mmsi: "413393620",
      latitude: 22.48,
      longitude: 113.91,
      speed: 12.3,
      course: 91,
      heading: 90,
      navigationStatus: "under_way",
      timestamp: "2026-08-24T00:00:00.000Z",
      source: "mock-ais",
      sourceType: "mock",
    }], [{ vesselId: "imo:9162423", mmsi: "413393620" }], "2026-08-24T00:00:01.000Z")
  } else {
    const position = await repository.getLatestPosition("imo:9162423", new Date("2026-08-24T00:01:00.000Z"))
    if (!position || position.latitude !== 22.48 || position.longitude !== 113.91 || position.source !== "mock-ais") throw new Error("p3a_ais_position_persistence_failed")
    console.log(JSON.stringify({ process: "B", persisted: true, vesselId: position.vesselId, mmsi: position.mmsi, stale: position.stale }))
  }
  native.close()
}

const stage = process.env.P3A_AIS_SMOKE_STAGE
const databasePath = process.env.P3A_AIS_SMOKE_DB
if (stage === "A" || stage === "B") {
  if (!databasePath) throw new Error("p3a_ais_smoke_database_missing")
  await runStage(stage, databasePath)
} else {
  const root = mkdtempSync(join(process.env.TEMP ?? ".", "shipping-hot-p3a-"))
  const path = join(root, "ais.sqlite3")
  const script = fileURLToPath(import.meta.url)
  const loader = resolve("scripts/tsx-alias-loader.mjs")
  try {
    for (const childStage of ["A", "B"] as const) {
      const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-loader", pathToFileURL(loader).href, script], {
        cwd: process.cwd(),
        env: { ...process.env, P3A_AIS_SMOKE_STAGE: childStage, P3A_AIS_SMOKE_DB: path },
        encoding: "utf8",
      })
      if (result.status !== 0) throw new Error(`${childStage} failed: ${result.stderr || result.stdout}`)
      if (result.stdout) process.stdout.write(result.stdout)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
