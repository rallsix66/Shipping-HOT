import { type Server, createServer } from "node:http"
import { createApp, createRouter, toNodeListener } from "h3"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import handler from "./manual.post"
import detailHandler from "./items/[id].get"
import security from "#/middleware/security"
import { open } from "#/intel/__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { intelSourceSeeds } from "#/intel/sources"

let state: ReturnType<typeof open>
let server: Server
let base: string
let fail = false
const actualFetch = globalThis.fetch
const outbound: string[] = []
beforeEach(async () => {
  state = open(":memory:", (sql) => {
    if (fail && sql.startsWith("INSERT INTO intel_manual_action")) throw new Error("offline-fault")
  })
  await initShippingTables(state.database, "real")
  await state.repository.upsertSource(intelSourceSeeds[0], "2026-10-14T00:00:00Z")
  vi.stubGlobal("useDatabase", () => state.database)
  const app = createApp({ debug: false })
  app.use(security)
  app.use(createRouter().post("/api/shipping/intel/manual", handler).get("/api/shipping/intel/items/:id", detailHandler))
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (new URL(String(input)).origin !== base) {
      outbound.push(String(input))
      throw new Error("outbound forbidden")
    }
    return actualFetch(input, options)
  })
})
afterEach(async () => {
  fail = false
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  expect(outbound).toEqual([])
  state.native.close()
  vi.unstubAllGlobals()
})
const data = { requestId: "http-request-1", sourceId: "intel:th-w01", operator: "Synthetic operator", action: "submit", title: "Synthetic HTTP notice", url: "https://www.tmd.go.th/offline", body: "Synthetic licensed text" }
async function post(body = data, origin = base) {
  return fetch(`${base}/api/shipping/intel/manual`, { method: "POST", headers: { "Content-Type": "application/json", "Origin": origin }, body: JSON.stringify(body) })
}
it("runs explicit POST through same-origin security then reads manual provenance without writes", async () => {
  const response = await post()
  expect(response.status).toBe(200)
  const result = await response.json() as { itemId: string }
  state.native.exec("PRAGMA query_only=ON")
  const read = await fetch(`${base}/api/shipping/intel/items/${result.itemId}`)
  expect(read.status).toBe(200)
  const body = await read.json() as Record<string, any>
  expect(body.manualLabel).toBe("官方通知（人工录入）")
  expect(body.item.publishedAt).toBeNull()
  expect(body.manualActions[0].operator).toBe(data.operator)
  expect(body.selectedVersion.blocks[1].text).toBe(data.body)
})
it("rejects cross-origin and HTML inputs without a persisted action", async () => {
  expect((await post(data, "https://evil.test")).status).toBe(403)
  expect((await post({ ...data, body: "<script>alert(1)</script>" })).status).toBe(400)
  expect(await state.repository.listItems(data.sourceId)).toEqual([])
})
it("returns409 for conflicting request and503 for failed atomic save preserving prior content", async () => {
  expect((await post()).status).toBe(200)
  expect((await post({ ...data, title: "Changed" })).status).toBe(409)
  fail = true
  expect((await post({ ...data, requestId: "http-request-2", body: "Changed" })).status).toBe(503)
  expect(await state.repository.listManualActions(data.sourceId)).toHaveLength(1)
})
