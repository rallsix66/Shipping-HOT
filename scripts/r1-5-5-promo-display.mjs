// R1.5-5 promo calendar verification on an ISOLATED SQLite (fresh <repo>/.tmp run dir):
// production build -> POST generate (explicit write) -> POST confirm (negative cases + one fixture confirmation)
// -> inject abnormal legacy rows -> restart server -> GET API -> real /calendar page in system Chrome (CDP).
// The confirmation evidence URL used here is a TEST FIXTURE, not a real official confirmation.
// Usage: node scripts/r1-5-5-promo-display.mjs
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import process from "node:process"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = join(ROOT, ".tmp", `r1-5-5-promo-${new Date().toISOString().replace(/[:.]/g, "-")}`)
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_PROMO_PORT ?? "4495")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_PROMO_DEBUG_PORT ?? "9355")
const SECRET_KEYS = ["GFW_API_TOKEN", "VESSELAPI_API_KEY", "AISSTREAM_API_KEY", "CALENDARIFIC_API_KEY", "DEEPSEEK_API_KEY", "SHIPPING_WEATHER_ALERT_PROVIDER"]
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const FIXTURE_EVIDENCE = "https://shopee.vn/blog/fixture-r1-5-5-test-only"
const checks = []
const add = (id, pass, detail = "") => checks.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 300) })
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(check, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return true
    } catch {}
    await sleep(250)
  }
  return false
}

function startServer(tag) {
  const logFd = openSync(join(RUN_DIR, `server-${tag}.log`), "a")
  const env = { ...process.env }
  for (const key of SECRET_KEYS) delete env[key]
  Object.assign(env, { SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_PORT_PROVIDER: "mock", SHIPPING_FEED_PROVIDER: "mock", SHIPPING_CALENDAR_PROVIDER: "mock", SHIPPING_WEATHER_PROVIDER: "mock", NITRO_HOST: "127.0.0.1", PORT: String(PORT), NITRO_PORT: String(PORT) })
  return spawn(process.execPath, [SERVER_ENTRY], { cwd: RUN_DIR, env, stdio: ["ignore", logFd, logFd] })
}

async function stopServer(server) {
  server.kill("SIGKILL")
  await waitFor(async () => {
    try {
      await fetch(`${BASE}/api/shipping/health`)
      return false
    } catch {
      return true
    }
  }, 10000)
}

const post = (path, body, origin = BASE) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })

function promoFingerprint() {
  const db = new Database(DB_PATH, { readonly: true })
  const r = db.prepare("SELECT COUNT(*) AS n, GROUP_CONCAT(id || '|' || updated_at || '|' || confirmation_status, ',') AS h FROM (SELECT * FROM ops_calendar_event ORDER BY id)").get()
  const usage = db.prepare("SELECT COUNT(*) AS n FROM provider_usage").get().n
  db.close()
  return { rows: r.n, hashLength: (r.h ?? "").length, hash: String(r.h ?? "").slice(0, 0) + String((r.h ?? "").split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)), providerUsageRows: usage }
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
  const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value
  return { ws, send, evaluate }
}

