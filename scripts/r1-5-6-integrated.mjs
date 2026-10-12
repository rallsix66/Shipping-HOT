// R1.5-6 four-page no-LLM integrated acceptance (ports, weather notices in Feed, calendar, policies + main navigation).
// One production build (dist/output/server), one isolated SQLite under .tmp, one serial real-browser walk (system Chrome over CDP).
// Data provenance (each item labelled in the evidence):
//   - historical live samples: port forecasts from the accepted R1.5-1 run (50bad03, .tmp/r1-5-1-live-2026-10-10T06-42-03-941Z),
//     official notices from the NMC (a6c00bc), NCHMF (c064e5a) and MetMalaysia (eab30a7) isolated live runs — copied, not re-fetched;
//   - rule-generated promo candidates (POST generate in this run, all 待确认);
//   - fixtures: policies (isFixture=true, example.org links).
// No-LLM evidence: provider secrets stripped from env, no provider-secrets.json in the run dir, translation status API,
// an outbound recorder preloaded into the server (scripts/lib/outbound-recorder.cjs) that logs every non-loopback
// TCP connect / DNS lookup / fetch, plus a recorder self-test; code-path review is documented separately.
// Usage: node scripts/r1-5-6-integrated.mjs
import { execSync, spawn, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import process from "node:process"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = join(ROOT, ".tmp", `r1-5-6-integrated-${new Date().toISOString().replace(/[:.]/g, "-")}`)
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const RECORDER = join(ROOT, "scripts", "lib", "outbound-recorder.cjs")
const OUTBOUND_LOG = join(RUN_DIR, "outbound.jsonl")
const PORT = Number(process.env.E2E_R156_PORT ?? "4499")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R156_DEBUG_PORT ?? "9359")
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SOURCES = {
  weather: { dir: ".tmp/r1-5-1-live-2026-10-10T06-42-03-941Z", sha: "50bad03", kind: "historical live sample (R1.5-1 accepted run, 2026-10-10 14:42 UTC+8)" },
  nmc: { dir: ".tmp/nmc-live-a6c00bc", sha: "a6c00bc", kind: "historical live sample (CN-W01/02)" },
  nchmf: { dir: ".tmp/nchmf-live-c064e5a", sha: "c064e5a", kind: "historical live sample (VN-W01)" },
  metmalaysia: { dir: ".tmp/metmalaysia-live-eab30a7", sha: "eab30a7", kind: "historical live sample (MY-W01)" },
}
const PORT_IDS = ["port-shekou", "port-yantian", "port-nansha", "port-laem-chabang", "port-klang", "port-manila", "port-jakarta", "port-ho-chi-minh"]
const checks = []
const add = (id, pass, detail = "", provenance = "this-round browser/API") => checks.push({ id, pass: Boolean(pass), provenance, detail: String(detail).slice(0, 400) })
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(check, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return true
    } catch {}
    await sleep(250)
  }
  return false
}
function findChrome() {
  return [process.env.E2E_CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find(p => existsSync(p))
}
const outbound = () => existsSync(OUTBOUND_LOG) ? readFileSync(OUTBOUND_LOG, "utf8").trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : []

// ---- isolated DB from retained samples (no re-fetch) ----
function prepareDb() {
  mkdirSync(join(RUN_DIR, ".data"), { recursive: true })
  copyFileSync(join(ROOT, SOURCES.weather.dir, ".data", "shipping-hot-v3.sqlite3"), DB_PATH)
  const db = new Database(DB_PATH)
  const cols = db.prepare("PRAGMA table_info(feed_items)").all().map(c => c.name)
  const copied = {}
  for (const key of ["nmc", "nchmf", "metmalaysia"]) {
    const src = join(ROOT, SOURCES[key].dir, ".data", "shipping-hot-v3.sqlite3")
    db.exec(`ATTACH DATABASE '${src.replace(/'/g, "''")}' AS src`)
    const srcCols = new Set(db.prepare("PRAGMA src.table_info(feed_items)").all().map(c => c.name))
    const common = cols.filter(c => srcCols.has(c)).join(", ")
    copied[key] = db.prepare(`INSERT OR IGNORE INTO feed_items (${common}) SELECT ${common} FROM src.feed_items`).run().changes
    db.exec("DETACH DATABASE src")
  }
  const counts = { feed: db.prepare("SELECT COUNT(*) n FROM feed_items").get().n, forecast: db.prepare("SELECT COUNT(*) n FROM weather_forecast").get().n }
  db.close()
  return { copied, counts }
}

function startServer(tag) {
  const logFd = openSync(join(RUN_DIR, `server-${tag}.log`), "a")
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!/KEY|TOKEN|SECRET|PASSWORD|WEATHER_ALERT_PROVIDER/i.test(k)) env[k] = v
  }
  Object.assign(env, { SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_PORT_PROVIDER: "mock", SHIPPING_FEED_PROVIDER: "mock", SHIPPING_CALENDAR_PROVIDER: "mock", SHIPPING_WEATHER_PROVIDER: "mock", NITRO_HOST: "127.0.0.1", PORT: String(PORT), NITRO_PORT: String(PORT), OUTBOUND_LOG })
  const strippedKeys = Object.keys(process.env).filter(k => !(k in env))
  return { proc: spawn(process.execPath, ["--require", RECORDER, SERVER_ENTRY], { cwd: RUN_DIR, env, stdio: ["ignore", logFd, logFd] }), envKeys: Object.keys(env).filter(k => k.startsWith("SHIPPING_")).sort(), strippedKeys }
}
async function stopServer(server) {
  server.proc.kill("SIGKILL")
  await waitFor(async () => {
    try {
      await fetch(`${BASE}/api/shipping/health`)
      return false
    } catch {
      return true
    }
  }, 10000)
}
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", "origin": BASE }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const getJson = async path => (await fetch(`${BASE}${path}`)).json()

