/**
 * R3-6 isolated browse zero-pay verification (CDP) — RC evidence pass.
 * Fresh project-internal RUN_DIR; refuse overwrite/delete of existing data.
 * Seeds fixture policy/labels + fake provider/model/binding (non-routable HTTPS).
 * Independent provider-spy (--import) records/blocks outbound fetch; ledger counted separately.
 * Per-page wait for data queries (CDP Network) + content/empty asserts; timeout/error = fail.
 * Chrome profile under RUN_DIR. Historical empty + strengthen evidence retained; this run → r3-6-rc/.
 * Does NOT substitute for S7; does NOT expand open-page scope; A1 not executed.
 */
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ISOLATED_ROOT = resolve(join(ROOT, ".tmp"))
const RUNS_ROOT = resolve(join(ISOLATED_ROOT, "r3-6-browse-zero-pay", "runs"))
const EVIDENCE_DIR = resolve(process.env.E2E_R31_EVIDENCE_DIR ?? join(ROOT, "docs", "evidence", "r3-acceptance-closeout-20261102", "r3-6-rc"))
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const SPY_MODULE = join(ROOT, "scripts", "e2e-r3-6-provider-spy.mjs")
const PORT = Number(process.env.E2E_R36_BROWSE_PORT ?? "4496")
const SPY_PORT = Number(process.env.E2E_R36_SPY_PORT ?? "4497")
const BASE = `http://127.0.0.1:${PORT}`
const SPY_BASE = `http://127.0.0.1:${SPY_PORT}`
const DEBUG_PORT = Number(process.env.E2E_R36_DEBUG_PORT ?? "9366")
const EXPECTED_SCHEMA = 39
const FAKE_KEY = "sk-test-fixture-r36-not-real-0000"
const FAKE_PROVIDER_BASE = "https://api.example.invalid/v1"
const DETAIL_PORT_ID = "port-shekou"

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

const OPEN_PAGES = ["/", "/ports", "/events", "/policies", "/calendar", "/feed", "/label", "/settings"]

/** Per-page data APIs that must complete successfully before content assert. */
const PAGE_QUERIES = {
  "/": [], // static country overview — no shipping query
  "/ports": ["/api/shipping", "/api/shipping/ports/port-yantian/weather", "/api/shipping/tropical-cyclones"],
  "/events": ["/api/shipping"],
  "/policies": ["/api/shipping/policies"],
  "/calendar": ["/api/shipping/calendar/reference"],
  "/feed": ["/api/shipping/intel/manual", "/api/shipping/intel/items"],
  "/label": ["/api/shipping/intel/labels"],
  "/settings": [
    "/api/shipping",
    "/api/shipping/llm/providers",
    "/api/shipping/llm/models",
    "/api/shipping/llm/bindings",
    "/api/shipping/llm/shared-budget",
    "/api/shipping/translation/status",
    "/api/shipping/translation/secret",
  ],
  [`/ports/${DETAIL_PORT_ID}`]: [
    "/api/shipping",
    `/api/shipping/ports/${DETAIL_PORT_ID}/weather`,
    "/api/shipping/tropical-cyclones",
  ],
}

const READONLY_APIS = [
  { path: "/api/shipping/health", expectStatus: 200, assert: body => body?.database?.schemaVersion === EXPECTED_SCHEMA },
  { path: "/api/shipping/readiness", expectStatus: 200 },
  { path: "/api/shipping/runtime", expectStatus: 200 },
  { path: "/api/shipping/", expectStatus: 200 },
  { path: "/api/shipping/feed", expectStatus: 200 },
  { path: "/api/shipping/calendar", expectStatus: 200 },
  { path: "/api/shipping/tropical-cyclones", expectStatus: 200 },
  { path: "/api/shipping/search/ports", expectStatus: 200 },
  { path: "/api/shipping/intel/sources", expectStatus: 200 },
  { path: "/api/shipping/intel/items", expectStatus: 200 },
  { path: "/api/shipping/intel/manual", expectStatus: 200 },
  { path: "/api/shipping/intel/labels", expectStatus: 200, assert: body => Number(body?.coverage?.total) === 2 },
  { path: "/api/shipping/policies", expectStatus: 200, assert: body => Array.isArray(body?.records) && body.records.length >= 1 },
  { path: "/api/shipping/llm/providers", expectStatus: 200, assert: body => Array.isArray(body?.items) && body.items.length >= 1 },
  { path: "/api/shipping/llm/models", expectStatus: 200, assert: body => Array.isArray(body?.items) && body.items.length >= 1 },
  { path: "/api/shipping/llm/bindings", expectStatus: 200, assert: body => Array.isArray(body?.items) && body.items.some(b => b.step === "extract") },
  { path: "/api/shipping/llm/shared-budget", expectStatus: 200 },
  { path: "/api/shipping/translation/status", expectStatus: 200 },
  { path: "/api/shipping/translation/secret", expectStatus: 200 },
]

