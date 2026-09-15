// Targeted S5 acceptance for the provider-free full-text article translation
// read/display path and bilingual reading.
//
// SCOPE (deliberate): this harness exercises reading and display against seeded
// fixture cache rows. It never claims translation work, never calls a Provider,
// and does not exercise the structure guard, the budget guard or hash mismatch —
// those are covered by the server test suites, and real long-article acceptance
// stays BLOCKED (see docs/status.md, A5-03/A5-08). Nothing here is evidence of
// DeepSeek translation quality.
//
// This is the S5 counterpart of scripts/e2e-smoke.mjs: real production Nitro
// build, real Chrome over the DevTools Protocol (no added dependency), an
// isolated SQLite database seeded by scripts/s5-article-browser-seed.ts, and the
// background Runtime switched off so that every Provider/usage/Runtime counter
// delta in the window is attributable to the browsing itself.
//
// Usage:
//   1. node --import tsx/esm --experimental-loader ./scripts/tsx-alias-loader.mjs \
//        ./scripts/s5-article-browser-seed.ts <run-dir>
//   2. node scripts/e2e-s5-article.mjs            (E2E_S5_DIR overrides <run-dir>)
//
// Exit code 0 only when every check passes.
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_S5_DIR ?? join(ROOT, ".tmp", "s5-browser"))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const MANIFEST_PATH = join(RUN_DIR, "s5-article-manifest.json")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_S5_PORT ?? "4455")
const BASE = (process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, "")
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? "9333")

const TRANSLATION_LABELS = {
  complete: "全文翻译完成",
  partial: "部分翻译（全文尚未完成）",
  untranslated: "尚未翻译",
  ineligible: "当前正文不参与翻译",
}
const BLOCK_BADGES = {
  historical: "历史缓存（非当前模型）",
  original: "原文已是目标语言",
  pending: "翻译中",
  failed: "翻译失败",
  rejected: "译文结构不符",
  missing: "尚未翻译",
}

const failures = []
const runtimeErrors = []
const apiServerErrors = []
const externalRequests = []
let passCount = 0

function check(condition, message) {
  if (condition) {
    passCount += 1
    console.log(`PASS  ${message}`)
  } else {
    failures.push(message)
    console.log(`FAIL  ${message}`)
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`)
}

function norm(value) {
  return String(value ?? "").replace(/\s+/g, "")
}

/**
 * List/table blocks are stored as flat separator-joined strings, so a rendered
 * element can never contain the joined form verbatim. Compare item/cell texts.
 */
function blockFragments(block, useTranslation) {
  const text = useTranslation ? (block.expectedTranslatedText ?? block.text) : block.text
  if (block.type === "list") return text.split(" • ").filter(Boolean)
  if (block.type === "table") return text.split("\n").filter(Boolean).flatMap(row => row.split(" | "))
  return [text]
}

function pageHasBlock(pageNorm, block, useTranslation) {
  return blockFragments(block, useTranslation).map(norm).filter(Boolean).every(fragment => pageNorm.includes(fragment))
}

/** Distinct hosts of any accidental outbound HTTP(S) traffic, for diagnostics. */
function externalHosts() {
  const hosts = new Set()
  for (const url of externalRequests) {
    try {
      hosts.add(new URL(url).host)
    } catch {
      hosts.add(url)
    }
  }
  return [...hosts].slice(0, 8)
}

function isBenign(message) {
  return message.includes("favicon") || message.includes("swx.js") || message.includes("service-worker")
}

async function waitFor(fn, timeoutMs = 30000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return undefined
}

function findChrome() {
  const candidates = [
    process.env.E2E_CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean)
  return candidates.find(path => existsSync(path))
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (msg) => {
        if (msg.method === method) {
          this.listeners = this.listeners.filter(item => item !== listener)
          resolve(msg.params)
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
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true })
    ws.addEventListener("error", reject, { once: true })
  })
  return new Cdp(ws)
}

/* ----------------------------------------------------- isolated server */

let serverLogFd
let serverLogPath

function startServer() {
  serverLogPath = join(RUN_DIR, `server-${Date.now()}.log`)
  mkdirSync(dirname(serverLogPath), { recursive: true })
  serverLogFd = openSync(serverLogPath, "a")
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: RUN_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      SHIPPING_DATA_MODE: "mock",
      // Isolate the browse window: nothing but the browser may touch the DB.
      SHIPPING_RUNTIME_ENABLED: "false",
    },
    stdio: ["ignore", serverLogFd, serverLogFd],
  })
  return child
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    child.once("exit", resolve)
    child.kill("SIGKILL")
    setTimeout(resolve, 5000)
  })
}

async function waitForServer() {
  const ready = await waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/api/shipping/health`)
      return res.status < 500 ? res.status : undefined
    } catch {
      return undefined
    }
  }, 60000)
  if (ready === undefined) {
    const log = serverLogPath && existsSync(serverLogPath) ? readFileSync(serverLogPath, "utf8").slice(-2000) : "(no log)"
    throw new Error(`server did not become ready; log tail:\n${log}`)
  }
}

