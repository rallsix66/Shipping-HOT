import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { type Server, createServer } from "node:http"
import { Socket } from "node:net"
import { resolve } from "node:path"
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createApp, createRouter, toNodeListener } from "h3"
import { expect, it, vi } from "vitest"
import { ManualIntelPage } from "../src/components/shipping/manual-intel"
import { myFetch } from "~/utils"
import { open } from "#/intel/__fixtures__/isolated-db"
import { intelSourceSeeds } from "#/intel/sources"
import { manualSubmit } from "#/intel/manual"
import { getDefaultRuntimeJobs } from "#/runtime/registry"
import { bootstrapBackgroundRuntime, shutdownBackgroundRuntime } from "#/runtime/bootstrap"
import { INTEL_COLLECT_JOB_ID } from "#/runtime/intel-collect-job"
import itemsHandler from "#/api/shipping/intel/items.get"
import detailHandler from "#/api/shipping/intel/items/[id].get"
import checklistHandler from "#/api/shipping/intel/manual.get"

// Only shell/unused legacy page are stubbed. Real query hooks render real HTTP data.
vi.mock("../src/components/shipping/app", () => ({ ShippingShell: ({ children }: { children: unknown }) => children }))
vi.mock("../src/components/shipping/pages", () => ({ FeedPage: () => null }))
vi.mock("~/utils", () => ({ myFetch: vi.fn(() => {
  throw new Error("Unexpected SSR fetching")
}) }))