function allocateRunDir() {
  const override = process.env.E2E_R36_BROWSE_DIR
  if (override) {
    const requested = resolve(override)
    if (!requested.startsWith(ISOLATED_ROOT + sep) && requested !== ISOLATED_ROOT) {
      throw new Error(`refusing: RUN_DIR must stay inside ${ISOLATED_ROOT} (got ${requested})`)
    }
    const dataDir = join(requested, ".data")
    if (existsSync(dataDir)) {
      const kids = readdirSync(dataDir)
      if (kids.length > 0) {
        throw new Error(
          `refusing: RUN_DIR already contains .data (${kids.join(",")}); will not overwrite/delete. Unset E2E_R36_BROWSE_DIR or point at a fresh empty dir.`,
        )
      }
    }
    mkdirSync(dataDir, { recursive: true })
    return requested
  }
  mkdirSync(RUNS_ROOT, { recursive: true })
  const dir = mkdtempSync(join(RUNS_ROOT, "run-"))
  mkdirSync(join(dir, ".data"), { recursive: true })
  return dir
}

const RUN_DIR = allocateRunDir()
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SPY_FILE = join(RUN_DIR, "provider-spy.json")
const CHROME_PROFILE = join(RUN_DIR, "chrome-profile")

if (!existsSync(SERVER_ENTRY)) throw new Error(`missing production server entry: ${SERVER_ENTRY} (run pnpm build first)`)
if (!existsSync(SPY_MODULE)) throw new Error(`missing provider spy module: ${SPY_MODULE}`)

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

async function waitFor(fn, ms, label = "waitFor") {
  const start = Date.now()
  let last
  while (Date.now() - start < ms) {
    last = await fn()
    if (last !== undefined && last !== false && last !== null) return last
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`${label} timed out after ${ms}ms (last=${JSON.stringify(last)})`)
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

function apiPathname(url) {
  try {
    return new URL(url).pathname
  } catch {
    return String(url)
  }
}

function pathMatches(url, pattern) {
  const pathname = apiPathname(url)
  if (pattern === "/api/shipping") return pathname === "/api/shipping" || pathname === "/api/shipping/"
  return pathname === pattern || pathname.startsWith(`${pattern}/`)
}

function createNetworkTracker() {
  const inflight = new Map()
  const completed = []
  return {
    onMessage(msg) {
      if (msg.method === "Network.requestWillBeSent") {
        const { requestId, request } = msg.params
        inflight.set(requestId, { url: request.url, method: request.method, status: null, failed: false, errorText: null })
      }
      if (msg.method === "Network.responseReceived") {
        const entry = inflight.get(msg.params.requestId)
        if (entry) entry.status = msg.params.response.status
      }
      if (msg.method === "Network.loadingFinished") {
        const entry = inflight.get(msg.params.requestId)
        if (entry) {
          completed.push({ ...entry, finished: true })
          inflight.delete(msg.params.requestId)
        }
      }
      if (msg.method === "Network.loadingFailed") {
        const entry = inflight.get(msg.params.requestId)
        if (entry) {
          completed.push({ ...entry, finished: true, failed: true, errorText: msg.params.errorText || "loadingFailed" })
          inflight.delete(msg.params.requestId)
        }
      }
    },
    clear() {
      inflight.clear()
      completed.length = 0
    },
    shippingSnapshot() {
      return completed.filter(c => String(c.url).includes("/api/shipping"))
    },
    async waitForApis(patterns, timeoutMs) {
      if (!patterns.length) return []
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const hits = patterns.map((pattern) => {
          const match = [...completed].reverse().find(c => pathMatches(c.url, pattern) && c.finished)
          return { pattern, match }
        })
        for (const hit of hits) {
          if (hit.match && (hit.match.failed || (hit.match.status != null && hit.match.status >= 400))) {
            throw new Error(`page query failed for ${hit.pattern}: ${JSON.stringify(hit.match)}`)
          }
        }
        if (hits.every(h => h.match && h.match.status != null && h.match.status >= 200 && h.match.status < 400)) {
          return hits.map(h => ({ pattern: h.pattern, url: h.match.url, status: h.match.status }))
        }
        await new Promise(r => setTimeout(r, 100))
      }
      const seen = this.shippingSnapshot().map(c => ({ url: c.url, status: c.status, failed: c.failed }))
      throw new Error(`timeout waiting page queries ${JSON.stringify(patterns)}; seen=${JSON.stringify(seen)}`)
    },
  }
}