/* ------------------------------------------------------------ counters */

function openDatabase() {
  return new Database(DB_PATH, { timeout: 10000 })
}

function count(db, sql, ...params) {
  const row = db.prepare(sql).get(...params)
  return Number(row?.count ?? 0)
}

function snapshotCounters(db) {
  const runtimeState = db.prepare("SELECT provider_id, capability, status, COALESCE(error_code, '') AS error_code, consecutive_failures, COALESCE(last_success_at, '') AS last_success_at, COALESCE(updated_at, '') AS updated_at FROM provider_runtime ORDER BY provider_id, capability").all()
  return {
    providerUsageRows: count(db, "SELECT COUNT(*) AS count FROM provider_usage"),
    translationUsageRows: count(db, "SELECT COUNT(*) AS count FROM provider_usage WHERE capability = 'translation'"),
    deepseekUsageRows: count(db, "SELECT COUNT(*) AS count FROM provider_usage WHERE provider_id = 'deepseek'"),
    syncRunRows: count(db, "SELECT COUNT(*) AS count FROM sync_runs"),
    translationSyncRuns: count(db, "SELECT COUNT(*) AS count FROM sync_runs WHERE capability = 'translation'"),
    articleFetchRuns: count(db, "SELECT COUNT(*) AS count FROM sync_runs WHERE capability = 'article_fetch'"),
    translationCacheRows: count(db, "SELECT COUNT(*) AS count FROM translation_cache"),
    // Row counts alone cannot see an in-place UPDATE (e.g. a circuit clear), so the
    // Runtime state itself is part of the snapshot. The value is a JSON string, not
    // a number, so `diffCounters` compares it separately.
    providerRuntimeRows: count(db, "SELECT COUNT(*) AS count FROM provider_runtime"),
    providerRuntimeState: JSON.stringify(runtimeState),
  }
}

function diffCounters(before, after) {
  const delta = {}
  for (const key of Object.keys(before)) {
    if (typeof before[key] === "number" && typeof after[key] === "number") delta[key] = after[key] - before[key]
    else if (before[key] !== after[key]) delta[key] = "changed"
  }
  return delta
}

