// S7 Clean Local Integrated Acceptance harness.
//
// SCOPE: end-to-end integration acceptance on this Windows machine for the
// finished local V1 — fresh isolated SQLite initialization + schema migration,
// restart persistence, production build served on 127.0.0.1, and the three
// primary user flows over the real production build in Real Mode:
//
//   Flow A  vessel identity -> tracking: name search (provider-free cache hit),
//           canonical IMO/MMSI, no same-name mis-binding, AIS latest position,
//           Voyage/Destination/ETA, and explicit unknown instead of fabrication
//   Flow B  feed -> article: list, detail, 原文 / 中文 / 原文 / 中文 reading,
//           historical-version labelling (integration only; S5 acceptance is NOT
//           re-run and its BLOCKED real-long-article items stay BLOCKED)
//   Flow C  ports / weather / calendar: load, scope switching, weather windows
//
// HONESTY: fixtures are synthetic (see scripts/s7-local-seed.ts). This harness
// proves integration and Real-Mode boundary behavior, never live-provider
// accuracy, and it does not re-verify S2/S3/S4/S5 sealed scope.
//
// Usage:
//   node scripts/e2e-s7-integrated.mjs           (E2E_S7_DIR overrides .tmp/s7-local)
//
// Exit code 0 only when every check passes.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const RUN_DIR = resolve(process.env.E2E_S7_DIR ?? join(ROOT, ".tmp", "s7-local"))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const MANIFEST_PATH = join(RUN_DIR, "s7-local-manifest.json")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const SEED_ENTRY = join(ROOT, "scripts", "s7-local-seed.ts")
const PORT = Number(process.env.E2E_S7_PORT ?? "4477")
const BASE = (process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, "")
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? "9345")
const EXPECTED_SCHEMA_VERSION = 13

const REQUIRED_TABLES = [
  "app_metadata",
  "vessels",
  "ports",
  "voyages",
  "feed_items",
  "events",
  "calendar_events",
  "translation_cache",
  "provider_usage",
  "provider_runtime",
  "sync_runs",
  "port_directory",
  "vessel_metadata",
  "vessel_search_cache",
  "ais_positions",
  "ais_latest_positions",
  "voyage_eta_history",
  "feed_articles",
  "article_versions",
  "article_blocks",
]

/** Retained (never-seeded, never-written) databases this run must not touch. */
const RETAINED_DATABASES = [
  join(ROOT, ".data", "shipping-hot-v3.sqlite3"),
  join(ROOT, ".data", "shipping-hot-v3-browser.sqlite3"),
  join(ROOT, ".data", "p7-final-seal-20260904.sqlite3"),
  join(ROOT, ".data", "provider-secrets.json"),
]

const failures = []
const runtimeErrors = []
const unexpectedApiServerErrors = []
const expectedProviderResponses = []
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

/** Local-calendar date fragment, matching how the UI formats timestamps. */
function localDateFragment(iso) {
  const date = new Date(iso)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function sha256Prefix(path) {
  if (!existsSync(path)) return "absent"
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16)
}

function fileStamp(path) {
  if (!existsSync(path)) return "absent"
  const stat = statSync(path)
  return `${stat.size}:${stat.mtimeMs}`
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

/* ------------------------------------------------------- isolated process */

let serverLogFd
let serverLogPath

function startServer(tag) {
  serverLogPath = join(RUN_DIR, `server-${tag}-${Date.now()}.log`)
  mkdirSync(dirname(serverLogPath), { recursive: true })
  serverLogFd = openSync(serverLogPath, "a")
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: RUN_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
      SHIPPING_DATA_MODE: "real",
      // Nothing but the browser may touch the database during the browse window,
      // so any counter delta is attributable to the browsing itself.
      SHIPPING_RUNTIME_ENABLED: "false",
    },
    stdio: ["ignore", serverLogFd, serverLogFd],
  })
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

async function runSeed() {
  return await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx/esm",
      "--experimental-loader",
      pathToFileURL(join(ROOT, "scripts", "tsx-alias-loader.mjs")).href,
      SEED_ENTRY,
      RUN_DIR,
    ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk) => {
      output += chunk
    })
    child.stderr.on("data", (chunk) => {
      output += chunk
    })
    child.on("exit", code => resolvePromise({ code, output }))
  })
}

/* -------------------------------------------------------------- counters */

function openDatabase() {
  return new Database(DB_PATH, { timeout: 10000 })
}

function count(db, sql, ...params) {
  const row = db.prepare(sql).get(...params)
  return Number(row?.count ?? 0)
}

/**
 * The browse window must be read-only. `provider_runtime` state is compared as
 * a whole because row counts cannot see an in-place UPDATE.
 */
