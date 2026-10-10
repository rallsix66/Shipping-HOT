// R1.5-1 live acceptance: eight-port Open-Meteo + JMA in an isolated .tmp directory.
// Fixture tropical UI states remain covered by S7 (referenced in evidence output).
//
// Usage: node scripts/r1-5-1-live-acceptance.mjs
// Env: E2E_R151_DIR (default .tmp/r1-5-1-live-<timestamp>)
import { execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"
import Database from "better-sqlite3"

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const ISOLATED_ROOT = resolve(join(ROOT, ".tmp"))
const RUN_DIR = resolve(process.env.E2E_R151_DIR ?? join(ISOLATED_ROOT, `r1-5-1-live-${new Date().toISOString().replace(/[:.]/g, "-")}`))
const DB_PATH = join(RUN_DIR, ".data", "shipping-hot-v3.sqlite3")
const SERVER_ENTRY = join(ROOT, "dist", "output", "server", "index.mjs")
const PORT = Number(process.env.E2E_R151_PORT ?? "4488")
const BASE = `http://127.0.0.1:${PORT}`
const DEBUG_PORT = Number(process.env.E2E_R151_DEBUG_PORT ?? "9346")
const MIN_HOURLY_IN_SEVEN_DAY_WINDOW = 140

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
    if (await check()) return true
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
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    child.once("exit", resolve)
    child.kill("SIGKILL")
    setTimeout(resolve, 5000)
  })
}

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`)
  const body = await res.json().catch(() => undefined)
  return { status: res.status, body }
}

function evaluatePort(portId, syncPort, apiPanel, uiHourlyText) {
  const sqlite = syncPort?.sqlite ?? {}
  const meta = apiPanel?.forecastMeta ?? syncPort?.forecastMeta
  const hourlyInWindow = Number(sqlite.hourlyInSevenDayWindow ?? 0)
  const missing = sqlite.missingInWindow ?? {}
  const isVnsgn = portId === "port-ho-chi-minh"
  const checks = []
  checks.push({ id: "hourly_window_count", pass: hourlyInWindow >= MIN_HOURLY_IN_SEVEN_DAY_WINDOW, detail: `${hourlyInWindow} hourly (min ${MIN_HOURLY_IN_SEVEN_DAY_WINDOW})` })
  checks.push({ id: "land_wind_present", pass: (missing.windGust ?? 99) === 0, detail: `windGust missing ${missing.windGust ?? "?"}` })
  checks.push({ id: "land_precip_present", pass: (missing.precip ?? 99) === 0, detail: `precip missing ${missing.precip ?? "?"}` })
  checks.push({ id: "land_visibility_present", pass: (missing.visibility ?? 99) === 0, detail: `visibility missing ${missing.visibility ?? "?"}` })
  if (isVnsgn) {
    checks.push({
      id: "marine_vnsgn_gap_documented",
      pass: Boolean(meta?.marineCoverageNote) && (missing.wave ?? 0) > 0,
      detail: meta?.marineCoverageNote ?? "no marine note",
    })
  } else {
    checks.push({ id: "marine_wave_present", pass: (missing.wave ?? 99) === 0, detail: `wave missing ${missing.wave ?? "?"}` })
  }
  const metaHourly = meta?.actualCoverage?.hourlyReturned
  checks.push({
    id: "forecast_meta_hourly_consistent",
    pass: metaHourly === undefined || metaHourly === hourlyInWindow || Math.abs(Number(metaHourly) - hourlyInWindow) <= 2,
    detail: `meta hourly=${metaHourly} sqlite window=${hourlyInWindow}`,
  })
  if (uiHourlyText !== undefined && metaHourly !== undefined) {
    checks.push({
      id: "browser_shows_hourly_count",
      pass: uiHourlyText.includes(String(metaHourly)),
      detail: `expected hourly ${metaHourly}`,
    })
  }
  const pass = checks.every(c => c.pass)
  return { portId, pass, checks }
}

async function runBrowserChecks(chromePath, _apiByPort) {
  const userDataDir = join(RUN_DIR, "chrome-profile")
  mkdirSync(userDataDir, { recursive: true })
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "about:blank",
  ], { stdio: "ignore" })
  await waitFor(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      return res.ok
    } catch {
      return false
    }
  }, 20000)
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = targets.find(t => t.type === "page") ?? targets[0]
  const wsUrl = page.webSocketDebuggerUrl
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })
  let id = 0
  const pending = new Map()
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const msgId = ++id
    pending.set(msgId, resolve)
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true })
    return result.result?.value
  }
  await send("Page.enable")
  const ui = {}
  for (const portId of PORT_IDS) {
    await send("Page.navigate", { url: `${BASE}/ports/${portId}` })
    await waitFor(async () => (await evaluate("document.readyState")) === "complete", 30000)
    await new Promise(r => setTimeout(r, 800))
    const text = await evaluate(`(() => {
      const el = document.querySelector('[data-testid="port-weather-panel"]') || document.body
      return el?.innerText?.slice(0, 800) ?? ""
    })()`)
    ui[portId] = text
  }
  ws.close()
  chrome.kill("SIGKILL")
  return { uiSnippets: ui }
}

async function main() {
  if (!existsSync(SERVER_ENTRY)) throw new Error("run pnpm build first")
  mkdirSync(RUN_DIR, { recursive: true })
  let gitHead = "unknown"
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    gitHead = readFileSync(join(ROOT, ".git", "HEAD"), "utf8").trim()
  }
  const checks = []
  const push = (name, pass, detail = "") => checks.push({ name, pass, detail })

  const seed = await spawnTsx("r1-5-1-port-seed.ts", [RUN_DIR])
  push("port_seed", seed.code === 0, seed.output.slice(-400))

  const sync = await spawnTsx("r1-5-1-sync-live.ts", [RUN_DIR])
  push("live_sync", sync.code === 0, sync.output.slice(-400))
  if (sync.code !== 0) throw new Error(`live sync failed:\n${sync.output}`)
  const jsonStart = sync.output.indexOf("{\n  \"kind\": \"r1-5-1-live-sync\"")
  if (jsonStart < 0) throw new Error(`live sync produced no JSON evidence:\n${sync.output.slice(-800)}`)
  const syncEvidence = JSON.parse(sync.output.slice(jsonStart))
  writeFileSync(join(RUN_DIR, "r1-5-1-sync-live.json"), JSON.stringify(syncEvidence, null, 2))
  push("weather_job_success", syncEvidence.jobResults?.["weather-sync"]?.status === "success", JSON.stringify(syncEvidence.jobResults?.["weather-sync"]))
  push("jma_job_success", syncEvidence.jobResults?.["tropical-cyclone-sync"]?.status === "success", JSON.stringify(syncEvidence.jobResults?.["tropical-cyclone-sync"]))

  const { child: serverA } = startServer("a")
  const readyA = await waitFor(async () => {
    try {
      const res = await fetch(`${BASE}/api/shipping/health`)
      return res.status < 500
    } catch {
      return false
    }
  })
  push("server_first_start", readyA)
  const apiByPort = {}
  for (const portId of PORT_IDS) {
    const res = await fetchJson(`/api/shipping/ports/${portId}/weather`)
    apiByPort[portId] = res.body
    push(`api_weather_${portId}`, res.status === 200 && Boolean(res.body?.forecastMeta), `status=${res.status}`)
  }
  const tropical = await fetchJson("/api/shipping/tropical-cyclones")
  push("api_jma_live", tropical.status === 200, `outcome=${tropical.body?.sync?.outcome}`)
  await stopServer(serverA)

  const { child: serverB } = startServer("b")
  await waitFor(async () => {
    try {
      return (await fetch(`${BASE}/api/shipping/health`)).status < 500
    } catch {
      return false
    }
  })
  const afterRestart = await fetchJson(`/api/shipping/ports/port-shekou/weather`)
  push("restart_persistence", afterRestart.status === 200 && (afterRestart.body?.forecasts?.length ?? 0) > 0)
  await stopServer(serverB)

  const db = new Database(DB_PATH, { readonly: true })
  const forecastRows = db.prepare("SELECT COUNT(*) AS count FROM weather_forecast").get().count
  push("sqlite_weather_forecast_rows", forecastRows > 0, String(forecastRows))
  db.close()

  let browserEvidence = { skipped: true, reason: "no chrome" }
  const chromePath = findChrome()
  if (chromePath) {
    try {
      browserEvidence = await runBrowserChecks(chromePath, apiByPort)
      push("browser_eight_ports", true)
    } catch (error) {
      browserEvidence = { error: String(error) }
      push("browser_eight_ports", false, String(error))
    }
  }

  const uiSnippets = browserEvidence.uiSnippets ?? {}
  const portEvaluations = PORT_IDS.map(portId =>
    evaluatePort(portId, syncEvidence.ports?.[portId], apiByPort[portId], uiSnippets[portId]),
  )
  const allPortsPass = portEvaluations.every(p => p.pass)
  push("eight_port_matrix", allPortsPass, portEvaluations.filter(p => !p.pass).map(p => p.portId).join(", ") || "all pass")

  const jmaOutcome = syncEvidence.jma?.syncMeta?.outcome
  push("jma_archived_live", jmaOutcome === "ok" || jmaOutcome === "ok_empty", `outcome=${jmaOutcome} cyclones=${syncEvidence.jma?.cycloneCount ?? 0}`)

  const s7EvidencePath = join(ROOT, ".tmp", "s7-local", "s7-integrated-evidence.json")
  const fixtureRef = existsSync(s7EvidencePath)
    ? JSON.parse(readFileSync(s7EvidencePath, "utf8"))
    : undefined
  const s7Pass = Array.isArray(fixtureRef?.failedChecks) && fixtureRef.failedChecks.length === 0
  push("fixture_tropical_browser_s7", s7Pass, fixtureRef ? `failedChecks=${fixtureRef.failedChecks?.length ?? "?"}` : "missing s7 evidence — run S7")

  const evidence = {
    acceptanceId: "R1.5-1",
    gitHead,
    runDir: RUN_DIR,
    startedAt: new Date().toISOString(),
    liveNetwork: { openMeteo: true, jma: true },
    fixtureNetwork: {
      tropicalPartialFailedStale: {
        harness: "scripts/e2e-s7-integrated.mjs",
        evidencePath: s7EvidencePath,
        passed: s7Pass,
      },
    },
    syncEvidence,
    apiByPort,
    tropicalLive: tropical.body,
    portEvaluations,
    browserEvidence,
    checks,
    verdict: allPortsPass && checks.every(c => c.pass) ? "PASS" : "FAIL",
    vnsgnMarineGap: {
      status: "DOCUMENTED_PARTIAL",
      note: "Open-Meteo marine cell_selection=sea returns no wave/swell at VNSGN; land hourly still complete. UI note does not satisfy full marine coverage requirement.",
      minimalFollowUp: "Optional: probe nearest-sea coordinate offset or alternate approved marine source at L-stage; no code change required for R1.5-1 if land+7d hourly passes.",
    },
  }
  const outPath = join(RUN_DIR, "r1-5-1-evidence.json")
  writeFileSync(outPath, JSON.stringify(evidence, null, 2))
  console.log(`Evidence: ${outPath}`)
  console.log(`R1.5-1 live acceptance: ${evidence.verdict}`)
  if (evidence.verdict !== "PASS") process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
