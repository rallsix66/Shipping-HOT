// Preload for the PH-M01 display process only.
// Install with: node --require scripts/lib/ph-m01-display-guard.cjs <entry>
// This runs before the application entry. It is a JavaScript hook inside this
// Node process, not an operating-system firewall.
"use strict"

const { Buffer } = require("node:buffer")
const crypto = require("node:crypto")
const fs = require("node:fs")
const net = require("node:net")
const process = require("node:process")

const DENIED = "display_egress_denied"

function denied(detail) {
  const error = new Error(`${DENIED}: ${detail}`)
  error.code = DENIED
  return error
}

function parseAllowList(value) {
  if (value == null || value.trim() === "") return []
  const seen = new Set()
  return value.split(",").map((part) => {
    const match = /^127\.0\.0\.1:(\d+)$/.exec(part.trim())
    if (!match) throw denied(`allow list only accepts exact 127.0.0.1:port entries, got ${part.trim() || "(empty)"}`)
    const port = Number(match[1])
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw denied(`invalid allow port ${match[1]}`)
    const key = `127.0.0.1:${port}`
    if (seen.has(key)) throw denied(`duplicate allow entry ${key}`)
    seen.add(key)
    return { host: "127.0.0.1", port }
  })
}

function allowedTcp(allow, host, port) {
  const numeric = typeof port === "number" ? port : Number(port)
  return host === "127.0.0.1"
    && Number.isInteger(numeric)
    && allow.some(entry => entry.port === numeric)
}

function tcpFromConnectArgs(args) {
  const first = args[0]
  if (typeof first === "string") {
    if (/^\d+$/.test(first)) return { kind: "tcp", port: Number(first), host: typeof args[1] === "string" ? args[1] : undefined }
    return { kind: "ipc" }
  }
  if (typeof first === "number") return { kind: "tcp", port: first, host: typeof args[1] === "string" ? args[1] : undefined }
  if (first && typeof first === "object") {
    if (first.path) return { kind: "ipc" }
    const host = first.host ?? first.hostname
    return { kind: "tcp", port: first.port, host: host == null ? undefined : String(host) }
  }
  return { kind: "unknown" }
}

function tcpFromUrlish(args) {
  let options = {}
  let url
  const first = args[0]
  if (typeof first === "string" || first instanceof URL) {
    url = new URL(first)
    if (args[1] && typeof args[1] === "object") options = args[1]
  } else if (first && typeof first === "object") {
    options = first
    if (typeof first.href === "string" && first.protocol) url = first
  }
  const protocol = String(options.protocol || url?.protocol || "http:")
  let host = options.hostname || options.host || url?.hostname
  let port = options.port || url?.port
  if (typeof host === "string") {
    const embedded = /^([^:]+):(\d+)$/.exec(host)
    if (embedded && !port) {
      host = embedded[1]
      port = embedded[2]
    }
  }
  if (!port) port = protocol === "https:" ? 443 : 80
  return { host: host == null ? undefined : String(host), port: Number(port) }
}

function callbackOf(args) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (typeof args[index] === "function") return args[index]
  }
  return undefined
}

function localIpLookup(args) {
  const callback = callbackOf(args)
  if (callback) {
    process.nextTick(() => callback(null, "127.0.0.1", 4))
    return undefined
  }
  return Promise.resolve({ address: "127.0.0.1", family: 4 })
}

