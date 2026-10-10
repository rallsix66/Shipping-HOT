// TH-W01 TMD CAP live probe in an isolated .tmp database (real egress to the official TMD endpoint only).
// Classifies the run honestly: alerts_present / no_active_alerts / source_unreachable. Never touches the retained DB.
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { FeedItem } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources } from "#/providers/weather-alerts"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const RUN_DIR = join(ROOT, ".tmp", `tmd-cap-live-${stamp}`)
mkdirSync(RUN_DIR, { recursive: true })

const native = new NativeDatabase(join(RUN_DIR, "isolated.sqlite3"))
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

const egress: { url: string, status?: number, bytes?: number, error?: string, at: string }[] = []
async function fetcher(url: string) {
  const at = new Date().toISOString()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    const body = await response.text()
    egress.push({ url, status: response.status, bytes: body.length, at })
    return { ok: response.ok, status: response.status, text: async () => body }
  } catch (error) {
    egress.push({ url, error: error instanceof Error ? error.message : String(error), at })
    throw error
  }
}

async function main() {
  const now = new Date()
  await initShippingTables(database, "real")
  const repository = new ShippingRepository(database, "real")
  const port = createMockSnapshot().ports.find(p => p.id === "port-laem-chabang")!
  await repository.seed([{ ...port, provenance: { sourceType: "official", dataNature: "reported", sourceId: "unlocode", verified: true } }], [], [], createMockSnapshot().settings)
  const tmd = officialWeatherAlertSources.find(source => source.id === "tmd")!
  const provider = createOfficialWeatherAlertProvider({ sources: [tmd], fetcher, now: () => now, throwOnSourceFailureWithoutLastKnown: true })
  let items: FeedItem[] = []
  let failure: string | undefined
  try {
    items = await provider.getFeedItems([], await repository.listPorts())
    for (const item of items) await repository.upsertFeedItem(item)
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  const stored = await repository.listFeedItems({ now, view: "all" })
  const current = await repository.listFeedItems({ now, view: "current" })
  const panel = await getPortWeatherPanel(repository, "port-laem-chabang", current, "n/a", "TMD", { now })
  const active = stored.filter(item => item.weather?.alertState === "active" && item.eventEligibility === true)
  const classification = failure ? "source_unreachable" : active.length ? "alerts_present" : "no_active_alerts"
  let gitHead = ""
  let workspaceClean = false
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
    workspaceClean = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === ""
  } catch {}
  const evidence = {
    probe: "TH-W01 TMD CAP live (isolated)",
    gitHead,
    workspaceClean,
    ranAt: now.toISOString(),
    entry: tmd.url,
    format: tmd.format,
    classification,
    failure,
    egress,
    storedCount: stored.length,
    activeCount: active.length,
    alerts: stored.map(item => ({
      alertId: item.weather?.alertId,
      title: item.title,
      severity: item.severity,
      state: item.weather?.alertState,
      eventEligibility: item.eventEligibility,
      sentAt: item.publishedAt,
      expiresAt: item.weather?.alertExpiresAt,
      region: item.weather?.alertRegion,
      relatedPortIds: item.relatedPortIds,
      sourceUrl: item.sourceUrl,
    })),
    laemChabangPanel: {
      officialAlerts: panel.officialAlerts.length,
      officialAlertImpacts: panel.officialAlertImpacts.map(hit => ({ ruleId: hit.ruleId, status: hit.status, severity: hit.severity, alertId: hit.inputValues.officialAlertId })),
    },
    scope: "parser → provider → isolated SQLite → panel service layer; not HTTP route, not browser",
  }
  writeFileSync(join(RUN_DIR, "tmd-cap-live-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`Evidence: ${join(RUN_DIR, "tmd-cap-live-evidence.json")}`)
  console.log(JSON.stringify({ classification, egress: egress.length, storedCount: stored.length, activeCount: active.length, laemChabangImpacts: evidence.laemChabangPanel.officialAlertImpacts.length }))
  native.close()
  process.exitCode = classification === "source_unreachable" ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
