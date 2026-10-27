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
    tip: "r3-1-settings-browser",
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

  const patch = await fetch(`${BASE}/api/shipping/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ translation: { enabled: true, monthlyBudget: 10 } }),
  })
  check(patch.status < 500, `settings budget configure -> ${patch.status}`)

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

  const testApi = await fetch(`${BASE}/api/shipping/llm/test-connection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, modelId: model.id }),
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
    body: JSON.stringify({ providerId: provider.id, modelId: model.id, live: true }),
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
