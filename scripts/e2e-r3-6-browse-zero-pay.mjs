/**
 * R3-6 isolated browse zero-pay verification (CDP).
 * Visits every currently open console page + related readonly APIs.
 * Asserts paid_receipt / paid_receipt_attempt / provider_usage request_count
 * and Provider call counters stay flat. Fake/no-outbound; runtime disabled.
 * Does NOT substitute for S7; does NOT live-test connection or start crawl.
 */
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_R36_BROWSE_DIR ?? join(ROOT, ".tmp", "r3-6-browse-zero-pay"))
const EVIDENCE_DIR = resolve(process.env.E2E_R31_EVIDENCE_DIR ?? join(ROOT, "docs", "evidence", "r3-acceptance-closeout-20261102"))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_R36_BROWSE_PORT ?? "4496")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R36_DEBUG_PORT ?? "9366")
const ISOLATED_ROOT = resolve(join(ROOT, ".tmp"))
const EXPECTED_SCHEMA = 39

if (!RUN_DIR.startsWith(ISOLATED_ROOT + sep)) {
  throw new Error(`refusing: RUN_DIR must stay inside ${ISOLATED_ROOT}`)
}
if (!existsSync(SERVER_ENTRY)) {
  throw new Error(`missing production server entry: ${SERVER_ENTRY} (run pnpm build first)`)
}

const PROVIDER_SECRET_ENV_KEYS = [
  "GFW_API_TOKEN",
  "GFW_API_KEY",
  "AISSTREAM_API_KEY",
  "AIS_STREAM_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "TRANSLATION_API_KEY",
]

const OPEN_PAGES = [
  "/",
  "/ports",
  "/events",
  "/policies",
  "/calendar",
  "/feed",
  "/label",
  "/settings",
]

const READONLY_APIS = [
  "/api/shipping/health",
  "/api/shipping/readiness",
  "/api/shipping/runtime",
  "/api/shipping/",
  "/api/shipping/feed",
  "/api/shipping/calendar",
  "/api/shipping/tropical-cyclones",
  "/api/shipping/search/ports",
  "/api/shipping/intel/sources",
  "/api/shipping/intel/items",
  "/api/shipping/intel/manual",
  "/api/shipping/intel/labels",
  "/api/shipping/policies",
  "/api/shipping/llm/providers",
  "/api/shipping/llm/models",
  "/api/shipping/llm/bindings",
  "/api/shipping/llm/shared-budget",
  "/api/shipping/translation/status",
  "/api/shipping/translation/secret",
]

function findChrome() {
  for (const candidate of [
    process.env.E2E_CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

async function waitFor(fn, ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const value = await fn()
    if (value !== undefined && value !== false && value !== null) return value
    await new Promise(r => setTimeout(r, 200))
  }
  return undefined
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = []
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id) {
        const pending = this.pending.get(msg.id)
        if (pending) {
          this.pending.delete(msg.id)
          msg.error ? pending.reject(new Error(JSON.stringify(msg.error))) : pending.resolve(msg.result)
        }
        return
      }
      for (const listener of this.listeners) listener(msg)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method) {
    return new Promise((resolvePromise) => {
      const listener = (msg) => {
        if (msg.method === method) {
          this.listeners = this.listeners.filter(item => item !== listener)
          resolvePromise(msg.params)
        }
      }
      this.listeners.push(listener)
    })
  }

  on(listener) {
    this.listeners.push(listener)
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolvePromise, reject) => {
    ws.addEventListener("open", resolvePromise, { once: true })
    ws.addEventListener("error", reject, { once: true })
  })
  return new Cdp(ws)
}

async function readDbCounters() {
  const Database = (await import("better-sqlite3")).default
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  try {
    const usage = db.prepare("SELECT COALESCE(SUM(request_count),0) AS n FROM provider_usage").get().n
    const usageRows = db.prepare("SELECT COUNT(*) AS n FROM provider_usage").get().n
    const receipts = db.prepare("SELECT COUNT(*) AS n FROM paid_receipt").get().n
    const attempts = db.prepare("SELECT COUNT(*) AS n FROM paid_receipt_attempt").get().n
    const syncRuns = db.prepare("SELECT COUNT(*) AS n FROM sync_runs").get().n
    return {
      usageRequestCount: Number(usage),
      usageRows: Number(usageRows),
      receipts: Number(receipts),
      attempts: Number(attempts),
      syncRuns: Number(syncRuns),
    }
  } finally {
    db.close()
  }
}