it("joins existing Runtime, archived safe-byte fetch, SQLite, restart, HTTP and real page SSR offline", async () => {
  mkdirSync(".tmp", { recursive: true })
  const dir = mkdtempSync(resolve(".tmp", "intel-chain-"))
  const path = resolve(dir, "chain.sqlite3")
  const fixture = "server/providers/__fixtures__/tmd-cap-2026-10-10/index.xml"
  const archive = readFileSync(fixture)
  const seed = intelSourceSeeds.find(row => row.catalogId === "TH-W01")!
  let clock = Date.parse("2026-10-13T02:00:00Z")
  let mode: "archive" | "revision" | "failure" | "empty" = "archive"
  let state = open(path)
  let server: Server | undefined
  let base = ""
  let port = -1
  const realFetch = globalThis.fetch
  const blocked: string[] = []
  const originalConnect = Socket.prototype.connect
  const networkGuard = vi.spyOn(Socket.prototype, "connect").mockImplementation(function (this: Socket, ...args: unknown[]) {
    const values = Array.isArray(args[0]) ? args[0] : args
    const options = values[0] as { host?: string, port?: number }
    const host = typeof options === "object" ? options.host ?? "localhost" : values[1] ?? "localhost"
    const targetPort = typeof options === "object" ? Number(options.port) : Number(options)
    if (!["127.0.0.1", "localhost"].includes(String(host)) || targetPort !== port) {
      blocked.push(String(host))
      throw new Error("External TCP forbidden in chain acceptance")
    }
    return originalConnect.apply(this, args as Parameters<typeof originalConnect>)
  } as typeof originalConnect)
  const transport = vi.fn(async (url: URL) => {
    expect(url.toString()).toBe(seed.url)
    if (mode === "failure") return { status: 503, headers: {}, body: new Uint8Array() }
    const bytes = mode === "archive" ? archive : Buffer.from(mode === "empty" ? "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>SYNTHETIC EMPTY</title></channel></rss>" : archive.toString("utf8").replace("<title>Heavy Rain</title>", "<title>Heavy Rain — SYNTHETIC REVISION</title>"))
    return { status: 200, headers: { "content-type": "application/rss+xml; charset=utf-8" }, body: bytes }
  })
  const release = vi.fn(async () => {})
  try {
    vi.stubEnv("SHIPPING_DATA_MODE", "real")
    vi.stubEnv("SHIPPING_WEATHER_ALERT_PROVIDER", "off")
    vi.stubGlobal("useDatabase", () => state.database)
    vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (new URL(String(input)).origin !== base) {
        blocked.push(String(input))
        throw new Error("External fetch forbidden")
      }
      return realFetch(input, init)
    })
    const now = () => new Date(clock)
    const jobs = getDefaultRuntimeJobs({ database: state.database, dataMode: "real", now, intel: { enabled: true, seeds: [seed], fetch: { lookup: async () => [{ address: "93.184.216.34", family: 4 }], transport } } }).filter(job => job.id === INTEL_COLLECT_JOB_ID)
    expect(jobs).toHaveLength(1)
    const runtime = await bootstrapBackgroundRuntime({ database: state.database, jobs, enabled: true, acquireIntelOwnership: async () => ({ release }), runtimeOptions: { now, setTimeout: vi.fn(() => 0) as never, clearTimeout: vi.fn(), logger: { info: vi.fn(), error: vi.fn() } } })
    const run = async () => {
      clock += 3600000
      return runtime.runNow(INTEL_COLLECT_JOB_ID)
    }
    const first = await run()
    expect(first.status).toBe("success")
    const stored = await state.repository.listItems(seed.id)
    const item = stored.find(row => row.canonicalUrl === "https://www.tmd.go.th/uploads/CAP/en/CAPTMD20261010062912_2.xml")!
    expect(item).toMatchObject({ title: "Heavy Rain", publishedAt: "2026-10-09T16:00:00.000Z" })
    const firstVersion = item.currentVersionId!
    expect((await state.repository.listVersions(item.id))[0].contentScope).toBe("full_text")
    expect((await state.repository.readVersionBlocks(firstVersion))[1].text).toContain("Another high-pressure system from China")
    const countVersions = () => (state.native.prepare("SELECT COUNT(*) AS n FROM intel_item_version").get() as { n: number }).n
    const initialCount = countVersions()
    expect(await run()).toMatchObject({ status: "success", recordsWritten: 0 })
    expect(countVersions()).toBe(initialCount)
    mode = "revision"
    expect(await run()).toMatchObject({ status: "success", recordsWritten: 1 })
    expect(countVersions()).toBe(initialCount + 1)
    expect((await state.repository.readVersionBlocks(firstVersion))[0].text).toBe("Heavy Rain")
    const revised = (await state.repository.getItem(item.id))!
    mode = "failure"
    expect((await run()).status).toBe("failed")
    expect(await state.repository.getSource(seed.id)).toMatchObject({ status: "failing", consecutiveFailures: 1 })
    expect((await state.repository.getItem(item.id))?.currentVersionId).toBe(revised.currentVersionId)
    expect(countVersions()).toBe(initialCount + 1)
    const failedHealth = state.native.prepare("SELECT * FROM intel_source WHERE id=?").get(seed.id)
    await manualSubmit(state.repository, { requestId: "chain-check-empty", sourceId: seed.id, operator: "SYNTHETIC checklist operator", action: "checked_empty" }, now().toISOString())
    expect(state.native.prepare("SELECT * FROM intel_source WHERE id=?").get(seed.id)).toEqual(failedHealth)
    expect((await state.repository.getSource(seed.id))?.status).toBe("failing")
    mode = "empty"
    expect(await run()).toMatchObject({ status: "success", recordsRead: 0, recordsWritten: 0 })
    expect((await state.repository.getSource(seed.id))?.status).toBe("ok_empty")
    expect((await state.repository.listRuns(seed.id)).map(row => row.status)).toEqual(["ok_items", "ok_items", "ok_items", "failed", "ok_empty"])
    expect(await state.repository.listItems(seed.id)).toHaveLength(stored.length)
    expect(transport).toHaveBeenCalledTimes(5)
    await shutdownBackgroundRuntime()
    expect(release).toHaveBeenCalledTimes(1)
    state.native.close()
    state = open(path) // Reopen without migration, collector, bootstrap or recovery.
    state.native.exec("PRAGMA query_only=ON")
    const snapshot = () => JSON.stringify((state.native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map(({ name }) => [name, state.native.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))
    const before = snapshot()
    const app = createApp({ debug: false })
    app.use(createRouter().get("/api/shipping/intel/items", itemsHandler).get("/api/shipping/intel/items/:id", detailHandler).get("/api/shipping/intel/manual", checklistHandler))
    server = createServer(toNodeListener(app))
    await new Promise<void>(done => server!.listen(0, "127.0.0.1", done))
    port = (server.address() as { port: number }).port
    base = `http://127.0.0.1:${port}`
    const get = async (suffix: string) => {
      const response = await fetch(`${base}/api/shipping/intel/${suffix}`)
      expect(response.status).toBe(200)
      return response.json()
    }
    const list = await get("items")
    const checklist = await get("manual")
    const current = await get(`items/${item.id}`)
    const historical = await get(`items/${item.id}?versionId=${firstVersion}`)
    expect(current.item.title).toBe("Heavy Rain — SYNTHETIC REVISION")
    expect(current.manualLabel).toBeNull()
    expect(current.selectedVersion.contentScope).toBe("full_text")
    expect(historical.selectedVersion.blocks[0].text).toBe("Heavy Rain")
    expect(checklist.items.find((row: { id: string }) => row.id === seed.id).recentActions[0].action).toBe("checked_empty")
    const query = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
    query.setQueryData(["intel-items", ""], list)
    query.setQueryData(["intel-manual"], checklist)
    const html = renderToString(createElement(QueryClientProvider, { client: query }, createElement(ManualIntelPage, { onLegacy: vi.fn() })))
    expect(html).toContain("Heavy Rain — SYNTHETIC REVISION")
    expect(html).toContain("2026-10-09T16:00:00.000Z")
    expect(html).toContain(item.canonicalUrl)
    expect(myFetch).not.toHaveBeenCalled()
    expect(snapshot()).toBe(before)
    expect(state.native.prepare("SELECT COUNT(*) AS n FROM provider_usage WHERE provider_id != 'intel-collect'").get()).toEqual({ n: 0 })
    expect(state.native.prepare("SELECT COUNT(*) AS n FROM paid_receipt").get()).toEqual({ n: 0 })
    expect(blocked).toEqual([])
    query.clear()
    writeFileSync(resolve(dir, "page-ssr.html"), html)
    writeFileSync(resolve(dir, "chain-result.json"), JSON.stringify({ fixture, fixtureSha256: createHash("sha256").update(archive).digest("hex"), archived: "Real stored TMD 2026-10-10 bytes, replayed offline", synthetic: ["revision", "503 failure", "empty RSS", "checked_empty operator"], pipeline: ["existing registry/runtime", "secure fetch injected bytes", "parse", "SQLite", "reopen", "actual H3 GET query_only", "actual page SSR with HTTP query cache"], itemId: item.id, firstVersion, rows: stored.length, outboundAttempts: blocked, browser: "NOT_RUN", database: path }, null, 2))
  } finally {
    await shutdownBackgroundRuntime()
    server?.closeAllConnections()
    if (server) await new Promise<void>(done => server!.close(() => done()))
    state.native.close()
    networkGuard.mockRestore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})
