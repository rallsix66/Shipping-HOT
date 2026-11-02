/**
 * R3-1 Label page isolated browser acceptance (§4.9) (CDP).
 * Zero egress; mock test-connection only; never claims real vendor connected.
 * Pattern mirrors scripts/e2e-s7-integrated.mjs (Chrome CDP + production build).
 */
import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_R31_LABEL_DIR ?? join(ROOT, ".tmp", "r3-1-label-browser"))
const EVIDENCE_DIR = resolve(process.env.E2E_R31_EVIDENCE_DIR ?? join(ROOT, ".tmp", "r3-1-llm-registry-20261027", "r3-label-eval-20261102"))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_R31_LABEL_PORT ?? "4491")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R31_LABEL_DEBUG_PORT ?? "9358")
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
    "[]",
    "prompt-fake",
    null,
    "fake-model",
    now,
  )
  db.close()
}

async function main() {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  mkdirSync(join(RUN_DIR, ".data"), { recursive: true })
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true })

  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge; set E2E_CHROME")

  const evidence = {
    tip: "r3-1-label-eval",
    baseUrl: BASE,
    runDir: RUN_DIR.replaceAll("\\", "/"),
    evidenceDir: EVIDENCE_DIR.replaceAll("\\", "/"),
    checks: [],
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
  check(ready?.database?.schemaVersion === 34, `schema v34 after init (got ${ready?.database?.schemaVersion})`)

  await seedLabels()

  const beforeBrowse = await readDbCounters()
  const list0 = await fetch(`${BASE}/api/shipping/intel/labels`)
  const listBody = await list0.json()
  check(list0.status === 200, `GET labels -> ${list0.status}`)
  check(listBody?.coverage?.total === 2, `coverage total=2 (got ${listBody?.coverage?.total})`)
  check(Array.isArray(listBody?.coverage?.missingNotes) && listBody.coverage.missingNotes.length > 0, "coverage reports missingNotes honestly")
  check(listBody.coverage.humanConfirmed === 0, "no human confirmed yet")
  evidence.api.list0 = { total: listBody?.coverage?.total, missing: listBody?.coverage?.missingNotes }

  const detail0 = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_001`)
  const detailBody = await detail0.json()
  check(detail0.status === 200, `GET label detail -> ${detail0.status}`)
  check(detailBody?.aiPrelabel?.isHuman === false, "AI prelabel isHuman=false")
  check(detailBody?.humanDecision == null, "no human decision yet")

  const afterBrowse = await readDbCounters()
  check(
    afterBrowse.usage === beforeBrowse.usage
    && afterBrowse.receipts === beforeBrowse.receipts
    && afterBrowse.attempts === beforeBrowse.attempts,
    `browse labels: zero new receipts (before=${JSON.stringify(beforeBrowse)} after=${JSON.stringify(afterBrowse)})`,
  )

  // Save human label
  const save = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_001/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_correct",
      operator: "e2e.tester",
      expectedContentHash: "hash_e2e_1",
      clientRequestId: "e2e-req-1",
      decision: {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-11-02",
        isOfficialStatement: true,
        notes: "corrected official flag",
      },
    }),
  })
  const saveBody = await save.json().catch(() => ({}))
  check(save.status === 200 || save.status === 201 || saveBody?.isHuman === true, `save human decision -> ${save.status}`)
  check(saveBody?.isHuman === true, "saved decision isHuman")
  evidence.api.save = saveBody

  // duplicate submit
  const save2 = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_001/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_correct",
      operator: "e2e.tester",
      expectedContentHash: "hash_e2e_1",
      clientRequestId: "e2e-req-1",
      decision: saveBody.decision,
    }),
  })
  const save2Body = await save2.json().catch(() => ({}))
  check(save2Body?.id === saveBody?.id, `duplicate submit returns same id (${save2Body?.id})`)

  // version/hash mismatch
  const mismatch = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_001/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_confirm",
      operator: "e2e.tester",
      expectedContentHash: "hash_stale",
      decision: saveBody.decision,
    }),
  })
  check(mismatch.status === 409 || mismatch.status === 400, `stale hash rejected -> ${mismatch.status}`)

  // fake as human rejected
  const fakeHuman = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_confirm",
      operator: "system:ai",
      expectedContentHash: "hash_e2e_2",
      decision: {
        prefilterKeep: false,
        eventType: null,
        countries: [],
        ports: [],
        effectiveFrom: null,
        isOfficialStatement: null,
      },
    }),
  })
  check(fakeHuman.status === 400, `system:ai operator rejected -> ${fakeHuman.status}`)

  const afterSave = await readDbCounters()
  check(
    afterSave.receipts === beforeBrowse.receipts,
    `save labels: still zero new receipts (got ${afterSave.receipts})`,
  )

  // Browser: open /label, confirm page renders, screenshot
  profile = mkdtempSync(join(tmpdir(), "r3-label-chrome-"))
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
      if (!res.ok) return undefined
      return await res.json()
    } catch {
      return undefined
    }
  }, 30000)
  if (!version) throw new Error("Chrome DevTools endpoint not ready")
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = (targets || []).find(t => t.type === "page") || targets?.[0]
  if (!page?.webSocketDebuggerUrl) throw new Error("no CDP page target")
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })
  const cdp = new Cdp(ws)
  await cdp.send("Page.enable")
  await cdp.send("Network.enable")
  const external = []
  cdp.listeners.push((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      const url = msg.params?.request?.url || ""
      if (!url.startsWith(BASE) && !url.startsWith("data:") && !url.startsWith("blob:")) external.push(url)
    }
  })
  await cdp.send("Page.navigate", { url: `${BASE}/label` })
  await waitFor(async () => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('[data-testid=intel-label-page]'))",
      returnByValue: true,
    })
    return result.value ? true : undefined
  }, 30000)
  const hasPage = await cdp.send("Runtime.evaluate", {
    expression: "Boolean(document.querySelector('[data-testid=intel-label-page]'))",
    returnByValue: true,
  })
  check(hasPage.result?.value === true, "label page DOM present")
  const coverageText = await cdp.send("Runtime.evaluate", {
    expression: "document.querySelector('[data-testid=label-coverage]')?.innerText || ''",
    returnByValue: true,
  })
  check(String(coverageText.result?.value || "").includes("合计"), `coverage widget visible (${coverageText.result?.value})`)
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
  const shotPath = join(EVIDENCE_DIR, "label-page.png")
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
  evidence.screenshots.push(shotPath.replaceAll("\\", "/"))
  check(external.length === 0, `no external network from label page (got ${external.length})`)

  // Offline eval against a DB copy (server may hold the live file open)
  const evalDb = join(EVIDENCE_DIR, "label-eval-source.sqlite3")
  copyFileSync(DB_PATH, evalDb)
  const { spawnSync } = await import("node:child_process")
  const evalRun = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", "--experimental-loader", "./scripts/tsx-alias-loader.mjs", "./scripts/intel-eval.ts"],
    {
      cwd: ROOT,
      env: { ...process.env, SHIPPING_DB_PATH: evalDb, INTEL_EVAL_OUT: EVIDENCE_DIR, SHIPPING_DATA_MODE: "real" },
      encoding: "utf8",
    },
  )
  evidence.api.evalStdout = (evalRun.stdout || "").slice(0, 2000)
  evidence.api.evalStderr = (evalRun.stderr || "").slice(0, 2000)
  evidence.api.evalStatus = evalRun.status
  check(evalRun.status === 0, `intel-eval exit ${evalRun.status}`)
  const reportPath = join(EVIDENCE_DIR, "intel-eval-report.json")
  check(existsSync(reportPath), "intel-eval-report.json written")
  if (existsSync(reportPath)) {
    const report = JSON.parse(await (await import("node:fs/promises")).readFile(reportPath, "utf8"))
    check(report.humanLabeled >= 1, `eval humanLabeled>=1 (got ${report.humanLabeled})`)
    check(report.cost?.r3_5 === "BLOCKED" || report.cost?.r3_5 === "NOT_RUN", `R3-5 boundary ${report.cost?.r3_5}`)
    evidence.api.evalReport = { status: report.status, r3_5: report.cost?.r3_5, humanLabeled: report.humanLabeled }
  }

  evidence.checks = checks
  const out = join(EVIDENCE_DIR, "label-browser-evidence.json")
  writeFileSync(out, JSON.stringify(evidence, null, 2))
  const failed = checks.filter(c => !c.ok)
  console.log(`\n${failed.length ? "FAIL" : "PASS"} label browser e2e — ${checks.length - failed.length}/${checks.length}`)
  if (failed.length) {
    for (const f of failed) console.log(" -", f.label)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => {
  try {
    if (chromeChild) chromeChild.kill()
  } catch {}
  try {
    if (server) server.kill()
  } catch {}
})
