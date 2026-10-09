import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { Port } from "@shared/shipping"
import { defaultShippingSettings, initializeShippingDatabase } from "../server/database/runtime"
import { ShippingRepository } from "../server/database/shipping"

/** Synthetic Real-lineage port fixture (not captured Provider data). Exercises Real-mode Mock filtering. */
function syntheticRealPort(): Port {
  const updatedAt = "2026-10-09T00:00:00.000Z"
  return {
    id: "p0-smoke-port-shekou",
    name: "蛇口",
    nameEn: "SHEKOU",
    country: "CN",
    unlocode: "CNSHK",
    isWatched: false,
    congestionLevel: "medium",
    waitingVessels: 3,
    waitingHours: 6,
    operationalStatus: "normal",
    updatedAt,
    fetchedAt: updatedAt,
    sourceUpdatedAt: updatedAt,
    stale: false,
    sourceStatus: "healthy",
    source_type: "real",
    provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "portcast-public", verified: true },
  }
}

function syntheticMockPortDecoy(): Port {
  const updatedAt = "2026-10-09T00:00:00.000Z"
  return {
    id: "p0-smoke-mock-decoy-port",
    name: "MOCK DECOY PORT",
    nameEn: "MOCK DECOY PORT",
    country: "CN",
    unlocode: "CNXXX",
    isWatched: false,
    congestionLevel: "low",
    updatedAt,
    fetchedAt: updatedAt,
    sourceUpdatedAt: updatedAt,
    stale: false,
    sourceStatus: "healthy",
    source_type: "mock",
    provenance: { sourceType: "mock", dataNature: "derived", sourceId: "mock-port", verified: false },
  }
}

async function openDatabase(path: string) {
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
  await initializeShippingDatabase(database, "real")
  return { native, database }
}

async function writer(path: string) {
  const { native, database } = await openDatabase(path)
  const repository = new ShippingRepository(database, "real")
  const realPort = syntheticRealPort()
  const mockDecoy = syntheticMockPortDecoy()
  await repository.seed([realPort], [], [], defaultShippingSettings)
  await repository.setPortFollow(realPort.id, true)
  const decoy = mockDecoy
  native.prepare(`
    INSERT INTO ports (id, data, source_type, congestion_level, last_updated_at)
    VALUES (?, ?, 'mock', 'low', ?)
  `).run(decoy.id, JSON.stringify({ ...decoy, isWatched: false }), decoy.updatedAt ?? null)
  native.close()
}

async function reader(path: string) {
  const { native, database } = await openDatabase(path)
  const repository = new ShippingRepository(database, "real")
  const ports = await repository.listPorts()
  if (ports.length !== 1) throw new Error(`expected one real-lineage port, got ${ports.length} (${ports.map(p => p.id).join(", ")})`)
  if (ports[0]?.id !== "p0-smoke-port-shekou") throw new Error(`unexpected port id: ${ports[0]?.id}`)
  if (!ports[0]?.isWatched) throw new Error("port follow state was not persisted across restart")
  if (ports.some(port => port.id === "p0-smoke-mock-decoy-port")) throw new Error("mock-source port leaked into Real Mode listPorts")
  const appMetadata = native.prepare("SELECT schema_version, bootstrap_completed_at, data_mode FROM app_metadata WHERE id = 'default'").get() as { schema_version: number, bootstrap_completed_at?: string, data_mode: string } | undefined
  const portDirectory = native.prepare("SELECT port_directory_status, port_directory_version, port_directory_imported_at FROM port_directory_status WHERE id = 'default'").get() as { port_directory_status: string, port_directory_version?: string, port_directory_imported_at?: string } | undefined
  const portCount = native.prepare("SELECT COUNT(*) AS count FROM port_directory WHERE is_active = 1 AND source <> 'mock'").get() as { count: number }
  if (appMetadata?.data_mode !== "real") throw new Error(`unexpected data mode: ${appMetadata?.data_mode}`)
  if (!appMetadata.bootstrap_completed_at) throw new Error("bootstrap_completed_at was not persisted")
  if (portDirectory?.port_directory_status !== "ready" || portDirectory.port_directory_version !== "p1a-unlocode-baseline-v1" || !portDirectory.port_directory_imported_at) throw new Error("Port Directory baseline was not persisted")
  if (Number(portCount.count) !== 8) throw new Error(`unexpected active Port Directory baseline count: ${portCount.count}`)
  native.close()
  console.log(JSON.stringify({ process: "B", node: process.version, abi: process.versions.modules, bootstrapCompletedAt: appMetadata.bootstrap_completed_at, watchedPort: ports[0].id, portDirectory: portDirectory?.port_directory_status }))
}

const phase = process.argv[2]
const path = process.argv[3] ?? join(tmpdir(), "shipping-hot-p0-native-restart-smoke.sqlite3")

if (phase === "writer") {
  await writer(path)
} else if (phase === "reader") {
  await reader(path)
} else {
  rmSync(path, { force: true })
  const script = fileURLToPath(import.meta.url)
  for (const childPhase of ["writer", "reader"]) {
    const loader = pathToFileURL(fileURLToPath(new URL("./tsx-alias-loader.mjs", import.meta.url))).href
    const result = spawnSync(process.execPath, ["--import", "tsx/esm", "--experimental-loader", loader, script, childPhase, path], {
      stdio: "inherit",
      env: { ...process.env, SHIPPING_DATA_MODE: "real" },
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
