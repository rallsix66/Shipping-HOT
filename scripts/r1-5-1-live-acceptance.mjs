// R1.5-1 live acceptance: eight-port Open-Meteo + JMA in an isolated .tmp directory.
// Fixture tropical UI states remain covered by S7 (validated here by version + full check set).
//
// Usage: node scripts/r1-5-1-live-acceptance.mjs
// Env: E2E_R151_DIR (default .tmp/r1-5-1-live-<timestamp>), E2E_CHROME, E2E_R151_PORT, E2E_R151_DEBUG_PORT
//
// Verdicts (9/29 plan R1.5-1 is the business bar; no exceptions):
//   PASS    harness chain ran end-to-end AND every port has full seven-day marine + land coverage.
//   BLOCKED harness chain ran but business coverage is not met, or a prerequisite (Chrome, S7 evidence) is missing.
//   FAIL    the harness chain itself broke (seed/sync/server/API/browser assertion failure).
// Exit codes: PASS 0, FAIL 1, BLOCKED 2.
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"
import Database from "better-sqlite3"
import { evaluateForecastWindowCoverage } from "./lib/forecast-window-coverage.mjs"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ISOLATED_ROOT = resolve(join(ROOT, ".tmp"))
const RUN_DIR = resolve(process.env.E2E_R151_DIR ?? join(ISOLATED_ROOT, `r1-5-1-live-${new Date().toISOString().replace(/[:.]/g, "-")}`))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_R151_PORT ?? "4488")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R151_DEBUG_PORT ?? "9346")
const S7_EVIDENCE_PATH = join(ROOT, ".tmp", "s7-local", "s7-integrated-evidence.json")
/** S7 R1.5 check set size recorded at its last accepted run; a smaller set is not accepted as a pass. */
const S7_MIN_CHECKS = 151

const RETAINED = [
  join(ROOT, ".data", "shipping-hot-v3.sqlite3"),
  join(ROOT, ".data", "shipping-hot-v3-browser.sqlite3"),
  join(ROOT, ".data", "p7-final-seal-20260904.sqlite3"),
]

const PORT_IDS = [
  "port-shekou",
  "port-yantian",
  "port-nansha",
  "port-laem-chabang",
  "port-klang",
  "port-manila",
  "port-jakarta",
  "port-ho-chi-minh",
]

const PROVIDER_SECRET_ENV_KEYS = [
  "GFW_API_TOKEN",
  "VESSELAPI_API_KEY",
  "AISSTREAM_API_KEY",
  "CALENDARIFIC_API_KEY",
  "DEEPSEEK_API_KEY",
]

if (!RUN_DIR.startsWith(ISOLATED_ROOT + sep)) throw new Error(`E2E_R151_DIR must stay inside ${ISOLATED_ROOT}`)
if (RETAINED.includes(DB_PATH)) throw new Error("refusing retained database path")

const rel = path => relative(ROOT, path).split(sep).join("/")

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, encoding: "utf8" }).trim()
  } catch (error) {
    return `ERROR: ${String(error?.message ?? error).slice(0, 200)}`
  }
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

function spawnTsx(script, args = []) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [
      "--import",
      "tsx/esm",
      "--experimental-loader",
      pathToFileURL(join(ROOT, "scripts", "tsx-alias-loader.mjs")).href,
      join(ROOT, "scripts", script),
      ...args,
    ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } })
    let output = ""
    child.stdout.on("data", (c) => {
      output += c
    })
    child.stderr.on("data", (c) => {
      output += c
    })
    child.on("exit", code => resolvePromise({ code, output }))
  })
}

async function waitFor(check, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return true
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

function startServer(tag) {
  const logPath = join(RUN_DIR, `server-${tag}.log`)
  const logFd = openSync(logPath, "a")
  const env = { ...process.env }
  for (const key of PROVIDER_SECRET_ENV_KEYS) delete env[key]
  Object.assign(env, {
    SHIPPING_DATA_MODE: "real",
    SHIPPING_WEATHER_PROVIDER: "open-meteo",
    SHIPPING_RUNTIME_ENABLED: "false",
    SHIPPING_PORT_PROVIDER: "mock",
    SHIPPING_FEED_PROVIDER: "mock",
    SHIPPING_CALENDAR_PROVIDER: "mock",
    NITRO_HOST: "127.0.0.1",
    PORT: String(PORT),
    NITRO_PORT: String(PORT),
  })
  return {
    child: spawn(process.execPath, [SERVER_ENTRY], { cwd: RUN_DIR, env, stdio: ["ignore", logFd, logFd] }),
    logPath,
  }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => {
    child.once("exit", resolve)
    child.kill("SIGKILL")
    setTimeout(resolve, 5000)
  })
}

