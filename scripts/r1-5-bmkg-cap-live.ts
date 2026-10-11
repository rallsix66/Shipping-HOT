// BMKG nowcast CAP live probe in an isolated .tmp database (real egress to the official BMKG endpoint only).
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
import { type RecordedRequest, createRecordingFetcher } from "./lib/recording-fetcher"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources } from "#/providers/weather-alerts"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const RUN_DIR = join(ROOT, ".tmp", `bmkg-cap-live-${stamp}`)
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

// Pass-through recording fetcher: keeps the provider's RequestInit (redirect: "error" for CAP bodies), adds a
// 30 s timeout and preserves response url/redirected so the provider's redirect checks apply in this harness too.
const egress: RecordedRequest[] = []
const fetcher = createRecordingFetcher((url, init) => fetch(url, init), egress)

async function main() {
  const now = new Date()
  await initShippingTables(database, "real")
  const repository = new ShippingRepository(database, "real")
  const port = createMockSnapshot().ports.find(p => p.id === "port-jakarta")!
  await repository.seed([{ ...port, provenance: { sourceType: "official", dataNature: "reported", sourceId: "unlocode", verified: true } }], [], [], createMockSnapshot().settings)
  const tmd = officialWeatherAlertSources.find(source => source.id === "bmkg")!
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
  const panel = await getPortWeatherPanel(repository, "port-jakarta", current, "n/a", "BMKG", { now })
  const active = stored.filter(item => item.weather?.alertState === "active" && item.eventEligibility === true)
  const classification = failure ? "source_unreachable" : active.length ? "alerts_present" : "no_active_alerts"
  let gitHead = ""
  let workspaceClean = false
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
    workspaceClean = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === ""
  } catch {}
  const evidence = {
    probe: "BMKG nowcast CAP live (isolated)",
    gitHead,
    workspaceClean,
    ranAt: now.toISOString(),
    entry: tmd.url,
    format: tmd.format,
    classification,
    failure,
    egress,
    redirectSummary: {
      requests: egress.length,
      bodyRequestsWithRedirectError: egress.filter(entry => entry.url !== tmd.url && entry.requestedRedirect === "error").length,
      bodyRequests: egress.filter(entry => entry.url !== tmd.url).length,
      redirectedResponses: egress.filter(entry => entry.redirected === true).length,
      finalUrlDiffersFromRequest: egress.filter(entry => entry.finalUrl !== undefined && entry.finalUrl !== entry.url).length,
      errors: egress.filter(entry => entry.error).length,
    },
    targetPortCoverage: active.some(item => item.relatedPortIds.includes("port-jakarta")) ? "covered_by_polygon" : "not_covered_zero_impact",
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
    jakartaPanel: {
      officialAlerts: panel.officialAlerts.length,
      officialAlertImpacts: panel.officialAlertImpacts.map(hit => ({ ruleId: hit.ruleId, status: hit.status, severity: hit.severity, alertId: hit.inputValues.officialAlertId })),
    },
    scope: "parser → provider → isolated SQLite → panel service layer; not HTTP route, not browser",
  }
  writeFileSync(join(RUN_DIR, "bmkg-cap-live-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`Evidence: ${join(RUN_DIR, "bmkg-cap-live-evidence.json")}`)
  console.log(JSON.stringify({ classification, egress: egress.length, storedCount: stored.length, activeCount: active.length, jakartaImpacts: evidence.jakartaPanel.officialAlertImpacts.length }))
  native.close()
  process.exitCode = classification === "source_unreachable" ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