async function main() {
  mkdirSync(join(RUN_DIR, ".data"), { recursive: true })
  const writes = {}
  let server = startServer("phase1")
  try {
    add("server1_healthy", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500), BASE)
    const emptyGet = await (await fetch(`${BASE}/api/shipping/calendar/promotions?year=2026`)).json()
    add("fresh_db_empty_before_generate", emptyGet.events?.length === 0, emptyGet.events?.length)
    const foreign = await post("/api/shipping/calendar/promotions/generate", { year: 2026 }, "https://evil.example.com")
    add("generate_foreign_origin_rejected", foreign.status === 403, foreign.status)
    const badYear = await post("/api/shipping/calendar/promotions/generate", { year: "2026" })
    add("generate_invalid_year_rejected", badYear.status === 400, badYear.status)
    const gen1 = await (await post("/api/shipping/calendar/promotions/generate", { year: 2026 })).json()
    const gen2 = await (await post("/api/shipping/calendar/promotions/generate", { year: 2026 })).json()
    writes.generate = [gen1, gen2].map(g => ({ candidates: g.candidates, created: g.created, updated: g.updated, unchanged: g.unchanged, protected: g.protected, rejected: g.rejected }))
    add("generate_creates_then_idempotent", gen1.created === gen1.candidates && gen2.created === 0 && gen2.unchanged === gen1.candidates, JSON.stringify(writes.generate))
    const id = "promo:E-R01:2026:VN:shopee:m11"
    const neg = {
      confirmedFlagOnly: await post("/api/shipping/calendar/promotions/confirm", { id, countryCode: "VN", platform: "shopee", confirmed: true }),
      wrongCountry: await post("/api/shipping/calendar/promotions/confirm", { id, countryCode: "TH", platform: "shopee", evidenceSourceId: "XX-E01", evidenceRef: FIXTURE_EVIDENCE }),
      wrongPlatform: await post("/api/shipping/calendar/promotions/confirm", { id, countryCode: "VN", platform: "lazada", evidenceSourceId: "XX-E01", evidenceRef: FIXTURE_EVIDENCE }),
      noEvidenceRef: await post("/api/shipping/calendar/promotions/confirm", { id, countryCode: "VN", platform: "shopee", evidenceSourceId: "XX-E01" }),
      anchorPending: await post("/api/shipping/calendar/promotions/confirm", { id: "promo:E-R06:2026:VN:unspecified:tet", countryCode: "VN", platform: "unspecified", evidenceSourceId: "manual_url", evidenceRef: "https://example.org/tet-sale-fixture" }),
    }
    writes.negativeConfirm = Object.fromEntries(await Promise.all(Object.entries(neg).map(async ([k, r]) => [k, { status: r.status, statusText: (await r.json().catch(() => ({}))).statusMessage ?? r.statusText }])))
    add("confirm_negatives_rejected", Object.values(writes.negativeConfirm).every(r => r.status >= 400 && r.status < 500), JSON.stringify(writes.negativeConfirm))
    const ok = await post("/api/shipping/calendar/promotions/confirm", { id, countryCode: "VN", platform: "shopee", evidenceSourceId: "XX-E01", evidenceRef: FIXTURE_EVIDENCE, note: "TEST FIXTURE ONLY - not a real official confirmation" })
    const okBody = await ok.json()
    writes.fixtureConfirm = { status: ok.status, confirmationStatus: okBody.confirmationStatus, sourceId: okBody.confirmation?.sourceId }
    add("confirm_with_fixture_evidence_ok", ok.status === 200 && okBody.confirmationStatus === "confirmed", JSON.stringify(writes.fixtureConfirm))
  } finally {
    await stopServer(server)
  }
  // Abnormal legacy rows written directly (as an old/foreign writer could): must never display as confirmed.
  const db = new Database(DB_PATH)
  const now = new Date().toISOString()
  db.prepare("INSERT INTO ops_calendar_event (id, country_code, title, starts_at, ends_at, category, basis_kind, basis_ref, confirmation_status, rule_id, notes, created_at, updated_at) VALUES ('legacy-fixture-1','PH','历史记录（无平台，标记已确认但无证据）','2026-05-05',NULL,'promo','manual',NULL,'confirmed',NULL,'fixture',?,?)").run(now, now)
  db.prepare("INSERT INTO ops_calendar_event (id, country_code, title, starts_at, ends_at, category, basis_kind, basis_ref, confirmation_status, rule_id, notes, created_at, updated_at, platform, entry_kind) VALUES ('legacy-fixture-2','PH','异常平台记录','2026-05-05','2026-05-05','promo','manual',NULL,'confirmed',NULL,'fixture',?,?,'amazon','legacy')").run(now, now)
  db.close()

  let api = {}
  let browser = { status: "NOT_RUN" }
  server = startServer("phase2-restart")
  try {
    add("server2_healthy_after_restart", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500), BASE)
    const before = promoFingerprint()
    const res = await fetch(`${BASE}/api/shipping/calendar/promotions?year=2026`)
    const body = await res.json()
    await fetch(`${BASE}/api/shipping/calendar/reference?year=2026`).then(r => r.text())
    const after = promoFingerprint()
    const ev = body.events ?? []
    const confirmed = ev.filter(e => e.confirmationStatus === "confirmed")
    const legacy = ev.filter(e => e.id.startsWith("legacy-fixture"))
    api = { status: res.status, events: ev.length, confirmed: confirmed.map(e => e.id), byRule: Object.fromEntries(["E-R01", "E-R02", "E-R03", "E-R04", "E-R05", "E-R06"].map(r => [r, ev.filter(e => e.ruleId === r).length])), pendingWindow: ev.filter(e => e.windowStatus === "pending").map(e => e.id), legacy: legacy.map(e => ({ id: e.id, platform: e.platform, confirmationStatus: e.confirmationStatus, dataIssue: e.dataIssue })), gaps: body.gaps, before, after }
    add("api_persisted_after_restart", res.status === 200 && ev.length >= 489, ev.length)
    add("api_only_fixture_confirmed", confirmed.length === 1 && confirmed[0].id === "promo:E-R01:2026:VN:shopee:m11" && confirmed[0].confirmation?.evidenceRef === FIXTURE_EVIDENCE && /E-R01/.test(confirmed[0].generationBasis), confirmed.map(e => e.id).join(","))
    add("api_legacy_never_confirmed", legacy.length === 2 && legacy.every(e => e.confirmationStatus === "pending" && e.platform === "unspecified" && e.dataIssue), JSON.stringify(api.legacy))
    add("api_anchor_windows_pending", api.pendingWindow.length === 7, api.pendingWindow.length)
    add("api_gaps_listed", (body.gaps ?? []).some(g => g.ruleId === "E-R04") && (body.gaps ?? []).some(g => g.ruleId === "E-R06"), (body.gaps ?? []).length)
    add("get_checked_fingerprint_unchanged", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} / ${JSON.stringify(after)}`)

    const chromePath = findChrome()
    if (!chromePath) {
      browser = { status: "BLOCKED", reason: "no system Chrome/Edge" }
    } else {
      const profile = join(RUN_DIR, "chrome-profile")
      mkdirSync(profile, { recursive: true })
      const chrome = spawn(chromePath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1500,1400", "about:blank"], { stdio: "ignore" })
      try {
        await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok, 20000)
        const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === "page")
        const cdp = await openCdp(page.webSocketDebuggerUrl)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Page.navigate", { url: `${BASE}/calendar` })
        const rendered = await waitFor(async () => String(await cdp.evaluate("document.body?.innerText ?? ''")).includes("东南亚假日台历"), 30000)
        add("browser_calendar_rendered", rendered, "/calendar")
        const offCount = Number(await cdp.evaluate("document.querySelectorAll('[data-testid=promo-day-count]').length"))
        add("browser_layer_off_by_default", offCount === 0, offCount)
        await cdp.evaluate("document.querySelector('[data-testid=promo-layer-toggle]').click()")
        const pick = async (month, date) => {
          await cdp.evaluate(`(() => { const s = document.querySelector('select[aria-label="月份"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${month}'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await sleep(300)
          await waitFor(async () => Boolean(await cdp.evaluate(`!!document.querySelector('button[aria-label^="${date}，"]')`)), 5000)
          await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"]').click()`)
          await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=promo-detail]').length")) > 0, 10000)
          await sleep(300)
          return {
            text: String(await cdp.evaluate("document.querySelector('[data-testid=promo-details]')?.innerText ?? ''")),
            details: await cdp.evaluate("[...document.querySelectorAll('[data-testid=promo-detail]')].map(a => ({ status: a.dataset.status, text: a.innerText }))"),
            dayCount: String(await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"] [data-testid=promo-day-count]')?.innerText ?? ''`)),
          }
        }
        const nov = await pick(10, "2026-11-11")
        const shot1 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
        writeFileSync(join(RUN_DIR, "calendar-2026-11-11.png"), Buffer.from(shot1.data, "base64"))
        const confirmedCards = nov.details.filter(d => d.status === "confirmed")
        add("browser_1111_multi_country_platform", nov.details.length === 15 && ["Shopee", "Lazada", "TikTok Shop"].every(p => nov.text.includes(p)) && ["VN", "TH", "MY", "ID", "PH"].every(c => nov.text.includes(c)), `${nov.details.length} cards; day chip ${nov.dayCount}`)
        add("browser_1111_one_confirmed_with_evidence", confirmedCards.length === 1 && confirmedCards[0].text.includes("已由 XX-E01 确认") && confirmedCards[0].text.includes("确认证据：XX-E01") && confirmedCards[0].text.includes("VN · Shopee"), confirmedCards[0]?.text)
        add("browser_1111_others_pending_with_basis", nov.details.filter(d => d.status === "pending").every(d => d.text.includes("规则生成（待确认）") && d.text.includes("规则：E-R01") && d.text.includes("来源：信源目录 §9 E-R01") && d.text.includes("生成依据：")), "")
        const feb = await pick(1, "2026-02-16")
        add("browser_tet_anchor_pending_window", feb.text.includes("越南春节促销") && feb.text.includes("节日锚点（促销窗口待定）") && feb.text.includes("VN · 未指定") && feb.text.includes("规则：E-R06"), "")
        const may = await pick(4, "2026-05-05")
        add("browser_legacy_abnormal_not_confirmed", may.details.filter(d => d.text.includes("历史记录") || d.text.includes("异常平台")).length === 2 && !may.details.some(d => d.status === "confirmed" && /历史|异常/.test(d.text)) && may.text.includes("数据异常（待确认）") && may.text.includes("PH · 未指定"), "")
        const dec = await pick(11, "2026-12-12")
        const shot2 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
        writeFileSync(join(RUN_DIR, "calendar-2026-12-12.png"), Buffer.from(shot2.data, "base64"))
        add("browser_harbolnas_catalog_pending", dec.text.includes("Harbolnas 全国网购日") && dec.text.includes("ID · 未指定") && dec.text.includes("来源：信源目录 §9 E-R05") && dec.text.includes("本系统未重新核实"), "")
        const gaps = String(await cdp.evaluate("document.querySelector('[data-testid=promo-gaps]')?.innerText ?? ''"))
        add("browser_gaps_shown_as_pending", gaps.includes("待定") && gaps.includes("E-R04") && gaps.includes("E-R06"), gaps.slice(0, 200))
        const holidaysStill = String(await cdp.evaluate("document.querySelector('.annual-details')?.innerText ?? ''"))
        add("browser_holiday_layer_unchanged", holidaysStill.includes("项所选国家记录"), "")
        browser = { status: "RAN", chrome: chromePath, url: `${BASE}/calendar`, screenshots: ["calendar-2026-11-11.png", "calendar-2026-12-12.png"], nov: { dayCount: nov.dayCount, cards: nov.details.length, confirmed: confirmedCards.map(d => d.text) }, feb: feb.text.slice(0, 800), may: may.text.slice(0, 800), dec: dec.text.slice(0, 1200), gaps }
        cdp.ws.close()
      } finally {
        chrome.kill("SIGKILL")
        await sleep(500)
        try {
          rmSync(profile, { recursive: true, force: true })
        } catch {}
      }
    }
  } finally {
    await stopServer(server)
  }
  const pass = checks.every(c => c.pass) && browser.status === "RAN"
  const evidence = { kind: "R1.5-5 promo calendar isolated SQLite -> restart -> API -> /calendar", ranAt: new Date().toISOString(), gitHead: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(), workspaceClean: execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === "", runDir: RUN_DIR, fixtureNotice: `The only confirmation uses fixture evidence ${FIXTURE_EVIDENCE}; it is NOT a real official confirmation. No seller backend, no new source, no LLM, no upstream fetch.`, verdict: pass ? "PASS" : browser.status === "BLOCKED" ? "BLOCKED" : "FAIL", writes, api, browser, checks }
  writeFileSync(join(RUN_DIR, "promo-display-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ verdict: evidence.verdict, runDir: RUN_DIR, failed: checks.filter(c => !c.pass) }))
  process.exitCode = pass ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
