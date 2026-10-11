// CN-W01/CN-W02 NMC limited-integration REAL run (dots approved 76b39fc) in an isolated .tmp directory.
// Exactly the six pinned NMC pages, one plain GET each (redirect: "error"); no link expansion, no getContent REST,
// no headless browser. The source stays enabled:false / liveStatus "experimental"; this harness passes allowPending,
// the same thing SHIPPING_WEATHER_ALERT_PROVIDER=experimental does. Never touches the retained DB. Raw pages are
// saved after a key-like redaction pass. The DB is then shown by scripts/r1-5-nmc-display.mjs.
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
import { NMC_PAGES, type NmcRunReport } from "#/providers/nmc-warning"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_CNW01_DIR ?? join(ROOT, ".tmp", `nmc-live-${new Date().toISOString().replace(/[:.]/g, "-")}`))
if (!RUN_DIR.startsWith(join(ROOT, ".tmp"))) throw new Error("E2E_CNW01_DIR must stay inside <repo>/.tmp")
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
const rawPages = new Map<string, string>()

/** Same redaction as the committed samples: session tokens and third-party widget scripts/keys never stored. */
function redact(html: string): string {
  return html
    .replace(/((?:api[_-]?key|appid|access[_-]?token|token|secret|ak)\s*[=:]\s*["']?)[\w\-.]{16,}/gi, "$1<redacted>")
    .replace(/(name="__(?:VIEWSTATE|VIEWSTATEGENERATOR|EVENTVALIDATION)"[^>]*value=")[^"]*/gi, "$1<redacted>")
}

async function fetcher(url: string, init?: { redirect?: "error" | "manual" | "follow" }) {
  const entry: Egress = { url, redirect: init?.redirect, at: new Date().toISOString() }
  egress.push(entry)
  try {
    const res = await fetch(url, { redirect: init?.redirect ?? "error", headers: { "user-agent": "ShippingHOT-readonly/1.0" }, signal: AbortSignal.timeout(30_000) })
    const text = await res.text()
    rawPages.set(url, text)
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
  const source = officialWeatherAlertSources.find(s => s.id === "nmc")!
  let report: NmcRunReport | undefined
  const provider = createOfficialWeatherAlertProvider({ sources: [source], allowPending: true, fetcher, now: () => now, throwOnSourceFailureWithoutLastKnown: true, onNmcReport: (r) => {
    report = r
  } })
  const job = createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "nmc", provider: provider as typeof provider & { providerId: string }, intervalMs: 900_000, now: () => now })
  const jobResult = await job.run().catch((error: unknown) => ({ status: "threw", error: String(error) }))
  const all: FeedItem[] = (await repository.listFeedItems({ now, view: "all" })).filter(item => item.sourceId === "nmc")
  const current: FeedItem[] = await repository.listFeedItems({ now, view: "current" })
  const classification = !report
    ? "all_pages_failed"
    : report.failed.length
      ? "received_with_partial_failures"
      : "received_all_six_pages"
  mkdirSync(join(RUN_DIR, "raw"), { recursive: true })
  for (const [url, html] of rawPages) {
    const column = NMC_PAGES.find(p => p.url === url)?.column ?? "unknown"
    writeFileSync(join(RUN_DIR, "raw", `${column}.html`), redact(html))
  }
  const cnHits = evaluateOfficialAlertImpactRules(all, { portId: "cnsha", portCountry: "CN", cities: ["Shanghai", "上海"], now } as never)
  let gitHead = ""
  let workspaceClean = false
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
    workspaceClean = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === ""
  } catch {}
  const evidence = {
    probe: "CN-W01/CN-W02 NMC limited integration real run (isolated)",
    gitHead,
    workspaceClean,
    runDir: RUN_DIR,
    ranAt: now.toISOString(),
    entry: source.url,
    requests: egress.length,
    egress,
    jobResult,
    classification,
    report,
    summaryZh: classification === "all_pages_failed" ? "本次六个页面全部失败：不是“无预警”，旧记录未清除" : `收到 ${report?.received ?? 0}/6 页（新建 ${report?.created ?? 0}，更新 ${report?.updated ?? 0}，未变 ${report?.unchanged ?? 0}，失败 ${report?.failed.length ?? 0}，历史产品提示 ${report?.historical ?? 0}）；生命周期/有效期未知，未关联港口`,
    recordsStored: all.length,
    recordsHistoricalNotice: all.filter(item => item.weather?.cnNoticeRaw?.historicalProductNotice).length,
    recordsLiftStatement: all.filter(item => item.weather?.cnNoticeRaw?.liftStatement).length,
    recordsEventEligible: all.filter(item => item.eventEligibility === true).length,
    recordsWithPort: all.filter(item => item.relatedPortIds.length > 0).length,
    recordsCurrentFeed: current.filter(item => item.sourceId === "nmc").length,
    cnshaRuleHits: cnHits.length,
    records: all.map(item => ({ id: item.id, title: item.title, sourceUrl: item.sourceUrl, raw: { publishTimeText: item.weather?.cnNoticeRaw?.publishTimeText, numberText: item.weather?.cnNoticeRaw?.numberText, nextIssueText: item.weather?.cnNoticeRaw?.nextIssueText, historicalProductNotice: item.weather?.cnNoticeRaw?.historicalProductNotice, liftStatement: item.weather?.cnNoticeRaw?.liftStatement, rawColorLevel: item.weather?.cnNoticeRaw?.rawColorLevel, typhoonIntensityText: item.weather?.cnNoticeRaw?.typhoonIntensityText, centerPositionText: item.weather?.cnNoticeRaw?.centerPositionText, typhoonObjects: item.weather?.cnNoticeRaw?.typhoonObjects.map(o => o.object) }, standardizedSeverity: item.weather?.standardizedSeverity, alertState: item.weather?.alertState, lifecycleStatus: item.weather?.lifecycleStatus, firstReceivedAt: item.weather?.cnNoticeRaw?.firstReceivedAt, relatedPortIds: item.relatedPortIds, eventEligibility: item.eventEligibility })),
    scope: "real official site -> provider -> sync job -> isolated SQLite -> impact rule SERVICE layer; HTTP API + browser are covered by r1-5-nmc-display.mjs",
  }
  writeFileSync(join(RUN_DIR, "nmc-live-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ runDir: RUN_DIR, classification, requests: egress.length, report, recordsStored: evidence.recordsStored, cnshaRuleHits: cnHits.length }))
  native.close()
  process.exitCode = classification === "all_pages_failed" ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
