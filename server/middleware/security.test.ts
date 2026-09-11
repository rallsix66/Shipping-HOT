import { createEvent } from "h3"
import { describe, expect, it } from "vitest"
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

describe("api security boundary", () => {
  it("allows a same-host GET", async () => {
    await expect(call("GET", "/api/shipping/health", { host: "127.0.0.1:4444" })).resolves.toBeUndefined()
  })

  it("ignores non-api paths", async () => {
    await expect(call("GET", "/vessels", { host: "127.0.0.1:4444" })).resolves.toBeUndefined()
  })

  it("rejects a foreign Host header", async () => {
    await expect(call("GET", "/api/shipping/health", { host: "evil.example.com" }))
      .rejects
      .toMatchObject({ statusCode: 403 })
  })

  it("rejects a cross-site Origin on writes", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": "127.0.0.1:4444",
      "origin": "http://evil.example.com",
      "content-type": "application/json",
      "content-length": "2",
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects a non-JSON non-empty write body", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": "127.0.0.1:4444",
      "origin": "http://localhost",
      "content-type": "text/plain",
      "content-length": "5",
    })).rejects.toMatchObject({ statusCode: 415 })
  })

  it("rejects a chunked write body", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": "127.0.0.1:4444",
      "transfer-encoding": "chunked",
    })).rejects.toMatchObject({ statusCode: 411 })
  })

  it("rejects an oversized declared body", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": "127.0.0.1:4444",
      "content-type": "application/json",
      "content-length": String(2 * 1024 * 1024),
    })).rejects.toMatchObject({ statusCode: 413 })
  })

  it("allows a same-host JSON write", async () => {
    await expect(call("POST", "/api/shipping/settings", {
      "host": "localhost:4444",
      "origin": "http://localhost:4444",
      "content-type": "application/json; charset=utf-8",
      "content-length": "2",
    })).resolves.toBeUndefined()
  })
})
