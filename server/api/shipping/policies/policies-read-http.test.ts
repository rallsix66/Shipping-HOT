import { type Server, createServer } from "node:http"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import {
  createApp,
  createError,
  createRouter,
  defineEventHandler,
  getQuery,
  getRouterParam,
  toNodeListener,
} from "h3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PolicyRepository } from "#/database/policy"
import { initShippingTables } from "#/database/shipping"
import {
  PolicyAutoService,
  policyAutoInvokeCount,
  resetPolicyAutoInvokeCount,
} from "#/intel/policy-auto"

/**
 * Real HTTP GET against policies list/detail handlers (h3 + toNodeListener).
 * Browse path must not invoke PolicyAutoService and must not grow paid_receipt / provider_usage.
 */

const T0 = new Date("2026-10-12T02:00:00.000Z")

function memoryDb() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: unknown[]) => statement.all(...params as never[]),
        get: async (...params: unknown[]) => statement.get(...params as never[]),
        run: async (...params: unknown[]) => {
          const result = statement.run(...params as never[])
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { native, database }
}

describe("policies actual HTTP GET zero-model guard", () => {
  let native: ReturnType<typeof memoryDb>["native"]
  let database: ReturnType<typeof memoryDb>["database"]
  let server: Server
  let base: string
  let policyId: string
  let beforeReceipts: number
  let beforeProvider: number
  const originalFetch = globalThis.fetch
  let outbound: string[]

  beforeEach(async () => {
    vi.resetModules()
    const opened = memoryDb()
    native = opened.native
    database = opened.database
    await initShippingTables(database, "real")
    const policies = new PolicyRepository(database)
    const auto = new PolicyAutoService(database, policies)
    const created = await auto.apply({
      eventType: "customs_rule",
      countryCode: "VN",
      publisher: "示例机关（fixture）",
      documentNumber: "HTTP-GET-1",
      title: "[FIXTURE] HTTP GET policy",
      sourceUrl: "https://example.org/fixture/http-get-1",
      sourceType: "official",
      status: "published",
      publishedAt: "2026-10-01",
      effectiveAt: "2026-11-01",
      fullText: "fixture body",
      basisText: "fixture",
      analysisIds: ["an-http"],
      intelItemId: "item-http",
      intelVersionId: "ver-http",
      contentHash: "hash-http",
      contentScope: "full_text",
      isFixture: true,
      enteredBy: "policy-auto-http-test",
    }, T0)
    expect(created.outcome).toBe("created")
    policyId = created.policyId!

    beforeReceipts = (native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get() as { c: number }).c
    beforeProvider = (native.prepare("SELECT COUNT(*) AS c FROM provider_usage").get() as { c: number }).c

    vi.doMock("#/shipping-store", () => ({
      getPolicyRepository: async () => new PolicyRepository(database),
    }))
    // Nitro/unimport globals used by policies handlers + policy-api utils
    vi.stubGlobal("defineEventHandler", defineEventHandler)
    vi.stubGlobal("getQuery", getQuery)
    vi.stubGlobal("getRouterParam", getRouterParam)
    vi.stubGlobal("createError", createError)

    const listHandler = (await import("./index.get")).default
    const detailHandler = (await import("./[id]/index.get")).default

    const app = createApp({ debug: false })
    const router = createRouter()
      .get("/api/shipping/policies", listHandler)
      .get("/api/shipping/policies/:id", detailHandler)
    app.use(router)
    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    outbound = []
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (new URL(String(input)).origin !== base) {
        outbound.push(String(input))
        throw new Error("External fetch forbidden")
      }
      return originalFetch(input, init)
    })
    native.exec("PRAGMA query_only=ON")
    resetPolicyAutoInvokeCount()
  })

  afterEach(async () => {
    server?.closeAllConnections()
    await new Promise<void>(resolve => server?.close(() => resolve()))
    expect(outbound).toEqual([])
    native.close()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("list + detail GET do not grow receipts/provider usage or invoke policy-auto", async () => {
    expect(policyAutoInvokeCount()).toBe(0)
    const listRes = await fetch(`${base}/api/shipping/policies`)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json() as { records: Array<{ id: string }> }
    expect(listBody.records.some(r => r.id === policyId)).toBe(true)

    const detailRes = await fetch(`${base}/api/shipping/policies/${encodeURIComponent(policyId)}`)
    expect(detailRes.status).toBe(200)
    const detailBody = await detailRes.json() as { record: { id: string } }
    expect(detailBody.record.id).toBe(policyId)

    expect(policyAutoInvokeCount()).toBe(0)
    expect(outbound).toEqual([])

    native.exec("PRAGMA query_only=OFF")
    const afterReceipts = (native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get() as { c: number }).c
    const afterProvider = (native.prepare("SELECT COUNT(*) AS c FROM provider_usage").get() as { c: number }).c
    expect(afterReceipts).toBe(beforeReceipts)
    expect(afterProvider).toBe(beforeProvider)
  })
})
