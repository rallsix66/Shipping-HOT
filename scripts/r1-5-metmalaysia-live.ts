// MY-W01 MetMalaysia limited-integration REAL run (dots 2026-10-10 16:05) in an isolated .tmp directory.
// Exactly ONE request to the pinned official entry https://api.data.gov.my/weather/warning/ (redirect: "error", no key).
// The source stays enabled:false / liveStatus "experimental" in config; this harness passes allowPending, the same
// thing SHIPPING_WEATHER_ALERT_PROVIDER=experimental does. Never touches the retained DB.
// Records: count received, count with unknown validity, empty-array vs fetch-failure classification, Klang impact.
// The resulting DB (RUN_DIR/.data/shipping-hot-v3.sqlite3) is then shown by scripts/r1-5-metmalaysia-display.mjs.
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { Buffer } from "node:buffer"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import type { FeedItem } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { ShippingRepository, initShippingTables } from "#/database/shipping"
import { createOfficialWeatherAlertProvider, officialWeatherAlertSources } from "#/providers/weather-alerts"
import { createWeatherAlertSyncJob } from "#/runtime/weather-alert-sync-job"
import { evaluateOfficialAlertImpactRules } from "#/services/official-alert-impact"
import { getPortWeatherPanel } from "#/services/port-weather-panel"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_MYW01_DIR ?? join(ROOT, ".tmp", `metmalaysia-live-${new Date().toISOString().replace(/[:.]/g, "-")}`))
if (!RUN_DIR.startsWith(join(ROOT, ".tmp"))) throw new Error("E2E_MYW01_DIR must stay inside <repo>/.tmp")
mkdirSync(join(RUN_DIR, ".data"), { recursive: true })
const native = new NativeDatabase(join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3"))
const database = createDatabase({
  name: "sqlite",
  dialect: "sqlite",
  getInstance: () => native,
  exec: (sql: string) => native.exec(sql),
  prepare: (sql: string) => {
    const statement = native.prepare(sql)
    return {
      all: async (...params: unknown[]) => statement.all(...params as never[]),
      get: async (...params: unknown[]) => statement.get(...params as never[]),
      run: async (...params: unknown[]) => {
        const result = statement.run(...params as never[])
        return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
      },
    }
  },
  dispose: () => native.close(),
} as never)

interface Egress {
  url: string
  redirect?: string
  status?: number
  redirected?: boolean
  finalUrl?: string
  bytes?: number
  error?: string
  at: string
}
const egress: Egress[] = []
let rawBody = ""
async function fetcher(url: string, init?: { redirect?: "error" | "manual" | "follow" }) {
  const entry: Egress = { url, redirect: init?.redirect, at: new Date().toISOString() }
  egress.push(entry)
  try {
    const res = await fetch(url, { redirect: init?.redirect ?? "error", signal: AbortSignal.timeout(30_000) })
    const text = await res.text()
    rawBody = text
    Object.assign(entry, { status: res.status, redirected: res.redirected, finalUrl: res.url, bytes: Buffer.byteLength(text) })
    return { ok: res.ok, status: res.status, redirected: res.redirected, url: res.url, text: async () => text }
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error)
    throw error
  }
}