function snapshotCounters(db) {
  const runtimeState = db.prepare("SELECT provider_id, capability, status, COALESCE(error_code, '') AS error_code, consecutive_failures, COALESCE(last_success_at, '') AS last_success_at, COALESCE(updated_at, '') AS updated_at FROM provider_runtime ORDER BY provider_id, capability").all()
  return {
    providerUsageRows: count(db, "SELECT COUNT(*) AS count FROM provider_usage"),
    deepseekUsageRows: count(db, "SELECT COUNT(*) AS count FROM provider_usage WHERE provider_id = 'deepseek'"),
    translationUsageRows: count(db, "SELECT COUNT(*) AS count FROM provider_usage WHERE capability = 'translation'"),
    syncRunRows: count(db, "SELECT COUNT(*) AS count FROM sync_runs"),
    translationCacheRows: count(db, "SELECT COUNT(*) AS count FROM translation_cache"),
    providerRuntimeRows: count(db, "SELECT COUNT(*) AS count FROM provider_runtime"),
    providerRuntimeState: JSON.stringify(runtimeState),
    aisPositionRows: count(db, "SELECT COUNT(*) AS count FROM ais_positions"),
    aisLatestRows: count(db, "SELECT COUNT(*) AS count FROM ais_latest_positions"),
    articleVersionRows: count(db, "SELECT COUNT(*) AS count FROM article_versions"),
    articleFetchRows: count(db, "SELECT COUNT(*) AS count FROM feed_articles"),
    voyageRows: count(db, "SELECT COUNT(*) AS count FROM voyages"),
    vesselRows: count(db, "SELECT COUNT(*) AS count FROM vessels"),
    portRows: count(db, "SELECT COUNT(*) AS count FROM ports"),
    feedRows: count(db, "SELECT COUNT(*) AS count FROM feed_items"),
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
  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge executable found; set E2E_CHROME")
  if (!existsSync(SERVER_ENTRY)) throw new Error(`production build missing: ${SERVER_ENTRY} (run pnpm build)`)

  const evidence = {
    runDir: RUN_DIR,
    databasePath: DB_PATH,
    baseUrl: BASE,
    productionBuild: SERVER_ENTRY,
    coverage: "clean local integration acceptance: fresh isolated DB init/migration, restart persistence, Real-Mode boundary, Flow A/B/C over the production build in system Chrome",
    fixtureDataProvenance: "synthetic deterministic fixture (see scripts/s7-local-seed.ts); not captured real Provider data",
    inheritedNotReVerified: "S2 coverage, S3 MY/TH/PH calendar, S4 real samples and S5 real long-article acceptance stay BLOCKED and are not re-run here",
    phases: {},
    flows: [],
    counters: {},
    expectedProviderResponses: [],
    retainedDatabases: {},
  }

  const retainedBefore = Object.fromEntries(RETAINED_DATABASES.map(path => [path, `${sha256Prefix(path)}|${fileStamp(path)}`]))

  let server
  let chromeChild
  let profile
  let db

  try {
    /* --------------------------------------- phase 1: clean initialization */

    section("Phase 1 — clean local initialization and schema migration")
    if (existsSync(DB_PATH)) {
      rmSync(DB_PATH, { force: true })
      console.log("      removed the previous isolated database to force a fresh start")
    }
    check(!existsSync(DB_PATH), "start from a run directory with no database file")

    server = startServer("init")
    await waitForServer()
    const health = await (await fetch(`${BASE}/api/shipping/health`)).json()
    check(health?.database?.status === "healthy", `health reports a healthy database (${health?.database?.status})`)
    check(health?.database?.schemaVersion === EXPECTED_SCHEMA_VERSION, `fresh database reached schema v${EXPECTED_SCHEMA_VERSION} (got ${health?.database?.schemaVersion})`)
    check(existsSync(DB_PATH), "the isolated database file was created on first request")

    db = openDatabase()
    const metadata = db.prepare("SELECT schema_version, data_mode, bootstrap_completed_at FROM app_metadata").get()
    check(metadata?.schema_version === EXPECTED_SCHEMA_VERSION, `app_metadata.schema_version = ${metadata?.schema_version}`)
    check(metadata?.data_mode === "real", `app_metadata.data_mode = ${metadata?.data_mode}`)
    check(Boolean(metadata?.bootstrap_completed_at), "bootstrap completed timestamp recorded")
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => String(row.name)))
    const missingTables = REQUIRED_TABLES.filter(table => !tables.has(table))
    check(missingTables.length === 0, `all ${REQUIRED_TABLES.length} required business tables exist${missingTables.length ? ` (missing: ${missingTables.join(", ")})` : ""}`)
    const seedIsolation = { vessels: count(db, "SELECT COUNT(*) AS count FROM vessels"), ports: count(db, "SELECT COUNT(*) AS count FROM ports"), feedItems: count(db, "SELECT COUNT(*) AS count FROM feed_items") }
    check(seedIsolation.vessels === 0 && seedIsolation.ports === 0 && seedIsolation.feedItems === 0, `fresh database carries no business rows (vessels ${seedIsolation.vessels}, ports ${seedIsolation.ports}, feed ${seedIsolation.feedItems})`)
    check(count(db, "SELECT COUNT(*) AS count FROM port_directory") > 0, "port_directory baseline was migrated in")
    evidence.phases.freshInit = { schemaVersion: metadata?.schema_version, tables: tables.size, seedIsolation }
    await stopServer(server)
    db.close()
    db = undefined

    /* --------------------------------------------- phase 2: fixture seeding */

    section("Phase 2 — deterministic provider-free fixture seed")
    const seedResult = await runSeed()
    check(seedResult.code === 0, `seed exited 0${seedResult.code === 0 ? "" : ` (code ${seedResult.code}): ${seedResult.output.slice(-400)}`}`)
    check(existsSync(MANIFEST_PATH), "seed wrote the expectation manifest")
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))
    const expectations = manifest.expectations
    check(manifest.dataMode === "real", `manifest dataMode = ${manifest.dataMode}`)

    db = openDatabase()
    const seeded = {
      realVessels: count(db, "SELECT COUNT(*) AS count FROM vessels WHERE source_type IN ('real','imported','derived')"),
      mockVessels: count(db, "SELECT COUNT(*) AS count FROM vessels WHERE source_type = 'mock'"),
      mockPorts: count(db, "SELECT COUNT(*) AS count FROM ports WHERE source_type = 'mock'"),
      mockFeed: count(db, "SELECT COUNT(*) AS count FROM feed_items WHERE source_type = 'mock'"),
      voyages: count(db, "SELECT COUNT(*) AS count FROM voyages"),
      aisPositions: count(db, "SELECT COUNT(*) AS count FROM ais_positions"),
      aisLatest: count(db, "SELECT COUNT(*) AS count FROM ais_latest_positions"),
      articleVersions: count(db, "SELECT COUNT(*) AS count FROM article_versions"),
      articleBlocks: count(db, "SELECT COUNT(*) AS count FROM article_blocks"),
      translationCache: count(db, "SELECT COUNT(*) AS count FROM translation_cache"),
      legacyCache: count(db, "SELECT COUNT(*) AS count FROM translation_cache WHERE model <> 'deepseek-v4-flash'"),
      searchCache: count(db, "SELECT COUNT(*) AS count FROM vessel_search_cache"),
    }
    check(seeded.realVessels === 3, `3 real-lineage vessels seeded (got ${seeded.realVessels})`)
    check(seeded.voyages === 2, `2 voyage records seeded (got ${seeded.voyages})`)
    check(seeded.aisPositions === 3 && seeded.aisLatest === 1, `AIS history 3 / latest 1 seeded (got ${seeded.aisPositions}/${seeded.aisLatest})`)
    check(seeded.articleVersions === 1 && seeded.articleBlocks === 6, `article version 1 / 6 blocks seeded (got ${seeded.articleVersions}/${seeded.articleBlocks})`)
    check(seeded.translationCache === 6, `6 translated blocks seeded (got ${seeded.translationCache})`)
    check(seeded.legacyCache === 1, `1 historical-model cache row seeded (got ${seeded.legacyCache})`)
    check(seeded.searchCache === 1, `provider-free vessel search cache row seeded (got ${seeded.searchCache})`)
    // The decoys must really be in the database, otherwise the Real-Mode
    // read-filter checks below would pass vacuously.
    check(seeded.mockVessels === 1 && seeded.mockPorts === 1 && seeded.mockFeed === 1, `mock-source decoy rows are present in the database (${seeded.mockVessels}/${seeded.mockPorts}/${seeded.mockFeed})`)
    evidence.phases.seed = seeded
    db.close()
    db = undefined

    /* -------------------------------------- phase 3: restart persistence */

    section("Phase 3 — restart persistence in Real Mode")
    db = openDatabase()
    server = startServer("run")
    await waitForServer()
    const snapshotResponse = await fetch(`${BASE}/api/shipping`)
    check(snapshotResponse.status === 200, `GET /api/shipping after restart -> ${snapshotResponse.status}`)
    const snapshot = await snapshotResponse.json()
    const vesselIds = (snapshot.vessels ?? []).map(vessel => vessel.id)
    const portIds = (snapshot.ports ?? []).map(port => port.id)
    const feedIds = (snapshot.feedItems ?? []).map(item => item.id)
    check(vesselIds.includes(expectations.vesselId), `canonical vessel survived the restart (${expectations.vesselId})`)
    check(vesselIds.includes(expectations.identityOnlyVesselId), "identity-only vessel survived the restart")
    check(portIds.includes(expectations.portId), `port survived the restart (${expectations.portId})`)
    check(feedIds.includes(expectations.articleFeedId) && feedIds.includes(expectations.weatherFeedId), "both feed items survived the restart")
    check((snapshot.voyages ?? []).length === 2, `both voyage records are readable after restart (${(snapshot.voyages ?? []).length})`)

    section("Phase 3b — Real-Mode boundary: no Mock leakage, no Mock fallback")
    const allIds = [...vesselIds, ...portIds, ...feedIds, ...(snapshot.voyages ?? []).map(voyage => voyage.id)]
    check(!allIds.includes(expectations.mockDecoyVesselId) && !allIds.includes(expectations.mockDecoyPortId) && !allIds.includes(expectations.mockDecoyFeedId), "mock-source decoy rows stay invisible in Real Mode even though they exist in SQLite")
    const provenanceSources = [
      ...(snapshot.vessels ?? []).map(item => item.provenance?.sourceType),
      ...(snapshot.ports ?? []).map(item => item.provenance?.sourceType),
      ...(snapshot.feedItems ?? []).map(item => item.provenance?.sourceType),
      ...(snapshot.voyages ?? []).map(item => item.provenance?.sourceType),
      ...(snapshot.events ?? []).map(item => item.provenance?.sourceType),
    ]
    check(provenanceSources.every(value => value !== "mock"), `no payload record carries mock provenance (${provenanceSources.filter(value => value === "mock").length} mock of ${provenanceSources.length})`)
    const providerModes = snapshot.provider ?? {}
    check(providerModes.dataMode === "real", `payload reports dataMode = ${providerModes.dataMode}`)
    check(!Object.values(providerModes).includes("mock"), `no capability silently fell back to Mock in Real Mode (${JSON.stringify(providerModes)})`)
    const mockStrings = JSON.stringify(snapshot).match(/MOCK DECOY/g) ?? []
    check(mockStrings.length === 0, `no decoy content leaked into the snapshot payload (${mockStrings.length})`)

    const searchCacheResponse = await (await fetch(`${BASE}/api/shipping/search/vessels?q=${encodeURIComponent(expectations.searchFixture.query)}`)).json()
    check(searchCacheResponse?.cacheHit === true, `cached identity lookup is served without a live provider call (cacheHit=${searchCacheResponse?.cacheHit})`)
    check(searchCacheResponse?.providerId === expectations.searchFixture.providerId, `cache answer attributed to provider ${searchCacheResponse?.providerId}`)
    check((searchCacheResponse?.results ?? []).length === 1, `one canonical identity returned for the shared name (${(searchCacheResponse?.results ?? []).length})`)
    check(searchCacheResponse?.results?.[0]?.imo === expectations.searchFixture.canonicalImo && searchCacheResponse?.results?.[0]?.mmsi === expectations.searchFixture.canonicalMmsi, `canonical identity carries IMO ${searchCacheResponse?.results?.[0]?.imo} / MMSI ${searchCacheResponse?.results?.[0]?.mmsi}`)

    const countersStart = snapshotCounters(db)

    /* ------------------------------------------- phase 4: browser flows */

    const local = new URL(BASE)
    profile = mkdtempSync(join(tmpdir(), "shipping-hot-s7-"))
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
        if (url.includes("/api/") && status >= 500) {
          const expected = url.includes(encodeURIComponent(expectations.providerUnavailableQuery))
          const record = `api ${status}: ${url}`
          if (expected) expectedProviderResponses.push(record)
          else unexpectedApiServerErrors.push(record)
        }
      }
      if (msg.method === "Network.requestWillBeSent") {
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
      await waitFor(async () => (await evaluate(`document.querySelectorAll('.d-panel, .tl-item, .glass-panel').length`)) > 0, 20000)
      // The shell paints immediately with a loading state, so content assertions
      // must wait for the data query to settle.
      await waitFor(async () => !(await evaluate(`document.body.innerText`)).includes("正在加载 Shipping HOT 数据"), 20000)
      if (path.startsWith("/vessels/") || path.startsWith("/ports/") || path.startsWith("/voyages/")) {
        await waitFor(async () => (await evaluate(`document.querySelectorAll('.d-title').length`)) > 0, 20000)
      }
      if (path.startsWith("/feed/")) {
        await waitFor(async () => (await evaluate(`document.querySelectorAll('.article-body').length`)) > 0, 20000)
      }
      await new Promise(resolve => setTimeout(resolve, 150))
      if (process.env.E2E_S7_DEBUG === "1") {
        const debugText = await evaluate(`document.body.innerText`)
        const debugUrl = await evaluate(`location.pathname`)
        console.log(`      [debug] ${path} -> url ${debugUrl} :: ${String(debugText).replace(/\s+/g, " ").slice(0, 320)}`)
        if (runtimeErrors.length > 0) console.log(`      [debug] errors so far: ${runtimeErrors.slice(0, 3).join(" | ")}`)
      }
    }

    const bodyText = () => evaluate(`document.body.innerText`)
    const pageUrl = () => evaluate(`location.pathname + location.search`)
    const api = async path => evaluate(`fetch(${JSON.stringify(path)}).then(async r => ({ status: r.status, body: await r.json().catch(() => undefined) }))`, true)

    const clickByText = async (selector, label) => {
      const clicked = await waitFor(async () => evaluate(`(() => {
        const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(candidate => candidate.textContent.trim() === ${JSON.stringify(label)})
        if (!node) return false
        node.click()
        return true
      })()`), 20000)
      if (!clicked) throw new Error(`control not found: ${selector} "${label}"`)
      await new Promise(resolve => setTimeout(resolve, 400))
    }

    /* ------------------------------------------------------------- Flow A */

    section("Flow A — vessel name -> canonical identity -> tracking -> voyage/ETA")
    const flowA = []
    const pushA = (ok, message) => {
      flowA.push({ ok, message })
      check(ok, `[A] ${message}`)
    }

    await navigate("/vessels")
    let text = await bodyText()
    pushA(norm(text).includes("搜索并关注船舶"), "vessel page renders the search panel")
    pushA(text.includes(expectations.vesselName) && text.includes(expectations.decoyVesselName), "both same-name vessels are listed by distinct records")

    // Same name must never collapse the two identities.
    const duplicateNames = (snapshot.vessels ?? []).filter(vessel => vessel.name === expectations.vesselName)
    pushA(duplicateNames.length === 2 && new Set(duplicateNames.map(vessel => vessel.id)).size === 2, `same vessel name maps to 2 distinct ids (${duplicateNames.map(v => `${v.id}:${v.imo}`).join(", ")})`)
    pushA(duplicateNames.some(vessel => vessel.imo === expectations.vesselImo) && duplicateNames.some(vessel => vessel.imo === expectations.decoyVesselImo), `the two records keep distinct IMOs ${expectations.vesselImo} / ${expectations.decoyVesselImo}`)

    // Search input: cached, provider-free identity answer.
    const typed = await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="搜索船舶"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(expectations.searchFixture.query)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    pushA(typed === true, "search box accepts the vessel name")
    await clickByText("button", "搜索")
    const searchRow = await waitFor(async () => evaluate(`(() => {
      const row = [...document.querySelectorAll('.list-row')].find(node => node.textContent.includes('IMO ${expectations.searchFixture.canonicalImo}'))
      return row ? row.textContent.replace(/\\s+/g, ' ').trim() : false
    })()`), 15000)
    pushA(Boolean(searchRow), `search returns the canonical identity IMO ${expectations.searchFixture.canonicalImo}`)
    pushA(Boolean(searchRow) && searchRow.includes(`MMSI ${expectations.searchFixture.canonicalMmsi}`), `search result carries MMSI ${expectations.searchFixture.canonicalMmsi}`)
    pushA(Boolean(searchRow) && !searchRow.includes(`IMO ${expectations.decoyVesselImo}`), "the same-name vessel with a different IMO is not mis-bound to this identity")

    // Honest provider-unavailable path: no fabrication, coded failure.
    const unavailable = await api(`/api/shipping/search/vessels?q=${encodeURIComponent(expectations.providerUnavailableQuery)}`)
    pushA(unavailable.status === 503, `unconfigured Vessel Search fails closed with 503 (got ${unavailable.status})`)
    pushA(unavailable.body?.data?.code === "provider_unavailable", `fail-closed response carries code provider_unavailable (got ${unavailable.body?.data?.code ?? unavailable.body?.message})`)
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label="搜索船舶"]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(expectations.providerUnavailableQuery)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await clickByText("button", "搜索")
    const searchPanelState = await waitFor(async () => evaluate(`(() => {
      const input = document.querySelector('input[aria-label="搜索船舶"]')
      const panel = input?.closest('.glass-panel')
      if (!panel) return false
      const message = panel.textContent.includes('搜索数据源异常') || panel.textContent.includes('搜索暂时不可用')
      if (!message) return false
      const fabricated = [...panel.querySelectorAll('.list-row')].filter(row => /IMO\\s+\\d{7}/.test(row.textContent)).length
      return { message, fabricated, text: panel.textContent.replace(/\\s+/g, ' ').trim() }
    })()`), 15000)
    pushA(Boolean(searchPanelState?.message), "the UI reports an honest unavailable state instead of inventing a vessel")
    pushA(searchPanelState?.fabricated === 0, `no result row is fabricated for an unresolved query (${searchPanelState?.fabricated})`)
    const unresolvedPanel = searchPanelState?.text ?? ""
    pushA(!/MMSI\s+\d{9}/.test(unresolvedPanel), "the unresolved query leaves the search panel free of invented MMSI identities")
    evidence.expectedProviderResponses = expectedProviderResponses

    // Vessel detail: identity, AIS, voyage/ETA.
    await navigate(`/vessels/${expectations.vesselId}`)
    text = await bodyText()
    const pageNorm = norm(text)
    pushA(pageNorm.includes(norm(`IMO ${expectations.vesselImo}`)), `detail shows IMO ${expectations.vesselImo}`)
    pushA(pageNorm.includes(norm(expectations.vesselMmsi)), `detail shows MMSI ${expectations.vesselMmsi}`)
    pushA(pageNorm.includes(norm(expectations.vesselDestination)), `detail shows the reported destination ${expectations.vesselDestination}`)
    pushA(pageNorm.includes("22.4707") && pageNorm.includes("113.9207"), "AIS latest position from the tracking store is displayed")
    pushA(pageNorm.includes("AISStream"), "AIS position is attributed to its real source")
    pushA(pageNorm.includes("未加入关注列表") === false, "the followed vessel exposes its tracking panel")
    const etaFragment = localDateFragment(expectations.vesselEta)
    pushA(pageNorm.includes(norm(etaFragment)), `voyage ETA date ${etaFragment} is rendered from the voyage record`)
    pushA(pageNorm.includes("ETA"), "the ETA field is present on the vessel detail")
    pushA(pageNorm.includes(expectations.voyageNumber), `voyage number ${expectations.voyageNumber} is rendered`)
    pushA(pageNorm.includes(norm("蛇口")), "voyage destination is resolved to the port identity")

    const positionApi = await api(`/api/shipping/vessels/${expectations.vesselId}/position`)
    pushA(positionApi.status === 200 && positionApi.body?.latitude === 22.4707, `latest-position API returns the seeded fix (${positionApi.status})`)
    const voyageApi = await api(`/api/shipping/vessels/${expectations.vesselId}/voyage`)
    pushA(voyageApi.status === 200 && voyageApi.body?.eta === expectations.vesselEta, "voyage API returns the ETA for the vessel")

    // Identity-only vessel: explicit unknown, never fabricated.
    await navigate(`/vessels/${expectations.identityOnlyVesselId}`)
    text = await bodyText()
    const unknownNorm = norm(text)
    pushA(unknownNorm.includes(norm("Unavailable (No MMSI)")), "identity-only vessel reports that AIS tracking is unavailable without MMSI")
    pushA(unknownNorm.includes("暂无航次数据") || unknownNorm.includes("暂无官方信息") || unknownNorm.includes("未知"), "an unknown voyage/destination is shown as unknown")
    const unknownVoyage = await api(`/api/shipping/vessels/${expectations.identityOnlyVesselId}/voyage`)
    pushA(unknownVoyage.status === 200 && !unknownVoyage.body?.eta, `unknown-ETA voyage returns no fabricated ETA (status ${unknownVoyage.status})`)
    const unknownFields = await evaluate(`(() => {
      const value = label => [...document.querySelectorAll('dt')]
        .filter(node => node.textContent.trim() === label)
        .map(node => node.nextElementSibling?.textContent.trim() ?? null)
      return { eta: value('ETA'), destination: value('目的港'), voyageNumber: value('航次号') }
    })()`)
    pushA((unknownFields.eta ?? []).length > 0 && unknownFields.eta.every(cell => cell === "—"), `every ETA field on the unknown vessel reads as an explicit placeholder (${JSON.stringify(unknownFields.eta)})`)
    pushA((unknownFields.destination ?? []).length > 0 && unknownFields.destination.every(cell => cell === "—" || cell === "暂无官方信息"), `destination is never invented for the unknown vessel (${JSON.stringify(unknownFields.destination)})`)
    pushA(unknownNorm.includes("未知") || unknownNorm.includes("暂无"), "unknown values are labelled instead of hidden")

    // List -> detail -> back navigation, and deep-link refresh.
    await navigate("/vessels")
    const openedDetail = await waitFor(async () => evaluate(`(() => {
      const link = [...document.querySelectorAll('a')].find(node => (node.getAttribute('href') ?? '').includes(${JSON.stringify(expectations.vesselId)}))
      if (!link) return false
      link.click()
      return true
    })()`), 15000)
    pushA(openedDetail === true, "vessel list links into the detail page")
    await waitFor(async () => (await pageUrl()).includes(expectations.vesselId), 10000)
    pushA((await pageUrl()).includes(`/vessels/${expectations.vesselId}`), `in-app navigation reached /vessels/${expectations.vesselId}`)
    await evaluate(`window.history.back()`)
    await waitFor(async () => (await pageUrl()) === "/vessels", 10000)
    pushA((await pageUrl()) === "/vessels", "browser back returns to the vessel list")
    pushA(norm(await bodyText()).includes(norm(expectations.vesselName)), "the returned-to list is fully rendered")

    evidence.flows.push({ flow: "A", checks: flowA.length, failed: flowA.filter(item => !item.ok).length })

    /* ------------------------------------------------------------- Flow B */

    section("Flow B — feed list -> detail -> original/Chinese/bilingual/historical")
    const flowB = []
    const pushB = (ok, message) => {
      flowB.push({ ok, message })
      check(ok, `[B] ${message}`)
    }

    await navigate("/feed")
    text = await bodyText()
    pushB(text.includes(expectations.articleTitle), "feed list shows the article item")
    pushB(!text.includes("MOCK DECOY"), "feed list shows no mock-source item")
    pushB(text.includes("模型预报") && text.includes("浪高") && text.includes("风速"), "weather-category item renders its forecast chips from stored weather detail")
    pushB(text.includes("72 小时") && text.includes("24 小时") && text.includes("7 天"), "weather chips expose the 24h/72h/7d windows")

    const detailOpened = await waitFor(async () => evaluate(`(() => {
      const item = [...document.querySelectorAll('.tl-item')].find(node => node.textContent.includes(${JSON.stringify(expectations.articleTitle)}))
      const chip = item ? [...item.querySelectorAll('a.chip')].find(node => node.textContent.trim() === '查看详情') : undefined
      if (!chip) return false
      chip.click()
      return true
    })()`), 15000)
    pushB(detailOpened === true, "feed list opens the article detail")
    await waitFor(async () => (await pageUrl()).includes(`/feed/${expectations.articleFeedId}`), 15000)
    pushB((await pageUrl()).includes(`/feed/${expectations.articleFeedId}`), `in-app navigation reached /feed/${expectations.articleFeedId}`)
    await waitFor(async () => (await bodyText()).includes("Shekou berth congestion eases after schedule recovery"), 20000)

    text = await bodyText()
    const articleNorm = norm(text)
    pushB(articleNorm.includes(norm("Shekou berth congestion eases after schedule recovery")), "article detail renders the original headline")
    pushB(articleNorm.includes("翻译进度：已完成"), "article detail reports the translation progress from the cache")
    pushB(articleNorm.includes(norm("其中历史缓存（非当前模型）1")), "a legacy-model cache row is labelled historical, not current")
    pushB(articleNorm.includes("Buffalo") === false && articleNorm.length > 0, "no unrelated fixture text leaked into the article view")

    const detail = await api(`/api/shipping/feed/${expectations.articleFeedId}`)
    const view = detail.body?.article?.translation
    pushB(detail.status === 200 && Boolean(view), `feed detail API returns article.translation (${detail.status})`)
    pushB(view?.versionId === expectations.articleVersionId, `translation view is version-scoped to ${expectations.articleVersionId}`)
    pushB(view?.total === 6 && view?.translated === 5, `5 of 6 blocks counted as translated (${view?.translated}/${view?.total})`)
    pushB(view?.historical === 1, `historical counter = ${view?.historical}`)
    pushB(view?.status === "complete", `full current-or-historical coverage reports complete status (${view?.status})`)

    await clickByText("button.fbtn", "中文")
    text = await bodyText()
    pushB(text.includes(expectations.translationSentinel), "中文 mode renders the cached Chinese translation")
    await clickByText("button.fbtn", "原文 / 中文")
    text = await bodyText()
    pushB((text.match(new RegExp(expectations.translationSentinel, "g")) ?? []).length >= 5, "bilingual mode pairs the original and the Chinese text")
    pushB(text.includes("Shekou berth congestion eases after schedule recovery"), "bilingual mode keeps the original text visible")
    await clickByText("button.fbtn", "原文")
    text = await bodyText()
    pushB(text.includes("Shekou berth congestion eases after schedule recovery"), "原文 mode returns to the original text")

    const reloaded = cdp.once("Page.loadEventFired")
    await cdp.send("Page.reload", { ignoreCache: true })
    await reloaded
    await waitFor(async () => (await evaluate(`document.querySelectorAll('.article-body').length`)) > 0, 20000)
    text = await bodyText()
    pushB(text.includes("Shekou berth congestion eases after schedule recovery"), "deep-link refresh restores the article page")
    pushB(!text.includes(expectations.translationSentinel), "refresh resets to 原文 without inventing a translation mode")

    await evaluate(`window.history.back()`)
    await waitFor(async () => (await pageUrl()).includes("/feed"), 10000)
    pushB((await bodyText()).includes(expectations.articleTitle), "back navigation restores the feed list")

    evidence.flows.push({ flow: "B", checks: flowB.length, failed: flowB.filter(item => !item.ok).length })

    /* ------------------------------------------------------------- Flow C */

    section("Flow C — ports, weather and calendar load and switch")
    const flowC = []
    const pushC = (ok, message) => {
      flowC.push({ ok, message })
      check(ok, `[C] ${message}`)
    }

    await navigate("/ports")
    text = await bodyText()
    pushC(text.includes("蛇口") && text.includes("盐田"), "port list renders both seeded ports")
    pushC(text.includes("CNSHK") && text.includes("CNYTN"), "port list keeps the UN/LOCODE identities")
    pushC(!text.includes("MOCK DECOY PORT"), "port list shows no mock-source port")

    await navigate(`/ports/${expectations.portId}`)
    text = await bodyText()
    const portNorm = norm(text)
    pushC(portNorm.includes(norm("蛇口")) && portNorm.includes("CNSHK"), "port detail shows name and UN/LOCODE")
    pushC(/拥堵|等待|high|高/.test(text), "port detail surfaces congestion information")
    pushC(text.includes("Swell and wind risk window"), "port detail lists the related weather item")

    await navigate("/feed")
    const weatherClicked = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.tl-item')].find(node => node.textContent.includes('Swell and wind risk window'))
      const button = card ? [...card.querySelectorAll('button.chip')].find(node => node.textContent.trim() === '24 小时') : undefined
      if (!button) return false
      button.click()
      return true
    })()`)
    pushC(weatherClicked === true, "weather item exposes its forecast window switch")
    const weatherWindow = await waitFor(async () => {
      const value = await evaluate(`(() => {
        const card = [...document.querySelectorAll('.tl-item')].find(node => node.textContent.includes('Swell and wind risk window'))
        return card ? card.textContent.replace(/\\s+/g, ' ').trim() : ''
      })()`)
      return value.includes("浪高2.4") ? value : false
    }, 10000)
    pushC(Boolean(weatherWindow), "switching to the 24h window recomputes the stored wave value")
    const weatherWindowFull = await waitFor(async () => {
      const value = await evaluate(`(() => {
        const card = [...document.querySelectorAll('.tl-item')].find(node => node.textContent.includes('Swell and wind risk window'))
        return card ? card.textContent.replace(/\\s+/g, ' ').trim() : ''
      })()`)
      return value.includes("风速42.0") ? value : false
    }, 10000)
    pushC(Boolean(weatherWindowFull), "the 24h wind value is recomputed alongside the wave value")
    const weatherReload = await waitFor(async () => evaluate(`(() => {
      const card = [...document.querySelectorAll('.tl-item')].find(node => node.textContent.includes('Swell and wind risk window'))
      return card ? card.textContent.replace(/\\s+/g, ' ').trim() : false
    })()`), 10000)
    pushC(Boolean(weatherReload) && weatherReload.includes("72 小时"), "the 72h window remains available alongside the 24h selection")

    // `/calendar` is the bundled annual reference calendar (provider-free). The
    // operational provider-calendar page in pages.tsx has no route in this build;
    // that observation is recorded in the evidence instead of being silently
    // accepted as verified behaviour.
    await navigate("/calendar")
    text = await bodyText()
    const currentYear = new Date().getUTCFullYear()
    pushC(text.includes("年度参考日历") || text.includes("东南亚假日台历"), "the calendar route renders the annual reference calendar")
    pushC(text.includes("未录入不代表没有假日") && text.includes("泰国资料不完整"), "country-specific incompleteness is stated instead of implied completeness")
    pushC(["印度尼西亚", "泰国", "马来西亚", "菲律宾", "越南"].every(country => text.includes(country)), "all five reference countries are offered")
    const monthHeading = () => evaluate(`document.querySelector('.annual-toolbar h2')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
    const headingBefore = await monthHeading()
    await clickByText("button[aria-label='下个月']", "›")
    const headingNext = await monthHeading()
    pushC(Boolean(headingBefore) && headingBefore !== headingNext, `advancing a month changes the calendar period (${headingBefore} -> ${headingNext})`)
    await clickByText("button[aria-label='上个月']", "‹")
    pushC((await monthHeading()) === headingBefore, "stepping back restores the original period")
    const yearSet = await evaluate(`(() => {
      const select = document.querySelector('select[aria-label="年份"]')
      if (!select) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      setter.call(select, String(new Date().getFullYear() + 1))
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    pushC(yearSet === true, "the year selector is available")
    const headingYear = await waitFor(async () => {
      const heading = await monthHeading()
      return heading.includes(String(currentYear + 1)) ? heading : false
    }, 10000)
    pushC(Boolean(headingYear), `switching the year reloads the ${currentYear + 1} calendar (${headingYear})`)
    const countryToggle = await evaluate(`(() => {
      const label = [...document.querySelectorAll('label.annual-country')].find(node => node.textContent.includes('泰国'))
      const input = label?.querySelector('input[type="checkbox"]')
      if (!input) return false
      input.click()
      return true
    })()`)
    pushC(countryToggle === true, "country selection is offered")
    const countryCount = await waitFor(async () => {
      const meta = await evaluate(`document.querySelector('.annual-month-meta')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
      return meta.includes("4 个国家已选") ? meta : false
    }, 10000)
    pushC(Boolean(countryCount), `deselecting 泰国 narrows the reference scope (${countryCount})`)
    const all = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === '全选')
      if (!button) return false
      button.click()
      return true
    })()`)
    pushC(all === true, "全选 restores the full reference scope")
    const calendarApi = await api("/api/shipping/calendar/reference")
    pushC(calendarApi.status === 200, `bundled calendar reference API -> ${calendarApi.status}`)

    for (const route of ["/", "/events", "/settings", "/voyages"]) {
      await navigate(route)
      const routeText = await bodyText()
      pushC(routeText.length > 0 && !routeText.includes("MOCK DECOY"), `${route} loads with real-data-only content`)
    }
    const voyagesApi = await api(`/api/shipping/vessels/${expectations.vesselId}/voyage`)
    pushC(voyagesApi.body?.destinationPortId === "CNSHK", "voyage destination identity resolves to CNSHK")

    evidence.flows.push({ flow: "C", checks: flowC.length, failed: flowC.filter(item => !item.ok).length })
    evidence.observations = [
      {
        id: "S7-OBS-01",
        topic: "calendar product surface",
        finding: "`/calendar` renders the bundled annual reference calendar. The operational provider-calendar page (CalendarPage in src/components/shipping/pages.tsx) is exported but has no route in this build.",
        disposition: "confirms the already-documented 2026-09-09 decision (operational-cache UI entry removed, legacy component left unmounted); recorded only, not changed in S7 because choosing the operational calendar surface is a product/scope decision and provider calendar completeness stays partial/BLOCKED",
      },
    ]

    /* ------------------------------------ phase 5: zero-delta and clean */

    section("Phase 4 — read-only browse window, zero external egress")
    const countersEnd = snapshotCounters(db)
    const delta = diffCounters(countersStart, countersEnd)
    evidence.counters = { before: countersStart, after: countersEnd, delta }
    check(delta.providerUsageRows === 0, `provider_usage delta = ${delta.providerUsageRows}`)
    check(delta.deepseekUsageRows === 0, `DeepSeek usage delta = ${delta.deepseekUsageRows}`)
    check(delta.translationUsageRows === 0, `translation usage delta = ${delta.translationUsageRows}`)
    check(delta.syncRunRows === 0, `sync_runs delta = ${delta.syncRunRows}`)
    check(delta.translationCacheRows === 0, `translation_cache writes delta = ${delta.translationCacheRows}`)
    check(delta.providerRuntimeRows === 0, `provider_runtime row delta = ${delta.providerRuntimeRows}`)
    check(delta.providerRuntimeState === undefined, `provider_runtime state unchanged${delta.providerRuntimeState ? `: ${String(delta.providerRuntimeState)}` : ""}`)
    check(delta.aisPositionRows === 0 && delta.aisLatestRows === 0, `AIS store is read-only during browsing (${delta.aisPositionRows}/${delta.aisLatestRows})`)
    check(delta.articleVersionRows === 0 && delta.articleFetchRows === 0, "article store is read-only during browsing")
    check(delta.voyageRows === 0 && delta.vesselRows === 0 && delta.portRows === 0 && delta.feedRows === 0, "operational stores are read-only during browsing")

    section("Phase 5 — browser and API cleanliness")
    check(runtimeErrors.length === 0, `unhandled runtime/console errors = ${runtimeErrors.length}`)
    for (const error of runtimeErrors.slice(0, 10)) console.log(`      ${error}`)
    check(unexpectedApiServerErrors.length === 0, `unexpected API 5xx responses = ${unexpectedApiServerErrors.length}`)
    for (const error of unexpectedApiServerErrors.slice(0, 10)) console.log(`      ${error}`)
    check(expectedProviderResponses.length > 0, `the deliberate unconfigured-provider probe returned its coded failure (${expectedProviderResponses.length} expected 5xx recorded separately)`)
    check(externalRequests.length === 0, `no outbound request left the machine during browsing (${externalRequests.length}${externalRequests.length ? `: ${externalHosts().join(", ")}` : ""})`)
    for (const url of externalRequests.slice(0, 10)) console.log(`      external: ${url}`)

    section("Phase 6 — retained data untouched")
    const retainedAfter = Object.fromEntries(RETAINED_DATABASES.map(path => [path, `${sha256Prefix(path)}|${fileStamp(path)}`]))
    evidence.retainedDatabases = { before: retainedBefore, after: retainedAfter }
    for (const path of RETAINED_DATABASES) {
      check(retainedBefore[path] === retainedAfter[path], `retained ${path.replace(`${ROOT}\\`, "")} unchanged (${retainedAfter[path]})`)
    }

    const totalChecks = passCount + failures.length
    evidence.phases.totals = {
      checks: totalChecks,
      passed: passCount,
      failed: failures.length,
      runtimeErrors: runtimeErrors.length,
      unexpectedApi5xx: unexpectedApiServerErrors.length,
      expectedProvider5xx: expectedProviderResponses.length,
      externalRequests: externalRequests.length,
    }
    evidence.failedChecks = failures
    const evidencePath = join(RUN_DIR, "s7-integrated-evidence.json")
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8")
    console.log(`\nEvidence: ${evidencePath}`)
    console.log(`\n${failures.length === 0 ? "S7 CLEAN LOCAL INTEGRATED ACCEPTANCE PASS" : `S7 CLEAN LOCAL INTEGRATED ACCEPTANCE FAIL (${failures.length})`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    try {
      if (db?.open) db.close()
    } catch {}
    await stopServer(server)
    if (chromeChild) chromeChild.kill("SIGKILL")
    if (profile) {
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {}
    }
    if (process.exitCode === 0 && serverLogPath) {
      try {
        rmSync(serverLogPath, { force: true })
      } catch {}
    }
  }
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

main().catch((error) => {
  console.error(`S7 E2E ERROR: ${error.message}`)
  process.exitCode = 1
})
