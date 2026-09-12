// Repeatable real-browser acceptance for Shipping HOT.
//
// Usage: start the built server against an isolated DB, then:
//   E2E_BASE_URL=http://127.0.0.1:4444 node scripts/e2e-smoke.mjs
//   E2E_VERIFY_ONLY=1 E2E_EXPECT_REFRESH=21 node scripts/e2e-smoke.mjs
//
// It drives headless Chrome over the DevTools Protocol (no extra dependency; Node 24
// provides a global WebSocket) and fails on any unhandled runtime/API error.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:4444").replace(/\/$/, "")
const VERIFY_ONLY = process.env.E2E_VERIFY_ONLY === "1"
const EXPECT_REFRESH = Number(process.env.E2E_EXPECT_REFRESH ?? "21")
const DEBUG_PORT = Number(process.env.E2E_DEBUG_PORT ?? "9333")
const ROUTES = ["/", "/vessels", "/ports", "/voyages", "/feed", "/calendar", "/settings", "/events"]

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

const failures = []
const apiErrors = []
function check(condition, message) {
  if (condition) {
    console.log(`PASS  ${message}`)
  } else {
    failures.push(message)
    console.log(`FAIL  ${message}`)
  }
}

async function waitFor(fn, timeoutMs = 20000, intervalMs = 150) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, intervalMs))
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

function isBenign(message) {
  return message.includes("favicon") || message.includes("swx.js") || message.includes("service-worker")
}

async function main() {
  const chrome = findChrome()
  if (!chrome) throw new Error("No Chrome/Edge executable found; set E2E_CHROME")
  const profile = mkdtempSync(join(tmpdir(), "shipping-hot-e2e-"))
  const child = spawn(chrome, [
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

  try {
    const version = await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
        return res.ok ? await res.json() : undefined
      } catch {
        return undefined
      }
    }, 20000)
    if (!version) throw new Error("Chrome DevTools endpoint did not become ready")

    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
    const page = targets.find(target => target.type === "page")
    if (!page) throw new Error("No page target")
    const cdp = await connect(page.webSocketDebuggerUrl)

    cdp.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        const text = msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "exception"
        if (!isBenign(text)) apiErrors.push(`runtime exception: ${text}`)
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const text = (msg.params.args ?? []).map(arg => arg.value ?? arg.description ?? "").join(" ")
        if (!isBenign(text)) apiErrors.push(`console error: ${text}`)
      }
      if (msg.method === "Network.responseReceived") {
        const { url, status } = msg.params.response
        if (url.includes("/api/") && status >= 400) apiErrors.push(`api ${status}: ${url}`)
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
      await waitFor(async () => (await evaluate(`document.querySelectorAll('.shipping-shell').length`)) > 0, 15000)
    }

    // 1. All routes render the Shipping HOT shell without unhandled errors.
    for (const route of ROUTES) {
      await navigate(route)
      const shell = await evaluate(`document.querySelectorAll('.shipping-shell').length`)
      const title = await evaluate(`document.title`)
      check(shell > 0 && title === "Shipping HOT", `route ${route} renders shell + title`)
    }
    const navCount = await evaluate(`document.querySelectorAll('a[href="/"], a[href="/vessels"], a[href="/ports"], a[href="/voyages"], a[href="/feed"], a[href="/calendar"], a[href="/settings"], a[href="/events"]').length`)
    check(navCount >= 8, `navigation exposes all 8 Shipping routes (found ${navCount})`)

    // 2. Deep link + reload.
    await navigate("/vessels")
    const deepLink = await evaluate(`location.pathname`)
    check(deepLink === "/vessels", "deep link /vessels lands on /vessels")
    await navigate("/vessels", { reload: true })
    check((await evaluate(`document.querySelectorAll('.shipping-shell').length`)) > 0, "refresh on deep link keeps rendering")

    // 3. History back/forward.
    await navigate("/ports")
    await evaluate(`history.back()`)
    const backPath = await waitFor(async () => {
      const path = await evaluate(`location.pathname`)
      return path === "/vessels" ? path : undefined
    }, 8000)
    check(backPath === "/vessels", "history back returns to /vessels")
    await evaluate(`history.forward()`)
    const forwardPath = await waitFor(async () => {
      const path = await evaluate(`location.pathname`)
      return path === "/ports" ? path : undefined
    }, 8000)
    check(forwardPath === "/ports", "history forward returns to /ports")

    // 4. Settings write from the real browser origin (same-origin fetch) + readback.
    await navigate("/settings")
    if (!VERIFY_ONLY) {
      const status = await evaluate(`fetch("/api/shipping/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshInterval: ${EXPECT_REFRESH} }) }).then(r => r.status)`, true)
      check(status === 200, `browser same-origin settings write -> ${status}`)
      const watchStatus = await evaluate(`fetch("/api/shipping/watch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "vessel", id: "vessel-cosco-harmony" }) }).then(r => r.status)`, true)
      check(watchStatus === 200, `browser watch write -> ${watchStatus}`)
    }
    const refresh = await evaluate(`fetch("/api/shipping").then(r => r.json()).then(s => s.settings.refreshInterval)`, true)
    check(refresh === EXPECT_REFRESH, `settings readback refreshInterval=${refresh} (expected ${EXPECT_REFRESH})`)
    const watched = await evaluate(`fetch("/api/shipping").then(r => r.json()).then(s => (s.vessels.find(v => v.id === "vessel-cosco-harmony") || {}).isWatched)`, true)
    check(watched === true, "watched vessel persists in the browser read model")

    // 5. Calendar: month switch + day selection/detail.
    await navigate("/calendar")
    const dayCount = await evaluate(`document.querySelectorAll('button.annual-day').length`)
    check(dayCount > 0, `calendar grid renders days (${dayCount})`)
    const monthBefore = await evaluate(`document.querySelector('select[aria-label="月份"]')?.value ?? null`)
    await evaluate(`document.querySelector('button[aria-label="下个月"]')?.click()`)
    const monthAfter = await waitFor(async () => {
      const value = await evaluate(`document.querySelector('select[aria-label="月份"]')?.value ?? null`)
      return value !== null && value !== monthBefore ? value : undefined
    }, 6000)
    check(monthAfter !== undefined, `calendar month switch ${monthBefore} -> ${monthAfter}`)
    await evaluate(`document.querySelectorAll('button.annual-day:not(.outside)')[6]?.click()`)
    const detailHeading = await waitFor(async () => (await evaluate(`document.querySelector('.annual-details h2')?.textContent ?? null`)), 6000)
    check(typeof detailHeading === "string" && detailHeading.includes("/"), `calendar day detail shows a date (${detailHeading})`)

    // 6. No unhandled runtime/API errors across the whole run.
    check(apiErrors.length === 0, `no unhandled runtime/API errors (${apiErrors.length})`)
    if (apiErrors.length > 0) {
      for (const error of apiErrors) console.log(`      ${error}`)
    }

    console.log(`\n${failures.length === 0 ? "E2E PASS" : `E2E FAIL (${failures.length})`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    child.kill("SIGKILL")
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((error) => {
  console.error(`E2E ERROR: ${error.message}`)
  process.exitCode = 1
})