async function waitHealthy() {
  return waitFor(async () => (await fetch(`${BASE}/api/shipping/health`)).status < 500)
}

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`)
  const body = await res.json().catch(() => undefined)
  return { status: res.status, body }
}

function readDbRowsByPort() {
  const db = new Database(DB_PATH, { readonly: true })
  try {
    const total = db.prepare("SELECT COUNT(*) AS count FROM weather_forecast").get().count
    const stmt = db.prepare(`SELECT forecast_at, horizon, wave_height_m, swell_wave_height_m, wind_gust_kmh, precipitation_mm, visibility_m
      FROM weather_forecast WHERE port_id = ? ORDER BY forecast_at ASC`)
    const byPort = {}
    for (const portId of PORT_IDS) {
      byPort[portId] = stmt.all(portId).map(r => ({
        forecastAt: String(r.forecast_at),
        horizon: r.horizon === "current" ? "current" : "hourly",
        waveHeightM: r.wave_height_m ?? undefined,
        swellWaveHeightM: r.swell_wave_height_m ?? undefined,
        windGustKmh: r.wind_gust_kmh ?? undefined,
        precipitationMm: r.precipitation_mm ?? undefined,
        visibilityM: r.visibility_m ?? undefined,
      }))
    }
    return { total, byPort }
  } finally {
    db.close()
  }
}

function compactApi(res) {
  const body = res.body
  return {
    status: res.status,
    state: body?.state,
    asOf: body?.asOf,
    forecastsReturned: Array.isArray(body?.forecasts) ? body.forecasts.length : undefined,
    forecastMeta: body?.forecastMeta,
  }
}

/** Minimal CDP client: every call has a timeout and protocol errors reject. */
async function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket open timeout")), 10000)
    ws.addEventListener("open", () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("CDP websocket error"))
    })
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id)
      clearTimeout(timer)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`))
      else resolve(msg.result)
    }
  })
  const send = (method, params = {}, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const msgId = ++id
    const timer = setTimeout(() => {
      pending.delete(msgId)
      reject(new Error(`CDP ${method} timeout`))
    }, timeoutMs)
    pending.set(msgId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
  // send() resolves with the CDP `result` object; Runtime.evaluate nests the RemoteObject under result.result.
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true })
    if (result.exceptionDetails) throw new Error(`evaluate exception: ${result.exceptionDetails.text}`)
    return result.result?.value
  }
  return { ws, send, evaluate }
}

