// Outbound-call recorder preloaded into the production server (node --require) for acceptance runs only.
// Records every non-loopback TCP connect (net.Socket#connect, which undici fetch, http and https all use),
// every globalThis.fetch call and every DNS lookup to OUTBOUND_LOG as JSON lines. It never blocks a call.
"use strict"
const fs = require("node:fs")
const net = require("node:net")
const dns = require("node:dns")
const process = require("node:process")

const LOG = process.env.OUTBOUND_LOG
if (LOG) {
  const write = (entry) => {
    try {
      fs.appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
    } catch {}
  }
  const loopback = host => !host || host === "localhost" || host === "::1" || /^127\./.test(host) || host === "0.0.0.0"
  const origConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) {
    try {
      const a0 = Array.isArray(args[0]) ? args[0][0] : args[0]
      const o = typeof a0 === "object" && a0 !== null ? a0 : { port: a0, host: typeof args[1] === "string" ? args[1] : undefined }
      if (!o.path && !loopback(o.host)) write({ kind: "tcp_connect", host: o.host ?? "(default localhost)", port: o.port })
    } catch {}
    return origConnect.apply(this, args)
  }
  const origLookup = dns.lookup
  dns.lookup = function (host, ...rest) {
    if (!loopback(host)) write({ kind: "dns_lookup", host })
    return origLookup.call(this, host, ...rest)
  }
  if (typeof globalThis.fetch === "function") {
    const origFetch = globalThis.fetch
    globalThis.fetch = function (input, init) {
      try {
        const url = typeof input === "string" ? input : input?.url ?? String(input)
        const host = new URL(url, "http://127.0.0.1").hostname
        if (!loopback(host)) write({ kind: "fetch", url: url.replace(/[?#].*$/, "") })
      } catch {}
      return origFetch.call(this, input, init)
    }
  }
  write({ kind: "recorder_ready", pid: process.pid })
}
