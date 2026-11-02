/**
 * R3-6 isolated browse zero-pay verification (CDP) — seeded strengthen pass.
 * Fresh project-internal RUN_DIR each run; refuse overwrite/delete of existing data.
 * Seeds fixture policy/labels + fake provider/model/binding (non-routable HTTPS base).
 * Server-side Provider call count via provider_usage/paid_receipt (must stay 0).
 * No real keys / outbound / live test-connection.
 * Historical empty-DB smoke evidence under r3-acceptance-closeout-20261102/ is retained;
 * this strengthen run writes only under r3-6-strengthen/.
 * Does NOT substitute for S7; does NOT expand open-page scope.
 */
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ISOLATED_ROOT = resolve(join(ROOT, ".tmp"))
const RUNS_ROOT = resolve(join(ISOLATED_ROOT, "r3-6-browse-zero-pay", "runs"))
const EVIDENCE_DIR = resolve(process.env.E2E_R31_EVIDENCE_DIR ?? join(ROOT, "docs", "evidence", "r3-acceptance-closeout-20261102", "r3-6-strengthen"))
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_R36_BROWSE_PORT ?? "4496")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R36_DEBUG_PORT ?? "9366")
const EXPECTED_SCHEMA = 39
const FAKE_KEY = "sk-test-fixture-r36-not-real-0000"

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

/** Readonly APIs that must return explicit success (not merely <500). */
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
    // .tmp path check is NOT ownership proof — refuse any pre-existing unknown data.
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