async function main() {
  const now = new Date()
  await initShippingTables(database, "real")
  const repository = new ShippingRepository(database, "real")
  const ports = createMockSnapshot().ports.map(port => ({ ...port, provenance: { sourceType: "official" as const, dataNature: "reported" as const, sourceId: "unlocode", verified: true } }))
  await repository.seed(ports, [], [], createMockSnapshot().settings)
  const source = officialWeatherAlertSources.find(s => s.id === "metmalaysia")!
  const provider = createOfficialWeatherAlertProvider({ sources: [source], allowPending: true, fetcher, now: () => now, throwOnSourceFailureWithoutLastKnown: true })
  const job = createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "metmalaysia", provider: provider as typeof provider & { providerId: string }, intervalMs: 900_000, now: () => now })
  const jobResult = await job.run().catch((error: unknown) => ({ status: "threw", error: String(error) }))
  const all: FeedItem[] = (await repository.listFeedItems({ now, view: "all" })).filter(item => item.sourceId === "metmalaysia")
  const current: FeedItem[] = await repository.listFeedItems({ now, view: "current" })
  const fetchFailed = egress.some(e => e.error) || !egress.some(e => e.status === 200)
  let rowsReceived: number | undefined
  try {
    const parsed = JSON.parse(rawBody)
    rowsReceived = Array.isArray(parsed) ? parsed.length : undefined
  } catch {}
  const classification = fetchFailed ? "fetch_failed" : rowsReceived === 0 ? "empty_array_meaning_unknown" : rowsReceived ? "received_official_warning_records_validity_pending" : "contract_failure"
  const panel = await getPortWeatherPanel(repository, "port-klang", current, "n/a", "MetMalaysia", { now })
  const klangHits = evaluateOfficialAlertImpactRules(all, { portId: "port-klang", portCountry: "MY", cities: ["Klang", "Kuala Lumpur", "Selangor"], now } as never)
  if (rawBody) writeFileSync(join(RUN_DIR, "warning-raw.json"), rawBody)
  let gitHead = ""
  let workspaceClean = false
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
    workspaceClean = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === ""
  } catch {}
  const evidence = {
    probe: "MY-W01 MetMalaysia limited integration real run (isolated)",
    gitHead,
    workspaceClean,
    runDir: RUN_DIR,
    ranAt: now.toISOString(),
    entry: source.url,
    requests: egress.length,
    egress,
    jobResult,
    classification,
    summaryZh: classification === "received_official_warning_records_validity_pending"
      ? `收到 ${rowsReceived} 条官方预警记录，有效性待确认（时区未确认，未计算是否生效）`
      : classification === "empty_array_meaning_unknown"
        ? "官方接口返回空数组：含义未确认，不能据此判断全国无预警"
        : "本次抓取失败或结构不符：不是“无预警”",
    rowsReceived,
    recordsStored: all.length,
    recordsUnknownValidity: all.filter(item => item.weather?.validityStatus === "unknown" && item.weather?.alertState === "unknown").length,
    recordsEventEligible: all.filter(item => item.eventEligibility === true).length,
    recordsWithPort: all.filter(item => item.relatedPortIds.length > 0).length,
    recordsCurrentFeed: current.filter(item => item.sourceId === "metmalaysia").length,
    noAdvisoryRecords: all.filter(item => item.tags?.includes("tropical_cyclone_no_advisory_scope_only")).length,
    klang: { panelOfficialAlerts: panel.officialAlerts.length, panelImpacts: panel.officialAlertImpacts.length, ruleHits: klangHits.length },
    records: all.map(item => ({ id: item.id, title: item.title, raw: { issued: item.weather?.alertRaw?.issued, validFrom: item.weather?.alertRaw?.validFrom, validTo: item.weather?.alertRaw?.validTo }, alertState: item.weather?.alertState, validityStatus: item.weather?.validityStatus, timezoneStatus: item.weather?.timezoneStatus, officialSeverity: item.weather?.officialSeverity, receivedAt: item.publishedAt, fetchedAt: item.fetchedAt, relatedPortIds: item.relatedPortIds, eventEligibility: item.eventEligibility })),
    scope: "real official API -> provider -> sync job -> isolated SQLite -> panel/impact SERVICE layer; HTTP API + browser are covered by r1-5-metmalaysia-display.mjs",
  }
  writeFileSync(join(RUN_DIR, "metmalaysia-live-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ runDir: RUN_DIR, classification, requests: egress.length, rowsReceived, recordsStored: evidence.recordsStored, recordsUnknownValidity: evidence.recordsUnknownValidity, klang: evidence.klang }))
  native.close()
  process.exitCode = classification === "fetch_failed" || classification === "contract_failure" ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