async function openCdp(wsUrl, onEvent) {
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
    } else if (msg.method) {
      onEvent(msg.method, msg.params)
    }
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id
    const timer = setTimeout(() => {
      pending.delete(msgId)
      rej(new Error(`CDP timeout ${method}`))
    }, 45000)
    const done = (fn, v) => {
      clearTimeout(timer)
      fn(v)
    }
    pending.set(msgId, { res: v => done(res, v), rej: e => done(rej, e) })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
  const evaluate = async expression => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value
  return { ws, send, evaluate }
}
const SET_FIELD = `window.__setField = (testid, value) => {
  const el = document.querySelector('[data-testid="' + testid + '"]')
  if (!el) throw new Error('missing ' + testid)
  if (el.type === 'checkbox') { if (el.checked !== value) el.click(); return }
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}`

const fixtureA = { category: "customs_tax", countryCode: "VN", title: "[FIXTURE] 综合验收示例越南海关公告 A", documentNumber: "FIXTURE-R156-A", publisher: "示例机关（fixture）", publishedAt: "2026-09-20", effectiveAt: "2026-10-01", status: "effective", sourceType: "official", sourceUrl: "https://example.org/fixture/r156-a", fullText: "示例政府公告全文副本（fixture，非真实公告）。", basisText: "fixture 依据 A v1", enteredBy: "r156-tester", isFixture: true }

