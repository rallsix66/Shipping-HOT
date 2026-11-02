/**
 * Test-only Provider/transport spy for R3-6 isolated Nitro subprocess.
 * Loaded via `node --import <this-file> dist/.../index.mjs`.
 * - Records attempted non-local fetch calls independently of DB ledgers
 * - Blocks outbound (throws); does not change OS/firewall or production code
 * - Control plane on 127.0.0.1:E2E_R36_SPY_PORT — /stats /reset /probe
 */
import http from "node:http"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import process from "node:process"

const spyFile = process.env.E2E_R36_SPY_FILE
const spyPort = Number(process.env.E2E_R36_SPY_PORT || "0")
if (!spyFile || !Number.isFinite(spyPort) || spyPort <= 0) {
  throw new Error("e2e-r3-6-provider-spy requires E2E_R36_SPY_FILE and E2E_R36_SPY_PORT")
}

const state = {
  attempts: [],
  blocked: 0,
  allowedLocal: 0,
}

function isLocalUrl(urlStr) {
  try {
    const host = new URL(urlStr).hostname
    return host === "127.0.0.1" || host === "localhost" || host === "::1"
  } catch {
    return false
  }
}

function persist() {
  mkdirSync(dirname(spyFile), { recursive: true })
  writeFileSync(
    spyFile,
    JSON.stringify(
      {
        attemptCount: state.attempts.length,
        blocked: state.blocked,
        allowedLocal: state.allowedLocal,
        attempts: state.attempts.slice(-100),
      },
      null,
      2,
    ),
  )
}

const originalFetch = globalThis.fetch.bind(globalThis)
globalThis.fetch = async (input, init = undefined) => {
  const url = typeof input === "string" ? input : input && typeof input === "object" && "url" in input ? String(input.url) : String(input)
  if (isLocalUrl(url)) {
    state.allowedLocal += 1
    return originalFetch(input, init)
  }
  const method = (init && init.method) || (typeof input === "object" && input && "method" in input && input.method) || "GET"
  state.attempts.push({
    url,
    method: String(method),
    at: new Date().toISOString(),
    via: "globalThis.fetch",
  })
  state.blocked += 1
  persist()
  throw new TypeError(`E2E_PROVIDER_SPY_BLOCKED ${url}`)
}

persist()

const control = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0]
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(body))
  }
  try {
    if (path === "/stats" && req.method === "GET") {
      return json(200, {
        attemptCount: state.attempts.length,
        blocked: state.blocked,
        allowedLocal: state.allowedLocal,
        attempts: state.attempts,
      })
    }
    if (path === "/reset" && req.method === "POST") {
      state.attempts = []
      state.blocked = 0
      state.allowedLocal = 0
      persist()
      return json(200, { ok: true })
    }
    if (path === "/probe" && req.method === "POST") {
      let blocked = false
      let errMsg = ""
      try {
        await globalThis.fetch("https://api.example.invalid/v1/e2e-probe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      } catch (error) {
        errMsg = String(error && error.message ? error.message : error)
        blocked = errMsg.includes("E2E_PROVIDER_SPY_BLOCKED")
      }
      return json(200, {
        ok: true,
        blocked,
        errMsg,
        attemptCount: state.attempts.length,
        lastAttempt: state.attempts[state.attempts.length - 1] || null,
      })
    }
    return json(404, { error: "not_found" })
  } catch (error) {
    return json(500, { error: String(error && error.message ? error.message : error) })
  }
})

control.listen(spyPort, "127.0.0.1", () => {
  console.error(`[e2e-provider-spy] control http://127.0.0.1:${spyPort} file=${spyFile}`)
})
