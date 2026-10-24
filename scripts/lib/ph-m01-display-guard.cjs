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

function lookupRequest(args) {
  const callback = callbackOf(args)
  const end = callback ? args.lastIndexOf(callback) : args.length
  const inputs = []
  for (let index = 0; index < end; index += 1) {
    if (args[index] !== undefined) inputs.push(args[index])
  }
  if (inputs.length > 1) throw denied("dns.lookup received conflicting options")
  const options = inputs.length === 0 ? null : inputs[0]
  if (options == null) return { all: false }
  if (typeof options === "number") {
    if (options !== 0 && options !== 4) {
      throw denied(options === 6
        ? "dns.lookup family 6 conflicts with 127.0.0.1"
        : `dns.lookup family ${options} is invalid`)
    }
    return { all: false }
  }
  if (typeof options !== "object" || Array.isArray(options)) throw denied("dns.lookup options are invalid")
  if (options.all !== undefined && typeof options.all !== "boolean") throw denied("dns.lookup all option conflicts with the boolean form")
  const family = options.family == null ? 0 : options.family
  if (typeof family !== "number" || !Number.isInteger(family) || (family !== 0 && family !== 4 && family !== 6)) {
    throw denied(`dns.lookup family ${String(family)} is invalid`)
  }
  if (family === 6) throw denied("dns.lookup family 6 conflicts with 127.0.0.1")
  if (options.hints !== undefined && (!Number.isInteger(options.hints) || options.hints < 0)) throw denied("dns.lookup hints conflict with 127.0.0.1")
  return { all: options.all === true }
}

function localIpLookup(args) {
  const request = lookupRequest(args)
  const callback = callbackOf(args)
  if (callback) {
    process.nextTick(() => {
      if (request.all) callback(null, [{ address: "127.0.0.1", family: 4 }])
      else callback(null, "127.0.0.1", 4)
    })
    return undefined
  }
  if (request.all) return Promise.resolve([{ address: "127.0.0.1", family: 4 }])
  return Promise.resolve({ address: "127.0.0.1", family: 4 })
}

function confirmListenerBind(server, expectedPort) {
  const address = server && typeof server.address === "function" ? server.address() : null
  const actualHost = address && typeof address === "object" ? address.address : undefined
  const actualPort = address && typeof address === "object" ? address.port : undefined
  const ephemeral = expectedPort === 0
  const portMatches = ephemeral
    ? Number.isInteger(actualPort) && actualPort >= 1 && actualPort <= 65535
    : actualPort === expectedPort
  if (actualHost === "127.0.0.1" && portMatches) return { ok: true, address: "127.0.0.1", port: actualPort }
  if (server && typeof server.close === "function") {
    try {
      server.close()
    } catch {
      // The rejected listener may already be closing.
    }
  }
  const actual = address && typeof address === "object" ? `${String(actualHost)}:${String(actualPort)}` : String(address)
  const expected = ephemeral ? "127.0.0.1:<assigned>" : `127.0.0.1:${expectedPort}`
  return { ok: false, actual, expected }
}

function readListenPlan(args, ports) {
  if (args.length === 0) throw denied("listen host is omitted")
  let port
  let host
  if (typeof args[0] === "object" && args[0]) {
    if (args[0].path || args[0].fd != null || args[0].handle) throw denied("non-tcp listen is not permitted")
    port = args[0].port
    host = args[0].host
  } else if (typeof args[0] === "number") {
    port = args[0]
    host = typeof args[1] === "string" ? args[1] : undefined
  } else {
    throw denied("listen arguments are not a loopback port")
  }
  if (host !== "127.0.0.1") throw denied(`listen host ${host == null ? "(omitted)" : host} is not 127.0.0.1`)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw denied(`listen port ${String(port)} is invalid`)
  const appPort = ports.appPort
  const shutdownPort = ports.shutdownPort
  let role
  if (Number.isInteger(shutdownPort) && port === shutdownPort) role = "shutdown"
  else if (Number.isInteger(appPort) && port === appPort) role = "app"
  else if (port === 0 && !Number.isInteger(appPort)) role = "app"
  else throw denied(`listen port ${port} conflicts with planned ports app=${String(appPort)} shutdown=${String(shutdownPort)}`)
  return { role, port }
}

function installListenerBindGuard(options = {}) {
  const netModule = options.net ?? require("node:net")
  const prototype = netModule.Server?.prototype
  if (!prototype || typeof prototype.listen !== "function") throw denied("server listen hook is unavailable")
  const write = options.write ?? (line => fs.writeSync(1, line))
  const writeError = options.writeError ?? (line => fs.writeSync(2, line))
  const exit = options.exit ?? (code => process.exit(code))
  const portValue = options.appPort ?? process.env.PORT
  const nitroPort = options.nitroPort ?? process.env.NITRO_PORT
  if (portValue != null && portValue !== "" && nitroPort != null && nitroPort !== "" && Number(portValue) !== Number(nitroPort)) {
    throw denied("PORT conflicts with NITRO_PORT")
  }
  const ports = {
    appPort: portValue == null || portValue === "" ? Number.NaN : Number(portValue),
    shutdownPort: options.shutdownPort == null ? Number(process.env.PH_M01_DISPLAY_SHUTDOWN_PORT) : Number(options.shutdownPort),
  }
  const original = prototype.listen
  const open = new Set()
  const confirmed = {}
  let announced = false
  function rejectBind(result) {
    for (const server of open) {
      try {
        server.close()
      } catch {
        // Closing a rejected listener is best-effort before the process exits.
      }
    }
    writeError(`ph-m01-display-guard-failed bind ${result.actual} is not ${result.expected}\n`)
    exit(1)
  }
  function announce() {
    if (announced || !confirmed.app || !confirmed.shutdown) return
    announced = true
    write(`ph-m01-display-bound app=127.0.0.1:${confirmed.app.port} shutdown=127.0.0.1:${confirmed.shutdown.port}\n`)
  }
  prototype.listen = function guardedListen(...args) {
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : undefined
    const plan = readListenPlan(args, ports)
    open.add(this)
    this.prependOnceListener("listening", () => {
      const result = confirmListenerBind(this, plan.port)
      if (!result.ok) {
        rejectBind(result)
        return
      }
      confirmed[plan.role] = result
      announce()
      if (callback) callback()
    })
    return original.apply(this, args)
  }
  return {
    restore() {
      prototype.listen = original
    },
  }
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
    installListenerBindGuard()
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
  server.once("error", (error) => {
    fs.writeSync(2, `ph-m01-display-guard-failed ${error.message}\n`)
    process.exit(1)
  })
  return guard
}

if (process.env.PH_M01_DISPLAY_GUARD === "1") installPreload()

module.exports = {
  DENIED,
  confirmListenerBind,
  installDisplayEgressGuard,
  installListenerBindGuard,
  installShutdownLatch,
  parseAllowList,
}
