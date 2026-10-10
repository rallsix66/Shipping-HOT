// Live Open-Meteo + JMA sync into isolated cwd database (real egress).
import { existsSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { portDirectoryBaseline } from "@shared/port-directory"
import { loadServerEnv } from "./load-env"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const DB_FILE = "shipping-hot-v3.sqlite3"

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

function countMissing(rows: readonly { windGustKmh?: number, waveHeightM?: number, swellWaveHeightM?: number, precipitationMm?: number, visibilityM?: number }[], field: "windGust" | "wave" | "precip" | "visibility") {
  return rows.filter((row) => {
    if (field === "windGust") return row.windGustKmh === undefined
    if (field === "wave") return row.waveHeightM === undefined && row.swellWaveHeightM === undefined
    if (field === "precip") return row.precipitationMm === undefined
    return row.visibilityM === undefined
  }).length
}

async function main() {
  const runDir = resolve(process.argv[2] ?? "")
  if (!runDir) throw new Error("usage: r1-5-1-sync-live.ts <isolated-run-dir>")
  const isolatedRoot = resolve(join(ROOT, ".tmp"))
  if (!runDir.startsWith(isolatedRoot + sep)) throw new Error(`refusing: run dir must stay inside ${isolatedRoot}`)
  const databasePath = join(runDir, ".data", DB_FILE)
  if (!existsSync(databasePath)) throw new Error(`missing database: ${databasePath}`)

  loadServerEnv()
  // Diagnostic egress log (no credentials: Open-Meteo/JMA URLs carry none). Wraps fetch before providers are created
  // so a per-port upstream failure that the weather job tolerates is visible in the evidence.
  const egress: { host: string, latitude?: string, longitude?: string, status?: number, error?: string, at: string }[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    const entry = { host: url.host, latitude: url.searchParams.get("latitude") ?? undefined, longitude: url.searchParams.get("longitude") ?? undefined, at: new Date().toISOString() } as (typeof egress)[number]
    egress.push(entry)
    try {
      const res = await originalFetch(input, init)
      entry.status = res.status
      return res
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }) as typeof fetch
  process.env.SHIPPING_DATA_MODE = "real"
  process.env.SHIPPING_WEATHER_PROVIDER = "open-meteo"
  process.chdir(runDir)

  const syncStartedAt = new Date()
  const { database, native } = createNativeDatabase(databasePath)
  const { WEATHER_FORECAST_HORIZON_MS } = await import("#/services/weather-panel-policy")
  const { getPortWeatherPanel } = await import("#/services/port-weather-panel")
  const { ShippingRepository } = await import("#/database/shipping")
  const { RuntimeRepository } = await import("#/database/runtime-jobs")
  const { BackgroundRuntime } = await import("#/runtime/background-runtime")
  const { getDefaultRuntimeJobs } = await import("#/runtime/registry")

  const repository = new ShippingRepository(database, "real")
  const runtime = new BackgroundRuntime(new RuntimeRepository(database), { now: () => syncStartedAt })
  const jobs = getDefaultRuntimeJobs({ database, dataMode: "real", now: () => syncStartedAt })
    .filter(job => job.id === "weather-sync" || job.id === "tropical-cyclone-sync")
  for (const job of jobs) runtime.register(job)
  await runtime.start()
  const jobResults: Record<string, unknown> = {}
  for (const job of jobs) jobResults[job.id] = await runtime.runNow(job.id)
  runtime.stop()

  const nowMs = syncStartedAt.getTime()
  const horizonEndMs = nowMs + WEATHER_FORECAST_HORIZON_MS
  const ports: Record<string, unknown> = {}

  for (const row of portDirectoryBaseline) {
    const portId = row.shippingPortId
    const stored = await repository.listWeatherForecastsForPort(portId, 7 * 24 + 8)
    const hourly = stored.filter(r => r.horizon === "hourly")
    const current = stored.filter(r => r.horizon === "current")
    const inWindowHourly = hourly.filter((r) => {
      const t = Date.parse(r.forecastAt)
      return Number.isFinite(t) && t >= nowMs - 60 * 60 * 1000 && t <= horizonEndMs
    })
    const instants = inWindowHourly.map(r => Date.parse(r.forecastAt)).filter(Number.isFinite).sort((a, b) => a - b)
    const panel = await getPortWeatherPanel(repository, portId, [], "Open-Meteo", "alerts", { now: syncStartedAt })
    ports[portId] = {
      unlocode: row.unlocode,
      sqlite: {
        totalRows: stored.length,
        hourlyRows: hourly.length,
        currentRows: current.length,
        hourlyInSevenDayWindow: inWindowHourly.length,
        firstHourlyInWindow: instants.length ? new Date(instants[0]).toISOString() : undefined,
        lastHourlyInWindow: instants.length ? new Date(instants[instants.length - 1]).toISOString() : undefined,
        sourceId: stored[0]?.sourceId,
        fetchedAt: stored.reduce<string | undefined>((latest, r) => {
          const t = Date.parse(r.fetchedAt)
          if (!Number.isFinite(t)) return latest
          const iso = new Date(t).toISOString()
          return !latest || t > Date.parse(latest) ? iso : latest
        }, undefined),
        missingInWindow: {
          windGust: countMissing(inWindowHourly, "windGust"),
          wave: countMissing(inWindowHourly, "wave"),
          precip: countMissing(inWindowHourly, "precip"),
          visibility: countMissing(inWindowHourly, "visibility"),
        },
      },
      forecastMeta: panel.forecastMeta,
      panelState: panel.state,
    }
  }

  const jmaMeta = await repository.getTropicalCycloneSyncMeta({ nowMs })
  const cyclones = await repository.listNormalizedTropicalCyclones()

  const output = {
    kind: "r1-5-1-live-sync",
    runDir,
    databasePath,
    syncStartedAt: syncStartedAt.toISOString(),
    syncCompletedAt: new Date().toISOString(),
    jobResults,
    egress: {
      requests: egress.length,
      nonOk: egress.filter(e => e.error !== undefined || (e.status !== undefined && e.status >= 400)),
      byHostStatus: egress.reduce<Record<string, number>>((acc, e) => {
        const key = `${e.host} ${e.status ?? "error"}`
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
    },
    sevenDayWindow: {
      note: "Hourly counts use horizon=hourly only within [now-1h, now+7d]; current rows are reported separately and never pad hourlyReturned.",
      start: new Date(nowMs - 60 * 60 * 1000).toISOString(),
      end: new Date(horizonEndMs).toISOString(),
    },
    ports,
    jma: {
      syncMeta: jmaMeta,
      // Stored/archived normalized JMA records; NOT the focus-area active count (see panel activeCount).
      storedCycloneCount: cyclones.length,
      storedCycloneIds: cyclones.map(c => c.id),
    },
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  native.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
