/**
 * R3-1 Settings isolated browser acceptance (CDP).
 * Zero egress; mock test-connection only; never claims real vendor connected.
 * Pattern mirrors scripts/e2e-s7-integrated.mjs (Chrome CDP + production build).
 */
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_R31_SETTINGS_DIR ?? join(ROOT, ".tmp", "r3-1-settings-browser"))
const EVIDENCE_DIR = resolve(process.env.E2E_R31_EVIDENCE_DIR ?? join(ROOT, ".tmp", "r3-1-llm-registry-20261027"))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_R31_SETTINGS_PORT ?? "4488")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R31_DEBUG_PORT ?? "9355")
const ISOLATED_ROOT = resolve(join(ROOT, ".tmp"))

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
    const receipts = db.prepare("SELECT COUNT(*) AS n FROM paid_receipt").get().n
    const attempts = db.prepare("SELECT COUNT(*) AS n FROM paid_receipt_attempt").get().n
    return { usage: Number(usage), receipts: Number(receipts), attempts: Number(attempts) }
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
  serverLogPath = join(RUN_DIR, `server-settings-${Date.now()}.log`)
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
    tip: "r3-1-settings-manage-ui",
    baseUrl: BASE,
    runDir: RUN_DIR.replaceAll("\\", "/"),
    evidenceDir: EVIDENCE_DIR.replaceAll("\\", "/"),
    checks: [],
    externalRequests: [],
    screenshots: [],
    api: {},
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
  check(ready?.database?.schemaVersion === 31, `schema v31 after init (got ${ready?.database?.schemaVersion})`)

  // Shared pool GET before configure: unconfigured fail-closed, zero provider/receipt side effects.
  const countersBeforeSharedGet = await readDbCounters()
  const sharedGet0 = await fetch(`${BASE}/api/shipping/llm/shared-budget`)
  const sharedBody0 = await sharedGet0.json().catch(() => ({}))
  check(sharedGet0.status === 200, `GET shared-budget unconfigured -> ${sharedGet0.status}`)
  check(sharedBody0.configured === false && sharedBody0.state === "unconfigured", `shared-budget starts unconfigured (got ${JSON.stringify(sharedBody0)})`)
  check(sharedBody0.notAHardInvoiceCap === true, "shared-budget discloses notAHardInvoiceCap")
  const countersAfterSharedGet = await readDbCounters()
  check(
    countersAfterSharedGet.usage === countersBeforeSharedGet.usage
    && countersAfterSharedGet.receipts === countersBeforeSharedGet.receipts
    && countersAfterSharedGet.attempts === countersBeforeSharedGet.attempts,
    `GET shared-budget: no receipt/usage increment (before=${JSON.stringify(countersBeforeSharedGet)} after=${JSON.stringify(countersAfterSharedGet)})`,
  )
  evidence.api.sharedBudgetGet0 = sharedBody0

  const badCurrency = await fetch(`${BASE}/api/shipping/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sharedLlmBudget: { monthlyBudget: 5, currency: "usd" } }),
  })
  check(badCurrency.status === 400, `sharedLlmBudget bad currency rejected -> ${badCurrency.status}`)

  // Translation sub-limit + enable (must NOT invent shared pool authorization).
  const patch = await fetch(`${BASE}/api/shipping/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ translation: { enabled: true, monthlyBudget: 10 } }),
  })
  check(patch.status < 500, `settings translation sub-budget configure -> ${patch.status}`)
  const sharedAfterTranslationOnly = await (await fetch(`${BASE}/api/shipping/llm/shared-budget`)).json().catch(() => ({}))
  check(sharedAfterTranslationOnly.configured === false, `translation-only save must not invent shared pool (got ${JSON.stringify(sharedAfterTranslationOnly)})`)

  // Dedicated shared pool — separate from translation.monthlyBudget.
  const sharedSave = await fetch(`${BASE}/api/shipping/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sharedLlmBudget: { monthlyBudget: 5, currency: "USD" } }),
  })
  const sharedSaveBody = await sharedSave.json().catch(() => ({}))
  check(sharedSave.status === 200 || sharedSave.status === 201, `sharedLlmBudget save -> ${sharedSave.status}`)
  check(sharedSaveBody?.sharedLlmBudget?.monthlyBudget === 5 && sharedSaveBody?.sharedLlmBudget?.currency === "USD", `shared pool persisted on settings response (got ${JSON.stringify(sharedSaveBody?.sharedLlmBudget)})`)

  const sharedGet1 = await fetch(`${BASE}/api/shipping/llm/shared-budget`)
  const sharedBody1 = await sharedGet1.json().catch(() => ({}))
  check(sharedGet1.status === 200 && sharedBody1.configured === true && sharedBody1.monthlyBudget === 5 && sharedBody1.currency === "USD", `GET shared-budget after save (got ${JSON.stringify(sharedBody1)})`)
  evidence.api.sharedBudgetGet1 = sharedBody1

  // Unrelated patch must preserve shared pool (no overwrite / no rewrite of absent fields elsewhere).
  const unrelated = await fetch(`${BASE}/api/shipping/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshInterval: 15 }),
  })
  const unrelatedBody = await unrelated.json().catch(() => ({}))
  check(unrelated.status === 200 || unrelated.status === 201, `unrelated settings patch -> ${unrelated.status}`)
  check(unrelatedBody?.sharedLlmBudget?.monthlyBudget === 5 && unrelatedBody?.sharedLlmBudget?.currency === "USD", `unrelated patch preserves shared pool (got ${JSON.stringify(unrelatedBody?.sharedLlmBudget)})`)

  const providerRes = await fetch(`${BASE}/api/shipping/llm/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "R3-1 Settings Accept Mock",
      baseUrl: "https://api.example.invalid/v1",
      apiCompat: "openai",
      apiKey: "sk-test-fixture-not-real-0000",
    }),
  })
  const provider = await providerRes.json().catch(() => ({}))
  check(providerRes.status === 200 || providerRes.status === 201, `create provider -> ${providerRes.status}`, { providerId: provider.id })
  evidence.api.provider = { status: providerRes.status, id: provider.id, secretConfigured: provider.secret?.configured }

  const modelRes = await fetch(`${BASE}/api/shipping/llm/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId: provider.id,
      modelName: "mock-chat-fixture",
      purpose: "chat",
      unitPriceIn: 0.001,
      unitPriceOut: 0.002,
      currency: "USD",
    }),
  })
  const model = await modelRes.json().catch(() => ({}))
  check(modelRes.status === 200 || modelRes.status === 201, `create model -> ${modelRes.status}`, { modelId: model.id })
  evidence.api.model = { status: modelRes.status, id: model.id }
  check(typeof provider.secretRef === "string" && String(provider.secretRef).startsWith("llm-registry:"), `provider secretRef namespaced (got ${provider.secretRef})`)

  const providerBRes = await fetch(`${BASE}/api/shipping/llm/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "r31-browser-b",
      name: "R3-1 Browser Provider B",
      baseUrl: "https://api.example-b.invalid/v1",
      apiCompat: "openai",
      apiKey: "sk-test-fixture-b-not-real",
    }),
  })
  const providerB = await providerBRes.json().catch(() => ({}))
  check(providerBRes.status === 200 || providerBRes.status === 201, `create provider B -> ${providerBRes.status}`, { providerId: providerB.id })
  const modelBRes = await fetch(`${BASE}/api/shipping/llm/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "r31-browser-model-b",
      providerId: providerB.id,
      modelName: "mock-chat-b",
      purpose: "chat",
      unitPriceIn: 0.001,
      unitPriceOut: 0.002,
      currency: "USD",
    }),
  })
  const modelB = await modelBRes.json().catch(() => ({}))
  check(modelBRes.status === 200 || modelBRes.status === 201, `create model b -> ${modelBRes.status}`, { modelId: modelB.id })
  evidence.api.providerB = { status: providerBRes.status, id: providerB.id }
  evidence.api.modelB = { status: modelBRes.status, id: modelB.id }

  // --- Manage-UI API prelude ---
  const countersBeforeGet = await readDbCounters()
  evidence.countersBeforeGet = countersBeforeGet
  const getProviders = await fetch(`${BASE}/api/shipping/llm/providers`)
  const getModels = await fetch(`${BASE}/api/shipping/llm/models`)
  const getBindings = await fetch(`${BASE}/api/shipping/llm/bindings`)
  check(getProviders.status === 200, `GET providers -> ${getProviders.status}`)
  check(getModels.status === 200, `GET models -> ${getModels.status}`)
  check(getBindings.status === 200, `GET bindings -> ${getBindings.status}`)
  const countersAfterGet = await readDbCounters()
  evidence.countersAfterGet = countersAfterGet
  check(
    countersAfterGet.usage === countersBeforeGet.usage
    && countersAfterGet.receipts === countersBeforeGet.receipts
    && countersAfterGet.attempts === countersBeforeGet.attempts,
    `GET llm registry: no receipt/usage increment (before=${JSON.stringify(countersBeforeGet)} after=${JSON.stringify(countersAfterGet)})`,
  )

  const blankOmit = await fetch(`${BASE}/api/shipping/llm/providers/${provider.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "R3-1 Settings Accept Mock Edited" }),
  })
  const blankOmitBody = await blankOmit.json().catch(() => ({}))
  check(blankOmit.status === 200 || blankOmit.status === 201, `PATCH provider omit apiKey -> ${blankOmit.status}`)
  check(blankOmitBody.secret?.configured === true, "omit apiKey keeps secret configured")
  const blankEmpty = await fetch(`${BASE}/api/shipping/llm/providers/${provider.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "   " }),
  })
  const blankEmptyBody = await blankEmpty.json().catch(() => ({}))
  check(blankEmpty.status === 400, `PATCH blank apiKey rejected -> ${blankEmpty.status}`)
  check(JSON.stringify(blankEmptyBody).includes("secret_required"), `blank apiKey error is secret_required (body=${JSON.stringify(blankEmptyBody).slice(0, 200)})`)
  const tooLong = await fetch(`${BASE}/api/shipping/llm/providers/${provider.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "x".repeat(600) }),
  })
  const tooLongBody = await tooLong.json().catch(() => ({}))
  check(tooLong.status === 400, `PATCH overlong apiKey rejected -> ${tooLong.status}`)
  check(JSON.stringify(tooLongBody).includes("secret_too_long"), "overlong error secret_too_long")

  const rotate = await fetch(`${BASE}/api/shipping/llm/providers/${provider.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "sk-test-fixture-rotated-1111" }),
  })
  const rotateBody = await rotate.json().catch(() => ({}))
  check(rotate.status === 200 || rotate.status === 201, `PATCH rotate fake key -> ${rotate.status}`)
  check(rotateBody.secret?.configured === true, "rotated secret still configured/redacted")
  check(!JSON.stringify(rotateBody).includes("sk-test-fixture-rotated-1111"), "response never echoes raw key")

  const modelPatch = await fetch(`${BASE}/api/shipping/llm/models/${model.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "chat", unitPriceIn: 0.01, unitPriceOut: 0.02, currency: "USD", modelName: "mock-chat-fixture-v2" }),
  })
  const modelPatched = await modelPatch.json().catch(() => ({}))
  check(modelPatch.status === 200 || modelPatch.status === 201, `PATCH model price/purpose -> ${modelPatch.status}`)
  check(modelPatched.unitPriceIn === 0.01 && modelPatched.unitPriceOut === 0.02 && modelPatched.currency === "USD", `model price precise API readback (got in=${modelPatched.unitPriceIn} out=${modelPatched.unitPriceOut} ${modelPatched.currency})`)
  // Re-GET list and confirm same numbers (precise readback, not client Number alone).
  const modelsAfterPrice = await (await fetch(`${BASE}/api/shipping/llm/models`)).json().catch(() => ({ items: [] }))
  const priceRow = (modelsAfterPrice.items || []).find(m => m.id === model.id)
  check(priceRow?.unitPriceIn === 0.01 && priceRow?.unitPriceOut === 0.02 && priceRow?.currency === "USD", `GET models list matches PATCH readback (got ${JSON.stringify(priceRow && { in: priceRow.unitPriceIn, out: priceRow.unitPriceOut, currency: priceRow.currency })})`)

  const bindRes = await fetch(`${BASE}/api/shipping/llm/bindings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "extract", modelId: model.id, updatedBy: "e2e-r3-1-settings" }),
  })
  check(bindRes.status === 200 || bindRes.status === 201, `PUT binding extract -> ${bindRes.status}`)

  const disableModel = await fetch(`${BASE}/api/shipping/llm/models/${model.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  })
  check(disableModel.status === 200 || disableModel.status === 201, `PATCH disable bound model -> ${disableModel.status}`)

  const delBlockedModel = await fetch(`${BASE}/api/shipping/llm/models/${model.id}`, { method: "DELETE" })
  const delBlockedModelBody = await delBlockedModel.json().catch(() => ({}))
  check(delBlockedModel.status === 409, `DELETE bound model blocked -> ${delBlockedModel.status}`)
  check(JSON.stringify(delBlockedModelBody).includes("model_in_use"), "blocked delete code model_in_use")
  const delBlockedProvider = await fetch(`${BASE}/api/shipping/llm/providers/${provider.id}`, { method: "DELETE" })
  const delBlockedProviderBody = await delBlockedProvider.json().catch(() => ({}))
  check(delBlockedProvider.status === 409, `DELETE provider with bound model blocked -> ${delBlockedProvider.status}`)
  check(JSON.stringify(delBlockedProviderBody).includes("provider_in_use"), "blocked delete code provider_in_use")

  const rebind = await fetch(`${BASE}/api/shipping/llm/bindings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "extract", modelId: modelB.id, updatedBy: "e2e-r3-1-settings" }),
  })
  check(rebind.status === 200 || rebind.status === 201, `PUT rebind extract -> modelB -> ${rebind.status}`)
  await fetch(`${BASE}/api/shipping/llm/models/${model.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  })
  const delModel = await fetch(`${BASE}/api/shipping/llm/models/${model.id}`, { method: "DELETE" })
  check(delModel.status === 200 || delModel.status === 201, `DELETE unbound test model -> ${delModel.status}`)
  const model2Res = await fetch(`${BASE}/api/shipping/llm/models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId: provider.id,
      modelName: "mock-chat-fixture-ui",
      purpose: "chat",
      unitPriceIn: 0.001,
      unitPriceOut: 0.002,
      currency: "USD",
    }),
  })
  const model2 = await model2Res.json().catch(() => ({}))
  check(model2Res.status === 200 || model2Res.status === 201, `recreate UI model -> ${model2Res.status}`, { modelId: model2.id })
  evidence.api.modelUi = { status: model2Res.status, id: model2.id }
  await fetch(`${BASE}/api/shipping/llm/providers/${provider.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "R3-1 Settings Accept Mock" }),
  })
  const modelForConn = model2
  evidence.api.managePrelude = { ok: true }

  const testApi = await fetch(`${BASE}/api/shipping/llm/test-connection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, modelId: modelForConn.id }),
  })
  const testBody = await testApi.json().catch(() => ({}))
  evidence.api.testConnection = { status: testApi.status, body: testBody }
  check(testBody.kind === "test_result", `API test-connection kind=test_result (got ${testBody.kind})`)
  check(testBody.transport === "test_fixture_mock", `API transport=test_fixture_mock (got ${testBody.transport})`)
  check(typeof testBody.note === "string" && testBody.note.includes("测试结果"), "API note labelled 测试结果")
  check(typeof testBody.note === "string" && (testBody.note.includes("不是真实") || testBody.note.includes("mock")), "API note denies real connection")

  const liveAttempt = await fetch(`${BASE}/api/shipping/llm/test-connection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, modelId: modelForConn.id, live: true }),
  })
  check(liveAttempt.status === 400, `live transport refused -> ${liveAttempt.status}`)

  const local = new URL(BASE)
  const externalRequests = []
  profile = mkdtempSync(join(tmpdir(), "shipping-hot-r31-settings-"))
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

  await navigate("/settings")
  await waitFor(async () => {
    const text = await evaluate("document.body?.innerText ?? ''")
    return (text.includes("测试连接") || text.includes("LLM") || text.includes("服务商")) ? true : undefined
  }, 20000)

  const bodyText = await evaluate("document.body?.innerText ?? ''")
  check(bodyText.includes("测试连接（mock）") || bodyText.includes("测试连接"), "settings UI shows 测试连接（mock）")
  check(
    bodyText.includes("测试结果") || bodyText.includes("不是真实服务商已连接") || bodyText.includes("mock"),
    "settings UI copy mentions 测试结果 / mock / not-real",
  )
  check(bodyText.includes("不是真实服务商已连接") || bodyText.includes("不能当作真实"), "settings UI denies real connected claim")
  check(bodyText.includes("LLM") || bodyText.includes("服务商") || bodyText.includes("模型"), "settings UI shows LLM registry panel")
  check(bodyText.includes("共享 LLM 总池") || bodyText.includes("shared"), "settings UI shows shared LLM pool panel copy")

  const sharedUi = await evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const q = (sel) => document.querySelector(sel);
    const setNative = (el, value) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (proto && proto.set) proto.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const out = { panel: !!q('[data-testid="shared-llm-budget-panel"]') };
    if (!out.panel) return out;
    const input = q('[data-testid="shared-llm-budget-input"]');
    const currency = q('[data-testid="shared-llm-budget-currency"]');
    const save = q('[data-testid="shared-llm-budget-save"]');
    out.hasControls = !!(input && currency && save);
    if (input) { input.focus(); setNative(input, '4.5'); }
    if (currency) { currency.focus(); setNative(currency, 'USD'); }
    if (save) save.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const msg = q('[data-testid="shared-llm-budget-message"]')?.textContent || '';
      const status = q('[data-testid="shared-llm-budget-status"]')?.textContent || '';
      if (msg.includes('已保存') && (msg.includes('4.5') || status.includes('4.5'))) {
        out.message = msg; out.statusText = status; out.savedOk = true; return out;
      }
    }
    out.message = q('[data-testid="shared-llm-budget-message"]')?.textContent || '';
    out.statusText = q('[data-testid="shared-llm-budget-status"]')?.textContent || '';
    out.savedOk = (out.message.includes('已保存') && (out.message.includes('4.5') || out.statusText.includes('4.5')));
    return out;
  })()`, true)
  evidence.uiSharedBudget = sharedUi
  check(sharedUi?.panel === true, `UI shared pool panel present (got ${JSON.stringify(sharedUi)})`)
  check(sharedUi?.hasControls === true, "UI shared pool has input/currency/save")
  check(sharedUi?.savedOk === true, `UI shared pool save + status (got ${JSON.stringify(sharedUi)})`)
  const sharedAfterUi = await (await fetch(`${BASE}/api/shipping/llm/shared-budget`)).json().catch(() => ({}))
  check(sharedAfterUi.configured === true && Number(sharedAfterUi.monthlyBudget) === 4.5 && sharedAfterUi.currency === "USD", `GET shared-budget matches UI save (got ${JSON.stringify(sharedAfterUi)})`)

  const clickResult = await evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find(b => (b.textContent || "").includes("测试连接"));
    if (!btn) return { clicked: false, reason: "button_missing" };
    btn.click();
    return { clicked: true, label: (btn.textContent || "").trim() };
  })()`)
  evidence.uiClick = clickResult
  if (clickResult?.clicked) {
    await waitFor(async () => {
      const t = await evaluate("document.body?.innerText ?? ''")
      return t.includes("测试结果") ? true : undefined
    }, 15000)
    const after = await evaluate("document.body?.innerText ?? ''")
    check(after.includes("测试结果"), "after UI click, page shows 测试结果")
    check(after.includes("mock") || after.includes("不是真实"), "after UI click, result labelled mock / not-real")
    check(!after.includes("真实已连接"), "after UI click, no 真实已连接 claim")
  } else {
    check(false, `UI 测试连接 button present (got ${JSON.stringify(clickResult)})`)
  }

  // A/a → B/b: switching provider must reset model select; invalid model disables submit.
  await navigate("/settings")
  await waitFor(async () => {
    const text = await evaluate("document.body?.innerText ?? ''")
    return text.includes("测试连接") ? true : undefined
  }, 20000)
  const syncResult = await evaluate(`(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const providerSelect = document.querySelector('[data-testid="llm-test-provider"]');
    const modelSelect = document.querySelector('[data-testid="llm-test-model"]');
    const submit = document.querySelector('[data-testid="llm-test-submit"]');
    if (!providerSelect || !modelSelect || !submit) {
      return { ok: false, reason: "missing_testids", hasProvider: !!providerSelect, hasModel: !!modelSelect, hasSubmit: !!submit };
    }
    const options = Array.from(providerSelect.options).map(o => ({ value: o.value, label: o.textContent }));
    const optA = options.find(o => o.value && o.value !== "r31-browser-b") || options[0];
    const optB = options.find(o => o.value === "r31-browser-b");
    if (!optA || !optB) return { ok: false, reason: "providers_missing", options };
    const setSelect = (el, value) => {
      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
      if (proto && proto.set) proto.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setSelect(providerSelect, optA.value);
    await sleep(350);
    const modelAfterA = modelSelect.value;
    const modelsAfterA = Array.from(modelSelect.options).map(o => o.value);
    setSelect(providerSelect, optB.value);
    await sleep(450);
    const modelAfterB = modelSelect.value;
    const modelsAfterB = Array.from(modelSelect.options).map(o => o.value);
    // Stale cross-provider model id must not remain submittable.
    setSelect(modelSelect, modelAfterA);
    await sleep(350);
    const valueAfterStale = modelSelect.value;
    const submitDisabledWhenStale = submit.disabled === true || valueAfterStale !== modelAfterA;
    if (modelsAfterB[0]) {
      setSelect(modelSelect, modelsAfterB[0]);
      await sleep(150);
    }
    const ok = Boolean(modelAfterB) && modelsAfterB.includes(modelAfterB) && modelAfterB !== modelAfterA;
    return { ok, modelAfterA, modelAfterB, modelsAfterA, modelsAfterB, submitDisabledWhenStale, valueAfterStale, optA: optA.value, optB: optB.value };
  })()`, true)
  evidence.uiProviderModelSync = syncResult
  check(syncResult?.ok === true, `UI A/a→B/b resets testModelId (got ${JSON.stringify(syncResult)})`)
  check(syncResult?.submitDisabledWhenStale === true, "UI blocks submit when model id is stale across providers")

  // --- UI manage path ---
  const countersBeforeBrowse = await readDbCounters()
  evidence.countersBeforeBrowse = countersBeforeBrowse
  await navigate("/settings")
  const providerEditSel = `[data-testid="llm-provider-edit-${provider.id}"]`
  await waitFor(async () => {
    const editReady = await evaluate(`Boolean(document.querySelector(${JSON.stringify(providerEditSel)}))`)
    return editReady ? true : undefined
  }, 20000)

  const manageUi = await evaluate(`(async () => {\n`
    + `    const sleep = (ms) => new Promise(r => setTimeout(r, ms));\n`
    + `    const q = (sel) => document.querySelector(sel);\n`
    + `    const textOf = () => document.body?.innerText ?? '';\n`
    + `    const click = (sel) => { const el = q(sel); if (!el) return false; el.click(); return true; };\n`
    + `    const setInput = (sel, value) => {\n`
    + `      const el = q(sel); if (!el) return false;\n`
    + `      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');\n`
    + `      if (proto && proto.set) proto.set.call(el, value); else el.value = value;\n`
    + `      el.dispatchEvent(new Event('input', { bubbles: true }));\n`
    + `      el.dispatchEvent(new Event('change', { bubbles: true }));\n`
    + `      return true;\n`
    + `    };\n`
    + `    const setSelect = (sel, value) => {\n`
    + `      const el = q(sel); if (!el) return false;\n`
    + `      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');\n`
    + `      if (proto && proto.set) proto.set.call(el, value); else el.value = value;\n`
    + `      el.dispatchEvent(new Event('input', { bubbles: true }));\n`
    + `      el.dispatchEvent(new Event('change', { bubbles: true }));\n`
    + `      return true;\n`
    + `    };\n`
    + `    const out = { steps: [] };\n`
    + `    const providerId = ${JSON.stringify(provider.id)};\n`
    + `    const modelId = ${JSON.stringify(modelForConn.id)};\n`
    + `    const modelBId = ${JSON.stringify(modelB.id)};\n`
    + `    if (!click('[data-testid="llm-provider-edit-' + providerId + '"]')) return { ok: false, reason: 'edit_btn_missing', ...out };\n`
    + `    await sleep(200);\n`
    + `    if (!setInput('[data-testid="llm-provider-edit-name"]', 'R3-1 UI Edited Provider')) return { ok: false, reason: 'edit_name_missing', ...out };\n`
    + `    setInput('[data-testid="llm-provider-edit-apikey"]', '');\n`
    + `    click('[data-testid="llm-provider-edit-save"]');\n`
    + `    await sleep(900);\n`
    + `    out.steps.push('edit_provider');\n`
    + `    const providerRow = q('[data-testid="llm-provider-row-' + providerId + '"]');\n`
    + `    out.afterEditRowText = providerRow ? (providerRow.textContent || '') : '';\n`
    + `    out.editFormClosedAfterSave = !q('[data-testid="llm-provider-edit-form-' + providerId + '"]');\n`
    + `    out.afterEdit = Boolean(providerRow && out.afterEditRowText.includes('R3-1 UI Edited Provider') && out.editFormClosedAfterSave);\n`
    + `    if (!click('[data-testid="llm-provider-edit-' + providerId + '"]')) return { ok: false, reason: 'edit_btn_missing_2', ...out };\n`
    + `    await sleep(200);\n`
    + `    setInput('[data-testid="llm-provider-edit-name"]', 'R3-1 UI Edited Provider');\n`
    + `    setInput('[data-testid="llm-provider-edit-apikey"]', 'y'.repeat(600));\n`
    + `    click('[data-testid="llm-provider-edit-save"]');\n`
    + `    await sleep(1000);\n`
    + `    const afterFail = textOf();\n`
    + `    out.secretFailShowsError = afterFail.includes('secret_too_long') || afterFail.includes('\u66F4\u65B0\u5931\u8D25');\n`
    + `    out.secretFailNoFakeSuccess = !afterFail.includes('\u5BC6\u94A5\u5DF2\u66F4\u6362');\n`
    + `    out.formRetained = !!q('[data-testid="llm-provider-edit-form-' + providerId + '"]');\n`
    + `    const keyInput = q('[data-testid="llm-provider-edit-apikey"]');\n`
    + `    out.secretFieldRetained = keyInput ? String(keyInput.value || '').length === 600 : false;\n`
    + `    out.steps.push('secret_fail');\n`
    + `    click('[data-testid="llm-provider-edit-cancel"]');\n`
    + `    await sleep(200);\n`
    + `    // Model edit form: price / currency / purpose (real form path, not API-only).\n`
    + `    if (!click('[data-testid="llm-model-edit-' + modelId + '"]')) return { ok: false, reason: 'model_edit_btn_missing', ...out };\n`
    + `    await sleep(200);\n`
    + `    setInput('[data-testid="llm-model-edit-name"]', 'mock-chat-fixture-ui-edited');\n`
    + `    setSelect('[data-testid="llm-model-edit-purpose"]', 'chat');\n`
    + `    setInput('[data-testid="llm-model-edit-price-in"]', '0.003');\n`
    + `    setInput('[data-testid="llm-model-edit-price-out"]', '0.004');\n`
    + `    setInput('[data-testid="llm-model-edit-currency"]', 'USD');\n`
    + `    click('[data-testid="llm-model-edit-save"]');\n`
    + `    await sleep(900);\n`
    + `    out.steps.push('edit_model');\n`
    + `    const modelRow = q('[data-testid="llm-model-row-' + modelId + '"]');\n`
    + `    out.modelEditRowText = modelRow ? (modelRow.textContent || '') : '';\n`
    + `    out.modelEditFormClosed = !q('[data-testid="llm-model-edit-form-' + modelId + '"]');\n`
    + `    out.modelEditOk = Boolean(modelRow && out.modelEditRowText.includes('mock-chat-fixture-ui-edited') && out.modelEditRowText.includes('chat') && out.modelEditFormClosed);\n`
    + `    setSelect('[data-testid="llm-binding-step"]', 'extract');\n`
    + `    setSelect('[data-testid="llm-binding-model"]', modelId);\n`
    + `    click('[data-testid="llm-binding-save"]');\n`
    + `    await sleep(900);\n`
    + `    out.steps.push('bind');\n`
    + `    const bindStatusEl = q('[data-testid="llm-binding-status-extract"]');\n`
    + `    out.bindStatusText = bindStatusEl ? (bindStatusEl.textContent || '') : '';\n`
    + `    out.bindOk = Boolean(bindStatusEl && out.bindStatusText.includes(modelId) && out.bindStatusText.includes('\u6709\u6548'));\n`
    + `    if (!click('[data-testid="llm-model-toggle-' + modelId + '"]')) return { ok: false, reason: 'model_toggle_missing', ...out };\n`
    + `    await sleep(800);\n`
    + `    out.steps.push('disable');\n`
    + `    const statusAfterDisable = q('[data-testid="llm-binding-status-extract"]');\n`
    + `    out.disableStatusText = statusAfterDisable ? (statusAfterDisable.textContent || '') : '';\n`
    + `    out.disableVisible = Boolean(out.disableStatusText.includes('\u5931\u6548') || out.disableStatusText.includes('\u5DF2\u7981\u7528'));\n`
    + `    const modelRowDisabled = q('[data-testid="llm-model-row-' + modelId + '"]');\n`
    + `    out.disableRowShowsDisabled = Boolean(modelRowDisabled && (modelRowDisabled.textContent || '').includes('\u5DF2\u7981\u7528'));\n`
    + `    if (!click('[data-testid="llm-model-delete-' + modelId + '"]')) return { ok: false, reason: 'model_delete_missing', ...out };\n`
    + `    await sleep(200);\n`
    + `    out.confirmShown = !!q('[data-testid="llm-delete-confirm"]');\n`
    + `    click('[data-testid="llm-delete-confirm-yes"]');\n`
    + `    await sleep(900);\n`
    + `    out.steps.push('blocked_delete');\n`
    + `    out.blockedMsg = textOf().includes('model_in_use') || textOf().includes('\u53D7\u963B');\n`
    + `    setSelect('[data-testid="llm-binding-step"]', 'extract');\n`
    + `    setSelect('[data-testid="llm-binding-model"]', modelBId);\n`
    + `    click('[data-testid="llm-binding-save"]');\n`
    + `    await sleep(900);\n`
    + `    out.steps.push('rebind');\n`
    + `    click('[data-testid="llm-model-toggle-' + modelId + '"]');\n`
    + `    await sleep(700);\n`
    + `    click('[data-testid="llm-model-delete-' + modelId + '"]');\n`
    + `    await sleep(200);\n`
    + `    click('[data-testid="llm-delete-confirm-yes"]');\n`
    + `    await sleep(900);\n`
    + `    out.steps.push('delete_model');\n`
    + `    out.modelRowGone = !q('[data-testid="llm-model-row-' + modelId + '"]');\n`
    + `    out.modelDeleted = out.modelRowGone || textOf().includes('\u5DF2\u5220\u9664');\n`
    + `    const statusEl = q('[data-testid="llm-binding-status-extract"]');\n`
    + `    out.bindingStatusText = statusEl ? statusEl.textContent : '';\n`
    + `    const body = textOf();\n`
    + `    out.hasConfirmCopy = body.includes('\u786E\u8BA4\u5220\u9664') || out.confirmShown;\n`
    + `    out.hasRetainCopy = body.includes('SecretStore') && (body.includes('\u4FDD\u7559') || body.includes('\u672A\u6E05\u7406') || body.includes('\u4E0D\u4F1A\u6E05\u7406'));\n`
    + `    out.hasMaskCopy = body.includes('\u8131\u654F') || body.includes('\u672A\u914D\u7F6E\u5BC6\u94A5') || body.includes('\u5DF2\u914D\u7F6E');\n`
    + `    out.ok = Boolean(out.afterEdit && out.secretFailShowsError && out.secretFailNoFakeSuccess && out.formRetained && out.secretFieldRetained && out.modelEditOk && out.bindOk && out.disableVisible && out.blockedMsg && out.modelDeleted && out.modelRowGone && out.hasConfirmCopy && out.hasRetainCopy);\n`
    + `    return out;\n`
    + `  })()`, true)
  evidence.uiManage = manageUi
  check(manageUi?.afterEdit === true, `UI edit provider row persisted (got ${JSON.stringify({ afterEdit: manageUi?.afterEdit, row: manageUi?.afterEditRowText, formClosed: manageUi?.editFormClosedAfterSave })})`)
  check(manageUi?.secretFailShowsError === true, "UI secret failure shows real error")
  check(manageUi?.secretFailNoFakeSuccess === true, "UI secret failure has no fake success")
  check(manageUi?.formRetained === true, "UI secret failure retains edit form")
  check(manageUi?.secretFieldRetained === true, `UI secret failure retains overlong field value (got ${JSON.stringify(manageUi?.secretFieldRetained)})`)
  check(manageUi?.modelEditOk === true, `UI model edit form price/purpose (got ${JSON.stringify({ ok: manageUi?.modelEditOk, row: manageUi?.modelEditRowText })})`)
  check(manageUi?.bindOk === true, `UI bind step status row (got ${JSON.stringify(manageUi?.bindStatusText)})`)
  check(manageUi?.disableVisible === true, `UI disable shows invalid binding status (got ${JSON.stringify(manageUi?.disableStatusText)})`)
  check(manageUi?.disableRowShowsDisabled === true, "UI model row shows 已禁用 after toggle")
  check(manageUi?.blockedMsg === true, "UI blocked delete shows model_in_use / blocked")
  check(manageUi?.confirmShown === true, "UI delete shows explicit confirm")
  check(manageUi?.modelDeleted === true && manageUi?.modelRowGone === true, `UI deletes unbound test model row (got ${JSON.stringify({ deleted: manageUi?.modelDeleted, rowGone: manageUi?.modelRowGone })})`)
  check(manageUi?.hasRetainCopy === true, "UI copy states SecretStore retain semantics")
  check(manageUi?.ok === true, `UI manage flow aggregate ok (got ${JSON.stringify(manageUi)})`)

  // Persist checks vs list GET after manage UI (no GET-by-id routes)
  const getModelsListAfterUi = await (await fetch(`${BASE}/api/shipping/llm/models`)).json().catch(() => ({ items: [] }))
  check(!((getModelsListAfterUi.items || []).some(m => m.id === modelForConn.id)), "API models list excludes deleted modelForConn")
  const editedModelGoneOrAbsent = !((getModelsListAfterUi.items || []).some(m => m.id === modelForConn.id))
  check(editedModelGoneOrAbsent && manageUi?.modelRowGone === true, "deleted model absent in UI row and API list")
  const getBindingsAfterUi = await (await fetch(`${BASE}/api/shipping/llm/bindings`)).json().catch(() => ({ items: [] }))
  const extractBinding = (getBindingsAfterUi.items || []).find(b => b.step === "extract")
  check(extractBinding?.modelId === modelB.id, `GET binding extract persists modelB (got ${JSON.stringify(extractBinding)})`)
  check(
    typeof manageUi?.bindingStatusText === "string"
    && manageUi.bindingStatusText.includes(modelB.id)
    && manageUi.bindingStatusText.includes("\u6709\u6548"),
    `binding status text matches GET (got ${JSON.stringify(manageUi?.bindingStatusText)})`,
  )
  const getProvidersAfterEdit = await (await fetch(`${BASE}/api/shipping/llm/providers`)).json().catch(() => ({ items: [] }))
  const providerAfterEdit = (getProvidersAfterEdit.items || []).find(p => p.id === provider.id)
  check(providerAfterEdit?.name === "R3-1 UI Edited Provider", `GET providers list name matches UI edit (got ${JSON.stringify(providerAfterEdit?.name)})`)
  const modelForConnEdited = (getModelsListAfterUi.items || []).find(m => m.id === modelForConn.id)
  // modelForConn deleted above; price/purpose edit verified via modelEditOk row text before delete.
  void modelForConnEdited

  // Purpose mismatch: edit bound modelB chat -> embedding via form; status must invalidate; restore.
  const purposeUi = await evaluate(`(async () => {\n`
    + `    const sleep = (ms) => new Promise(r => setTimeout(r, ms));\n`
    + `    const q = (sel) => document.querySelector(sel);\n`
    + `    const click = (sel) => { const el = q(sel); if (!el) return false; el.click(); return true; };\n`
    + `    const setSelect = (sel, value) => {\n`
    + `      const el = q(sel); if (!el) return false;\n`
    + `      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');\n`
    + `      if (proto && proto.set) proto.set.call(el, value); else el.value = value;\n`
    + `      el.dispatchEvent(new Event('input', { bubbles: true }));\n`
    + `      el.dispatchEvent(new Event('change', { bubbles: true }));\n`
    + `      return true;\n`
    + `    };\n`
    + `    const out = {};\n`
    + `    const modelBId = ${JSON.stringify(modelB.id)};\n`
    + `    if (!click('[data-testid="llm-model-edit-' + modelBId + '"]')) return { ok: false, reason: 'edit_missing' };\n`
    + `    await sleep(200);\n`
    + `    if (!setSelect('[data-testid="llm-model-edit-purpose"]', 'embedding')) return { ok: false, reason: 'purpose_select_missing' };\n`
    + `    click('[data-testid="llm-model-edit-save"]');\n`
    + `    await sleep(1000);\n`
    + `    const statusEl = q('[data-testid="llm-binding-status-extract"]');\n`
    + `    out.statusAfterMismatch = statusEl ? (statusEl.textContent || '') : '';\n`
    + `    out.mismatchInvalid = out.statusAfterMismatch.includes('\u5931\u6548') && out.statusAfterMismatch.includes('\u7528\u9014');\n`
    + `    if (!click('[data-testid="llm-model-edit-' + modelBId + '"]')) return { ...out, ok: false, reason: 'edit_missing_restore' };\n`
    + `    await sleep(200);\n`
    + `    setSelect('[data-testid="llm-model-edit-purpose"]', 'chat');\n`
    + `    click('[data-testid="llm-model-edit-save"]');\n`
    + `    await sleep(1000);\n`
    + `    const statusRestore = q('[data-testid="llm-binding-status-extract"]');\n`
    + `    out.statusAfterRestore = statusRestore ? (statusRestore.textContent || '') : '';\n`
    + `    out.restoredValid = out.statusAfterRestore.includes('\u6709\u6548') && !out.statusAfterRestore.includes('\u5931\u6548');\n`
    + `    out.ok = Boolean(out.mismatchInvalid && out.restoredValid);\n`
    + `    return out;\n`
    + `  })()`, true)
  evidence.uiPurpose = purposeUi
  check(purposeUi?.mismatchInvalid === true, `UI purpose mismatch invalidates extract (got ${JSON.stringify(purposeUi)})`)
  check(purposeUi?.restoredValid === true, `UI purpose restore returns 有效 (got ${JSON.stringify(purposeUi?.statusAfterRestore)})`)
  const modelsAfterPurpose = await (await fetch(`${BASE}/api/shipping/llm/models`)).json().catch(() => ({ items: [] }))
  const modelBPurposeGet = (modelsAfterPurpose.items || []).find(m => m.id === modelB.id)
  check(modelBPurposeGet?.purpose === "chat", `GET modelB purpose restored chat (got ${JSON.stringify(modelBPurposeGet?.purpose)})`)

  // Delete currently selected provider A without page refresh; then create+test under B.
  const deleteProviderUi = await evaluate(`(async () => {\n`
    + `    const sleep = (ms) => new Promise(r => setTimeout(r, ms));\n`
    + `    const q = (sel) => document.querySelector(sel);\n`
    + `    const click = (sel) => { const el = q(sel); if (!el) return false; el.click(); return true; };\n`
    + `    const setInput = (sel, value) => {\n`
    + `      const el = q(sel); if (!el) return false;\n`
    + `      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');\n`
    + `      if (proto && proto.set) proto.set.call(el, value); else el.value = value;\n`
    + `      el.dispatchEvent(new Event('input', { bubbles: true }));\n`
    + `      el.dispatchEvent(new Event('change', { bubbles: true }));\n`
    + `      return true;\n`
    + `    };\n`
    + `    const setSelect = (sel, value) => {\n`
    + `      const el = q(sel); if (!el) return false;\n`
    + `      const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');\n`
    + `      if (proto && proto.set) proto.set.call(el, value); else el.value = value;\n`
    + `      el.dispatchEvent(new Event('input', { bubbles: true }));\n`
    + `      el.dispatchEvent(new Event('change', { bubbles: true }));\n`
    + `      return true;\n`
    + `    };\n`
    + `    const out = {};\n`
    + `    const providerA = ${JSON.stringify(provider.id)};\n`
    + `    const providerB = ${JSON.stringify(providerB.id)};\n`
    + `    const modelBId = ${JSON.stringify(modelB.id)};\n`
    + `    // Select A in create + test dropdowns so stale A is the current selection.\n`
    + `    setSelect('[data-testid="llm-model-create-provider"]', providerA);\n`
    + `    setSelect('[data-testid="llm-test-provider"]', providerA);\n`
    + `    await sleep(300);\n`
    + `    out.createProviderBefore = q('[data-testid="llm-model-create-provider"]')?.value || '';\n`
    + `    out.testProviderBefore = q('[data-testid="llm-test-provider"]')?.value || '';\n`
    + `    if (!click('[data-testid="llm-provider-delete-' + providerA + '"]')) return { ok: false, reason: 'delete_btn_missing', ...out };\n`
    + `    await sleep(200);\n`
    + `    out.confirmShown = !!q('[data-testid="llm-delete-confirm"]');\n`
    + `    click('[data-testid="llm-delete-confirm-yes"]');\n`
    + `    await sleep(1100);\n`
    + `    out.providerRowGone = !q('[data-testid="llm-provider-row-' + providerA + '"]');\n`
    + `    const createSel = q('[data-testid="llm-model-create-provider"]');\n`
    + `    const testSel = q('[data-testid="llm-test-provider"]');\n`
    + `    out.createProviderAfter = createSel ? createSel.value : '';\n`
    + `    out.testProviderAfter = testSel ? testSel.value : '';\n`
    + `    out.createOptions = createSel ? Array.from(createSel.options).map(o => o.value) : [];\n`
    + `    out.testOptions = testSel ? Array.from(testSel.options).map(o => o.value) : [];\n`
    + `    out.noGhostCreateA = out.createProviderAfter !== providerA && !out.createOptions.includes(providerA);\n`
    + `    out.noGhostTestA = out.testProviderAfter !== providerA && !out.testOptions.includes(providerA);\n`
    + `    // Without page refresh: create model under B and run mock test with B/modelB.\n`
    + `    setSelect('[data-testid="llm-model-create-provider"]', providerB);\n`
    + `    await sleep(200);\n`
    + `    setInput('[data-testid="llm-model-create-name"]', 'mock-after-delete-a');\n`
    + `    setSelect('[data-testid="llm-model-create-purpose"]', 'chat');\n`
    + `    setInput('[data-testid="llm-model-create-price-in"]', '0.001');\n`
    + `    setInput('[data-testid="llm-model-create-price-out"]', '0.002');\n`
    + `    setInput('[data-testid="llm-model-create-currency"]', 'USD');\n`
    + `    const createSubmit = q('[data-testid="llm-model-create-submit"]');\n`
    + `    out.createSubmitEnabled = createSubmit ? createSubmit.disabled === false : false;\n`
    + `    click('[data-testid="llm-model-create-submit"]');\n`
    + `    await sleep(1100);\n`
    + `    out.createAction = (q('[data-testid="llm-action-message"]')?.textContent || '');\n`
    + `    out.createdUnderB = out.createAction.includes('\u5DF2\u4FDD\u5B58') || !!Array.from(document.querySelectorAll('[data-testid^="llm-model-row-"]')).find(el => (el.textContent || '').includes('mock-after-delete-a'));\n`
    + `    setSelect('[data-testid="llm-test-provider"]', providerB);\n`
    + `    await sleep(350);\n`
    + `    setSelect('[data-testid="llm-test-model"]', modelBId);\n`
    + `    await sleep(200);\n`
    + `    const testSubmit = q('[data-testid="llm-test-submit"]');\n`
    + `    out.testSubmitEnabled = testSubmit ? testSubmit.disabled === false : false;\n`
    + `    click('[data-testid="llm-test-submit"]');\n`
    + `    await sleep(1200);\n`
    + `    out.testMessage = q('[data-testid="llm-test-message"]')?.textContent || '';\n`
    + `    out.testOk = out.testMessage.includes('\u6D4B\u8BD5\u7ED3\u679C') || out.testMessage.includes('mock');\n`
    + `    out.ok = Boolean(out.providerRowGone && out.noGhostCreateA && out.noGhostTestA && out.createdUnderB && out.testOk && out.testSubmitEnabled);\n`
    + `    return out;\n`
    + `  })()`, true)
  evidence.uiDeleteProvider = deleteProviderUi
  check(deleteProviderUi?.providerRowGone === true, `UI provider A row gone after delete (got ${JSON.stringify(deleteProviderUi?.providerRowGone)})`)
  check(deleteProviderUi?.noGhostCreateA === true, `create provider select cleared of A (got ${JSON.stringify({ after: deleteProviderUi?.createProviderAfter, options: deleteProviderUi?.createOptions })})`)
  check(deleteProviderUi?.noGhostTestA === true, `test provider select cleared of A (got ${JSON.stringify({ after: deleteProviderUi?.testProviderAfter, options: deleteProviderUi?.testOptions })})`)
  check(deleteProviderUi?.createdUnderB === true, `create model under B without refresh (got ${JSON.stringify(deleteProviderUi?.createAction)})`)
  check(deleteProviderUi?.testOk === true, `mock test under B without refresh (got ${JSON.stringify(deleteProviderUi?.testMessage)})`)
  check(deleteProviderUi?.ok === true, `delete-A then B create/test aggregate (got ${JSON.stringify(deleteProviderUi)})`)

  const providersAfterDelete = await (await fetch(`${BASE}/api/shipping/llm/providers`)).json().catch(() => ({ items: [] }))
  check(!((providersAfterDelete.items || []).some(p => p.id === provider.id)), "API providers list excludes deleted A")
  const modelsAfterDelete = await (await fetch(`${BASE}/api/shipping/llm/models`)).json().catch(() => ({ items: [] }))
  check(!((modelsAfterDelete.items || []).some(m => m.providerId === provider.id)), "API models list has no orphan rows under deleted A")
  const createdUnderB = (modelsAfterDelete.items || []).find(m => m.modelName === "mock-after-delete-a")
  check(createdUnderB?.providerId === providerB.id, `API created model belongs to B (got ${JSON.stringify(createdUnderB)})`)

  // Settings browse + refresh: receipt/usage must stay flat across real UI navigations (not only three GETs).
  // Capture AFTER any mock test-connection so this window isolates browse/refresh itself.
  const countersBeforeRefresh = await readDbCounters()
  evidence.countersBeforeBrowse = countersBeforeBrowse
  evidence.countersBeforeRefresh = countersBeforeRefresh
  await navigate("/settings")
  await waitFor(async () => {
    const text = await evaluate("document.body?.innerText ?? ''")
    return text.includes("\u6D4B\u8BD5\u8FDE\u63A5") ? true : undefined
  }, 20000)
  await navigate("/settings")
  await waitFor(async () => {
    const text = await evaluate("document.body?.innerText ?? ''")
    return text.includes("\u6D4B\u8BD5\u8FDE\u63A5") ? true : undefined
  }, 20000)
  const countersAfterBrowse = await readDbCounters()
  evidence.countersAfterBrowse = countersAfterBrowse
  check(
    countersAfterBrowse.usage === countersBeforeRefresh.usage
    && countersAfterBrowse.receipts === countersBeforeRefresh.receipts
    && countersAfterBrowse.attempts === countersBeforeRefresh.attempts,
    `Settings browse/refresh: no receipt/usage increment (before=${JSON.stringify(countersBeforeRefresh)} after=${JSON.stringify(countersAfterBrowse)})`,
  )

  const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })
  const shotPath = join(EVIDENCE_DIR, "settings-browser-accept.png")
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
  evidence.screenshots.push(shotPath.replaceAll("\\", "/"))
  check(existsSync(shotPath), `screenshot written`)

  evidence.externalRequests = externalRequests
  check(externalRequests.length === 0, `zero browser egress (got ${externalRequests.length})`)

  evidence.checks = checks
  const failed = checks.filter(c => !c.ok)
  evidence.pass = failed.length === 0
  evidence.failedCount = failed.length
  const outJson = join(EVIDENCE_DIR, "settings-browser-accept.json")
  writeFileSync(outJson, JSON.stringify(evidence, null, 2), "utf8")
  const outLog = join(EVIDENCE_DIR, "settings-browser-accept.log")
  writeFileSync(
    outLog,
    `${checks.map(c => `${c.ok ? "PASS" : "FAIL"}  ${c.label}`).join("\n")}\nRESULT ${evidence.pass ? "PASS" : "FAIL"} failed=${failed.length}\n`,
    "utf8",
  )
  console.log(`RESULT ${evidence.pass ? "PASS" : "FAIL"} failed=${failed.length}`)
  console.log(`evidence: ${outJson}`)
  if (!evidence.pass) process.exitCode = 1
}

main().catch(async (error) => {
  console.error(`SETTINGS BROWSER ERROR: ${error.message}`)
  process.exitCode = 1
}).finally(async () => {
  try {
    await stopServer(server)
  } catch {}
  try {
    if (chromeChild) chromeChild.kill("SIGKILL")
  } catch {}
  try {
    if (profile) rmSync(profile, { recursive: true, force: true })
  } catch {}
})