const checks = []
function check(ok, label, detail = {}) {
  checks.push({ ok: Boolean(ok), label, ...detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
}

let server
let chromeChild
let profile
let serverLogPath

function startServer() {
  serverLogPath = join(RUN_DIR, `server-r36-browse-${Date.now()}.log`)
  mkdirSync(dirname(serverLogPath), { recursive: true })
  const fd = openSync(serverLogPath, "a")
  const env = { ...process.env }
  for (const key of PROVIDER_SECRET_ENV_KEYS) delete env[key]
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: RUN_DIR,
    env: {
      ...env,
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      SHIPPING_DATA_MODE: "real",
      SHIPPING_RUNTIME_ENABLED: "false",
    },
    stdio: ["ignore", fd, fd],
  })
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  await new Promise((resolvePromise) => {
    child.once("exit", resolvePromise)
    child.kill("SIGKILL")
    setTimeout(resolvePromise, 5000)
  })
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  mkdirSync(join(RUN_DIR, ".data"), { recursive: true })
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true })
  const secretsPath = join(RUN_DIR, ".data", "provider-secrets.json")
  if (existsSync(secretsPath)) rmSync(secretsPath, { force: true })

  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge; set E2E_CHROME")

  const evidence = {
    tip: "r3-6-browse-zero-pay",
    baseUrl: BASE,
    runDir: RUN_DIR.replaceAll("\\", "/"),
    evidenceDir: EVIDENCE_DIR.replaceAll("\\", "/"),
    openPages: OPEN_PAGES.slice(),
    readonlyApis: READONLY_APIS.slice(),
    detailPages: [],
    apiResults: [],
    pageResults: [],
    externalRequests: [],
    checks: [],
    screenshots: [],
    notes: [
      "Not a substitute for S7 integrated acceptance",
      "No live test-connection; no crawl/runtime jobs",
      "Provider secrets stripped from env; fake/no-outbound",
    ],
  }

  server = startServer()
  const ready = await waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/api/shipping/health`)
      if (!res.ok) return undefined
      return await res.json()
    } catch {
      return undefined
    }
  }, 60000)
  if (!ready) throw new Error(`server not ready; log: ${serverLogPath}`)
  check(ready?.database?.schemaVersion === EXPECTED_SCHEMA, `schema v${EXPECTED_SCHEMA} after init (got ${ready?.database?.schemaVersion})`)
  evidence.health = ready

  let portId = null
  try {
    const portsRes = await fetch(`${BASE}/api/shipping/search/ports?q=`)
    const portsBody = await portsRes.json().catch(() => ({}))
    const list = portsBody?.ports || portsBody?.items || portsBody || []
    if (Array.isArray(list) && list.length) {
      portId = list[0].unlocode || list[0].id || list[0].shippingPortId || null
    }
  } catch {}
  if (!portId) portId = "CNSHK"
  const detailPages = [`/ports/${portId}`]
  evidence.detailPages = detailPages

  const before = await readDbCounters()
  evidence.countersBefore = before

  for (const path of READONLY_APIS) {
    const started = Date.now()
    let status = 0
    let ok = false
    let err = null
    try {
      const res = await fetch(`${BASE}${path}`)
      status = res.status
      ok = res.status >= 200 && res.status < 500
      await res.arrayBuffer()
    } catch (e) {
      err = String(e?.message || e)
    }
    evidence.apiResults.push({ path, status, ok, err, ms: Date.now() - started })
    check(ok, `GET ${path} -> ${status}${err ? (` err=${err}`) : ""}`)
  }

  const afterApis = await readDbCounters()
  evidence.countersAfterApis = afterApis
  check(
    afterApis.usageRequestCount === before.usageRequestCount
    && afterApis.usageRows === before.usageRows
    && afterApis.receipts === before.receipts
    && afterApis.attempts === before.attempts,
    `readonly APIs: zero paid_receipt/provider_usage delta (before=${JSON.stringify(before)} after=${JSON.stringify(afterApis)})`,
  )

  const local = new URL(BASE)
  const externalRequests = []
  profile = mkdtempSync(join(tmpdir(), "shipping-hot-r36-browse-"))
  chromeChild = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" })

  const version = await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      return res.ok ? await res.json() : undefined
    } catch {
      return undefined
    }
  }, 30000)
  if (!version) throw new Error("Chrome DevTools endpoint not ready")
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = targets.find(t => t.type === "page")
  if (!page) throw new Error("No page target")
  const cdp = await connect(page.webSocketDebuggerUrl)
  cdp.on((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      try {
        const url = new URL(msg.params.request.url)
        if ((url.protocol === "http:" || url.protocol === "https:") && url.host !== local.host) {
          externalRequests.push(msg.params.request.url)
        }
      } catch {}
    }
  })
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  await cdp.send("Network.enable")

  const evaluate = async (expression, awaitPromise = false) => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed")
    return result.result.value
  }

  const navigate = async (path) => {
    const loaded = cdp.once("Page.loadEventFired")
    await cdp.send("Page.navigate", { url: `${BASE}${path}` })
    await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))])
    await waitFor(async () => {
      const readyState = await evaluate("document.readyState")
      return readyState === "complete" ? true : undefined
    }, 15000)
  }

  for (const path of [...OPEN_PAGES, ...detailPages]) {
    const started = Date.now()
    await navigate(path)
    const title = await evaluate("document.title || ''")
    const bodyLen = await evaluate("(document.body && document.body.innerText ? document.body.innerText.length : 0)")
    const href = await evaluate("location.pathname + location.search + location.hash")
    const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
    evidence.pageResults.push({ path, href, title, bodyLen, shell, ms: Date.now() - started })
    check(shell || bodyLen > 0, `page ${path} rendered (href=${href}, bodyLen=${bodyLen})`)
  }

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })
  const shotPath = join(EVIDENCE_DIR, "r3-6-browse-last-page.png")
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
  evidence.screenshots.push(shotPath.replaceAll("\\", "/"))
  check(existsSync(shotPath), "screenshot written")

  evidence.externalRequests = externalRequests.slice()
  check(externalRequests.length === 0, `browser zero external HTTP (got ${externalRequests.length})`, { sample: externalRequests.slice(0, 5) })

  const afterBrowse = await readDbCounters()
  evidence.countersAfterBrowse = afterBrowse
  check(
    afterBrowse.usageRequestCount === before.usageRequestCount
    && afterBrowse.usageRows === before.usageRows
    && afterBrowse.receipts === before.receipts
    && afterBrowse.attempts === before.attempts,
    `browse pages: zero paid_receipt/provider_usage delta (before=${JSON.stringify(before)} after=${JSON.stringify(afterBrowse)})`,
  )
  check(afterBrowse.usageRequestCount === 0 && afterBrowse.attempts === 0 && afterBrowse.receipts === 0, `Provider call counters remain zero (usage=${afterBrowse.usageRequestCount}, attempts=${afterBrowse.attempts}, receipts=${afterBrowse.receipts})`)

  evidence.checks = checks
  const passed = checks.filter(c => c.ok).length
  const failed = checks.filter(c => !c.ok).length
  evidence.summary = { passed, failed, total: checks.length }
  writeFileSync(join(EVIDENCE_DIR, "r3-6-browse-evidence.json"), JSON.stringify(evidence, null, 2))
  const lines = [
    `R3-6 browse zero-pay ${failed === 0 ? "PASS" : "FAIL"}  ${passed}/${checks.length}`,
    `schema=${ready?.database?.schemaVersion}`,
    `before=${JSON.stringify(before)}`,
    `afterApis=${JSON.stringify(afterApis)}`,
    `afterBrowse=${JSON.stringify(afterBrowse)}`,
    `externalRequests=${externalRequests.length}`,
    `pages=${[...OPEN_PAGES, ...detailPages].join(",")}`,
    `apis=${READONLY_APIS.length}`,
    "NOT a substitute for S7; no live connection test; no crawl",
    ...checks.map(c => `${c.ok ? "PASS" : "FAIL"}  ${c.label}`),
  ]
  writeFileSync(join(EVIDENCE_DIR, "r3-6-browse-e2e.txt"), `${lines.join("\n")}\n`)
  console.log(`\nSUMMARY ${passed}/${checks.length} failed=${failed}`)
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
}).finally(async () => {
  if (chromeChild) {
    try {
      chromeChild.kill("SIGKILL")
    } catch {}
  }
  await stopServer(server)
  if (profile && existsSync(profile)) {
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
})
