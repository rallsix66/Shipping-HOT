// R1.5-7 policy library acceptance on an ISOLATED SQLite (fresh <repo>/.tmp run dir), in order:
// isolated SQLite -> (API seed) -> restart -> API -> real form (/policies) -> policy page -> /calendar -> restart with later TEST_NOW.
// Clock: SHIPPING_TEST_CLOCK=1 + TEST_NOW (never the real clock). ALL example policies are FIXTURES (isFixture=true, example.org links),
// not real official notices. No upstream fetch, no seller backend, no LLM.
// Usage: node scripts/r1-5-7-policy-display.mjs
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import process from "node:process"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = join(ROOT, ".tmp", `r1-5-7-policy-${new Date().toISOString().replace(/[:.]/g, "-")}`)
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_POLICY_PORT ?? "4497")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_POLICY_DEBUG_PORT ?? "9357")
const SECRET_KEYS = ["GFW_API_TOKEN", "VESSELAPI_API_KEY", "AISSTREAM_API_KEY", "CALENDARIFIC_API_KEY", "DEEPSEEK_API_KEY", "SHIPPING_WEATHER_ALERT_PROVIDER"]
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const NOW_1 = "2026-10-31T12:00:00+08:00"
const NOW_2 = "2026-11-01T00:00:00+08:00"
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

