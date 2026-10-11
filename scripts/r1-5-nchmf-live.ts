// VN-W01 NCHMF limited-integration REAL run (dots 2026-10-10 17:14) in an isolated .tmp directory.
// One request to the pinned list page https://www.nchmf.gov.vn/kttv/vi-VN/1/index.html plus at most NCHMF_MAX_ARTICLES
// same-host -post<digits>.html articles (redirect: "error"). The source stays enabled:false / liveStatus "experimental";
// this harness passes allowPending, the same thing SHIPPING_WEATHER_ALERT_PROVIDER=experimental does. Never touches
// the retained DB. Records received / filtered / failed / truncated counts. Raw pages are saved with session tokens and
// third-party widget scripts/keys redacted. The DB is then shown by scripts/r1-5-nchmf-display.mjs.
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
import type { NchmfRunReport } from "#/providers/nchmf-warning"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_VNW01_DIR ?? join(ROOT, ".tmp", `nchmf-live-${new Date().toISOString().replace(/[:.]/g, "-")}`))
if (!RUN_DIR.startsWith(join(ROOT, ".tmp"))) throw new Error("E2E_VNW01_DIR must stay inside <repo>/.tmp")
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
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => /openweathermap|appid/i.test(m) ? "<!-- third-party weather widget script removed (contained API key; redacted) -->" : m)
    .replace(/(appid\s*=\s*)[^&"'\s<>]+/gi, "$1<redacted>")
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
  const source = officialWeatherAlertSources.find(s => s.id === "nchmf")!
  let report: NchmfRunReport | undefined
  const provider = createOfficialWeatherAlertProvider({ sources: [source], allowPending: true, fetcher, now: () => now, throwOnSourceFailureWithoutLastKnown: true, onNchmfReport: (r) => {
    report = r
  } })
  const job = createWeatherAlertSyncJob({ database, dataMode: "real", sourceId: "nchmf", provider: provider as typeof provider & { providerId: string }, intervalMs: 900_000, now: () => now })
  const jobResult = await job.run().catch((error: unknown) => ({ status: "threw", error: String(error) }))
  const all: FeedItem[] = (await repository.listFeedItems({ now, view: "all" })).filter(item => item.sourceId === "nchmf")
  const current: FeedItem[] = await repository.listFeedItems({ now, view: "current" })
  const listFailed = !egress[0] || egress[0].error !== undefined || egress[0].status !== 200
  const classification = listFailed
    ? "list_fetch_failed"
    : !report || report.listStatus !== "ok"
        ? "list_structure_lost"
        : report.candidates === 0
          ? "no_matching_records_meaning_unconfirmed"
          : report.failed.length
            ? "received_with_partial_failures"
            : "received_official_notice_records"
  mkdirSync(join(RUN_DIR, "raw"), { recursive: true })
  let n = 0
  for (const [url, html] of rawPages) {
    const name = url.endsWith("index.html") ? "index.html" : `post${/-post(\d+)\.html$/.exec(url)?.[1] ?? `x${n++}`}.html`
    writeFileSync(join(RUN_DIR, "raw", name), redact(html))
  }
  const vnHits = evaluateOfficialAlertImpactRules(all, { portId: "vnsgn", portCountry: "VN", cities: ["Ho Chi Minh City", "Vung Tau"], now } as never)
  let gitHead = ""
  let workspaceClean = false
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()
    workspaceClean = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === ""
  } catch {}
  const evidence = {
    probe: "VN-W01 NCHMF limited integration real run (isolated)",
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
    summaryZh: classification === "no_matching_records_meaning_unconfirmed"
      ? "本次未发现符合筛选的记录，含义未确认"
      : classification === "list_fetch_failed" || classification === "list_structure_lost"
        ? "本次列表抓取失败或结构不符：不是“无预警”，旧记录未清除"
        : `收到 ${report?.received ?? 0} 条官方预警原文记录（候选 ${report?.candidates ?? 0}，排除 ${report?.excluded ?? 0}，失败 ${report?.failed.length ?? 0}，截断 ${report?.truncated ?? 0}）；生命周期/有效期未知，未关联港口`,
    recordsStored: all.length,
    recordsWithOriginalLevel: all.filter(item => item.weather?.originalRiskLevel).length,
    recordsLevelNotProvided: all.filter(item => item.weather?.officialSeverity === "not_provided").length,
    recordsEventEligible: all.filter(item => item.eventEligibility === true).length,
    recordsWithPort: all.filter(item => item.relatedPortIds.length > 0).length,
    recordsCurrentFeed: current.filter(item => item.sourceId === "nchmf").length,
    vnsgnRuleHits: vnHits.length,
    records: all.map(item => ({ id: item.id, title: item.title, sourceUrl: item.sourceUrl, raw: { listTimeText: item.weather?.noticeRaw?.listTimeText, bodyPublishText: item.weather?.noticeRaw?.bodyPublishText, nextIssueText: item.weather?.noticeRaw?.nextIssueText, originalLevelText: item.weather?.noticeRaw?.originalLevelText }, originalRiskLevel: item.weather?.originalRiskLevel ?? null, officialSeverity: item.weather?.officialSeverity ?? null, standardizedSeverity: item.weather?.standardizedSeverity, alertState: item.weather?.alertState, lifecycleStatus: item.weather?.lifecycleStatus, firstReceivedAt: item.weather?.noticeRaw?.firstReceivedAt, relatedPortIds: item.relatedPortIds, eventEligibility: item.eventEligibility })),
    scope: "real official site -> provider -> sync job -> isolated SQLite -> impact rule SERVICE layer; HTTP API + browser are covered by r1-5-nchmf-display.mjs",
  }
  writeFileSync(join(RUN_DIR, "nchmf-live-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ runDir: RUN_DIR, classification, requests: egress.length, report, recordsStored: evidence.recordsStored, vnsgnRuleHits: vnHits.length }))
  native.close()
  process.exitCode = classification === "list_fetch_failed" || classification === "list_structure_lost" ? 2 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