async function main() {
  mkdirSync(RUN_DIR, { recursive: true })
  const evidence = { kind: "R1.5-6 four-page no-LLM integrated acceptance", ranAt: new Date().toISOString(), gitHead: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(), workspaceClean: execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === "", runDir: RUN_DIR, sources: SOURCES, clock: "system clock (no TEST_NOW); policy fixtures use dates relative to 2026-10", notRun: [] }

  // Recorder self-test: a child process with the same preload must record a non-loopback connect attempt (TEST-NET-1, no traffic expected to succeed).
  const selfLog = join(RUN_DIR, "recorder-selftest.jsonl")
  spawnSync(process.execPath, ["--require", RECORDER, "-e", "const s=require('net').connect({host:'192.0.2.1',port:9});s.on('error',()=>{});setTimeout(()=>process.exit(0),300)"], { env: { ...process.env, OUTBOUND_LOG: selfLog } })
  const selfEntries = existsSync(selfLog) ? readFileSync(selfLog, "utf8") : ""
  add("recorder_selftest_detects_outbound", selfEntries.includes("192.0.2.1"), selfEntries.slice(0, 200), "recorder self-test")

  const seed = prepareDb()
  evidence.seed = seed
  add("seed_from_retained_samples", seed.counts.forecast > 0 && seed.copied.nmc > 0 && seed.copied.nchmf > 0 && seed.copied.metmalaysia > 0, JSON.stringify(seed), "historical live samples (copied)")
  const hasSecretsFile = existsSync(join(RUN_DIR, ".data", "provider-secrets.json"))

  const server = startServer("main")
  evidence.runtime = { envShipping: server.envKeys, strippedEnvKeyNames: server.strippedKeys, providerSecretsFilePresent: hasSecretsFile }
  const browserLog = { exceptions: [], consoleErrors: [], failedRequests: [], httpErrors: [], requests: 0 }
  try {
    add("server_healthy", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500, 60000), BASE)
    // ---- config checks ----
    const tr = await getJson("/api/shipping/translation/status")
    evidence.translationStatus = tr
    add("llm_not_configured", tr.configured === false && !hasSecretsFile, JSON.stringify({ configured: tr.configured, providerSecretsFilePresent: hasSecretsFile }), "config check")
    add("runtime_disabled_and_mock_providers", server.envKeys.includes("SHIPPING_RUNTIME_ENABLED"), server.envKeys.join(","), "config check")

    // ---- API snapshot ----
    const portApi = {}
    for (const id of PORT_IDS) portApi[id] = await getJson(`/api/shipping/ports/${id}/weather`)
    const feed = await getJson("/api/shipping/feed")
    const feedItems = feed.feedItems ?? []
    evidence.api = { ports: Object.fromEntries(Object.entries(portApi).map(([k, v]) => [k, { state: v.state, forecastMeta: v.forecastMeta ? { actualCoverage: v.forecastMeta.actualCoverage, lastSyncedAt: v.forecastMeta.lastSyncedAt ?? v.forecastMeta.fetchedAt } : null, officialAlerts: v.officialAlerts?.length, sources: v.sources, stale: JSON.stringify(v).includes("\"stale\":true") }])) }
    add("api_ports_all_respond", PORT_IDS.every(id => portApi[id]?.state), JSON.stringify(Object.fromEntries(PORT_IDS.map(id => [id, portApi[id]?.state]))))
    const officialFeed = feedItems.filter(i => String(i.id).startsWith("weather-alert:"))
    const modelFeed = feedItems.filter(i => i.weather && !String(i.id).startsWith("weather-alert:"))
    evidence.api.feedModelForecastItems = modelFeed.map(i => ({ id: i.id, riskSource: i.weather?.riskSource, relatedPortIds: i.relatedPortIds }))
    add("api_feed_model_items_are_not_official", modelFeed.every(i => i.weather?.riskSource !== "official"), JSON.stringify(evidence.api.feedModelForecastItems))
    evidence.api.feedOfficialNotices = officialFeed.length
    add("api_feed_official_notices", officialFeed.length >= seed.copied.nmc + seed.copied.nchmf + seed.copied.metmalaysia, `${officialFeed.length}`)
    add("api_feed_no_port_association_for_notices", officialFeed.every(i => (i.relatedPortIds ?? []).length === 0), "")
    // Explicit writes: promo candidates (rule-generated, pending) and fixture policy A.
    const gen = await post("/api/shipping/calendar/promotions/generate", { year: 2026 })
    const promos = await getJson("/api/shipping/calendar/promotions?year=2026")
    const promoEvents = promos.events ?? []
    evidence.api.promo = { generateStatus: gen.status, events: promoEvents.length, confirmed: promoEvents.filter(e => e.windowStatus === "confirmed" || e.confirmation).length }
    add("promo_rule_generated_all_pending", gen.status === 200 && promoEvents.length > 0 && promoEvents.every(e => e.windowStatus !== "confirmed"), JSON.stringify(evidence.api.promo), "rule-generated (this run)")
    const createA = await post("/api/shipping/policies", fixtureA)
    add("policy_fixture_A_created", createA.status === 200 && createA.body.displayStatus === "effective", `${createA.status} ${createA.body.displayStatus ?? createA.body.statusMessage}`, "fixture")

    // ---- browser ----
    const chromePath = findChrome()
    if (!chromePath) {
      evidence.notRun.push("browser: no system Chrome/Edge")
      add("browser_available", false, "no Chrome")
    } else {
      const profile = join(RUN_DIR, "chrome-profile")
      mkdirSync(profile, { recursive: true })
      const chrome = spawn(chromePath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1500,2200", "about:blank"], { stdio: "ignore" })
      const shots = []
      try {
        await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok, 20000)
        const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === "page")
        let currentPage = ""
        const cdp = await openCdp(page.webSocketDebuggerUrl, (method, p) => {
          if (method === "Runtime.exceptionThrown") browserLog.exceptions.push({ page: currentPage, text: p.exceptionDetails?.exception?.description?.slice(0, 300) ?? p.exceptionDetails?.text })
          if (method === "Runtime.consoleAPICalled" && p.type === "error") browserLog.consoleErrors.push({ page: currentPage, text: (p.args ?? []).map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300) })
          if (method === "Log.entryAdded" && p.entry?.level === "error") browserLog.consoleErrors.push({ page: currentPage, text: `${p.entry.source}: ${p.entry.text}`.slice(0, 300), url: p.entry.url })
          if (method === "Network.requestWillBeSent") browserLog.requests++
          if (method === "Network.loadingFailed" && !p.canceled) browserLog.failedRequests.push({ page: currentPage, error: p.errorText, type: p.type })
          if (method === "Network.responseReceived" && p.response?.status >= 400) browserLog.httpErrors.push({ page: currentPage, status: p.response.status, url: p.response.url })
          if (method === "Network.requestWillBeSent" && !/^(?:http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(p.request?.url ?? "")) browserLog.failedRequests.push({ page: currentPage, external: p.request.url })
        })
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Network.enable")
        await cdp.send("Log.enable")
        const go = async (path, ready) => {
          currentPage = path
          console.log(`[step] ${new Date().toISOString()} ${path}`)
          await cdp.send("Page.navigate", { url: `${BASE}${path}` })
          const ok = await waitFor(async () => (await cdp.evaluate("document.readyState")) === "complete" && (!ready || await cdp.evaluate(ready)), 30000)
          await sleep(500)
          return ok
        }
        const body = async () => String(await cdp.evaluate("document.body?.innerText ?? ''"))
        const shot = async (name) => {
          const s = await cdp.send("Page.captureScreenshot", { format: "png" })
          writeFileSync(join(RUN_DIR, name), Buffer.from(s.data, "base64"))
          shots.push(name)
        }

        // 1. Main navigation.
        await go("/", "!!document.querySelector('nav a, header a')")
        const navHrefs = await cdp.evaluate("[...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(Boolean)")
        const wanted = ["/ports", "/feed", "/calendar", "/policies"]
        add("nav_links_present", wanted.every(h => navHrefs.includes(h)), JSON.stringify(navHrefs).slice(0, 300))
        const navWalk = {}
        for (const h of wanted) {
          await go("/", `!!document.querySelector('a[href="${h}"]')`)
          currentPage = `nav→${h}`
          await cdp.evaluate(`document.querySelector('a[href="${h}"]').click()`)
          navWalk[h] = await waitFor(async () => (await cdp.evaluate("location.pathname")) === h, 10000)
        }
        add("nav_click_through_all", Object.values(navWalk).every(Boolean), JSON.stringify(navWalk))

        // 2. Ports + port forecasts (historical live sample, system clock).
        await go("/ports", "document.body.innerText.length > 50")
        add("ports_page_rendered", (await body()).includes("港口"), "")
        const portPages = {}
        for (const id of PORT_IDS) {
          await go(`/ports/${id}`, "!!document.querySelector('[data-testid=\"port-weather-forecast-meta\"]')?.innerText")
          const meta = String(await cdp.evaluate("document.querySelector('[data-testid=\"port-weather-forecast-meta\"]')?.innerText ?? ''"))
          const text = await body()
          const api = portApi[id]
          const ac = api.forecastMeta?.actualCoverage
          const apiStale = api.state === "data_stale" || JSON.stringify(api).includes("\"stale\":true")
          portPages[id] = {
            metaMatchesApi: Boolean(ac) && meta.includes(`hourly ${ac.hourlyReturned} / current ${ac.currentReturned}`),
            officialSection: text.includes("官方预警"),
            modelVsOfficial: text.includes("官方预警") && /模型预报|Open-Meteo/.test(text),
            apiState: api.state,
            apiStale,
            staleShown: !apiStale || text.includes("过期"),
            noAlertsHonest: (api.officialAlerts?.length ?? 0) > 0 || text.includes("未配置或未同步到本港相关官方预警"),
            meta: meta.slice(0, 300),
          }
        }
        await shot("port-ho-chi-minh.png")
        evidence.ports = portPages
        add("ports_forecast_meta_matches_api", Object.values(portPages).every(p => p.metaMatchesApi), JSON.stringify(Object.fromEntries(Object.entries(portPages).map(([k, v]) => [k, v.metaMatchesApi]))), "historical live sample rendered this round")
        add("ports_official_vs_model_distinguished", Object.values(portPages).every(p => p.modelVsOfficial), "")
        add("ports_stale_never_disguised", Object.values(portPages).every(p => p.staleShown), JSON.stringify(Object.fromEntries(Object.entries(portPages).map(([k, v]) => [k, `${v.apiState}/${v.apiStale}`]))))
        add("ports_missing_alerts_stated_honestly", Object.values(portPages).every(p => p.noAlertsHonest), "")

        // 3. Weather notices in Feed (historical live samples).
        await go("/feed", "document.body.innerText.includes('发布国家')")
        const feedText = await body()
        const rows = String(await cdp.evaluate("[...document.querySelectorAll('[data-testid=\"issuing-country-row\"]')].map(e => e.innerText).join(' | ')"))
        evidence.feed = { countryRows: rows, cnRaw: Number(await cdp.evaluate("document.querySelectorAll('[data-testid=\"cn-notice-raw\"]').length")), officialRaw: Number(await cdp.evaluate("document.querySelectorAll('[data-testid=\"official-notice-raw\"]').length")) }
        add("feed_grouped_by_issuing_country_cn_vn_my", ["CN", "VN", "MY"].every(c => rows.includes(`发布国家 ${c}`)), rows, "historical live samples rendered this round")
        add("feed_lifecycle_unknown_and_timezone_unconfirmed", feedText.includes("生命周期未知") && feedText.includes("时区未确认"), "")
        add("feed_historical_product_notice_shown", feedText.includes("历史产品提示"), "")
        add("feed_publication_not_active_claim", feedText.includes("发布不代表当前生效") && !/预警状态：生效/.test(feedText), "")
        add("feed_raw_levels_unmapped_no_port", feedText.includes("未映射") && feedText.includes("关联港口：0"), "")
        add("feed_official_vs_model_chips", feedText.includes("官方预警") && feedText.includes("模型预报"), "")
        add("feed_raw_blocks_rendered", evidence.feed.cnRaw > 0 && evidence.feed.officialRaw > 0, JSON.stringify(evidence.feed))
        await shot("feed-official-notices.png")

        // 4. Policies: form create, revise, old version, filter, export.
        await go("/policies", "document.querySelectorAll('[data-testid=policy-row]').length >= 1")
        await cdp.evaluate(SET_FIELD)
        const formD = { "pf-category": "customs_tax", "pf-countryCode": "MY", "pf-title": "[FIXTURE] 综合验收表单示例 D", "pf-documentNumber": "FIXTURE-R156-D", "pf-publisher": "示例机关（fixture）", "pf-publishedAt": "2026-10-05", "pf-effectiveAt": "2026-11-01", "pf-status": "published", "pf-sourceType": "official", "pf-sourceUrl": "https://example.org/fixture/r156-d", "pf-enteredBy": "r156-browser", "pf-basisText": "fixture 表单依据 v1", "pf-fullText": "表单录入示例全文（fixture，非真实公告）。" }
        for (const [k, v] of Object.entries(formD)) await cdp.evaluate(`window.__setField(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
        await cdp.evaluate("window.__setField('pf-isFixture', true)")
        await sleep(200)
        await cdp.evaluate("document.querySelector('[data-testid=policy-submit]').click()")
        add("policy_form_create", await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-row]').length")) === 2, 10000), "", "fixture via real form")
        await waitFor(async () => Boolean(await cdp.evaluate("!!document.querySelector('[data-testid=policy-start-revise]')")), 10000)
        await cdp.evaluate("document.querySelector('[data-testid=policy-start-revise]').click()")
        await sleep(300)
        await cdp.evaluate(SET_FIELD)
        await cdp.evaluate("window.__setField('pf-basisText', 'fixture 表单依据 v2')")
        await cdp.evaluate("window.__setField('pf-enteredBy', 'r156-browser-2')")
        await cdp.evaluate("window.__setField('pf-changeSummary', '依据更正（fixture）')")
        await sleep(200)
        await cdp.evaluate("document.querySelector('[data-testid=policy-submit]').click()")
        const revised = await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-version]').length")) === 2, 10000)
        const detail = String(await cdp.evaluate("document.querySelector('[data-testid=policy-detail]')?.innerText ?? ''"))
        add("policy_form_revise_and_old_version_visible", revised && detail.includes("fixture 表单依据 v1") && detail.includes("fixture 表单依据 v2") && detail.includes("已被新版本取代"), detail.slice(0, 200), "fixture via real form")
        await shot("policies-detail.png")
        const apiPolicies = await getJson("/api/shipping/policies")
        const rowsP = await cdp.evaluate("[...document.querySelectorAll('[data-testid=policy-row]')].map(r => ({ id: r.dataset.id, status: r.dataset.status }))")
        add("policy_status_page_equals_api", rowsP.length === apiPolicies.total && rowsP.every(r => apiPolicies.records.find(p => p.id === r.id)?.displayStatus === r.status), JSON.stringify(rowsP))
        await cdp.evaluate("window.__setField('filter-country', 'VN')")
        await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-row]').length")) === 1, 10000)
        const exportHref = String(await cdp.evaluate("document.querySelector('[data-testid=policy-export]').href"))
        const exported = String(await cdp.evaluate(`fetch(${JSON.stringify(exportHref)}).then(r => r.text())`))
        add("policy_filter_and_export_match", exportHref.includes("country=VN") && exported.trim().split(/\r?\n/).length === 2 && exported.includes("FIXTURE-R156-A"), exportHref)
        await cdp.evaluate("window.__setField('filter-country', '')")

        // 5. Calendar: promo + policy layers.
        await go("/calendar", "document.body.innerText.includes('东南亚假日台历')")
        await cdp.evaluate("document.querySelector('[data-testid=promo-layer-toggle]').click()")
        await cdp.evaluate("document.querySelector('[data-testid=policy-layer-toggle]').click()")
        const pick = async (month, date) => {
          await cdp.evaluate(`(() => { const s = document.querySelector('select[aria-label="月份"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${month}'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await sleep(400)
          await waitFor(async () => Boolean(await cdp.evaluate(`!!document.querySelector('button[aria-label^="${date}，"]')`)), 5000)
          await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"]').click()`)
          await sleep(600)
          return {
            text: await body(),
            promoChip: String(await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"] [data-testid=promo-day-count]')?.innerText ?? ''`)),
            policyChip: String(await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"] [data-testid=policy-day-count]')?.innerText ?? ''`)),
            promoStatuses: await cdp.evaluate("[...document.querySelectorAll('[data-testid=promo-status]')].map(e => e.innerText)"),
            policyItems: await cdp.evaluate("[...document.querySelectorAll('[data-testid=policy-calendar-item]')].map(e => e.innerText)"),
          }
        }
        const nov11 = await pick(10, "2026-11-11")
        const apiNov11 = promoEvents.filter(e => e.startDate <= "2026-11-11" && (e.endDate ?? e.startDate) >= "2026-11-11")
        evidence.calendar = { nov11: { promoChip: nov11.promoChip, promoStatuses: nov11.promoStatuses.slice(0, 6), apiPromoCount: apiNov11.length } }
        add("calendar_promo_layer_pending_status", nov11.promoChip.length > 0 && nov11.promoStatuses.length > 0 && nov11.promoStatuses.every(s => s.includes("待确认")) && !nov11.promoStatuses.some(s => s.includes("已确认")), JSON.stringify(evidence.calendar.nov11).slice(0, 300), "rule-generated (this run)")
        add("calendar_promo_not_shutdown", nov11.text.includes("非停工") || nov11.text.includes("不是停工"), "")
        await shot("calendar-2026-11-11.png")
        const nov1 = await pick(10, "2026-11-01")
        const apiD = apiPolicies.records.find(p => p.documentNumber === "FIXTURE-R156-D")
        evidence.calendar.nov1 = { policyChip: nov1.policyChip, policyItems: nov1.policyItems, apiD: apiD?.displayStatus }
        add("calendar_policy_layer_consistent", nov1.policyChip.includes("政策生效 1 项") && nov1.policyItems.some(t => t.includes("综合验收表单示例 D") && t.includes("已发布待生效")) && apiD?.displayStatus === "published", JSON.stringify(evidence.calendar.nov1).slice(0, 300))
        const oct1 = await pick(9, "2026-10-01")
        add("calendar_policy_effective_consistent", oct1.policyItems.some(t => t.includes("综合验收示例越南海关公告 A") && t.includes("已生效")), JSON.stringify(oct1.policyItems).slice(0, 300))
        await shot("calendar-2026-10-01.png")
        cdp.ws.close()
      } finally {
        chrome.kill("SIGKILL")
        await sleep(500)
        try {
          rmSync(profile, { recursive: true, force: true })
        } catch {}
      }
      evidence.screenshots = shots
    }
  } finally {
    await stopServer(server)
  }
  // ---- observation: outbound calls from the server process ----
  const out = outbound()
  const nonReady = out.filter(e => e.kind !== "recorder_ready")
  evidence.outbound = { recorderReady: out.some(e => e.kind === "recorder_ready"), entries: nonReady }
  add("server_recorder_loaded", evidence.outbound.recorderReady, "", "outbound observation")
  add("server_zero_outbound_calls", nonReady.length === 0, JSON.stringify(nonReady.slice(0, 5)), "outbound observation")
  add("server_no_llm_host_contacted", !nonReady.some(e => /deepseek|openai|anthropic|llm/i.test(JSON.stringify(e))), "", "outbound observation")
  evidence.browserLog = browserLog
  add("browser_no_uncaught_exceptions", browserLog.exceptions.length === 0, JSON.stringify(browserLog.exceptions.slice(0, 3)))
  add("browser_no_http_errors_or_console_errors", browserLog.httpErrors.length === 0 && browserLog.consoleErrors.length === 0, JSON.stringify([...browserLog.httpErrors, ...browserLog.consoleErrors].slice(0, 3)))
  add("browser_no_failed_or_external_requests", browserLog.failedRequests.length === 0, JSON.stringify(browserLog.failedRequests.slice(0, 3)))
  evidence.checks = checks
  const pass = checks.every(c => c.pass)
  evidence.verdict = pass ? "PASS" : "FAIL"
  evidence.summary = { total: checks.length, passed: checks.filter(c => c.pass).length, consoleErrors: browserLog.consoleErrors.length, httpErrors: browserLog.httpErrors.length }
  writeFileSync(join(RUN_DIR, "r1-5-6-integrated-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ verdict: evidence.verdict, summary: evidence.summary, runDir: RUN_DIR, failed: checks.filter(c => !c.pass) }))
  process.exitCode = pass ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