function installDisplayEgressGuard(options = {}) {
  const allow = options.allow ?? parseAllowList(process.env.PH_M01_DISPLAY_ALLOW)
  const modules = options.modules ?? {
    net: require("node:net"),
    dns: require("node:dns"),
    http: require("node:http"),
    https: require("node:https"),
    tls: require("node:tls"),
    http2: require("node:http2"),
    dgram: require("node:dgram"),
    childProcess: require("node:child_process"),
    fetch: globalThis.fetch,
    assignFetch(next) {
      globalThis.fetch = next
    },
  }
  const restores = []

  function replace(target, key, next) {
    const previous = target[key]
    target[key] = next
    restores.push(() => {
      target[key] = previous
    })
  }

  if (modules.net?.Socket?.prototype) {
    const connectOriginal = modules.net.Socket.prototype.connect
    replace(modules.net.Socket.prototype, "connect", function guardedConnect(...args) {
      const endpoint = tcpFromConnectArgs(args)
      if (endpoint.kind !== "tcp" || !allowedTcp(allow, endpoint.host, endpoint.port)) {
        throw denied(`tcp connect ${endpoint.host ?? "(no host)"}:${endpoint.port ?? "(no port)"}`)
      }
      return connectOriginal.apply(this, args)
    })
  }

  function wrapLookup() {
    return function guardedLookup(hostname, ...rest) {
      if (hostname === "127.0.0.1") return localIpLookup(rest)
      const error = denied(`dns.lookup ${hostname}`)
      const callback = callbackOf(rest)
      if (callback) {
        process.nextTick(() => callback(error))
        return undefined
      }
      return Promise.reject(error)
    }
  }

  if (modules.dns) {
    replace(modules.dns, "lookup", wrapLookup())
    if (modules.dns.promises) replace(modules.dns.promises, "lookup", wrapLookup())
    const resolveNames = ["resolve", "resolve4", "resolve6", "resolveMx", "resolveTxt", "resolveSrv", "resolveNs", "resolveCname", "resolvePtr", "resolveNaptr", "resolveSoa", "resolveAny", "reverse", "lookupService"]
    for (const name of resolveNames) {
      if (typeof modules.dns[name] === "function") {
        replace(modules.dns, name, () => {
          throw denied(`dns.${name}`)
        })
      }
      if (modules.dns.promises && typeof modules.dns.promises[name] === "function") {
        replace(modules.dns.promises, name, () => {
          return Promise.reject(denied(`dns.promises.${name}`))
        })
      }
    }
    const prototype = modules.dns.Resolver?.prototype
    if (prototype) {
      replace(prototype, "lookup", wrapLookup())
      for (const name of resolveNames) {
        if (typeof prototype[name] === "function") {
          replace(prototype, name, () => {
            throw denied(`dns.Resolver.${name}`)
          })
        }
      }
    }
  }

  function wrapRequest(original, label) {
    return function guardedRequest(...args) {
      const endpoint = tcpFromUrlish(args)
      if (!allowedTcp(allow, endpoint.host, endpoint.port)) throw denied(`${label} ${endpoint.host ?? "(no host)"}:${endpoint.port ?? "(no port)"}`)
      return original.apply(this, args)
    }
  }

  for (const [label, moduleApi] of [["http", modules.http], ["https", modules.https]]) {
    if (!moduleApi) continue
    if (typeof moduleApi.request === "function") replace(moduleApi, "request", wrapRequest(moduleApi.request, label))
    if (typeof moduleApi.get === "function") replace(moduleApi, "get", wrapRequest(moduleApi.get, label))
  }

  if (typeof modules.tls?.connect === "function") {
    const original = modules.tls.connect
    replace(modules.tls, "connect", function guardedTls(...args) {
      const endpoint = tcpFromConnectArgs(args)
      if (endpoint.kind !== "tcp" || !allowedTcp(allow, endpoint.host, endpoint.port)) {
        throw denied(`tls connect ${endpoint.host ?? "(no host)"}:${endpoint.port ?? "(no port)"}`)
      }
      return original.apply(this, args)
    })
  }

  if (typeof modules.http2?.connect === "function") {
    const original = modules.http2.connect
    replace(modules.http2, "connect", function guardedHttp2(...args) {
      let endpoint = { host: undefined, port: undefined }
      try {
        endpoint = tcpFromUrlish([args[0]])
      } catch {
        throw denied("http2.connect")
      }
      if (!allowedTcp(allow, endpoint.host, endpoint.port)) throw denied(`http2.connect ${endpoint.host ?? "(no host)"}:${endpoint.port ?? "(no port)"}`)
      return original.apply(this, args)
    })
  }

  if (typeof modules.dgram?.createSocket === "function") {
    const original = modules.dgram.createSocket
    replace(modules.dgram, "createSocket", function guardedSocket(...args) {
      const socket = original.apply(this, args)
      if (socket && typeof socket.send === "function") {
        socket.send = function guardedSend() {
          throw denied("dgram.send")
        }
      }
      return socket
    })
  }

  if (modules.childProcess) {
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      if (typeof modules.childProcess[name] !== "function") continue
      replace(modules.childProcess, name, () => {
        throw denied(`child_process.${name}`)
      })
    }
  }

  if (typeof modules.fetch === "function" && typeof modules.assignFetch === "function") {
    const original = modules.fetch
    const wrapped = function guardedFetch(input, init) {
      const raw = typeof input === "string" ? input : input?.url ?? String(input)
      let endpoint
      try {
        endpoint = tcpFromUrlish([raw])
      } catch (error) {
        return Promise.reject(error)
      }
      if (!allowedTcp(allow, endpoint.host, endpoint.port)) return Promise.reject(denied(`fetch ${endpoint.host ?? "(no host)"}:${endpoint.port ?? "(no port)"}`))
      return original.call(this, input, init)
    }
    modules.assignFetch(wrapped)
    restores.push(() => modules.assignFetch(original))
  }

  return {
    allow,
    restore() {
      while (restores.length) restores.pop()()
    },
  }
}