function startServer(tag, testNow) {
  const logFd = openSync(join(RUN_DIR, `server-${tag}.log`), "a")
  const env = { ...process.env }
  for (const key of SECRET_KEYS) delete env[key]
  Object.assign(env, { SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_PORT_PROVIDER: "mock", SHIPPING_FEED_PROVIDER: "mock", SHIPPING_CALENDAR_PROVIDER: "mock", SHIPPING_WEATHER_PROVIDER: "mock", NITRO_HOST: "127.0.0.1", PORT: String(PORT), NITRO_PORT: String(PORT), SHIPPING_TEST_CLOCK: "1", TEST_NOW: testNow })
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

async function post(path, body, origin = BASE) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const getJson = async path => (await fetch(`${BASE}${path}`)).json()

const fixtureA = { category: "customs_tax", countryCode: "VN", title: "[FIXTURE] 示例越南海关公告 A", documentNumber: "FIXTURE-VN-A", publisher: "示例机关（fixture）", publishedAt: "2026-10-01", effectiveAt: "2026-11-01", status: "published", sourceType: "official", sourceUrl: "https://example.org/fixture/vn-a", fullText: "示例政府公告全文副本（fixture，非真实公告）。第一条……", basisText: "fixture 依据 v1：示例原文第 1 条", enteredBy: "acceptance-tester", isFixture: true }
const fixtureB = { category: "ecommerce_platform", countryCode: "TH", platform: "shopee", title: "[FIXTURE] 示例 Shopee 泰国平台规则 B", effectiveAt: "2026-10-20", status: "published", sourceType: "platform", sourceUrl: "https://example.org/fixture/shopee-th-b", bodyExcerpt: "示例摘录（fixture）", basisText: "fixture 平台规则依据", enteredBy: "acceptance-tester", isFixture: true }
const fixtureC = { category: "trade_export", countryCode: "ID", title: "[FIXTURE] 示例传闻 C", effectiveAt: "2026-10-15", status: "rumor", sourceType: "media", sourceUrl: "https://example.org/fixture/news-c", basisText: "fixture 媒体报道", enteredBy: "acceptance-tester", isFixture: true }

function dbFingerprint() {
  const db = new Database(DB_PATH, { readonly: true })
  const n = t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  const h = db.prepare("SELECT GROUP_CONCAT(id || '|' || updated_at || '|' || status, ',') AS h FROM (SELECT * FROM policy_record ORDER BY id)").get().h ?? ""
  const r = { records: n("policy_record"), versions: n("policy_version"), log: n("policy_change_log"), providerUsage: n("provider_usage"), hash: String(h.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)) }
  db.close()
  return r
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

const SET_FIELD = `window.__setField = (testid, value) => {
  const el = document.querySelector('[data-testid="' + testid + '"]')
  if (!el) throw new Error('missing ' + testid)
  if (el.type === 'checkbox') { if (el.checked !== value) el.click(); return }
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}`

async function main() {
  mkdirSync(join(RUN_DIR, ".data"), { recursive: true })
  const ids = {}
  const writes = {}
  // Phase 1: isolated SQLite, explicit API writes.
  let server = startServer("phase1", NOW_1)
  try {
    add("server1_healthy", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500), BASE)
    const empty = await getJson("/api/shipping/policies")
    add("fresh_db_empty", empty.total === 0 && empty.clock === "test" && empty.today === "2026-10-31", JSON.stringify({ total: empty.total, clock: empty.clock, today: empty.today }))
    const foreign = await post("/api/shipping/policies", fixtureA, "https://evil.example.com")
    const negatives = {
      foreignOrigin: foreign.status,
      officialWithoutFullText: (await post("/api/shipping/policies", { ...fixtureA, fullText: "" })).body.statusMessage,
      mediaNotRumor: (await post("/api/shipping/policies", { ...fixtureC, status: "published" })).body.statusMessage,
      effectiveBeforeDate: (await post("/api/shipping/policies", { ...fixtureA, status: "effective" })).body.statusMessage,
      noEntrant: (await post("/api/shipping/policies", { ...fixtureA, enteredBy: "" })).body.statusMessage,
    }
    writes.negatives = negatives
    add("write_negatives_rejected", negatives.foreignOrigin === 403 && negatives.officialWithoutFullText === "official_full_text_required" && negatives.mediaNotRumor === "media_source_must_be_rumor" && negatives.effectiveBeforeDate === "effective_status_before_effective_date" && negatives.noEntrant === "entered_by_required", JSON.stringify(negatives))
    for (const [key, fx] of [["A", fixtureA], ["B", fixtureB], ["C", fixtureC]]) {
      const r = await post("/api/shipping/policies", fx)
      ids[key] = r.body.id
      add(`create_${key}`, r.status === 200 && r.body.isFixture === true, `${r.status} ${r.body.id ?? r.body.statusMessage}`)
    }
    const rev = await post(`/api/shipping/policies/${encodeURIComponent(ids.A)}/revise`, { ...fixtureA, basisText: "fixture 依据 v2：示例原文第 1 条（更正）", enteredBy: "acceptance-tester-2", changeSummary: "依据更正（fixture）" })
    add("api_revise_A_v2", rev.status === 200 && rev.body.currentVersionNumber === 2, rev.status)
    writes.ids = ids
  } finally {
    await stopServer(server)
  }

  let api = {}
  let browser = { status: "NOT_RUN" }
  // Phase 2: restart, API, real form, policy page, calendar at TEST_NOW = 2026-10-31.
  server = startServer("phase2-restart", NOW_1)
  try {
    add("server2_healthy_after_restart", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500), BASE)
    const before = dbFingerprint()
    const list = await getJson("/api/shipping/policies")
    const detailA = await getJson(`/api/shipping/policies/${encodeURIComponent(ids.A)}`)
    const csvTh = await (await fetch(`${BASE}/api/shipping/policies/export?country=TH`)).text()
    const listTh = await getJson("/api/shipping/policies?country=TH")
    const after = dbFingerprint()
    const byId = Object.fromEntries(list.records.map(r => [r.id, r]))
    api = { today: list.today, clock: list.clock, total: list.total, statuses: Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, { status: byId[id]?.status, displayStatus: byId[id]?.displayStatus, autoActivated: byId[id]?.autoActivated, datePosition: byId[id]?.datePosition }])), detailAVersions: detailA.versions?.map(v => ({ n: v.versionNumber, basis: v.snapshot?.basisText, supersededBy: v.supersededByVersionId })), csvThLines: csvTh.trim().split(/\r?\n/).length, listThTotal: listTh.total, before, after }
    add("api_persisted_after_restart", list.total === 3 && list.clock === "test" && list.today === "2026-10-31", JSON.stringify({ total: list.total, today: list.today }))
    add("api_A_future_published", byId[ids.A]?.displayStatus === "published" && byId[ids.A]?.datePosition === "future", JSON.stringify(api.statuses.A))
    add("api_B_auto_effective", byId[ids.B]?.displayStatus === "effective" && byId[ids.B]?.autoActivated === true && byId[ids.B]?.status === "published", JSON.stringify(api.statuses.B))
    add("api_C_rumor_never_activates", byId[ids.C]?.displayStatus === "rumor" && byId[ids.C]?.autoActivated === false, JSON.stringify(api.statuses.C))
    add("api_A_versions_retained", detailA.versions?.length === 2 && detailA.versions[0].snapshot?.basisText?.includes("v1") && detailA.versions[0].supersededByVersionId === `${ids.A}:v2` && detailA.changeLog?.length === 2, JSON.stringify(api.detailAVersions))
    add("api_export_matches_filter", api.csvThLines === 1 + listTh.total && listTh.total === 1 && csvTh.includes("示例（fixture，非真实公告）"), `${api.csvThLines} lines vs ${listTh.total}`)
    add("get_checked_fingerprint_unchanged", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} / ${JSON.stringify(after)}`)

    const chromePath = findChrome()
    if (!chromePath) {
      browser = { status: "BLOCKED", reason: "no system Chrome/Edge" }
    } else {
      const profile = join(RUN_DIR, "chrome-profile")
      mkdirSync(profile, { recursive: true })
      const chrome = spawn(chromePath, [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1500,2200", "about:blank"], { stdio: "ignore" })
      try {
        await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok, 20000)
        const page = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === "page")
        const cdp = await openCdp(page.webSocketDebuggerUrl)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Page.navigate", { url: `${BASE}/policies` })
        add("browser_policies_rendered", await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-row]').length")) === 3, 30000), "/policies 3 rows")
        await cdp.evaluate(SET_FIELD)
        const clockText = String(await cdp.evaluate("document.querySelector('[data-testid=policy-clock]')?.innerText ?? ''"))
        add("browser_test_clock_banner", clockText.includes("2026-10-31") && clockText.includes("测试时钟"), clockText.slice(0, 120))
        // Real form: create D.
        const formD = { "pf-category": "customs_tax", "pf-countryCode": "MY", "pf-title": "[FIXTURE] 表单录入示例 D", "pf-documentNumber": "FIXTURE-MY-D", "pf-publisher": "示例机关（fixture）", "pf-publishedAt": "2026-10-20", "pf-effectiveAt": "2026-11-01", "pf-status": "published", "pf-sourceType": "official", "pf-sourceUrl": "https://example.org/fixture/my-d", "pf-enteredBy": "browser-tester", "pf-basisText": "fixture 表单依据 v1", "pf-fullText": "表单录入的示例全文（fixture，非真实公告）。" }
        for (const [k, v] of Object.entries(formD)) await cdp.evaluate(`window.__setField(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
        await cdp.evaluate("window.__setField('pf-isFixture', true)")
        await sleep(200)
        await cdp.evaluate("document.querySelector('[data-testid=policy-submit]').click()")
        const savedD = await waitFor(async () => String(await cdp.evaluate("document.querySelector('[data-testid=policy-message]')?.innerText ?? ''")).includes("已保存"), 10000)
        add("browser_form_create_D", savedD && await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-row]').length")) === 4, 10000), String(await cdp.evaluate("document.querySelector('[data-testid=policy-message]')?.innerText ?? ''")))
        // Form revise D (detail is auto-selected after save).
        await waitFor(async () => Boolean(await cdp.evaluate("!!document.querySelector('[data-testid=policy-start-revise]')")), 10000)
        await cdp.evaluate("document.querySelector('[data-testid=policy-start-revise]').click()")
        await sleep(300)
        await cdp.evaluate(SET_FIELD)
        await cdp.evaluate("window.__setField('pf-effectiveAt', '2026-11-05')")
        await cdp.evaluate("window.__setField('pf-basisText', 'fixture 表单依据 v2')")
        await cdp.evaluate("window.__setField('pf-enteredBy', 'browser-tester-2')")
        await cdp.evaluate("window.__setField('pf-changeSummary', '生效日改为 11-05（fixture）')")
        await sleep(200)
        await cdp.evaluate("document.querySelector('[data-testid=policy-submit]').click()")
        const revised = await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-version]').length")) === 2, 10000)
        const detailText = String(await cdp.evaluate("document.querySelector('[data-testid=policy-detail]')?.innerText ?? ''"))
        add("browser_form_revise_D_keeps_v1", revised && detailText.includes("v1") && detailText.includes("fixture 表单依据 v1") && detailText.includes("fixture 表单依据 v2") && detailText.includes("已被新版本取代"), detailText.slice(0, 200))
        add("browser_fixture_label_and_fulltext", detailText.includes("示例（fixture）：仅用于验收，不是真实官方公告") && detailText.includes("政府公告全文副本") && detailText.includes("录入人：browser-tester-2"), "")
        const shot1 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
        writeFileSync(join(RUN_DIR, "policies-detail.png"), Buffer.from(shot1.data, "base64"))
        // Policy page: statuses & filter/export.
        const rows = await cdp.evaluate("[...document.querySelectorAll('[data-testid=policy-row]')].map(r => ({ id: r.dataset.id, status: r.dataset.status, text: r.innerText }))")
        const rowB = rows.find(r => r.id === ids.B)
        const rowC = rows.find(r => r.id === ids.C)
        const rowA = rows.find(r => r.id === ids.A)
        add("browser_page_statuses_consistent_with_api", rowA?.status === "published" && rowA.text.includes("未来生效") && rowB?.status === "effective" && rowB.text.includes("⚙") && rowC?.status === "rumor" && rows.every(r => r.text.includes("[示例 fixture")), JSON.stringify(rows.map(r => [r.status, r.text.slice(0, 60)])))
        await cdp.evaluate("window.__setField('filter-country', 'TH')")
        await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-row]').length")) === 1, 10000)
        const exportHref = String(await cdp.evaluate("document.querySelector('[data-testid=policy-export]').href"))
        const exported = await cdp.evaluate(`fetch(${JSON.stringify(exportHref)}).then(r => r.text())`)
        const rowCount = Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-row]').length"))
        add("browser_filter_and_export_match", rowCount === 1 && exportHref.includes("country=TH") && String(exported).trim().split(/\r?\n/).length === 1 + rowCount, `${rowCount} row, href ${exportHref}`)
        await cdp.evaluate("window.__setField('filter-country', '')")
        // Calendar.
        await cdp.send("Page.navigate", { url: `${BASE}/calendar` })
        await waitFor(async () => String(await cdp.evaluate("document.body?.innerText ?? ''")).includes("东南亚假日台历"), 30000)
        await cdp.evaluate("document.querySelector('[data-testid=policy-layer-toggle]').click()")
        const pick = async (month, date) => {
          await cdp.evaluate(`(() => { const s = document.querySelector('select[aria-label="月份"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '${month}'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
          await sleep(300)
          await waitFor(async () => Boolean(await cdp.evaluate(`!!document.querySelector('button[aria-label^="${date}，"]')`)), 5000)
          await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"]').click()`)
          await waitFor(async () => Number(await cdp.evaluate("document.querySelectorAll('[data-testid=policy-calendar-item]').length")) > 0, 8000)
          await sleep(300)
          return { text: String(await cdp.evaluate("document.querySelector('[data-testid=policy-calendar-details]')?.innerText ?? ''")), chip: String(await cdp.evaluate(`document.querySelector('button[aria-label^="${date}，"] [data-testid=policy-day-count]')?.innerText ?? ''`)), promoShown: Number(await cdp.evaluate("document.querySelectorAll('[data-testid=promo-details]').length")) }
        }
        const nov1 = await pick(10, "2026-11-01")
        add("browser_calendar_policy_layer_separate", nov1.chip.includes("政策生效 1 项") && nov1.text.includes("[示例 fixture，非真实公告] [FIXTURE] 示例越南海关公告 A") && nov1.text.includes("已发布待生效") && nov1.text.includes("非停工事实") && nov1.promoShown === 0, JSON.stringify(nov1).slice(0, 300))
        const oct20 = await pick(9, "2026-10-20")
        add("browser_calendar_auto_effective_consistent", oct20.text.includes("示例 Shopee 泰国平台规则 B") && oct20.text.includes("已生效（⚙ 到生效日自动）"), oct20.text.slice(0, 200))
        const shot2 = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
        writeFileSync(join(RUN_DIR, "calendar-policy-2026-10-20.png"), Buffer.from(shot2.data, "base64"))
        browser = { status: "RAN", chrome: chromePath, screenshots: ["policies-detail.png", "calendar-policy-2026-10-20.png"], rows: rows.map(r => ({ status: r.status, text: r.text.slice(0, 120) })), detailExcerpt: detailText.slice(0, 1500), nov1, oct20 }
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
  // Phase 3: restart with TEST_NOW = 2026-11-01 00:00 UTC+8 -> A auto-effective; rumor still rumor.
  server = startServer("phase3-next-day", NOW_2)
  try {
    add("server3_healthy", await waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500), BASE)
    const list = await getJson("/api/shipping/policies")
    const byId = Object.fromEntries(list.records.map(r => [r.id, r]))
    const d = list.records.find(r => r.title === "[FIXTURE] 表单录入示例 D")
    api.phase3 = { today: list.today, A: byId[ids.A]?.displayStatus, C: byId[ids.C]?.displayStatus, D: d?.displayStatus, Deffective: d?.effectiveAt }
    add("switch_A_effective_on_effective_date", list.today === "2026-11-01" && byId[ids.A]?.displayStatus === "effective" && byId[ids.A]?.autoActivated === true && byId[ids.A]?.status === "published", JSON.stringify(api.phase3))
    add("revised_D_still_future_at_11_01", d?.effectiveAt === "2026-11-05" && d?.displayStatus === "published", JSON.stringify(api.phase3))
    add("rumor_still_rumor", byId[ids.C]?.displayStatus === "rumor", JSON.stringify(api.phase3))
  } finally {
    await stopServer(server)
  }
  const pass = checks.every(c => c.pass) && browser.status === "RAN"
  const evidence = { kind: "R1.5-7 policy library isolated SQLite -> restart -> API -> form -> /policies -> /calendar -> restart(next TEST_NOW)", ranAt: new Date().toISOString(), gitHead: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(), workspaceClean: execSync("git status --porcelain", { cwd: ROOT }).toString().trim() === "", runDir: RUN_DIR, clock: { phase1and2: NOW_1, phase3: NOW_2, gate: "SHIPPING_TEST_CLOCK=1" }, fixtureNotice: "All policies are fixtures (isFixture=true, example.org links); none is a real official notice.", verdict: pass ? "PASS" : browser.status === "BLOCKED" ? "BLOCKED" : "FAIL", writes, api, browser, checks }
  writeFileSync(join(RUN_DIR, "policy-display-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({ verdict: evidence.verdict, runDir: RUN_DIR, failed: checks.filter(c => !c.pass) }))
  process.exitCode = pass ? 0 : 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
