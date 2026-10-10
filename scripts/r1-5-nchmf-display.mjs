// VN-W01 display verification on the isolated DB written by scripts/r1-5-nchmf-live.ts.
// Production build (dist/output/server) started with cwd = that run dir, Runtime DISABLED, no provider secrets,
// SHIPPING_WEATHER_ALERT_PROVIDER unset. Checks: (a) HTTP API GET /api/shipping (+ /feed) returns the stored records
// and the GETs cause zero provider_usage / runtime / feed_items row changes (no network, no LLM);
// (b) system Chrome over CDP renders /feed with the required wording and raw fields.
// Usage: node scripts/r1-5-nchmf-display.mjs <runDir>
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import process from "node:process"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.argv[2] ?? "")
if (!RUN_DIR.startsWith(join(ROOT, ".tmp")) || !existsSync(join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3"))) throw new Error("run dir must be an existing <repo>/.tmp run with .data/shipping-hot-v3.sqlite3")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_VNW01_PORT ?? "4492")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_VNW01_DEBUG_PORT ?? "9352")
const SECRET_KEYS = ["GFW_API_TOKEN", "VESSELAPI_API_KEY", "AISSTREAM_API_KEY", "CALENDARIFIC_API_KEY", "DEEPSEEK_API_KEY", "SHIPPING_WEATHER_ALERT_PROVIDER"]
const checks = []
const add = (id, pass, detail = "") => checks.push({ id, pass: Boolean(pass), detail })

async function waitFor(check, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return true
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

function dbCounts() {
  const db = new Database(join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3"), { readonly: true })
  const count = (table) => {
    try {
      return db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(CAST(rowid AS TEXT))),0) AS s FROM ${table}`).get()
    } catch {
      return { n: -1 }
    }
  }
  const usage = (() => {
    try {
      return db.prepare("SELECT COALESCE(SUM(request_count),0) AS r FROM provider_usage").get().r
    } catch {
      return -1
    }
  })()
  const feedHash = db.prepare("SELECT GROUP_CONCAT(id || ':' || LENGTH(data), ',') AS h FROM (SELECT id, data FROM feed_items ORDER BY id)").get().h
  const result = { feedItems: count("feed_items").n, providerUsageRows: count("provider_usage").n, providerUsageRequests: usage, runtimeRows: count("runtime_job_runs").n, feedHash }
  db.close()
  return result
}

function findChrome() {
  return [process.env.E2E_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find(p => existsSync(p))
}

async function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener("open", () => res())
    ws.addEventListener("error", () => rej(new Error("CDP websocket error")))
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) rej(new Error(msg.error.message))
      else res(msg.result)
    }
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    pending.set(msgId, { res, rej })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
  const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.value
  return { ws, send, evaluate }
}

async function main() {
  const live = JSON.parse(readFileSync(join(RUN_DIR, "nchmf-live-evidence.json"), "utf8"))
  const logFd = openSync(join(RUN_DIR, "server-display.log"), "a")
  const env = { ...process.env }
  for (const key of SECRET_KEYS) delete env[key]
  Object.assign(env, { SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_PORT_PROVIDER: "mock", SHIPPING_FEED_PROVIDER: "mock", SHIPPING_CALENDAR_PROVIDER: "mock", SHIPPING_WEATHER_PROVIDER: "mock", NITRO_HOST: "127.0.0.1", PORT: String(PORT), NITRO_PORT: String(PORT) })
  const server = spawn(process.execPath, [SERVER_ENTRY], { cwd: RUN_DIR, env, stdio: ["ignore", logFd, logFd] })
  let api = {}
  let browser = { status: "NOT_RUN" }
  try {
    add("server_healthy", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500), BASE)
    const before = dbCounts()
    const feedRes = await fetch(`${BASE}/api/shipping/feed`)
    const feedBody = await feedRes.json().catch(() => undefined)
    const indexRes = await fetch(`${BASE}/api/shipping`)
    await indexRes.text()
    const after = dbCounts()
    const items = (Array.isArray(feedBody) ? feedBody : feedBody?.feedItems ?? []).filter(item => item.sourceId === "nchmf")
    api = { feedStatus: feedRes.status, indexStatus: indexRes.status, nchmfItems: items.length, before, after }
    add("api_feed_returns_records", items.length === live.recordsStored && items.length > 0, `${items.length} vs stored ${live.recordsStored}`)
    add("api_records_unknown_lifecycle", items.every(i => i.weather?.lifecycleStatus === "unknown" && i.weather?.alertState === "unknown" && i.weather?.validityStatus === "unknown" && i.eventEligibility === false), "")
    add("api_records_raw_preserved", items.every(i => i.weather?.noticeRaw && "listTimeText" in i.weather.noticeRaw && "bodyPublishText" in i.weather.noticeRaw && "nextIssueText" in i.weather.noticeRaw && i.weather.noticeRaw.firstReceivedAt), "")
    add("api_records_level_unmapped", items.every(i => i.weather?.standardizedSeverity === "unmapped" && (i.weather?.originalRiskLevel ? !i.weather?.officialSeverity : i.weather?.officialSeverity === "not_provided")), "")
    add("api_records_no_port", items.every(i => Array.isArray(i.relatedPortIds) && i.relatedPortIds.length === 0), "")
    add("get_no_side_effects", JSON.stringify(before) === JSON.stringify(after), `before ${JSON.stringify(before).slice(0, 160)} after ${JSON.stringify(after).slice(0, 160)}`)
    const chromePath = findChrome()
    if (!chromePath) {
      browser = { status: "BLOCKED", reason: "no system Chrome/Edge" }
    } else {
      const profile = join(RUN_DIR, "chrome-profile")
      mkdirSync(profile, { recursive: true })
      const chrome = spawn(chromePath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "about:blank"], { stdio: "ignore" })
      try {
        await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok, 20000)
        const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === "page")
        const cdp = await openCdp(page.webSocketDebuggerUrl)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Page.navigate", { url: `${BASE}/feed` })
        const rendered = await waitFor(async () => String(await cdp.evaluate("document.body?.innerText ?? \"\"")).includes("NCHMF"), 30000)
        const text = String(await cdp.evaluate("document.body?.innerText ?? \"\""))
        const rawBlocks = Number(await cdp.evaluate("document.querySelectorAll('[data-testid=\"official-notice-raw\"]').length"))
        const countryRows = String(await cdp.evaluate("[...document.querySelectorAll('[data-testid=\"issuing-country-row\"]')].map(e => e.innerText).join(' | ')"))
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
        writeFileSync(join(RUN_DIR, "feed-nchmf.png"), Buffer.from(shot.data, "base64"))
        const leveled = live.records.find(r => r.originalRiskLevel)
        const unleveled = live.records.find(r => !r.originalRiskLevel)
        const withList = live.records.find(r => r.raw.listTimeText)
        add("browser_feed_rendered", rendered, "/feed contains NCHMF")
        add("browser_summary_wording", text.includes("已接收 NCHMF（越南）官方预警原文记录"), "")
        add("browser_no_active_claim", !/生效中|预警状态：生效/.test(text), "")
        add("browser_lifecycle_timezone_chips", text.includes("生命周期未知") && text.includes("时区未确认") && text.includes("有效性待确认") && text.includes("预警状态：未知"), "")
        add("browser_original_level_unmapped", !leveled || text.includes(`原文风险级别：${leveled.originalRiskLevel}（原始级别，标准化严重度未映射；非系统级别）`), leveled?.originalRiskLevel ?? "none")
        add("browser_level_not_provided", !unleveled || text.includes("原文风险级别：未提供"), "")
        add("browser_raw_times", Boolean(withList) && text.includes(`列表时间 ${withList.raw.listTimeText}`) && text.includes("下一期发布时间（不等于有效期）"), withList?.raw.listTimeText ?? "")
        add("browser_source_and_first_received", text.includes("来源 https://www.nchmf.gov.vn/kttv/vi-VN/1/") && text.includes("首次接收") && text.includes("抓取时间"), "")
        add("browser_grouped_by_issuing_country", countryRows.includes("发布国家 VN") && text.includes("发布国家：VN"), countryRows)
        add("browser_raw_block_per_record", rawBlocks >= live.recordsStored, `${rawBlocks} raw blocks`)
        browser = { status: "RAN", chrome: chromePath, url: `${BASE}/feed`, rawBlocks, countryRows, screenshot: "feed-nchmf.png", excerpt: text.slice(Math.max(0, text.indexOf("NCHMF") - 200), text.indexOf("NCHMF") + 900) }
        cdp.ws.close()
      } finally {
        chrome.kill("SIGKILL")
        await new Promise(r => setTimeout(r, 500))
        try {
          rmSync(profile, { recursive: true, force: true })
        } catch {}
      }
    }
  } finally {
    server.kill("SIGKILL")
  }
  const pass = checks.every(c => c.pass) && browser.status === "RAN"
  const evidence = { kind: "VN-W01 display verification", ranAt: new Date().toISOString(), gitHead: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(), workspaceClean: execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === "", liveRunGitHead: live.gitHead, runDir: RUN_DIR, verdict: pass ? "PASS" : browser.status === "BLOCKED" ? "BLOCKED" : "FAIL", coverage: { service: "production build dist/output/server (Nitro), Runtime disabled, SHIPPING_WEATHER_ALERT_PROVIDER unset", api: ["GET /api/shipping/feed", "GET /api/shipping"], browser: "system Chrome headless over CDP: /feed" }, api, browser, checks }
  writeFileSync(join(RUN_DIR, "nchmf-display-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ verdict: evidence.verdict, failed: checks.filter(c => !c.pass) }))
  process.exitCode = pass ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