async function runBrowserChecks(chromePath, apiAfterRestart) {
  const userDataDir = join(RUN_DIR, "chrome-profile")
  mkdirSync(userDataDir, { recursive: true })
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" })
  let cdp
  try {
    const ready = await waitFor(async () => (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok, 20000)
    if (!ready) throw new Error("Chrome DevTools endpoint not ready within 20s")
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const page = targets.find(t => t.type === "page")
    if (!page?.webSocketDebuggerUrl) throw new Error("no CDP page target")
    cdp = await openCdp(page.webSocketDebuggerUrl)
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    const ports = {}
    for (const portId of PORT_IDS) {
      const meta = apiAfterRestart[portId]?.forecastMeta
      const portChecks = []
      const add = (id, pass, detail = "") => portChecks.push({ id, pass: Boolean(pass), detail })
      let text = ""
      let bodyText = ""
      try {
        const nav = await cdp.send("Page.navigate", { url: `${BASE}/ports/${portId}` })
        add("navigate_no_error", !nav.errorText, nav.errorText ?? "ok")
        const loaded = await waitFor(async () => (await cdp.evaluate("document.readyState")) === "complete", 30000)
        add("document_complete", loaded, loaded ? "complete" : "readyState timeout 30s")
        const metaReady = await waitFor(async () => {
          const t = await cdp.evaluate(`document.querySelector('[data-testid="port-weather-forecast-meta"]')?.innerText ?? ""`)
          return typeof t === "string" && t.trim().length > 0
        }, 30000)
        add("forecast_meta_rendered", metaReady, metaReady ? "data-testid=port-weather-forecast-meta" : "forecast meta element missing/empty after 30s")
        text = String(await cdp.evaluate(`document.querySelector('[data-testid="port-weather-forecast-meta"]')?.innerText ?? ""`) ?? "")
        bodyText = String(await cdp.evaluate(`document.body?.innerText ?? ""`) ?? "")
        add("page_text_non_empty", bodyText.trim().length > 0, `body ${bodyText.length} chars`)
        if (!meta) {
          add("api_meta_available", false, "no post-restart API forecastMeta to compare")
        } else {
          const expected = `hourly ${meta.actualCoverage.hourlyReturned} / current ${meta.actualCoverage.currentReturned}`
          add("browser_hourly_current_match_api", text.includes(expected), `expected "${expected}"`)
          add("browser_total_match_api", text.includes(`实际返回 ${meta.actualCoverage.totalReturned}`), `expected total ${meta.actualCoverage.totalReturned}`)
          if (meta.marineCoverageNote) add("browser_shows_marine_note", text.includes(meta.marineCoverageNote.slice(0, 12)), "marine coverage note rendered")
        }
      } catch (error) {
        add("browser_protocol", false, String(error?.message ?? error))
      }
      ports[portId] = { pass: portChecks.length > 0 && portChecks.every(c => c.pass), checks: portChecks, forecastMetaText: text.slice(0, 600) }
    }
    return { status: "RAN", chrome: chromePath, ports }
  } finally {
    try {
      cdp?.ws.close()
    } catch {}
    chrome.kill("SIGKILL")
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
  }
}

function validateS7(gitHead) {
  if (!existsSync(S7_EVIDENCE_PATH)) return { status: "NOT_RUN", pass: false, detail: "missing .tmp/s7-local/s7-integrated-evidence.json — run S7" }
  const ev = JSON.parse(readFileSync(S7_EVIDENCE_PATH, "utf8"))
  const totals = ev.phases?.totals ?? {}
  const flows = Array.isArray(ev.flows) ? ev.flows : []
  const checks = [
    { id: "s7_git_head_matches", pass: ev.gitHead === gitHead, detail: `s7 ${ev.gitHead ?? "missing"} vs run ${gitHead}` },
    { id: "s7_workspace_clean", pass: ev.workspaceClean === true, detail: `workspaceClean=${ev.workspaceClean}` },
    { id: "s7_full_check_set", pass: Number(totals.checks) >= S7_MIN_CHECKS, detail: `checks=${totals.checks} (min ${S7_MIN_CHECKS})` },
    { id: "s7_all_passed", pass: totals.checks > 0 && totals.passed === totals.checks && totals.failed === 0, detail: `passed=${totals.passed}/${totals.checks} failed=${totals.failed}` },
    { id: "s7_flows_abc", pass: ["A", "B", "C"].every(f => flows.some(x => x.flow === f && x.checks > 0 && x.failed === 0)), detail: JSON.stringify(flows) },
    { id: "s7_failed_checks_empty", pass: Array.isArray(ev.failedChecks) && ev.failedChecks.length === 0, detail: `failedChecks=${ev.failedChecks?.length}` },
    { id: "s7_hermetic", pass: totals.externalRequests === 0 && totals.runtimeErrors === 0 && totals.unexpectedApi5xx === 0, detail: `ext=${totals.externalRequests} rtErr=${totals.runtimeErrors} 5xx=${totals.unexpectedApi5xx}` },
  ]
  const pass = checks.every(c => c.pass)
  return { status: pass ? "PASS" : "FAIL", pass, evidencePath: rel(S7_EVIDENCE_PATH), totals, flows, checks }
}

async function main() {
  if (!existsSync(SERVER_ENTRY)) throw new Error("run pnpm build first")
  mkdirSync(RUN_DIR, { recursive: true })
  const startedAt = new Date().toISOString()
  const gitHead = git("rev-parse HEAD")
  const porcelain = git("status --porcelain --untracked-files=normal")
  const headCommitEpoch = Number(git("log -1 --format=%ct HEAD"))
  const buildMtimeMs = statSync(SERVER_ENTRY).mtimeMs
  const versionBinding = {
    gitHead,
    branch: git("rev-parse --abbrev-ref HEAD"),
    workspaceClean: porcelain === "",
    workspaceStatus: porcelain ? porcelain.split("\n") : [],
    buildSource: {
      serverEntry: rel(SERVER_ENTRY),
      builtAt: new Date(buildMtimeMs).toISOString(),
      headCommittedAt: new Date(headCommitEpoch * 1000).toISOString(),
      builtAfterHeadCommit: buildMtimeMs >= headCommitEpoch * 1000,
    },
    node: process.version,
  }

  const checks = []
  const push = (name, pass, detail = "", kind = "harness") => checks.push({ name, kind, pass: Boolean(pass), detail })
  const evidence = { acceptanceId: "R1.5-1", startedAt, runDir: rel(RUN_DIR), versionBinding }
  const writeEvidence = () => writeFileSync(join(RUN_DIR, "r1-5-1-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`)

  push("version_workspace_clean", versionBinding.workspaceClean, porcelain || "clean", "prerequisite")
  push("version_build_after_head_commit", versionBinding.buildSource.builtAfterHeadCommit, `${versionBinding.buildSource.builtAt} >= ${versionBinding.buildSource.headCommittedAt}`, "prerequisite")

  // 1) Seed — abort on failure, never continue to live sync.
  const seed = await spawnTsx("r1-5-1-port-seed.ts", [RUN_DIR])
  writeFileSync(join(RUN_DIR, "seed.log"), seed.output)
  push("port_seed", seed.code === 0, `exit=${seed.code}`)
  if (seed.code !== 0) {
    evidence.checks = checks
    evidence.verdict = "FAIL"
    evidence.abortedAt = "port_seed"
    writeEvidence()
    console.error(seed.output)
    console.log("R1.5-1 live acceptance: FAIL (seed failed; live sync not attempted)")
    process.exit(1)
  }

  // 2) Live sync (real egress) into the isolated DB.
  const sync = await spawnTsx("r1-5-1-sync-live.ts", [RUN_DIR])
  const jsonStart = sync.output.indexOf("{\n  \"kind\": \"r1-5-1-live-sync\"")
  writeFileSync(join(RUN_DIR, "sync.log"), jsonStart >= 0 ? sync.output.slice(0, jsonStart) : sync.output)
  push("live_sync_exit", sync.code === 0, `exit=${sync.code}`)
  if (sync.code !== 0 || jsonStart < 0) {
    evidence.checks = checks
    evidence.verdict = "FAIL"
    evidence.abortedAt = "live_sync"
    writeEvidence()
    console.error(sync.output.slice(-2000))
    console.log("R1.5-1 live acceptance: FAIL (live sync failed)")
    process.exit(1)
  }
  const syncEvidence = JSON.parse(sync.output.slice(jsonStart))
  syncEvidence.runDir = rel(syncEvidence.runDir)
  syncEvidence.databasePath = rel(syncEvidence.databasePath)
  writeFileSync(join(RUN_DIR, "r1-5-1-sync-live.json"), `${JSON.stringify(syncEvidence, null, 2)}\n`)
  const syncNowMs = Date.parse(syncEvidence.syncStartedAt)
  push("weather_job_success", syncEvidence.jobResults?.["weather-sync"]?.status === "success", JSON.stringify(syncEvidence.jobResults?.["weather-sync"]))
  push("jma_job_success", syncEvidence.jobResults?.["tropical-cyclone-sync"]?.status === "success", JSON.stringify(syncEvidence.jobResults?.["tropical-cyclone-sync"]))

  // 3) SQLite: full (untruncated) per-port coverage at sync time.
  const dbRows = readDbRowsByPort()
  push("sqlite_weather_forecast_rows", dbRows.total > 0, String(dbRows.total))
  const sqliteCoverage = {}
  for (const portId of PORT_IDS) {
    sqliteCoverage[portId] = evaluateForecastWindowCoverage(dbRows.byPort[portId], syncNowMs)
    push(`sqlite_rows_${portId}`, dbRows.byPort[portId].length > 0, `${dbRows.byPort[portId].length} rows`)
  }

  let serverA
  let serverB
  const apiBeforeRestart = {}
  const apiAfterRestart = {}
  const apiAfterRestartRows = {}
  let tropical
  let browserEvidence = { status: "NOT_RUN", reason: "not reached" }
  try {
    // 4) First start: API for all eight ports + JMA panel.
    serverA = startServer("a").child
    const readyA = await waitHealthy()
    push("server_first_start", readyA)
    if (!readyA) throw new Error("server A not healthy")
    for (const portId of PORT_IDS) {
      const res = await fetchJson(`/api/shipping/ports/${portId}/weather`)
      apiBeforeRestart[portId] = compactApi(res)
      push(`api_weather_${portId}`, res.status === 200 && Boolean(res.body?.forecastMeta), `status=${res.status}`)
    }
    tropical = await fetchJson("/api/shipping/tropical-cyclones")
    push("api_jma_panel", tropical.status === 200 && typeof tropical.body?.activeCount === "number", `status=${tropical.status} outcome=${tropical.body?.sync?.outcome}`)
    await stopServer(serverA)

    // 5) Restart: persistence + API for all eight ports; server stays up for the browser pass.
    serverB = startServer("b").child
    const readyB = await waitHealthy()
    push("server_restart", readyB)
    if (!readyB) throw new Error("server B not healthy after restart")
    for (const portId of PORT_IDS) {
      const res = await fetchJson(`/api/shipping/ports/${portId}/weather`)
      apiAfterRestart[portId] = compactApi(res)
      const rows = Array.isArray(res.body?.forecasts) ? res.body.forecasts : []
      apiAfterRestartRows[portId] = rows
      const before = apiBeforeRestart[portId]?.forecastMeta?.actualCoverage
      const after = res.body?.forecastMeta?.actualCoverage
      push(`restart_persistence_${portId}`, res.status === 200 && rows.length > 0, `status=${res.status} forecasts=${rows.length}`)
      // lastInstant is the end of stored data and must survive the restart; firstInstant may legitimately roll with now-1h.
      push(`restart_meta_stable_${portId}`, Boolean(before && after) && before.lastInstant === after.lastInstant && after.hourlyReturned > 0, `before last=${before?.lastInstant} after last=${after?.lastInstant} hourly=${after?.hourlyReturned}`)
    }

    // 6) Browser: all eight port pages against the restarted server.
    const chromePath = findChrome()
    if (!chromePath) {
      browserEvidence = { status: "NOT_RUN", reason: "no Chrome/Edge found (set E2E_CHROME)" }
      push("browser_eight_ports", false, browserEvidence.reason, "prerequisite")
    } else {
      try {
        browserEvidence = await runBrowserChecks(chromePath, apiAfterRestart)
        for (const portId of PORT_IDS) {
          const p = browserEvidence.ports[portId]
          push(`browser_${portId}`, p?.pass, p ? p.checks.filter(c => !c.pass).map(c => `${c.id}: ${c.detail}`).join("; ") || "all assertions pass" : "missing")
        }
      } catch (error) {
        browserEvidence = { status: "ERROR", error: String(error?.message ?? error) }
        push("browser_eight_ports", false, browserEvidence.error)
      }
    }
  } catch (error) {
    push("harness_chain", false, String(error?.message ?? error))
  } finally {
    await stopServer(serverA)
    await stopServer(serverB)
  }

  // 7) Business coverage (9/29 plan R1.5-1): every port, seven-day marine + land, no exceptions.
  const portCoverage = {}
  for (const portId of PORT_IDS) {
    const sqlite = sqliteCoverage[portId]
    const apiNowMs = Date.parse(apiAfterRestart[portId]?.asOf ?? "")
    const api = Number.isFinite(apiNowMs) ? evaluateForecastWindowCoverage(apiAfterRestartRows[portId] ?? [], apiNowMs) : undefined
    const dbHourlyInApiWindow = Number.isFinite(apiNowMs) ? evaluateForecastWindowCoverage(dbRows.byPort[portId], apiNowMs).hourlyInWindow : undefined
    const truncation = {
      dbHourlyInWindow: dbHourlyInApiWindow,
      apiHourlyReturned: apiAfterRestart[portId]?.forecastMeta?.actualCoverage?.hourlyReturned,
      squeezed: dbHourlyInApiWindow !== undefined && (apiAfterRestart[portId]?.forecastMeta?.actualCoverage?.hourlyReturned ?? -1) < dbHourlyInApiWindow,
    }
    push(`api_not_truncated_${portId}`, !truncation.squeezed, JSON.stringify(truncation))
    const pass = Boolean(sqlite?.pass && api?.pass)
    portCoverage[portId] = { pass, sqliteAtSync: sqlite, apiAfterRestart: api, truncation }
    push(`coverage_${portId}`, pass, [...new Set([...(sqlite?.failed ?? []), ...(api?.failed ?? ["api_unavailable"])])].join(", ") || "full seven-day marine + land", "business")
  }

  // 8) JMA: archived (stored) records vs focus-area active count, reported separately.
  const jma = {
    syncOutcome: syncEvidence.jma?.syncMeta?.outcome,
    archivedStoredCycloneCount: syncEvidence.jma?.storedCycloneCount,
    archivedCycloneIds: syncEvidence.jma?.storedCycloneIds,
    focusAreaActiveCount: tropical?.body?.activeCount,
    historicalSummaryCount: tropical?.body?.historicalSummaryCount,
    panelMessageZh: tropical?.body?.messageZh,
    note: "archivedStoredCycloneCount counts JMA records persisted by this sync; focusAreaActiveCount is the panel's active cyclones after focus-area / 1000 km visibility rules. They are not interchangeable.",
  }
  push("jma_archived_live", jma.syncOutcome === "ok" || jma.syncOutcome === "ok_empty", `outcome=${jma.syncOutcome} archived=${jma.archivedStoredCycloneCount} active=${jma.focusAreaActiveCount}`)

  // 9) Fixture browser (S7): bound to the same commit and full check set.
  const s7 = validateS7(gitHead)
  push("fixture_s7_bound", s7.pass, s7.checks ? s7.checks.filter(c => !c.pass).map(c => `${c.id}: ${c.detail}`).join("; ") || "bound + full set pass" : s7.detail, s7.status === "NOT_RUN" ? "prerequisite" : "harness")

  const harnessFailed = checks.filter(c => c.kind === "harness" && !c.pass)
  const prereqMissing = checks.filter(c => c.kind === "prerequisite" && !c.pass)
  const businessFailed = checks.filter(c => c.kind === "business" && !c.pass)
  const verdict = harnessFailed.length ? "FAIL" : (prereqMissing.length || businessFailed.length ? "BLOCKED" : "PASS")

  const subChains = {
    seedToIsolatedDb: checks.find(c => c.name === "port_seed")?.pass ? "VERIFIED" : "FAIL",
    liveWeatherSyncToSqlite: PORT_IDS.every(p => checks.find(c => c.name === `sqlite_rows_${p}`)?.pass) && checks.find(c => c.name === "weather_job_success")?.pass ? "VERIFIED" : "FAIL",
    restartPersistenceApiEightPorts: PORT_IDS.every(p => checks.find(c => c.name === `restart_persistence_${p}`)?.pass && checks.find(c => c.name === `restart_meta_stable_${p}`)?.pass) ? "VERIFIED" : "FAIL",
    browserEightPortPages: browserEvidence.status !== "RAN" ? browserEvidence.status === "NOT_RUN" ? "NOT_RUN" : "FAIL" : PORT_IDS.every(p => browserEvidence.ports[p]?.pass) ? "VERIFIED" : "FAIL",
    apiNotTruncated: PORT_IDS.every(p => !portCoverage[p].truncation.squeezed) ? "VERIFIED" : "FAIL",
    jmaLiveArchive: checks.find(c => c.name === "jma_archived_live")?.pass ? "VERIFIED" : "FAIL",
    fixtureTropicalBrowserS7: s7.status === "PASS" ? "VERIFIED" : s7.status,
    sevenDayCoveragePerPort: Object.fromEntries(PORT_IDS.map(p => [p, portCoverage[p].pass ? "PASS" : `BLOCKED: ${[...new Set([...(portCoverage[p].sqliteAtSync?.failed ?? []), ...(portCoverage[p].apiAfterRestart?.failed ?? [])])].join(", ")}`])),
  }

  Object.assign(evidence, {
    completedAt: new Date().toISOString(),
    liveNetwork: { openMeteo: true, jma: true },
    criteria: "9/29 plan R1.5-1: all eight ports need seven-day marine and land forecasts. Window [now-1h, now+7d], hourly only, every whole UTC hour present once with land fields (windGust, precipitation, visibility) and marine (wave or swell). current rows reported separately. A coverage note is degradation display, not coverage.",
    syncEvidence,
    apiBeforeRestart,
    apiAfterRestart,
    portCoverage,
    jma,
    tropicalPanel: tropical?.body ? { asOf: tropical.body.asOf, sync: tropical.body.sync, activeCount: tropical.body.activeCount, historicalSummaryCount: tropical.body.historicalSummaryCount, messageZh: tropical.body.messageZh } : undefined,
    browserEvidence,
    fixtureS7: s7,
    subChains,
    checks,
    summary: { total: checks.length, passed: checks.filter(c => c.pass).length, harnessFailed: harnessFailed.map(c => c.name), prerequisiteMissing: prereqMissing.map(c => c.name), businessBlocked: businessFailed.map(c => c.name) },
    verdict,
  })
  writeEvidence()
  console.log(`Evidence: ${join(RUN_DIR, "r1-5-1-evidence.json")}`)
  console.log(JSON.stringify(evidence.summary, null, 2))
  console.log(JSON.stringify(subChains, null, 2))
  console.log(`R1.5-1 live acceptance: ${verdict}`)
  process.exit(verdict === "PASS" ? 0 : verdict === "BLOCKED" ? 2 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
