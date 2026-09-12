import { createEvent } from "h3"
import { afterEach, describe, expect, it, vi } from "vitest"
import security from "./security"

function makeEvent(method: string, url: string, headers: Record<string, string>) {
  const req = { method, url, headers } as never
  const res = {
    setHeader: () => {},
    end: () => {},
    writableEnded: false,
    headersSent: false,
  } as never
  return createEvent(req, res)
}

function call(method: string, url: string, headers: Record<string, string>) {
  const event = makeEvent(method, url, headers)
  return Promise.resolve().then(() => security(event as never))
}

const localHost = "127.0.0.1:4444"
const localOrigin = "http://127.0.0.1:4444"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("api security boundary", () => {
  it("allows a same-host GET", async () => {
    await expect(call("GET", "/api/shipping/health", { host: localHost })).resolves.toBeUndefined()
  })

  it("ignores non-api paths", async () => {
    await expect(call("GET", "/vessels", { host: localHost })).resolves.toBeUndefined()
  })

  it("rejects a foreign Host header", async () => {
    await expect(call("GET", "/api/shipping/health", { host: "evil.example.com" }))
      .rejects
      .toMatchObject({ statusCode: 403 })
  })

  it("rejects an api request with no Host header", async () => {
    await expect(call("GET", "/api/shipping/health", {}))
      .rejects
      .toMatchObject({ statusCode: 403 })
  })

  it("rejects Origin: null on writes", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "origin": "null",
      "content-type": "application/json",
      "content-length": "2",
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects a cross-site Origin on writes", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "origin": "http://evil.example.com",
      "content-type": "application/json",
      "content-length": "2",
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects a different localhost port as a different origin", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": "127.0.0.1:4444",
      "origin": "http://127.0.0.1:9999",
      "content-type": "application/json",
      "content-length": "2",
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("allows a same-origin browser JSON write", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "origin": localOrigin,
      "content-type": "application/json; charset=utf-8",
      "content-length": "2",
    })).resolves.toBeUndefined()
  })

  it("allows a local non-browser write without Origin by default", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "content-type": "application/json",
      "content-length": "2",
    })).resolves.toBeUndefined()
  })

  it("rejects a no-Origin write when SHIPPING_ALLOW_NO_ORIGIN=false", async () => {
    vi.stubEnv("SHIPPING_ALLOW_NO_ORIGIN", "false")
    vi.resetModules()
    const strict = (await import("./security")).default
    const event = makeEvent("POST", "/api/shipping/settings", {
      "host": localHost,
      "content-type": "application/json",
      "content-length": "2",
    })
    await expect(Promise.resolve().then(() => strict(event as never)))
      .rejects
      .toMatchObject({ statusCode: 403 })
  })

  it("allows an explicitly allowlisted dev-proxy origin", async () => {
    vi.stubEnv("SHIPPING_ALLOWED_ORIGINS", "http://localhost:5173")
    vi.resetModules()
    const dev = (await import("./security")).default
    const event = makeEvent("POST", "/api/shipping/settings", {
      "host": "127.0.0.1:4444",
      "origin": "http://localhost:5173",
      "content-type": "application/json",
      "content-length": "2",
    })
    await expect(Promise.resolve().then(() => dev(event as never))).resolves.toBeUndefined()
  })

  it("rejects a non-JSON media type", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "origin": localOrigin,
      "content-type": "text/plain",
      "content-length": "5",
    })).rejects.toMatchObject({ statusCode: 415 })
  })

  it("rejects a spoofed json-like media type", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "origin": localOrigin,
      "content-type": "application/jsonp",
      "content-length": "5",
    })).rejects.toMatchObject({ statusCode: 415 })
  })

  it("rejects a chunked write body", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "transfer-encoding": "chunked",
    })).rejects.toMatchObject({ statusCode: 411 })
  })

  it("rejects an oversized declared body", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": localHost,
      "origin": localOrigin,
      "content-type": "application/json",
      "content-length": String(2 * 1024 * 1024),
    })).rejects.toMatchObject({ statusCode: 413 })
  })
})