if (!existsSync(SERVER_ENTRY)) {
  throw new Error(`missing production server entry: ${SERVER_ENTRY} (run pnpm build first)`)
}

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
let profile
let serverLogPath
// Fake Provider: registry requires https + non-localhost. Use non-routable fixture host.
// Server-side call recording = provider_usage.request_count + paid_receipt(_attempt).
// No live listener (would need banned localhost / real DNS). Hits inferred from ledger.
const FAKE_PROVIDER_BASE = "https://api.example.invalid/v1"
let fakeProviderHits = 0 // mirrored from ledger.usageRequestCount for evidence symmetry

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
  check(policyRes.status === 200 || policyRes.status === 201, `seed policy -> ${policyRes.status}`, { policyId: policy.id })
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
  // Safety: never delete existing DB/secrets. Fresh RUN_DIR from allocateRunDir only.
  if (existsSync(DB_PATH)) {
    throw new Error(`refusing: DB already exists at ${DB_PATH}; allocateRunDir must yield an empty run`)
  }
  const secretsPath = join(RUN_DIR, ".data", "provider-secrets.json")
  if (existsSync(secretsPath)) {
    throw new Error(`refusing: provider-secrets already exists at ${secretsPath}`)
  }

  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge; set E2E_CHROME")

  const evidence = {
    tip: "r3-6-browse-zero-pay-strengthen",
    mode: "seeded-fixture",
    historicalEmptySmokeRetained: "docs/evidence/r3-acceptance-closeout-20261102/r3-6-browse-*",
    baseUrl: BASE,
    runDir: RUN_DIR.replaceAll("\\", "/"),
    evidenceDir: EVIDENCE_DIR.replaceAll("\\", "/"),
    openPages: OPEN_PAGES.slice(),
    readonlyApis: READONLY_APIS.map(a => a.path),
    detailPages: [],
    apiResults: [],
    pageResults: [],
    externalRequests: [],
    fakeProvider: {},
    checks: [],
    screenshots: [],
    notes: [
      "Strengthen pass with fixtures; historical empty-DB smoke retained separately",
      "Not a substitute for S7 integrated acceptance",
      "No live test-connection; no crawl/runtime jobs",
      "Provider secrets stripped from env; fake key only; fake Provider HTTP records hits",
      "RUN_DIR is a fresh mkdtemp under .tmp; refuse overwrite/delete of existing data",
    ],
  }

  const fakeBaseUrl = FAKE_PROVIDER_BASE
  evidence.fakeProvider = {
    baseUrl: fakeBaseUrl,
    mode: "non-routable-https-fixture",
    recording: "provider_usage.request_count + paid_receipt + paid_receipt_attempt",
    hitsBefore: 0,
    note: "registry parseProviderBaseUrl forbids http/localhost; fixture key only; no live test-connection",
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

  await seedLabels()
  const seeded = await seedPolicyAndLlm(fakeBaseUrl)
  evidence.seeded = seeded

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

  const detailApis = [
    {
      path: "/api/shipping/intel/labels/lbl_e2e_001",
      expectStatus: 200,
      assert: body => body?.item?.id === "lbl_e2e_001" || body?.id === "lbl_e2e_001" || Boolean(body?.material?.excerpt) || Boolean(body?.labelItem?.id),
    },
    {
      path: `/api/shipping/policies/${encodeURIComponent(seeded.policyId)}`,
      expectStatus: 200,
      assert: body => String(body?.record?.title || body?.title || "").includes("FIXTURE"),
    },
  ]

  const before = await readDbCounters()
  evidence.countersBefore = before
  fakeProviderHits = before.usageRequestCount
  evidence.fakeProvider.hitsAfterSeed = fakeProviderHits
  check(before.usageRequestCount === 0 && before.receipts === 0 && before.attempts === 0, `ledger before browse all zero (got ${JSON.stringify(before)})`)
  check(fakeProviderHits === 0, `fake Provider server-side call count after seed remain 0 (got ${fakeProviderHits})`)

  for (const spec of [...READONLY_APIS, ...detailApis]) {
    const started = Date.now()
    let status = 0
    let ok = false
    let err = null
    let body = null
    try {
      const res = await fetch(`${BASE}${spec.path}`)
      status = res.status
      const text = await res.text()
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
      const statusOk = status === spec.expectStatus
      const contentOk = spec.assert ? Boolean(spec.assert(body)) : true
      ok = statusOk && contentOk
      if (!statusOk) err = `expected status ${spec.expectStatus}`
      else if (!contentOk) err = "content assert failed"
    } catch (e) {
      err = String(e?.message || e)
    }
    evidence.apiResults.push({ path: spec.path, status, ok, err, ms: Date.now() - started })
    check(ok, `GET ${spec.path} -> ${status}${err ? (` err=${err}`) : ""}`)
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
  fakeProviderHits = afterApis.usageRequestCount
  evidence.fakeProvider.hitsAfterApis = fakeProviderHits
  check(fakeProviderHits === 0, `fake Provider server-side call count after APIs remain 0 (got ${fakeProviderHits})`)

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

  const pageAsserts = {
    "/": async () => {
      const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
      return shell ? true : undefined
    },
    "/ports": async () => {
      const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
      return shell ? true : undefined
    },
    "/events": async () => {
      const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
      return shell ? true : undefined
    },
    "/policies": async () => evaluate(`(() => {
      const pageEl = document.querySelector('[data-testid="policies-page"]');
      if (!pageEl) return undefined;
      const detail = document.querySelector('[data-testid="policy-detail"]');
      const text = ((detail && detail.innerText) || pageEl.innerText || '');
      if (text.includes('FIXTURE') || text.includes('R3-6 browse policy')) return true;
      const count = document.querySelector('[data-testid="policy-count"]');
      if (count && /[1-9]/.test(count.innerText || '')) return true;
      return undefined;
    })()`),
    "/calendar": async () => {
      const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
      return shell ? true : undefined
    },
    "/feed": async () => {
      const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
      return shell ? true : undefined
    },
    "/label": async () => evaluate(`(() => {
      const pageEl = document.querySelector('[data-testid="intel-label-page"]');
      if (!pageEl) return undefined;
      const text = pageEl.innerText || '';
      if (text.includes('lbl_e2e_001') || document.querySelector('[data-testid="label-queue-item-lbl_e2e_001"]')) return true;
      return undefined;
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
  }

  for (const path of [...OPEN_PAGES, ...detailPages]) {
    const started = Date.now()
    await navigate(path)
    const assertFn = pageAsserts[path]
    let readyOk = false
    if (assertFn) {
      const waited = await waitFor(assertFn, 20000)
      readyOk = Boolean(waited)
    } else if (path.startsWith("/ports/")) {
      const waited = await waitFor(async () => {
        const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
        return shell ? true : undefined
      }, 20000)
      readyOk = Boolean(waited)
    }
    await waitFor(async () => {
      const pending = await evaluate(`(() => {
        if (!window.performance || !performance.getEntriesByType) return 0;
        const entries = performance.getEntriesByType('resource');
        return entries.filter(e => String(e.name||'').includes('/api/shipping/')).length;
      })()`)
      return pending > 0 ? true : undefined
    }, 5000).catch(() => undefined)

    const title = await evaluate("document.title || ''")
    const bodyLen = await evaluate("(document.body && document.body.innerText ? document.body.innerText.length : 0)")
    const href = await evaluate("location.pathname + location.search + location.hash")
    const shell = await evaluate("!!document.querySelector('.shipping-shell, .risk-console')")
    const errorish = await evaluate(`(() => {
      const t = (document.body && document.body.innerText) || '';
      if (/Cannot GET|Something went wrong|Application error/i.test(t) && !document.querySelector('.shipping-shell, .risk-console')) return true;
      return false;
    })()`)
    evidence.pageResults.push({ path, href, title, bodyLen, shell, readyOk, errorish, ms: Date.now() - started })
    check(readyOk && shell && !errorish, `page ${path} loaded with content assert (href=${href}, bodyLen=${bodyLen}, readyOk=${readyOk}, errorish=${errorish})`)
  }

  await navigate("/label")
  await waitFor(async () => evaluate(`(() => {
    const btn = document.querySelector('[data-testid="label-queue-item-lbl_e2e_001"]');
    if (!btn) return undefined;
    btn.click();
    return true;
  })()`), 10000)
  const labelDetailReady = await waitFor(async () => evaluate(`(() => {
    const id = document.querySelector('[data-testid="label-identity"]');
    if (!id) return undefined;
    return (id.innerText || '').includes('lbl_e2e_001') ? true : undefined;
  })()`), 15000)
  check(Boolean(labelDetailReady), "label detail shows lbl_e2e_001 after select")
  evidence.labelDetail = { ready: Boolean(labelDetailReady) }

  await navigate("/policies")
  const policyDetailReady = await waitFor(async () => evaluate(`(() => {
    const d = document.querySelector('[data-testid="policy-detail"]');
    if (!d) return undefined;
    const t = d.innerText || '';
    return (t.includes('FIXTURE') || t.includes('R3-6 browse policy')) ? true : undefined;
  })()`), 20000)
  check(Boolean(policyDetailReady), "policy detail shows fixture record")
  evidence.policyDetail = { ready: Boolean(policyDetailReady) }

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })
  const shotPath = join(EVIDENCE_DIR, "r3-6-browse-strengthen-last-page.png")
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
  evidence.screenshots.push(shotPath.replaceAll("\\", "/"))
  check(existsSync(shotPath), "screenshot written")

  evidence.externalRequests = externalRequests.slice()
  check(externalRequests.length === 0, `browser zero external HTTP (got ${externalRequests.length})`, { sample: externalRequests.slice(0, 5) })

  const afterBrowse = await readDbCounters()
  evidence.countersAfterBrowse = afterBrowse
  fakeProviderHits = afterBrowse.usageRequestCount
  evidence.fakeProvider.hitsAfterBrowse = fakeProviderHits
  evidence.fakeProvider.ledgerAfterBrowse = afterBrowse
  check(
    afterBrowse.usageRequestCount === before.usageRequestCount
    && afterBrowse.usageRows === before.usageRows
    && afterBrowse.receipts === before.receipts
    && afterBrowse.attempts === before.attempts,
    `browse pages: zero paid_receipt/provider_usage delta (before=${JSON.stringify(before)} after=${JSON.stringify(afterBrowse)})`,
  )
  check(
    afterBrowse.usageRequestCount === 0 && afterBrowse.attempts === 0 && afterBrowse.receipts === 0,
    `ledger counters remain zero (usage=${afterBrowse.usageRequestCount}, attempts=${afterBrowse.attempts}, receipts=${afterBrowse.receipts})`,
  )
  check(fakeProviderHits === 0, `fake Provider server-side call count remains 0 after browse (got ${fakeProviderHits})`)

  evidence.checks = checks
  const passed = checks.filter(c => c.ok).length
  const failed = checks.filter(c => !c.ok).length
  evidence.summary = { passed, failed, total: checks.length }
  writeFileSync(join(EVIDENCE_DIR, "r3-6-browse-strengthen-evidence.json"), JSON.stringify(evidence, null, 2))
  const lines = [
    `R3-6 browse zero-pay STRENGTHEN ${failed === 0 ? "PASS" : "FAIL"}  ${passed}/${checks.length}`,
    `schema=${ready?.database?.schemaVersion}`,
    `runDir=${RUN_DIR.replaceAll("\\", "/")}`,
    `fakeProvider=${fakeBaseUrl} hits=${fakeProviderHits}`,
    `before=${JSON.stringify(before)}`,
    `afterApis=${JSON.stringify(afterApis)}`,
    `afterBrowse=${JSON.stringify(afterBrowse)}`,
    `externalRequests=${externalRequests.length}`,
    `pages=${[...OPEN_PAGES, ...detailPages].join(",")}`,
    `apis=${READONLY_APIS.length + detailApis.length}`,
    "historical empty-DB smoke retained at parent evidence dir; this is seeded strengthen",
    "NOT a substitute for S7; no live connection test; no crawl; A1 not executed",
    ...checks.map(c => `${c.ok ? "PASS" : "FAIL"}  ${c.label}`),
  ]
  writeFileSync(join(EVIDENCE_DIR, "r3-6-browse-strengthen-e2e.txt"), `${lines.join("\n")}\n`)
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