function installShutdownLatch(options) {
  const host = options.host ?? "127.0.0.1"
  if (host !== "127.0.0.1") throw denied("shutdown listener host must be 127.0.0.1")
  const port = Number(options.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw denied("shutdown listener port is invalid")
  if (!/^[0-9a-f]{32}$/.test(options.token ?? "")) throw denied("shutdown token must be 32 hex characters")
  const emit = options.emit
  if (typeof emit !== "function") throw denied("shutdown emit hook is missing")
  const server = net.createServer()
  server.on("connection", (socket) => {
    const chunks = []
    let settled = false
    const fail = () => {
      if (settled) return
      settled = true
      socket.destroy()
    }
    socket.on("data", (chunk) => {
      chunks.push(chunk)
      const buffer = Buffer.concat(chunks)
      if (buffer.length > 64) {
        fail()
        return
      }
      if (!buffer.includes(0x0A)) return
      settled = true
      const given = buffer.toString("utf8").trim()
      const expected = Buffer.from(options.token)
      const actual = Buffer.from(given)
      const matches = actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
      socket.end()
      if (matches) emit("SIGTERM")
    })
    socket.on("error", fail)
    socket.setTimeout(1000, fail)
  })
  server.listen(port, "127.0.0.1")
  return server
}

function installPreload() {
  const guard = installDisplayEgressGuard()
  const port = process.env.PH_M01_DISPLAY_SHUTDOWN_PORT
  const token = process.env.PH_M01_DISPLAY_SHUTDOWN_TOKEN
  if (!port || !token) {
    fs.writeSync(2, "ph-m01-display-guard-failed missing shutdown binding\n")
    process.exit(1)
  }
  let server
  try {
    server = installShutdownLatch({
      port,
      token,
      emit(signal) {
        process.emit(signal, signal)
      },
    })
  } catch (error) {
    fs.writeSync(2, `ph-m01-display-guard-failed ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
  server.once("listening", () => {
    const address = server.address()
    const bound = address && typeof address === "object" ? address.port : port
    fs.writeSync(1, `ph-m01-display-guard-listening ${bound}\n`)
  })
  server.once("error", (error) => {
    fs.writeSync(2, `ph-m01-display-guard-failed ${error.message}\n`)
    process.exit(1)
  })
  return guard
}

if (process.env.PH_M01_DISPLAY_GUARD === "1") installPreload()

module.exports = {
  DENIED,
  installDisplayEgressGuard,
  installShutdownLatch,
  parseAllowList,
}
