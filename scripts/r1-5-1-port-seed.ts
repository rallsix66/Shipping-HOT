// Seeds eight baseline ports (real lineage) into an isolated run directory DB.
// Usage: tsx ./scripts/r1-5-1-port-seed.ts <isolated-run-dir>
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { Port } from "@shared/shipping"
import { portDirectoryBaseline } from "@shared/port-directory"
import { defaultShippingSettings } from "#/database/runtime"
import { ShippingRepository, initShippingTables } from "#/database/shipping"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const DB_FILE = "shipping-hot-v3.sqlite3"
const NOW = new Date().toISOString()

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

function baselinePort(row: (typeof portDirectoryBaseline)[number]): Port {
  return {
    id: row.shippingPortId,
    name: row.nameZh,
    nameEn: row.nameEn,
    country: row.countryCode === "CN" ? "China" : row.countryCode,
    unlocode: row.unlocode,
    isWatched: false,
    congestionLevel: "low",
    waitingVessels: 0,
    waitingHours: 0,
    operationalStatus: "normal",
    updatedAt: NOW,
    fetchedAt: NOW,
    sourceUpdatedAt: NOW,
    stale: false,
    sourceStatus: "healthy",
    provenance: {
      sourceType: "official",
      dataNature: "derived",
      sourceId: "port-directory",
      sourceUrl: "shared/port-directory.ts",
      verified: true,
    },
  }
}

async function main() {
  const runDir = resolve(process.argv[2] ?? "")
  if (!runDir) throw new Error("usage: r1-5-1-port-seed.ts <isolated-run-dir>")
  const isolatedRoot = resolve(join(ROOT, ".tmp"))
  if (!runDir.startsWith(isolatedRoot + sep)) {
    throw new Error(`refusing: run dir must stay inside ${isolatedRoot}`)
  }
  const databasePath = join(runDir, ".data", DB_FILE)
  mkdirSync(join(runDir, ".data"), { recursive: true })
  if (existsSync(databasePath)) {
    const probe = new NativeDatabase(databasePath, { readonly: true })
    try {
      const row = probe.prepare("SELECT COUNT(*) AS count FROM ports").get() as { count: number }
      if (row.count > 0) throw new Error(`refusing: ${databasePath} already has ${row.count} port rows`)
    } finally {
      probe.close()
    }
  }
  const { database, native } = createNativeDatabase(databasePath)
  await initShippingTables(database, "real")
  const shipping = new ShippingRepository(database, "real")
  const ports = portDirectoryBaseline.map(baselinePort)
  await shipping.seed(ports, [], [], structuredClone(defaultShippingSettings))
  writeFileSync(join(runDir, "r1-5-1-port-seed.json"), JSON.stringify({
    seededAt: NOW,
    portIds: ports.map(p => p.id),
    unlocodes: ports.map(p => p.unlocode),
  }, null, 2))
  native.close()
  console.log(`R1.5-1 port seed: ${ports.length} ports -> ${databasePath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
