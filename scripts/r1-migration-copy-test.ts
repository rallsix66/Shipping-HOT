/**
 * R1-3: run pending migrations twice on an isolated DB copy (never the retained DB).
 * Usage (from repo root):
 *   node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs ./scripts/r1-migration-copy-test.ts <copy-dir>
 * `<copy-dir>` must contain `.data/shipping-hot-v3.sqlite3` (e.g. `.tmp/r1-migration`).
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { initializeShippingDatabase } from "#/database/runtime"

const copyDir = resolve(process.argv[2] ?? join(".tmp", "r1-migration"))
const dbPath = join(copyDir, ".data", "shipping-hot-v3.sqlite3")
if (!existsSync(dbPath)) {
  console.error(`missing database copy: ${dbPath}`)
  process.exit(1)
}

function openDatabase() {
  const native = new NativeDatabase(dbPath)
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
  return { database, close: () => native.close() }
}

for (let pass = 1; pass <= 2; pass++) {
  const { database, close } = openDatabase()
  const meta = await initializeShippingDatabase(database, "real")
  close()
  console.log(`pass ${pass}: schemaVersion=${meta.schemaVersion}`)
}

const probe = new NativeDatabase(dbPath, { readonly: true })
const version = probe.prepare("SELECT schema_version FROM app_metadata").get() as { schema_version?: number }
const retired = probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_retired_%' ORDER BY name").all() as { name: string }[]
console.log("app_metadata.schema_version", version?.schema_version)
console.log("_retired_* tables:")
for (const row of retired) console.log(`  ${row.name}`)
probe.close()