async function readDbCounters() {
  const Database = (await import("better-sqlite3")).default
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })
  try {
    const usage = db.prepare("SELECT COALESCE(SUM(request_count),0) AS n FROM provider_usage").get().n
    const usageRows = db.prepare("SELECT COUNT(*) AS n FROM provider_usage").get().n
    const receipts = db.prepare("SELECT COUNT(*) AS n FROM paid_receipt").get().n
    const attempts = db.prepare("SELECT COUNT(*) AS n FROM paid_receipt_attempt").get().n
    return {
      usageRequestCount: Number(usage),
      usageRows: Number(usageRows),
      receipts: Number(receipts),
      attempts: Number(attempts),
    }
  } finally {
    db.close()
  }
}

async function seedLabels() {
  const Database = (await import("better-sqlite3")).default
  const db = new Database(DB_PATH)
  const now = new Date().toISOString()
  const rows = [
    ["lbl_e2e_001", "item_e2e_1", "ver_e2e_1", "hash_e2e_1", "https://example.test/label/1", "excerpt one licensed", "port", "en", "ai_prelabeled", "Port notice one"],
    ["lbl_e2e_002", "item_e2e_2", "ver_e2e_2", "hash_e2e_2", "https://example.test/label/2", "excerpt two licensed", "weather", "zh", "unreviewed", "Weather notice two"],
  ]
  const insertItem = db.prepare(`
    INSERT OR REPLACE INTO intel_label_item (
      id, item_id, version_id, content_hash, source_url, excerpt, category, language,
      queue_status, title, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const r of rows) insertItem.run(...r, now, now)
  db.prepare(`
    INSERT OR REPLACE INTO intel_analysis (
      id, item_id, version_id, content_hash, step, attempt_index, run_id, status,
      provider_id, model_id, model_name, prompt_hash, reuse_key, output_json,
      provenance, basis, receipt_id, error_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "an_e2e_extract_1",
    "item_e2e_1",
    "ver_e2e_1",
    "hash_e2e_1",
    "extract",
    1,
    "run_e2e_1",
    "completed",
    "fixture",
    "model-fake",
    "fake-model",
    "prompt-fake",
    null,
    JSON.stringify({ eventType: "port_closure", countries: ["MY"], ports: ["MYPKG"] }),
    "ai",
    "e2e fixture analysis",
    null,
    null,
    now,
  )
  db.prepare(`
    INSERT OR REPLACE INTO intel_label_decision (
      id, label_item_id, item_id, version_id, content_hash, kind, operator, is_human,
      decision_json, analysis_ids_json, prompt_hash, model_id, model_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ldc_e2e_ai1",
    "lbl_e2e_001",
    "item_e2e_1",
    "ver_e2e_1",
    "hash_e2e_1",
    "ai_prelabel",
    "system:ai",
    0,
    JSON.stringify({
      prefilterKeep: true,
      eventType: "port_closure",
      countries: ["MY"],
      ports: ["MYPKG"],
      effectiveFrom: "2026-11-02",
      isOfficialStatement: false,
    }),
    JSON.stringify(["an_e2e_extract_1"]),
    "prompt-fake",
    "model-fake",
    "fake-model",
    now,
  )
  db.close()
}

const checks = []
function check(ok, label, detail = {}) {
  checks.push({ ok: Boolean(ok), label, ...detail })
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`)
}

let server
let chromeChild
let serverLogPath

function startServer() {
  serverLogPath = join(RUN_DIR, `server-r36-browse-${Date.now()}.log`)
  mkdirSync(dirname(serverLogPath), { recursive: true })
  const fd = openSync(serverLogPath, "a")
  const env = { ...process.env }
  for (const key of PROVIDER_SECRET_ENV_KEYS) delete env[key]
  return spawn(process.execPath, ["--import", pathToFileURL(SPY_MODULE).href, SERVER_ENTRY], {
    cwd: RUN_DIR,
    env: {
      ...env,
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      SHIPPING_DATA_MODE: "real",
      SHIPPING_RUNTIME_ENABLED: "false",
      E2E_R36_SPY_FILE: SPY_FILE,
      E2E_R36_SPY_PORT: String(SPY_PORT),
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

async function spyStats() {
  const res = await fetch(`${SPY_BASE}/stats`)
  if (!res.ok) throw new Error(`spy /stats -> ${res.status}`)
  return res.json()
}

async function spyReset() {
  const res = await fetch(`${SPY_BASE}/reset`, { method: "POST" })
  if (!res.ok) throw new Error(`spy /reset -> ${res.status}`)
  return res.json()
}

async function spyProbe() {
  const res = await fetch(`${SPY_BASE}/probe`, { method: "POST" })
  if (!res.ok) throw new Error(`spy /probe -> ${res.status}`)
  return res.json()
}

async function seedPolicyAndLlm(fakeBaseUrl) {
  const policyRes = await fetch(`${BASE}/api/shipping/policies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      category: "customs_tax",
      countryCode: "VN",
      title: "[FIXTURE] R3-6 browse policy",
      documentNumber: "R36-BROWSE-001",
      publisher: "示例机关（fixture）",
      publishedAt: "2026-10-01",
      effectiveAt: "2026-11-01",
      status: "published",
      sourceType: "official",
      sourceUrl: "https://example.org/fixture/r36-browse-001",
      fullText: "示例全文（fixture，非真实公告）。",
      basisText: "fixture 依据 r3-6",
      enteredBy: "e2e-r3-6-browse",
      isFixture: true,
    }),
  })
  const policy = await policyRes.json().catch(() => ({}))
  check(policyRes.status === 200 || policyRes.status === 201, `seed fixture policy -> ${policyRes.status}`, { policyId: policy.id })
  check(typeof policy.id === "string" && policy.id.length > 0, "seed policy returns id")
  check(policy.isFixture === true, "seed policy isFixture=true")

  const providerRes = await fetch(`${BASE}/api/shipping/llm/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "r36-browse-fake-provider",
      name: "R3-6 Browse Fake Provider",
      baseUrl: fakeBaseUrl,
      apiCompat: "openai",
      apiKey: FAKE_KEY,
    }),
  })
  const provider = await providerRes.json().catch(() => ({}))
  check(providerRes.status === 200 || providerRes.status === 201, `seed fake provider -> ${providerRes.status}`, { providerId: provider.id })
  check(provider.secret?.configured === true, "fake provider secret configured (fixture key, not real)")
  check(!JSON.stringify(provider).includes(FAKE_KEY), "provider response never echoes raw fixture key")

  const modelRes = await fetch(`${BASE}/api/shipping/llm/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "r36-browse-fake-model",
      providerId: provider.id || "r36-browse-fake-provider",
      modelName: "mock-chat-r36-browse",
      purpose: "chat",
      unitPriceIn: 0.001,
      unitPriceOut: 0.002,
      currency: "USD",
    }),
  })
  const model = await modelRes.json().catch(() => ({}))
  check(modelRes.status === 200 || modelRes.status === 201, `seed fake model -> ${modelRes.status}`, { modelId: model.id })

  const bindRes = await fetch(`${BASE}/api/shipping/llm/bindings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "extract", modelId: model.id || "r36-browse-fake-model", updatedBy: "e2e-r3-6-browse" }),
  })
  check(bindRes.status === 200 || bindRes.status === 201, `seed extract binding -> ${bindRes.status}`)
  return { policyId: policy.id, providerId: provider.id, modelId: model.id }
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const secretsPath = join(RUN_DIR, ".data", "provider-secrets.json")
  if (existsSync(secretsPath)) throw new Error(`refusing: provider-secrets already exists at ${secretsPath}`)

  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge; set E2E_CHROME")

  const evidence = {
    tip: "r3-6-browse-zero-pay-rc",
    mode: "seeded-fixture-with-provider-spy",
    runDir: RUN_DIR,
    evidenceDir: EVIDENCE_DIR,
    chromeProfile: CHROME_PROFILE,
    baseUrl: BASE,
    spy: { port: SPY_PORT, file: SPY_FILE },
    historicalEmptySmokeRetained: "docs/evidence/r3-acceptance-closeout-20261102/r3-6-browse-*",
    priorStrengthenRetained: "docs/evidence/r3-acceptance-closeout-20261102/r3-6-strengthen/",
    notes: [
      "RC: independent provider-spy (--import) records/blocks outbound fetch; ledger kept as separate column",
      "Prior 50/50 strengthen retained as historical script result, not as meeting these stronger conditions",
      "Per-page CDP Network wait for data queries; timeout/error fails; shell alone is not success",
      "Chrome profile under project RUN_DIR",
      "Not a substitute for S7; no live test-connection; no crawl/runtime jobs; A1 not executed",
    ],
    openPages: OPEN_PAGES,
    detailPages: [],
    seeded: {},
    apiResults: [],
    pageResults: [],
    countersBefore: null,
    countersAfterApis: null,
    countersAfterBrowse: null,
    providerSpy: {},
    fakeProvider: {},
    externalRequests: [],
    screenshots: [],
    summary: {},
  }

  evidence.fakeProvider = {
    baseUrl: FAKE_PROVIDER_BASE,
    mode: "non-routable-https-fixture-config-only",
    note: "fixture binding only; outbound observation is provider-spy, not this hostname",
  }

  server = startServer()
  await waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/api/shipping/health`)
      if (!res.ok) return undefined
      const body = await res.json()
      return body?.database?.schemaVersion === EXPECTED_SCHEMA ? true : undefined
    } catch {
      return undefined
    }
  }, 60000, "server health")

  await waitFor(async () => {
    try {
      const res = await fetch(`${SPY_BASE}/stats`)
      return res.ok ? true : undefined
    } catch {
      return undefined
    }
  }, 15000, "provider spy control")

  // Negative self-check: simulated outbound must be counted AND blocked, then reset.
  const probe = await spyProbe()
  evidence.providerSpy.negativeProbe = probe
  check(probe.blocked === true && Number(probe.attemptCount) >= 1, `provider-spy negative probe counted+blocked (attemptCount=${probe.attemptCount}, blocked=${probe.blocked})`)
  await spyReset()
  const afterReset = await spyStats()
  evidence.providerSpy.afterNegativeReset = afterReset
  check(afterReset.attemptCount === 0 && afterReset.blocked === 0, `provider-spy reset to zero after negative probe (got ${JSON.stringify(afterReset)})`)

  await seedLabels()
  const seeded = await seedPolicyAndLlm(FAKE_PROVIDER_BASE)
  evidence.seeded = seeded

  const detailPages = [`/ports/${DETAIL_PORT_ID}`]
  evidence.detailPages = detailPages

  const before = await readDbCounters()
  evidence.countersBefore = before
  const spyBeforeBrowse = await spyStats()
  evidence.providerSpy.beforeBrowse = spyBeforeBrowse
  check(before.usageRequestCount === 0 && before.receipts === 0 && before.attempts === 0, `ledger before browse all zero (got ${JSON.stringify(before)})`)
  check(spyBeforeBrowse.attemptCount === 0, `provider-spy attempts before browse remain 0 (got ${spyBeforeBrowse.attemptCount})`)

  for (const spec of READONLY_APIS) {
    const res = await fetch(`${BASE}${spec.path}`)
    let body = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const statusOk = res.status === (spec.expectStatus ?? 200)
    const assertOk = spec.assert ? Boolean(spec.assert(body)) : true
    evidence.apiResults.push({ path: spec.path, status: res.status, statusOk, assertOk })
    check(statusOk && assertOk, `API ${spec.path} -> ${res.status} (expect ${spec.expectStatus ?? 200}) assert=${assertOk}`)
  }

  const afterApis = await readDbCounters()
  evidence.countersAfterApis = afterApis
  const spyAfterApis = await spyStats()
  evidence.providerSpy.afterApis = spyAfterApis
  check(
    afterApis.usageRequestCount === before.usageRequestCount
    && afterApis.receipts === before.receipts
    && afterApis.attempts === before.attempts,
    `readonly APIs: zero ledger delta (before=${JSON.stringify(before)} after=${JSON.stringify(afterApis)})`,
  )
  check(spyAfterApis.attemptCount === 0, `provider-spy attempts after readonly APIs remain 0 (got ${spyAfterApis.attemptCount})`)

  mkdirSync(CHROME_PROFILE, { recursive: true })
  chromeChild = spawn(chrome, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${CHROME_PROFILE}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "about:blank",
  ], { stdio: "ignore" })

  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      return res.ok ? await res.json() : undefined
    } catch {
      return undefined
    }
  }, 30000, "chrome debug")
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = targets.find(t => t.type === "page") || targets[0]
  if (!page?.webSocketDebuggerUrl) throw new Error("no CDP page target")
  const cdp = await connect(page.webSocketDebuggerUrl)
  const net = createNetworkTracker()
  cdp.on((msg) => {
    net.onMessage(msg)
    if (msg.method === "Network.requestWillBeSent") {
      const url = msg.params?.request?.url || ""
      if (/^https?:/i.test(url) && !url.includes("127.0.0.1") && !url.includes("localhost")) {
        evidence.externalRequests.push(url)
      }
    }
  })
  await cdp.send("Page.enable")
  await cdp.send("Runtime.enable")
  await cdp.send("Network.enable")

  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }

  const navigate = async (path) => {
    net.clear()
    const loaded = cdp.once("Page.loadEventFired")
    await cdp.send("Page.navigate", { url: `${BASE}${path}` })
    await Promise.race([loaded, new Promise(r => setTimeout(r, 15000))])
    await waitFor(async () => {
      const readyState = await evaluate("document.readyState")
      return readyState === "complete" ? true : undefined
    }, 15000, `document.readyState ${path}`)
  }

  const contentAsserts = {
    "/": async () => evaluate(`(() => {
      const el = document.querySelector('[data-testid="country-overview"]');
      if (!el) return undefined;
      const cards = document.querySelectorAll('[data-testid="country-card"]');
      if (cards.length < 6) return undefined;
      const t = el.innerText || '';
      if (/正在加载 Shipping HOT/.test(t)) return undefined;
      return true;
    })()`),
    "/ports": async () => evaluate(`(() => {
      const shell = document.querySelector('.shipping-shell, .risk-console, .ports-demo');
      if (!shell) return undefined;
      const t = (document.body && document.body.innerText) || '';
      if (/正在加载 Shipping HOT|读取港口资料/.test(t) && !/尚无可读缓存|八港目录|未缓存相关公告/.test(t)) return undefined;
      if (/Cannot GET|Something went wrong|Application error/i.test(t)) return false;
      return /港口|八港|盐田|蛇口/.test(t) ? true : undefined;
    })()`),
    "/events": async () => evaluate(`(() => {
      const t = (document.body && document.body.innerText) || '';
      if (/正在加载 Shipping HOT/.test(t)) return undefined;
      if (/航运数据暂不可用/.test(t)) return false;
      if (/当前没有进行中的事件|暂无已解决的事件|事件/.test(t)) return true;
      return undefined;
    })()`),
    "/policies": async () => evaluate(`(() => {
      const pageEl = document.querySelector('[data-testid="policies-page"]');
      if (!pageEl) return undefined;
      const count = document.querySelector('[data-testid="policy-count"]');
      if (count && /读取中/.test(count.innerText || '')) return undefined;
      const detail = document.querySelector('[data-testid="policy-detail"]');
      const text = ((detail && detail.innerText) || pageEl.innerText || '');
      if (text.includes('FIXTURE') || text.includes('R3-6 browse policy')) return true;
      if (count && /[1-9]/.test(count.innerText || '')) return true;
      return undefined;
    })()`),
    "/calendar": async () => evaluate(`(() => {
      const el = document.querySelector('[data-testid="calendar-demo"]');
      if (!el) return undefined;
      const t = el.innerText || '';
      if (/读取年度资料…|正在读取参考记录…/.test(t) && !/年暂无已录入|项本月参考|项参考假日/.test(t)) return undefined;
      if (/年度资料读取失败/.test(t)) return false;
      return true;
    })()`),
    "/feed": async () => evaluate(`(() => {
      const root = document.querySelector('.manual-intel');
      if (!root) return undefined;
      const t = root.innerText || '';
      if (/^读取中/.test(t.trim()) || /检查清单读取失败/.test(t)) {
        if (/检查清单读取失败/.test(t)) return false;
        return undefined;
      }
      return /资讯录入|人工信源|粘贴/.test(t) ? true : undefined;
    })()`),
    "/label": async () => evaluate(`(() => {
      const pageEl = document.querySelector('[data-testid="intel-label-page"]');
      if (!pageEl) return undefined;
      if (document.querySelector('[data-testid="label-queue-item-lbl_e2e_001"]')) return true;
      const t = pageEl.innerText || '';
      return t.includes('lbl_e2e_001') ? true : undefined;
    })()`),
    "/settings": async () => evaluate(`(() => {
      const panel = document.querySelector('[data-testid="llm-settings-panel"]');
      if (!panel) return undefined;
      const provider = document.querySelector('[data-testid="llm-provider-row-r36-browse-fake-provider"]');
      const bind = document.querySelector('[data-testid="llm-binding-status-extract"]');
      if (provider && bind) return true;
      const text = panel.innerText || '';
      if (text.includes('R3-6 Browse Fake Provider') && text.includes('extract')) return true;
      return undefined;
    })()`),
    [`/ports/${DETAIL_PORT_ID}`]: async () => evaluate(`(() => {
      const t = (document.body && document.body.innerText) || '';
      if (/不在批准的八港范围内/.test(t)) return false;
      if (/读取港口资料|加载港口天气|正在加载 Shipping HOT/.test(t) && !/尚无可读缓存|port-weather|暂无 7 天|天气同步|港口天气 API/.test(t)) return undefined;
      const notice = document.querySelector('[data-testid="port-weather-notice"], [data-testid="port-weather-coverage"], [data-testid="port-weather-forecast-list"]');
      if (notice) return true;
      if (/尚无可读缓存|港口天气|蛇口|未缓存相关公告/.test(t)) return true;
      if (/港口天气 API 不可用/.test(t)) return false;
      return undefined;
    })()`),
  }

  for (const path of [...OPEN_PAGES, ...detailPages]) {
    const started = Date.now()
    const expectedApis = PAGE_QUERIES[path] || []
    await navigate(path)
    let queryHits = []
    let queryError = null
    try {
      queryHits = await net.waitForApis(expectedApis, 20000)
    } catch (error) {
      queryError = String(error && error.message ? error.message : error)
    }
    let contentOk = false
    let contentError = null
    const assertFn = contentAsserts[path]
    try {
      if (!assertFn) throw new Error(`missing content assert for ${path}`)
      if (queryError) throw new Error(queryError)
      await waitFor(assertFn, 20000, `content ${path}`)
      contentOk = true
    } catch (error) {
      contentError = String(error && error.message ? error.message : error)
      contentOk = false
    }

    const title = await evaluate("document.title || ''")
    const bodyLen = await evaluate("(document.body && document.body.innerText ? document.body.innerText.length : 0)")
    const href = await evaluate("location.pathname + location.search + location.hash")
    const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console, .ports-demo, [data-testid=\"country-overview\"], [data-testid=\"calendar-demo\"], [data-testid=\"policies-page\"], [data-testid=\"intel-label-page\"], .manual-intel')")
    const loadingLeft = await evaluate(`(() => {
      const t = (document.body && document.body.innerText) || '';
      return /正在加载 Shipping HOT 数据/.test(t);
    })()`)
    const errorish = await evaluate(`(() => {
      const t = (document.body && document.body.innerText) || '';
      if (/Cannot GET|Something went wrong|Application error/i.test(t) && !document.querySelector('.shipping-shell, .risk-console')) return true;
      return false;
    })()`)
    const spySnap = await spyStats()
    const ledgerSnap = await readDbCounters()
    const pageRecord = {
      path,
      href,
      title,
      bodyLen,
      shell,
      loadingLeft,
      errorish,
      expectedApis,
      queryHits,
      queryError,
      contentOk,
      contentError,
      providerSpyAttemptCount: spySnap.attemptCount,
      ledger: ledgerSnap,
      ms: Date.now() - started,
    }
    evidence.pageResults.push(pageRecord)
    check(
      contentOk && !errorish && !loadingLeft && !queryError && spySnap.attemptCount === 0,
      `page ${path} queries+content (href=${href}, contentOk=${contentOk}, queryError=${queryError}, loadingLeft=${loadingLeft}, spyAttempts=${spySnap.attemptCount})`,
      pageRecord,
    )
  }

  // Label detail click after queries settled
  await navigate("/label")
  await net.waitForApis(PAGE_QUERIES["/label"], 20000)
  await waitFor(contentAsserts["/label"], 20000, "label before click")
  await waitFor(async () => evaluate(`(() => {
    const btn = document.querySelector('[data-testid="label-queue-item-lbl_e2e_001"]');
    if (!btn) return undefined;
    btn.click();
    return true;
  })()`), 10000, "click label item")
  await waitFor(async () => evaluate(`(() => {
    const detail = document.querySelector('[data-testid="label-detail"]');
    if (!detail) return undefined;
    const t = detail.innerText || '';
    if (t.includes('lbl_e2e_001') || t.includes('excerpt one') || t.includes('Port notice')) return true;
    return undefined;
  })()`), 15000, "label detail")
  evidence.labelDetail = { ok: true, id: "lbl_e2e_001" }
  check(true, "label detail opened for lbl_e2e_001")

  await navigate("/policies")
  await net.waitForApis(PAGE_QUERIES["/policies"], 20000)
  await waitFor(contentAsserts["/policies"], 20000, "policy before detail")
  await evaluate(`(() => {
    const detail = document.querySelector('[data-testid="policy-detail"]');
    const text = (detail && detail.innerText) || '';
    if (text.includes('FIXTURE') || text.includes('R3-6 browse policy')) return true;
    const row = document.querySelector('[data-testid="policies-page"] button, [data-testid="policies-page"] li, [data-testid="policies-page"] a');
    // Prefer explicit list buttons if present
    const candidates = Array.from(document.querySelectorAll('[data-testid="policies-page"] *')).filter(el => /FIXTURE|R3-6 browse policy|R36-BROWSE/.test(el.textContent || ''));
    if (candidates[0]) candidates[0].click();
    return true;
  })()`)
  await waitFor(async () => evaluate(`(() => {
    const detail = document.querySelector('[data-testid="policy-detail"]');
    const text = (detail && detail.innerText) || '';
    if (text.includes('FIXTURE') || text.includes('R3-6 browse policy')) return true;
    return undefined;
  })()`), 15000, "policy detail fixture")
  const policyText = await evaluate(`(() => {
    const detail = document.querySelector('[data-testid="policy-detail"]');
    return (detail && detail.innerText) || '';
  })()`)
  evidence.policyDetail = { ok: /FIXTURE|R3-6 browse policy/.test(String(policyText)), excerpt: String(policyText).slice(0, 240) }
  check(evidence.policyDetail.ok, "policy detail shows fixture content")

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })
  const shotPath = join(EVIDENCE_DIR, "r3-6-browse-rc-last-page.png")
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
  evidence.screenshots.push(shotPath)

  const afterBrowse = await readDbCounters()
  evidence.countersAfterBrowse = afterBrowse
  const spyAfterBrowse = await spyStats()
  evidence.providerSpy.afterBrowse = spyAfterBrowse
  check(
    afterBrowse.usageRequestCount === before.usageRequestCount
    && afterBrowse.receipts === before.receipts
    && afterBrowse.attempts === before.attempts,
    `browse pages: zero ledger delta (before=${JSON.stringify(before)} after=${JSON.stringify(afterBrowse)})`,
  )
  check(
    afterBrowse.usageRequestCount === 0 && afterBrowse.attempts === 0 && afterBrowse.receipts === 0,
    `ledger counters remain zero (usage=${afterBrowse.usageRequestCount}, attempts=${afterBrowse.attempts}, receipts=${afterBrowse.receipts})`,
  )
  check(spyAfterBrowse.attemptCount === 0 && spyAfterBrowse.blocked === 0, `provider-spy attempts remain 0 after browse (got ${JSON.stringify(spyAfterBrowse)})`)
  check(evidence.externalRequests.length === 0, `browser external requests empty (n=${evidence.externalRequests.length})`)

  // Confirm spy file on disk independent of ledger
  if (existsSync(SPY_FILE)) {
    evidence.providerSpy.fileContents = JSON.parse(readFileSync(SPY_FILE, "utf8"))
  }

  const failed = checks.filter(c => !c.ok)
  evidence.summary = { passed: checks.length - failed.length, failed: failed.length, total: checks.length }
  const summaryLines = [
    `R3-6 browse zero-pay RC`,
    `RUN_DIR=${RUN_DIR}`,
    `EVIDENCE_DIR=${EVIDENCE_DIR}`,
    `chromeProfile=${CHROME_PROFILE}`,
    `SUMMARY ${evidence.summary.passed}/${evidence.summary.total} failed=${evidence.summary.failed}`,
    `ledger before/afterBrowse=${JSON.stringify(before)} / ${JSON.stringify(afterBrowse)}`,
    `providerSpy afterBrowse attemptCount=${spyAfterBrowse.attemptCount} blocked=${spyAfterBrowse.blocked}`,
    `negativeProbe attemptCount=${probe.attemptCount} blocked=${probe.blocked}`,
    `fakeProviderConfig=${FAKE_PROVIDER_BASE}`,
    `pages=${[...OPEN_PAGES, ...detailPages].join(",")}`,
    `priorStrengthen=retained-not-stronger-claim`,
  ]
  for (const c of checks) summaryLines.push(`${c.ok ? "PASS" : "FAIL"}  ${c.label}`)
  writeFileSync(join(EVIDENCE_DIR, "r3-6-browse-rc-e2e.txt"), summaryLines.join("\n"), "utf8")
  writeFileSync(join(EVIDENCE_DIR, "r3-6-browse-rc-evidence.json"), JSON.stringify(evidence, null, 2), "utf8")
  console.log(summaryLines.join("\n"))
  if (failed.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  try {
    if (chromeChild) chromeChild.kill("SIGKILL")
  } catch {}
  try {
    await stopServer(server)
  } catch {}
})