/* --------------------------------------------------------------- main */

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
  const expectations = manifest.expectations
  const byId = new Map(expectations.map(entry => [entry.id, entry]))

  const local = new URL(BASE)
  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge executable found; set E2E_CHROME")

  let server = startServer()
  const profile = mkdtempSync(join(tmpdir(), "shipping-hot-s5-"))
  const chromeChild = spawn(chrome, [
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

  const db = openDatabase()
  const evidence = {
    runDir: RUN_DIR,
    databasePath: DB_PATH,
    baseUrl: BASE,
    // Scope honesty: this harness exercises the Provider-free read/display path
    // against seeded cache rows. It never claims work, never calls a Provider and
    // is not evidence of DeepSeek translation quality.
    coverage: "provider-free article translation read/display path only (seeded fixture rows; no Provider call, no claim, no structure/budget guard)",
    translationsProvenance: "seeded-fixture (not real DeepSeek output)",
    phases: {},
    scenarios: [],
    counters: {},
  }

  try {
    await waitForServer()

    const version = await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
        return res.ok ? await res.json() : undefined
      } catch {
        return undefined
      }
    }, 30000)
    if (!version) throw new Error("Chrome DevTools endpoint did not become ready")
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const page = targets.find(target => target.type === "page")
    if (!page) throw new Error("No page target")
    const cdp = await connect(page.webSocketDebuggerUrl)

    cdp.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        const text = msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "exception"
        if (!isBenign(text)) runtimeErrors.push(`runtime exception: ${text}`)
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const text = (msg.params.args ?? []).map(arg => arg.value ?? arg.description ?? "").join(" ")
        if (!isBenign(text)) runtimeErrors.push(`console error: ${text}`)
      }
      if (msg.method === "Network.responseReceived") {
        const { url, status } = msg.params.response
        if (url.includes("/api/") && status >= 500) apiServerErrors.push(`api ${status}: ${url}`)
      }
      if (msg.method === "Network.requestWillBeSent") {
        // Only real outbound HTTP(S) traffic counts; data:/blob: and devtools
        // internal URLs are not network egress.
        try {
          const url = new URL(msg.params.request.url)
          if ((url.protocol === "http:" || url.protocol === "https:") && url.host !== local.host) externalRequests.push(msg.params.request.url)
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

    const navigate = async (path, { reload = false } = {}) => {
      const loaded = cdp.once("Page.loadEventFired")
      if (reload) await cdp.send("Page.reload", { ignoreCache: true })
      else await cdp.send("Page.navigate", { url: `${BASE}${path}` })
      await loaded
      await waitFor(async () => (await evaluate(`document.querySelectorAll('.shipping-shell').length`)) > 0, 20000)
      if (path.startsWith("/feed/")) {
        // The shell renders while the article query is still in flight; wait for
        // the detail panel so mode/structure assertions never race the fetch.
        await waitFor(async () => (await evaluate(`document.querySelectorAll('.article-detail').length`)) > 0, 20000)
      }
    }

    const api = async path => evaluate(
      `fetch(${JSON.stringify(path)}).then(async r => ({ status: r.status, body: await r.json() }))`,
      true,
    )

    const clickMode = async (label) => {
      const clicked = await waitFor(async () => evaluate(`(() => {
        const button = [...document.querySelectorAll('button.fbtn')].find(node => node.textContent.trim() === ${JSON.stringify(label)})
        if (!button) return false
        button.click()
        return true
      })()`), 20000)
      if (!clicked) throw new Error(`reading mode button not found: ${label}`)
      await new Promise(resolve => setTimeout(resolve, 300))
    }

    const bodyText = () => evaluate(`document.querySelector('.article-body')?.innerText ?? ''`)

    const countersStart = snapshotCounters(db)

    /* ------------------------------------------------- phase 1: scenarios */

    section("Phase 1 — provider-free article read model and reading UI")
    for (const expected of expectations) {
      const scenarioChecks = []
      const push = (ok, message) => {
        scenarioChecks.push({ ok, message })
        check(ok, `[${expected.id}] ${message}`)
      }

      // Land on the same origin first so the API probes below are same-origin fetches.
      await navigate(expected.path)
      push((await evaluate(`document.querySelectorAll('.shipping-shell').length`)) === 1, `${expected.path} renders the Shipping shell`)

      const response = await api(`/api/shipping/feed/${expected.id}`)
      push(response.status === 200, `GET /api/shipping/feed/${expected.id} -> ${response.status}`)
      const article = response.body?.article
      const view = article?.translation
      push(Boolean(view), "detail API exposes article.translation")
      if (!view) continue

      push(view.eligible === expected.eligible, `translation.eligible=${view.eligible} (expected ${expected.eligible})`)
      push(view.status === expected.status, `translation.status=${view.status} (expected ${expected.status})`)
      push(view.total === expected.total, `translation.total=${view.total} (expected ${expected.total})`)
      push(view.translated === expected.translated, `translation.translated=${view.translated} (expected ${expected.translated})`)
      push((view.historical ?? 0) === expected.historical, `translation.historical=${view.historical} (expected ${expected.historical})`)
      push(view.originalSameLanguage === expected.originalSameLanguage, `translation.originalSameLanguage=${view.originalSameLanguage} (expected ${expected.originalSameLanguage})`)
      push(view.pending === expected.pending, `translation.pending=${view.pending} (expected ${expected.pending})`)
      push(view.failed === expected.failed, `translation.failed=${view.failed} (expected ${expected.failed})`)
      push((view.rejected ?? 0) === expected.rejected, `translation.rejected=${view.rejected} (expected ${expected.rejected})`)
      push(view.missing === expected.missing, `translation.missing=${view.missing} (expected ${expected.missing})`)
      push(view.completedCount === expected.completedCount, `translation.completedCount=${view.completedCount} (expected ${expected.completedCount})`)
      push(view.versionId === expected.versionId, `translation is version-scoped to ${expected.versionId}`)
      push(view.targetLanguage === manifest.targetLanguage, `targetLanguage=${view.targetLanguage}`)

      const blockSources = (view.blocks ?? []).map(block => `${block.blockKey}:${block.source}`).join(",")
      const expectedSources = expected.blocks.map(block => `${block.blockKey}:${block.expectedSource}`).join(",")
      push(blockSources === expectedSources, "every block reports its own translated/pending/failed/missing/original state")
      for (const block of expected.blocks) {
        const actual = (view.blocks ?? []).find(candidate => candidate.blockKey === block.blockKey)
        if (block.expectedTranslatedText) {
          push(norm(actual?.translatedText) === norm(block.expectedTranslatedText), `block ${block.blockKey} returns the cached translation for this source hash`)
        }
        if (block.expectedSource !== "translation" && block.expectedSource !== "historical" && block.expectedSource !== "original") {
          push(actual?.translatedText === undefined, `block ${block.blockKey} (${block.expectedSource}) never invents a translated string`)
        }
      }

      // Factual boundary: the translation read must not alter the Feed item.
      push(response.body?.feedItem?.id === expected.id, "feedItem id unchanged by the translation read")
      push(response.body?.feedItem?.title === expected.title, "feedItem title unchanged by the translation read")
      push(article?.state?.completenessStatus === expected.completeness, `article completeness state unchanged (${article?.state?.completenessStatus})`)

      const modeLabels = await evaluate(`[...document.querySelectorAll('button.fbtn')].map(b => b.textContent.trim())`)
      const modesOffered = modeLabels.includes("原文") && modeLabels.includes("中文") && modeLabels.includes("原文 / 中文")
      const eligible = expected.eligible
      if (eligible) {
        push(modesOffered, "reading modes 原文 / 中文 / 原文 / 中文 are offered for an eligible version")
      } else {
        // An ineligible version must not pretend to offer a translation mode.
        push(!modesOffered, "an ineligible version offers no translation reading mode")
        // The explanation lives in the detail panel header, not the article body.
        const panelText = await evaluate(`document.querySelector('.article-detail')?.innerText ?? ''`)
        push(panelText.includes("本版本不参与翻译"), "an ineligible version explains why the original is always shown")
      }

      const progressLine = await evaluate(`[...document.querySelectorAll('.article-detail p')].map(p => p.textContent).find(t => t.includes('翻译进度')) ?? ''`)
      if (eligible) {
        push(progressLine.includes(`已完成 ${expected.completedCount} / ${expected.total}`), `progress line reports ${expected.completedCount} / ${expected.total}`)
        push(progressLine.includes(TRANSLATION_LABELS[expected.status]), `progress line labels the state as "${TRANSLATION_LABELS[expected.status]}"`)
        if (expected.originalSameLanguage > 0) {
          push(progressLine.includes(`其中原文已是目标语言 ${expected.originalSameLanguage}`), "same-language reuse is reported separately from model translation")
        }
        if (expected.historical > 0) {
          push(progressLine.includes(`其中历史缓存（非当前模型）${expected.historical}`), "historical cache rows are counted and labelled separately from the current model")
        }
      } else {
        push(progressLine === "", "an ineligible version shows no translation progress line")
      }

      /**
       * Reads the rendered body back per element type so structure and text can
       * be compared element-by-element instead of by whole-page substring.
       */
      const readRendered = () => evaluate(`(() => {
        const body = document.querySelector('.article-body')
        if (!body) return null
        const text = (node) => (node.textContent ?? '').trim()
        return {
          headings: [...body.querySelectorAll('.article-h')].map(text),
          unorderedItems: [...body.querySelectorAll('ul.article-list')].flatMap(list => [...list.querySelectorAll('li')].map(text)),
          orderedItems: [...body.querySelectorAll('ol.article-list')].flatMap(list => [...list.querySelectorAll('li')].map(text)),
          tableCells: [...body.querySelectorAll('table.article-table')].flatMap(table => [...table.querySelectorAll('th,td')].map(text)),
          tableRows: [...body.querySelectorAll('table.article-table')].map(table => table.querySelectorAll('tr').length),
          captions: [...body.querySelectorAll('p.article-caption')].map(text),
          paragraphs: [...body.querySelectorAll('p.article-p')].map(text),
          containers: body.querySelectorAll(':scope > .article-block').length,
        }
      })()`)

      // List/table text is stored as flat separator-joined strings; split it back
      // so each item/cell is compared on its own.
      const fragments = (block, display) => {
        if (block.type === "list") return display.split(" • ").filter(Boolean)
        if (block.type === "table") return display.split("\n").filter(Boolean).flatMap(row => row.split(" | "))
        return [display]
      }
      const expectedShape = (useTranslation) => {
        const display = block => (useTranslation ? (block.expectedTranslatedText ?? block.text) : block.text)
        return {
          headings: expected.blocks.filter(block => block.type === "heading").map(block => display(block)),
          unorderedItems: expected.blocks.filter(block => block.type === "list" && block.metadata?.ordered !== true).flatMap(block => fragments(block, display(block))),
          orderedItems: expected.blocks.filter(block => block.type === "list" && block.metadata?.ordered === true).flatMap(block => fragments(block, display(block))),
          tableCells: expected.blocks.filter(block => block.type === "table").flatMap(block => fragments(block, display(block))),
          captions: expected.blocks.filter(block => block.type === "caption").map(block => display(block)),
          paragraphs: expected.blocks.filter(block => block.type === "paragraph").map(block => display(block)),
        }
      }
      /**
       * Fidelity vs absence. When a version has no list/table/caption of that kind
       * there is nothing to compare verbatim, so the check is recorded as an
       * absence check ("nothing of that kind is rendered") instead of claiming a
       * verbatim comparison that cannot fail.
       */
      const checkTally = { fidelity: 0, absence: 0 }
      const compareText = (label, renderedList, expectedList, { prefix = false } = {}) => {
        if (expectedList.length === 0) {
          checkTally.absence += 1
          push(renderedList.length === 0, `${label}: none stored in this version and none rendered (${renderedList.length})`)
          return
        }
        checkTally.fidelity += 1
        const ok = renderedList.length === expectedList.length
          && expectedList.every((value, index) => (prefix ? norm(renderedList[index]).startsWith(norm(value)) : norm(renderedList[index]) === norm(value)))
        push(ok, label)
        if (!ok) console.log(`      rendered=${JSON.stringify(renderedList).slice(0, 240)}\n      expected=${JSON.stringify(expectedList).slice(0, 240)}`)
      }

      // Original mode: every original element, in order, verbatim.
      if (eligible) await clickMode("原文")
      const originalRendered = await readRendered()
      const originalExpected = expectedShape(false)
      compareText("original headings verbatim", originalRendered.headings, originalExpected.headings)
      compareText("original unordered list items verbatim", originalRendered.unorderedItems, originalExpected.unorderedItems)
      compareText("original ordered list items verbatim", originalRendered.orderedItems, originalExpected.orderedItems)
      compareText("original table cells verbatim", originalRendered.tableCells, originalExpected.tableCells)
      compareText("original captions verbatim", originalRendered.captions, originalExpected.captions, { prefix: true })
      compareText("original paragraphs verbatim (long paragraph included)", originalRendered.paragraphs, originalExpected.paragraphs, { prefix: true })
      const structure = { heading: originalRendered.headings.length, unorderedItems: originalRendered.unorderedItems.length, orderedItems: originalRendered.orderedItems.length, tables: expected.blocks.filter(block => block.type === "table").length, tableRows: originalRendered.tableRows, tableCells: originalRendered.tableCells.length, captions: originalRendered.captions.length, paragraphs: originalRendered.paragraphs.length }
      // A real multi-row table must render one <tr> per stored row, not one row
      // holding every cell: this is the structure the extractor must preserve.
      for (const block of expected.blocks.filter(candidate => candidate.type === "table")) {
        const rows = block.text.split("\n").filter(Boolean).length
        push(originalRendered.tableRows.includes(rows), `table ${block.blockKey} renders one row per stored row (${rows})`)
      }
      if (!eligible) {
        const ineligibleBadges = await evaluate(`[...document.querySelectorAll('.article-block-status')].map(node => node.textContent.trim())`)
        push(ineligibleBadges.length === 0, "an ineligible version shows no per-block translation badge")
      }
      if (eligible) {
      // 中文 mode: translated strings must land in the SAME structure.
        await clickMode("中文")
        const zhRendered = await readRendered()
        const zhExpected = expectedShape(true)
        compareText("中文 headings keep structure and use the translated string", zhRendered.headings, zhExpected.headings)
        compareText("中文 list items keep structure (unordered)", zhRendered.unorderedItems, zhExpected.unorderedItems)
        compareText("中文 list items keep structure (ordered)", zhRendered.orderedItems, zhExpected.orderedItems)
        compareText("中文 table cells keep structure", zhRendered.tableCells, zhExpected.tableCells)
        compareText("中文 captions keep structure", zhRendered.captions, zhExpected.captions, { prefix: true })
        compareText("中文 paragraphs keep structure (no summarising or omission)", zhRendered.paragraphs, zhExpected.paragraphs, { prefix: true })

        const zhBadges = await evaluate(`[...document.querySelectorAll('.article-block-status')].map(node => node.textContent.trim())`)
        const missingBadges = []
        for (const block of expected.blocks) {
          if (block.expectedSource === "translation" || block.expectedSource === "original") continue
          const badge = BLOCK_BADGES[block.expectedSource]
          if (!zhBadges.includes(badge)) missingBadges.push(`${block.blockKey}:${badge}`)
        }
        push(missingBadges.length === 0, `中文 mode marks pending/failed/missing/historical blocks explicitly [${missingBadges.join(",") || "ok"}]`)
        if (expected.originalSameLanguage > 0) {
          push(zhBadges.includes(BLOCK_BADGES.original), "same-language blocks are marked as original text, never as model output")
        }
        const zhText = norm(await bodyText())
        push(!zhText.includes("undefined") && !zhText.includes("[object Object]"), "中文 mode renders no placeholder artifacts")

        // 原文 / 中文: each block renders its own translation exactly once. Fixture
        // translations all start with the scenario sentinel and originals never
        // contain it, so counting sentinel occurrences is a falsifiable pairing
        // check (rendering the original instead of the translation yields 0).
        await clickMode("原文 / 中文")
        const bilingual = await evaluate(`[...document.querySelectorAll('.article-body > .article-block')].map(node => node.innerText ?? '')`)
        push(bilingual.length === expected.blocks.length, `原文 / 中文 renders one container per block (${bilingual.length}/${expected.blocks.length})`)
        const pairing = []
        let pairedBlocks = 0
        expected.blocks.forEach((block, index) => {
          const container = norm(bilingual[index])
          const sentinel = norm(expected.sentinel)
          const expectedHits = block.expectedTranslatedText ? fragments(block, block.expectedTranslatedText).length : 0
          const hits = sentinel ? container.split(sentinel).length - 1 : 0
          if (expectedHits > 0) pairedBlocks += 1
          if (hits !== expectedHits) pairing.push(`${block.blockKey}:${hits}/${expectedHits}`)
        })
        // With translated blocks this proves each translation renders exactly once (a
        // fallback to the original would render none); without any, it proves no
        // translation text leaks into a version that has none.
        push(pairing.length === 0, pairedBlocks > 0
          ? `原文 / 中文 renders each block's own translation exactly once (${pairedBlocks} translated blocks) [${pairing.join(",") || "ok"}]`
          : `原文 / 中文 renders no translation text for a version without translated blocks (0 translated blocks) [${pairing.join(",") || "ok"}]`)

        await clickMode("原文")
      }

      evidence.scenarios.push({
        id: expected.id,
        status: view.status,
        counts: { total: view.total, translated: view.translated, historical: view.historical ?? 0, originalSameLanguage: view.originalSameLanguage, pending: view.pending, failed: view.failed, rejected: view.rejected ?? 0, missing: view.missing },
        structure,
        // `fidelity` compares stored text verbatim; `absence` asserts a version
        // without that block kind renders none of it. Reported separately so the
        // claim "N verbatim structural comparisons" stays true.
        checks: scenarioChecks.length,
        fidelityChecks: checkTally.fidelity,
        absenceChecks: checkTally.absence,
        failed: scenarioChecks.filter(entry => !entry.ok).length,
      })
    }

    /* ----------------------------------------- phase 2: cache and version */

    section("Phase 2 — cache, version isolation and settings readback (A5-05)")

    const complete = byId.get("s5-article-complete")
    const partial = byId.get("s5-article-partial")
    const history = byId.get("s5-article-history")

    const beforeRepeat = snapshotCounters(db)
    await navigate(complete.path)
    const concurrent = await evaluate(`Promise.all([
      fetch('/api/shipping/feed/${complete.id}').then(r => r.status),
      fetch('/api/shipping/feed/${complete.id}').then(r => r.status),
      fetch('/api/shipping/feed/${complete.id}').then(r => r.status),
      fetch('/api/shipping/feed/${complete.id}').then(r => r.status),
      fetch('/api/shipping/feed/${complete.id}').then(r => r.status),
    ])`, true)
    check(concurrent.every(status => status === 200), `5 concurrent reads of a fully cached article all return 200 (${concurrent.join(",")})`)
    await navigate(complete.path, { reload: true })
    await navigate(complete.path, { reload: true })
    await clickMode("中文")
    const repeatText = norm(await bodyText())
    check(complete.blocks.every(block => pageHasBlock(repeatText, block, true)), "repeated navigation still serves every cached translation")
    const afterRepeat = snapshotCounters(db)
    const repeatDelta = diffCounters(beforeRepeat, afterRepeat)
    check(Object.values(repeatDelta).every(value => value === 0), `repeat/concurrent/reload reads cause zero Provider, usage, runtime and cache writes (delta ${JSON.stringify(repeatDelta)})`)

    // Version isolation: the current version must never surface the older one.
    await navigate(history.path)
    const currentText = norm(await bodyText())
    check(currentText.includes(norm(history.blocks.find(block => block.blockKey === "h-01").text)), "current version renders the newer source text")
    check(!currentText.includes(norm(history.history.headingText)), "current version does not leak the superseded version text")
    check(!currentText.includes(norm(history.history.sentinel)), "current version does not leak the superseded version translation")
    await clickMode("中文")
    const currentZh = norm(await bodyText())
    check(currentZh.includes(norm(history.sentinel)), "current version shows its own cached translation")
    check(!currentZh.includes(norm(history.history.sentinel)), "current version never mixes the older version translation")

    const switched = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('.tl-chips')].find(node => node.textContent.includes('当前版本'))
      if (!chips) return false
      const buttons = [...chips.querySelectorAll('button.fbtn')]
      const target = buttons.find(button => button.textContent.trim() !== '当前版本')
      if (!target) return false
      target.click()
      return true
    })()`)
    check(switched, "history version button is available on the article page")
    await waitFor(async () => {
      const text = norm(await bodyText())
      return text.includes(norm(history.history.headingText)) ? true : undefined
    }, 10000)
    const historicalText = norm(await bodyText())
    check(historicalText.includes(norm(history.history.headingText)), "switching to the history version renders the older source text")
    check(!historicalText.includes(norm(history.blocks.find(block => block.blockKey === "h-01").text)), "history version does not show the newer version text")
    await clickMode("中文")
    const historicalZh = norm(await bodyText())
    check(historicalZh.includes(norm(history.history.sentinel)), "history version shows the older version cached translation")
    check(!historicalZh.includes(norm(history.sentinel)), "history version never shows the newer version translation")
    const historyApi = await api(history.history.apiPath)
    check(historyApi.status === 200 && historyApi.body?.article?.translation?.versionId === history.history.versionId, "?versionId reads the superseded version translation from cache")
    check(historyApi.body?.article?.translation?.completedCount === 3, "superseded version reports its own 3/3 completed blocks")

    // Disabling translation must not remove already cached translations.
    const disable = await evaluate(`fetch('/api/shipping/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ translation: { enabled: false } }) }).then(r => r.status)`, true)
    check(disable === 200, `browser same-origin settings write disabling translation -> ${disable}`)
    await navigate(complete.path)
    await clickMode("中文")
    const disabledText = norm(await bodyText())
    check(complete.blocks.every(block => pageHasBlock(disabledText, block, true)), "cached translations stay readable after translation is disabled")
    const disabledView = await api(`/api/shipping/feed/${complete.id}`)
    check(disabledView.body?.article?.translation?.status === "complete", "provider-free view still reports complete while translation is disabled")
    const reEnable = await evaluate(`fetch('/api/shipping/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ translation: { enabled: true } }) }).then(r => r.status)`, true)
    check(reEnable === 200, `translation setting restored -> ${reEnable}`)

    /* ------------------------------------------------- phase 3: restart */

    section("Phase 3 — restart and cache recovery")
    const beforeRestart = snapshotCounters(db)
    await stopServer(server)
    db.close()
    server = startServer()
    await waitForServer()
    const restarted = openDatabase()
    const afterRestart = snapshotCounters(restarted)
    const restartDelta = diffCounters(beforeRestart, afterRestart)
    check(Object.values(restartDelta).every(value => value === 0), `restart writes no Provider, usage, runtime or cache rows (delta ${JSON.stringify(restartDelta)})`)

    await navigate(complete.path)
    await clickMode("中文")
    const restartedText = norm(await bodyText())
    check(complete.blocks.every(block => pageHasBlock(restartedText, block, true)), "after restart every cached translation is still readable")
    const restartedApi = await api(`/api/shipping/feed/${complete.id}`)
    check(restartedApi.body?.article?.translation?.completedCount === 20, "after restart the article still reports 20/20 complete")
    const partialApi = await api(`/api/shipping/feed/${partial.id}`)
    check(partialApi.body?.article?.translation?.status === "partial" && partialApi.body?.article?.translation?.completedCount === 19, "after restart the partial article still reports 19/20 partial")
    await navigate(partial.path)
    const partialLine = await evaluate(`[...document.querySelectorAll('.article-detail p')].map(p => p.textContent).find(t => t.includes('翻译进度')) ?? ''`)
    check(partialLine.includes("已完成 19 / 20") && partialLine.includes("部分翻译（全文尚未完成）"), "partial article shows 19/20 and 部分翻译 after restart")

    /* --------------------------------------------------- phase 4: zero delta */

    section("Phase 4 — zero Provider / usage / Runtime delta for the whole browse window")
    const countersEnd = snapshotCounters(restarted)
    const totalDelta = diffCounters(countersStart, countersEnd)
    evidence.counters = { start: countersStart, end: countersEnd, delta: totalDelta }
    check(totalDelta.providerUsageRows === 0, `provider_usage writes delta = ${totalDelta.providerUsageRows}`)
    check(totalDelta.deepseekUsageRows === 0, `DeepSeek calls delta = ${totalDelta.deepseekUsageRows}`)
    check(totalDelta.translationUsageRows === 0, `translation capability calls delta = ${totalDelta.translationUsageRows}`)
    check(totalDelta.syncRunRows === 0, `Runtime sync runs delta = ${totalDelta.syncRunRows}`)
    check(totalDelta.translationSyncRuns === 0, `translation-sync runs delta = ${totalDelta.translationSyncRuns}`)
    check(totalDelta.articleFetchRuns === 0, `article-fetch runs delta = ${totalDelta.articleFetchRuns}`)
    check(totalDelta.translationCacheRows === 0, `translation_cache writes delta = ${totalDelta.translationCacheRows}`)
    check(totalDelta.providerRuntimeRows === 0, `provider_runtime row delta = ${totalDelta.providerRuntimeRows}`)
    check(totalDelta.providerRuntimeState === undefined, `provider_runtime state unchanged (in-place UPDATEs included)${totalDelta.providerRuntimeState ? `: ${String(totalDelta.providerRuntimeState)}` : ""}`)
    check(externalRequests.length === 0, `no outbound request left the machine during browsing (${externalRequests.length}${externalRequests.length ? `: ${externalHosts().join(", ")}` : ""})`)
    if (externalRequests.length > 0) {
      for (const url of externalRequests.slice(0, 10)) console.log(`      external: ${url}`)
    }
    restarted.close()

    /* ------------------------------------------------------ phase 5: errors */

    section("Phase 5 — browser and API cleanliness")
    check(runtimeErrors.length === 0, `unhandled runtime/console errors = ${runtimeErrors.length}`)
    for (const error of runtimeErrors.slice(0, 10)) console.log(`      ${error}`)
    check(apiServerErrors.length === 0, `API 5xx responses = ${apiServerErrors.length}`)
    for (const error of apiServerErrors.slice(0, 10)) console.log(`      ${error}`)

    const scenarioCheckTotal = evidence.scenarios.reduce((sum, scenario) => sum + scenario.checks, 0)
    evidence.phases = {
      scenarios: expectations.length,
      modeChecks: "original/中文/原文-中文 per scenario",
      restarted: true,
      runtimeErrors: runtimeErrors.length,
      apiServerErrors: apiServerErrors.length,
      externalRequests: externalRequests.length,
      scenarioChecks: scenarioCheckTotal,
      phaseChecks: failures.length + passCount - scenarioCheckTotal,
      totalChecks: passCount + failures.length,
      failedChecks: failures.length,
    }
    const evidencePath = join(RUN_DIR, "s5-article-browser-evidence.json")
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
    console.log(`\nEvidence: ${evidencePath}`)
    console.log(`\n${failures.length === 0 ? "S5 BROWSER ACCEPTANCE PASS" : `S5 BROWSER ACCEPTANCE FAIL (${failures.length})`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    try {
      if (db.open) db.close()
    } catch {}
    await stopServer(server)
    chromeChild.kill("SIGKILL")
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
    if (process.exitCode === 0 && serverLogPath) {
      try {
        rmSync(serverLogPath, { force: true })
      } catch {}
    }
  }
}

main().catch((error) => {
  console.error(`S5 E2E ERROR: ${error.message}`)
  process.exitCode = 1
})
