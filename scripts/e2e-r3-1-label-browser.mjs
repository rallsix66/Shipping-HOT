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
const EVIDENCE_DIR = resolve(process.env.E2E_R31_EVIDENCE_DIR ?? join(ROOT, ".tmp", "r3-1-llm-registry-20261027", "r3-label-eval-rc3-20261102"))
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
  // R3-8: AI prelabel surfaces only when linked analysis shares one selectable run_id.
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
  check(ready?.database?.schemaVersion === 38, `schema v38 after init (got ${ready?.database?.schemaVersion})`)

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

  async function evalBool(expr) {
    const { result } = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
    return Boolean(result?.value)
  }
  async function evalStr(expr) {
    const { result } = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })
    return String(result?.value ?? "")
  }
  async function evalJson(expr) {
    const raw = await evalStr(expr)
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  // Select first queue item
  await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('[data-testid="label-queue-item-lbl_e2e_001"]');
      if (btn) btn.click();
      return Boolean(btn);
    })()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const t = await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")
    return t.includes("lbl_e2e_001") ? true : undefined
  }, 15000)
  await waitFor(async () => {
    const ready = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-draft-ready') || ''")
    return ready === "1" ? true : undefined
  }, 15000)
  check((await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-draft-ready') || ''")) === "1", "draft ready before first edit")

  const edited = await evalBool(`(() => {
    const op = document.querySelector('[data-testid=label-operator]');
    const notes = document.querySelector('[data-testid=label-notes]');
    const official = document.querySelector('[data-testid=label-official]');
    if (!op || !notes || !official) return false;
    const setNative = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setNative(op, 'e2e.browser');
    setNative(notes, 'browser-correct-notes');
    setNative(official, '1');
    return true;
  })()`)
  check(edited, "browser filled operator/notes/official")
  const dirtyBefore = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') || ''")
  check(dirtyBefore === "1", `dirty after edit (got ${dirtyBefore})`)

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-correct]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const _saving = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-saving') || ''")
    const msg = await evalStr("document.querySelector('[data-testid=label-message]')?.innerText || ''")
    if (msg.includes("已纠正") || msg.includes("已确认") || msg.includes("计为人工")) return true
    void _saving
    // _saving flipped 1→0 without message is still a progress signal; keep polling message
    return undefined
  }, 20000)
  const saveMsg = await evalStr("document.querySelector('[data-testid=label-message]')?.innerText || ''")
  const savingAfter = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-saving') || ''")
  check(saveMsg.includes("已纠正") || saveMsg.includes("已确认") || saveMsg.includes("计为人工"), `UI save message (${saveMsg}) saving=${savingAfter}`)

  const afterUi = await (await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_001`)).json()
  check(afterUi?.humanDecision?.isHuman === true, "GET after UI save has humanDecision")
  check(afterUi?.humanDecision?.decision?.notes === "browser-correct-notes", `GET notes after UI save (notes=${afterUi?.humanDecision?.decision?.notes})`)
  check(afterUi?.humanDecision?.operator === "e2e.browser", `GET operator after UI save (op=${afterUi?.humanDecision?.operator})`)
  check(afterUi?.humanDecision?.decision?.isOfficialStatement === true, `GET official after UI save (official=${afterUi?.humanDecision?.decision?.isOfficialStatement})`)
  check(afterUi?.item?.queueStatus === "human_confirmed", `GET queue human_confirmed (status=${afterUi?.item?.queueStatus})`)
  evidence.api.uiSaveReadback = {
    queueStatus: afterUi?.item?.queueStatus,
    notes: afterUi?.humanDecision?.decision?.notes,
    operator: afterUi?.humanDecision?.operator,
    isOfficialStatement: afterUi?.humanDecision?.decision?.isOfficialStatement,
  }

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-next]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const t = await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")
    return t.includes("lbl_e2e_002") ? true : undefined
  }, 10000)
  check((await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")).includes("lbl_e2e_002"), "next navigates to item 2")
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-prev]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const t = await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")
    return t.includes("lbl_e2e_001") ? true : undefined
  }, 10000)
  check((await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")).includes("lbl_e2e_001"), "prev returns to item 1")

  await evalBool(`(() => {
    const notes = document.querySelector('[data-testid=label-notes]');
    if (!notes) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(notes, 'unsaved-draft-stay');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-next]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))"), "leave confirm shown on dirty next")
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-no]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("!document.querySelector('[data-testid=label-leave-confirm]')")) ? true : undefined
  }, 5000)
  check((await evalStr("document.querySelector('[data-testid=label-notes]')?.value || ''")).includes("unsaved-draft-stay"), "leave-no keeps draft")

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-next]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-yes]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const t = await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")
    return t.includes("lbl_e2e_002") ? true : undefined
  }, 10000)
  check((await evalStr("document.querySelector('[data-testid=label-identity]')?.innerText || ''")).includes("lbl_e2e_002"), "leave-yes proceeds to next")
  await waitFor(async () => {
    const ready = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-draft-ready') || ''")
    const draftItem = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-draft-item') || ''")
    return ready === "1" && draftItem.includes("lbl_e2e_002") ? true : undefined
  }, 10000)
  const notesAfterLeave = await evalStr("document.querySelector('[data-testid=label-notes]')?.value || ''")
  check(!notesAfterLeave.includes("unsaved-draft-stay"), `leave-yes abandoned A draft on B (notes=${notesAfterLeave})`)
  check((await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-draft-ready') || ''")) === "1", "B draft ready after leave-yes")
  check((await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-draft-item') || ''")).includes("lbl_e2e_002"), "draft bound to B after leave-yes")
  // Attempt save on B must not carry A's abandoned notes
  await evalBool(`(() => {
    const op = document.querySelector('[data-testid=label-operator]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(op, 'e2e.after-leave');
    op.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-correct]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const msg = await evalStr("document.querySelector('[data-testid=label-message]')?.innerText || ''")
    return (msg.includes("已纠正") || msg.includes("已确认") || msg.includes("计为人工")) ? true : undefined
  }, 15000)
  const afterLeaveSave = await (await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002`)).json()
  check(afterLeaveSave?.humanDecision?.decision?.notes !== "unsaved-draft-stay", `B save notes not A's draft (notes=${afterLeaveSave?.humanDecision?.decision?.notes})`)
  check(afterLeaveSave?.humanDecision?.operator === "e2e.after-leave", `B save operator (op=${afterLeaveSave?.humanDecision?.operator})`)

  await evalBool(`(() => {
    const notes = document.querySelector('[data-testid=label-notes]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(notes, 'will-cancel');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-cancel]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const dirty = await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') || '0'")
    return dirty === "0" ? true : undefined
  }, 5000)
  check((await evalStr("document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') || ''")) === "0", "cancel clears dirty")

  await evalBool(`(() => {
    const notes = document.querySelector('[data-testid=label-notes]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(notes, 'beforeunload-draft');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  check(await evalBool(`document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') === '1'`), "dirty armed for beforeunload/blocker")

  const failRetry = await evalJson(`(async () => {
    const original = window.fetch.bind(window);
    let sawFail = false;
    window.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : input.url || '');
      if (url.includes('/decision') && init && init.method === 'POST') {
        sawFail = true;
        return new Response(JSON.stringify({ statusMessage: 'content_hash_mismatch' }), { status: 409, headers: { 'content-type': 'application/json' } });
      }
      return original(input, init);
    };
    const op = document.querySelector('[data-testid=label-operator]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(op, 'e2e.retry');
    op.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid=label-correct]')?.click();
    await new Promise(r => setTimeout(r, 800));
    const msg = document.querySelector('[data-testid=label-message]')?.innerText || '';
    const dirty = document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty');
    window.fetch = original;
    return JSON.stringify({ sawFail, msg, dirty });
  })()`)
  check(failRetry?.sawFail === true, "intercepted save failure fired")
  check(String(failRetry?.msg || "").includes("失败") || String(failRetry?.msg || "").includes("mismatch"), `save failure message (msg=${failRetry?.msg})`)
  check(failRetry?.dirty === "1", `save failure keeps dirty (dirty=${failRetry?.dirty})`)
  // Retry success after intercepted failure
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-correct]')?.click()`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const msg = await evalStr("document.querySelector('[data-testid=label-message]')?.innerText || ''")
    return (msg.includes("已纠正") || msg.includes("已确认") || msg.includes("计为人工")) ? true : undefined
  }, 15000)
  const afterRetry = await (await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002`)).json()
  check(afterRetry?.humanDecision?.operator === "e2e.retry", `retry save operator (op=${afterRetry?.humanDecision?.operator})`)
  check(afterRetry?.item?.queueStatus === "human_confirmed", "retry save confirms queue")

  const slowGuard = await evalJson(`(async () => {
    const original = window.fetch.bind(window);
    let release;
    const gate = new Promise(r => { release = r; });
    window.fetch = async (input, init) => {
      const url = String(typeof input === 'string' ? input : input.url || '');
      if (url.includes('/decision') && init && init.method === 'POST') {
        await gate;
        return original(input, init);
      }
      return original(input, init);
    };
    const notes = document.querySelector('[data-testid=label-notes]');
    const nset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    const op = document.querySelector('[data-testid=label-operator]');
    const oset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    oset?.call(op, 'e2e.slow');
    op.dispatchEvent(new Event('input', { bubbles: true }));
    nset?.call(notes, 'slow-save-v1');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid=label-correct]')?.click();
    await new Promise(r => setTimeout(r, 200));
    nset?.call(notes, 'slow-save-v2-during-flight');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    const midDirty = document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty');
    const midSaving = document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-saving');
    const midCorrectDisabled = document.querySelector('[data-testid=label-correct]')?.disabled === true;
    const midConfirmDisabled = document.querySelector('[data-testid=label-confirm]')?.disabled === true;
    release();
    await new Promise(r => setTimeout(r, 1200));
    window.fetch = original;
    const afterNotes = document.querySelector('[data-testid=label-notes]')?.value || '';
    const afterDirty = document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty');
    const afterSaving = document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-saving');
    return JSON.stringify({ midDirty, midSaving, midCorrectDisabled, midConfirmDisabled, afterNotes, afterDirty, afterSaving });
  })()`)
  check(slowGuard?.midSaving === "1", `saving flag during slow save (midSaving=${slowGuard?.midSaving})`)
  check(slowGuard?.midCorrectDisabled === true && slowGuard?.midConfirmDisabled === true, `controls disabled while saving (correct=${slowGuard?.midCorrectDisabled} confirm=${slowGuard?.midConfirmDisabled})`)
  check(String(slowGuard?.afterNotes || "") === "slow-save-v1", `slow-save final notes from in-flight snapshot (${slowGuard?.afterNotes})`)
  check(slowGuard?.afterSaving === "0", `saving cleared after slow save (afterSaving=${slowGuard?.afterSaving})`)

  // Real Shell TanStack Link SPA leave + history.back — no temp <a>, no OR/conditional skip PASS.
  await evalBool(`(() => {
    const notes = document.querySelector('[data-testid=label-notes]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(notes, 'spa-shell-draft');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  check(await evalBool(`document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') === '1'`), "dirty before Shell nav leave")
  check(await evalBool(`Boolean(document.querySelector('[data-testid=shell-nav-home]'))`), "Shell home Link present")

  const pathBeforeShell = await evalStr(`location.pathname`)
  check(String(pathBeforeShell).includes("label"), `on label route before Shell click (path=${pathBeforeShell})`)

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-home]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))"), "Shell Link dirty nav MUST show leave confirm")
  check(await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))"), "Shell Link blocked: still on label page")
  check((await evalStr("location.pathname")).includes("label"), "Shell Link blocked: URL still /label")
  check((await evalStr("document.querySelector('[data-testid=label-notes]')?.value || ''")).includes("spa-shell-draft"), "Shell Link blocked: draft retained")

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-no]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("!document.querySelector('[data-testid=label-leave-confirm]')")) ? true : undefined
  }, 5000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))"), "leave-no stays on label")
  check((await evalStr("location.pathname")).includes("label"), "leave-no URL still /label")
  check((await evalStr("document.querySelector('[data-testid=label-notes]')?.value || ''")).includes("spa-shell-draft"), "leave-no keeps draft")

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-home]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))"), "second Shell click shows confirm again")
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-yes]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const left = await evalBool("!document.querySelector('[data-testid=intel-label-page]')")
    const path = await evalStr("location.pathname")
    return left && (path === "/" || path === "") ? true : undefined
  }, 10000)
  check(await evalBool("!document.querySelector('[data-testid=intel-label-page]')"), "leave-yes left label page")
  const homePath = await evalStr("location.pathname")
  check(homePath === "/" || homePath === "", `leave-yes reached home URL (got ${homePath})`)

  // R3-8: leave-yes must preserve target search + hash via test harness link (not a permanent Shell e2e Link)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-label]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))")) ? true : undefined
  }, 15000)
  check(await evalBool("!document.querySelector('[data-testid=shell-nav-policies-query-hash]')"), "production Shell has no hidden policies-query-hash Link")
  await evalBool(`(() => {
    const link = document.querySelector('[data-testid=shell-nav-policies]');
    if (!link) return false;
    link.setAttribute('data-e2e-href-backup', link.getAttribute('href') || '/policies');
    link.setAttribute('href', '/policies?country=VN#r38-keep');
    link.setAttribute('data-e2e-policies-query-hash', '1');
    const notes = document.querySelector('[data-testid=label-notes]');
    const op = document.querySelector('[data-testid=label-operator]');
    const nset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    const oset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    oset?.call(op, 'e2e.hash');
    op.dispatchEvent(new Event('input', { bubbles: true }));
    nset?.call(notes, 'search-hash-draft');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  check(await evalBool(`document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') === '1'`), "dirty before search/hash leave")
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-policies]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))"), "search/hash Link dirty nav shows leave confirm")
  const leaveHref = await evalStr("document.querySelector('[data-testid=label-leave-confirm]')?.getAttribute('data-leave-href') || ''")
  check(leaveHref.includes("policies") && leaveHref.includes("country") && leaveHref.includes("r38-keep"), `leave confirm data-leave-href keeps search/hash (got ${leaveHref})`)
  await evalBool(`(() => {
    const link = document.querySelector('[data-testid=shell-nav-policies]');
    const backup = link?.getAttribute('data-e2e-href-backup');
    if (link && backup) link.setAttribute('href', backup);
    link?.removeAttribute('data-e2e-policies-query-hash');
    return true;
  })()`)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-yes]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const path = await evalStr("location.pathname")
    const search = await evalStr("location.search")
    const hash = await evalStr("location.hash")
    return String(path).includes("policies") && String(search).includes("country") && String(hash).includes("r38-keep") ? true : undefined
  }, 10000)
  const afterPath = await evalStr("location.pathname")
  const afterSearch = await evalStr("location.search")
  const afterHash = await evalStr("location.hash")
  check(String(afterPath).includes("policies"), `leave-yes reached policies (got ${afterPath})`)
  check(String(afterSearch).includes("country"), `leave-yes kept search (got ${afterSearch})`)
  check(String(afterHash).includes("r38-keep"), `leave-yes kept hash (got ${afterHash})`)

  // R3-8: leave-no (留下) must clear intended href so a later Back does not reuse prior hash target
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-label]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))")) ? true : undefined
  }, 15000)
  await evalBool(`(() => {
    const link = document.querySelector('[data-testid=shell-nav-policies]');
    if (!link) return false;
    link.setAttribute('data-e2e-href-backup', link.getAttribute('data-e2e-href-backup') || link.getAttribute('href') || '/policies');
    link.setAttribute('href', '/policies?country=VN#r38-stale');
    link.setAttribute('data-e2e-policies-query-hash', '1');
    const notes = document.querySelector('[data-testid=label-notes]');
    const op = document.querySelector('[data-testid=label-operator]');
    const nset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    const oset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    oset?.call(op, 'e2e.stale');
    op.dispatchEvent(new Event('input', { bubbles: true }));
    nset?.call(notes, 'stale-hash-draft');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-policies]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  const staleHref = await evalStr("document.querySelector('[data-testid=label-leave-confirm]')?.getAttribute('data-leave-href') || ''")
  check(staleHref.includes("r38-stale"), `stale leave href captured (got ${staleHref})`)
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-no]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("!document.querySelector('[data-testid=label-leave-confirm]')")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))"), "leave-no stays on label")
  await evalBool(`(() => {
    const link = document.querySelector('[data-testid=shell-nav-policies]');
    const backup = link?.getAttribute('data-e2e-href-backup');
    if (link && backup) link.setAttribute('href', backup);
    link?.removeAttribute('data-e2e-policies-query-hash');
    link?.removeAttribute('data-e2e-href-backup');
    return true;
  })()`)
  check(await evalBool("!document.querySelector('[data-testid=label-leave-confirm]')?.getAttribute('data-leave-href')"), "leave-no cleared pending leave href")

  // Real route history: home → label (Shell Link), dirty, history.back stay + leave
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=shell-nav-label]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))")) ? true : undefined
  }, 15000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))"), "Shell label Link navigated to label")

  await evalBool(`(() => {
    const notes = document.querySelector('[data-testid=label-notes]');
    const op = document.querySelector('[data-testid=label-operator]');
    const nset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    const oset = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    oset?.call(op, 'e2e.back');
    op.dispatchEvent(new Event('input', { bubbles: true }));
    nset?.call(notes, 'history-back-draft');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  check(await evalBool(`document.querySelector('[data-testid=intel-label-page]')?.getAttribute('data-dirty') === '1'`), "dirty before history.back")

  await cdp.send("Runtime.evaluate", {
    expression: `history.back(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))"), "history.back dirty MUST show leave confirm (no OR skip)")
  // Product cancels POP immediately so address bar returns to /label while confirm is up.
  await waitFor(async () => {
    const path = await evalStr("location.pathname")
    return String(path).includes("label") ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))"), "history.back blocked: still on label")
  check((await evalStr("location.pathname")).includes("label"), "history.back blocked: URL still /label")
  check((await evalStr("document.querySelector('[data-testid=label-notes]')?.value || ''")).includes("history-back-draft"), "history.back blocked: draft retained")

  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-no]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("!document.querySelector('[data-testid=label-leave-confirm]')")) ? true : undefined
  }, 5000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=intel-label-page]'))"), "Back leave-no stays on label")
  check((await evalStr("document.querySelector('[data-testid=label-notes]')?.value || ''")).includes("history-back-draft"), "Back leave-no keeps draft")
  check((await evalStr("location.pathname")).includes("label"), "Back leave-no URL still /label")

  await cdp.send("Runtime.evaluate", {
    expression: `history.back(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    return (await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))")) ? true : undefined
  }, 8000)
  check(await evalBool("Boolean(document.querySelector('[data-testid=label-leave-confirm]'))"), "second history.back shows confirm")
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=label-leave-yes]')?.click(); 'ok'`,
    returnByValue: true,
  })
  await waitFor(async () => {
    const left = await evalBool("!document.querySelector('[data-testid=intel-label-page]')")
    const path = await evalStr("location.pathname")
    return left && !String(path).includes("label") ? true : undefined
  }, 10000)
  check(await evalBool("!document.querySelector('[data-testid=intel-label-page]')"), "Back leave-yes left label")
  const afterBackPath = await evalStr("location.pathname")
  check(!String(afterBackPath).includes("label"), `Back leave-yes left label URL (got ${afterBackPath})`)

  const aba1 = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_correct",
      operator: "e2e.aba",
      expectedContentHash: "hash_e2e_2",
      clientRequestId: "aba-A",
      decision: { prefilterKeep: true, eventType: "weather_hazard", countries: ["VN"], ports: [], effectiveFrom: null, isOfficialStatement: false, notes: "A" },
    }),
  })
  const aba1Body = await aba1.json().catch(() => ({}))
  const aba2 = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_correct",
      operator: "e2e.aba",
      expectedContentHash: "hash_e2e_2",
      clientRequestId: "aba-B",
      decision: { prefilterKeep: false, eventType: null, countries: [], ports: [], effectiveFrom: null, isOfficialStatement: null, notes: "B" },
    }),
  })
  const aba2Body = await aba2.json().catch(() => ({}))
  const aba3 = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_correct",
      operator: "e2e.aba",
      expectedContentHash: "hash_e2e_2",
      clientRequestId: "aba-A2",
      decision: { prefilterKeep: true, eventType: "weather_hazard", countries: ["VN"], ports: [], effectiveFrom: null, isOfficialStatement: false, notes: "A-again" },
    }),
  })
  const aba3Body = await aba3.json().catch(() => ({}))
  check(aba1Body?.id && aba2Body?.id && aba3Body?.id
    && aba1Body.id !== aba2Body.id
    && aba2Body.id !== aba3Body.id
    && aba1Body.id !== aba3Body.id, `A→B→A three distinct decision ids (${aba1Body?.id},${aba2Body?.id},${aba3Body?.id})`)
  const conflict = await fetch(`${BASE}/api/shipping/intel/labels/lbl_e2e_002/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "human_confirm",
      operator: "e2e.aba",
      expectedContentHash: "hash_e2e_2",
      clientRequestId: "aba-A",
      decision: { prefilterKeep: true, eventType: "weather_hazard", countries: ["VN"], ports: [], effectiveFrom: null, isOfficialStatement: false, notes: "conflict" },
    }),
  })
  check(conflict.status === 409, `request-id conflict → 409 (got ${conflict.status})`)

  const listRedact = await (await fetch(`${BASE}/api/shipping/intel/labels`)).json()
  check(Array.isArray(listRedact?.items) && listRedact.items.every(i => i.excerpt == null), "list redacts excerpts")

  const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
  const shotPath = join(EVIDENCE_DIR, "label-page.png")
  writeFileSync(shotPath, Buffer.from(shot.data, "base64"))
  evidence.screenshots.push(shotPath.replaceAll("\\", "/"))
  const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" })
  const shot2Path = join(EVIDENCE_DIR, "label-page-after-ops.png")
  writeFileSync(shot2Path, Buffer.from(shot2.data, "base64"))
  evidence.screenshots.push(shot2Path.replaceAll("\\", "/"))
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
