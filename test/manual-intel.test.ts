import { type ReactElement, createElement } from "react"
import { renderToString } from "react-dom/server"
import { createEvent } from "h3"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ManualIntelPage } from "../src/components/shipping/manual-intel"

// Keep server-only aliases out of the app tsconfig, as in the existing clipper DOM tests.
interface LocalDatabase {
  native: { close: () => void, prepare: (sql: string) => { get: () => unknown } }
  database: unknown
  repository: Record<string, (...args: any[]) => Promise<any>>
}
const { open } = await vi.importActual<{ open: (path?: string, fault?: (sql: string) => void) => LocalDatabase }>("#/intel/__fixtures__/isolated-db")
const { initShippingTables } = await vi.importActual<{ initShippingTables: (db: unknown, mode: string) => Promise<void> }>("#/database/shipping")
const { manualSubmit } = await vi.importActual<{ manualSubmit: (repo: unknown, input: unknown, now: string) => Promise<unknown> }>("#/intel/manual")
const { manualChecklist } = await vi.importActual<{ manualChecklist: (repo: unknown) => Promise<unknown[]> }>("#/intel/manual-checklist")
const { intelSourceSeeds } = await vi.importActual<{ intelSourceSeeds: { id: string, url: string }[] }>("#/intel/sources")
const { readIntelItem, readIntelItems } = await vi.importActual<{ readIntelItem: (event: unknown, repo: unknown) => Promise<unknown>, readIntelItems: (event: unknown, repo: unknown) => Promise<unknown> }>("#/utils/intel-read")
const { QueryClient, QueryObserver } = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query")

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, sources: {} as Record<string, any>, items: {} as Record<string, any>, detail: {} as Record<string, any>, fetch: vi.fn(), invalidate: vi.fn(), queries: [] as { queryKey: string[], queryFn: () => Promise<unknown>, enabled?: boolean }[] }))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => {
  const index = state.index++
  return [state.values[index] ?? initial, (value: unknown) => {
    state.values[index] = value
  }]
} }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }), useQuery: (query: typeof state.queries[number]) => {
  state.queries.push(query)
  return query.queryKey[0] === "intel-manual" ? state.sources : query.queryKey[0] === "intel-items" ? state.items : state.detail
} }))
vi.mock("../src/components/shipping/app", () => ({ ShippingShell: ({ children }: { children: unknown }) => children }))
vi.mock("../src/components/shipping/pages", () => ({ FeedPage: () => null }))
vi.mock("~/utils", () => ({ myFetch: (...args: unknown[]) => state.fetch(...args) }))
function draw() {
  state.index = 0
  return renderToString(createElement(ManualIntelPage, { onLegacy: vi.fn() }))
}
beforeEach(() => {
  state.fetch.mockReset().mockImplementation(() => {
    throw new Error("SSR must not fetch")
  })
  state.invalidate.mockReset().mockResolvedValue(undefined)
  state.queries = []
  state.values = ["manual:synthetic", "", "", "", "", "", "item", "", false, "", null]
  state.sources = { data: { items: [{ id: "manual:synthetic", catalogId: "SYNTHETIC", name: "Synthetic source", urls: [], cadence: "每周", focus: "Synthetic", persistence: "disallowed", recentActions: [] }] } }
  state.items = { data: { items: [] } }
  state.detail = { data: { manualLabel: "官方通知（人工录入）", manualActions: [{ operator: "<img onerror=alert(1)>", entered_at: "2026-10-14T00:00:00Z", outcome: "created" }], selectedVersion: { id: "v1", blocks: [{ blockKey: "title", text: "<script>alert(1)</script>" }] }, versions: { items: [{ id: "v1", createdAt: "2026-10-14" }] } } }
})

let local: ReturnType<typeof open> | undefined
afterEach(() => {
  local?.native.close()
  local = undefined
  vi.unstubAllGlobals()
})

// Calls actual component event/query callbacks with controlled hooks/cache and real SQLite.
// This exercises application logic, not DOM events, browser layout or GUI acceptance.
function tree() {
  state.index = 0
  state.queries = []
  return ManualIntelPage({ onLegacy: vi.fn() })
}
function nodes(node: unknown): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== "object" || !("props" in node)) return []
  const el = node as ReactElement<Record<string, any>>
  return [el, ...nodes(el.props.children)]
}
function label(node: unknown): string {
  if (Array.isArray(node)) return node.map(label).join("")
  if (typeof node === "string" || typeof node === "number") return String(node)
  return node && typeof node === "object" && "props" in node ? label((node as ReactElement<{ children?: unknown }>).props.children) : ""
}
function button(text: string) {
  const found = nodes(tree()).find(el => el.type === "button" && label(el).includes(text))
  expect(found, text).toBeDefined()
  return found!
}
function field(text: string, value: string) {
  const group = nodes(tree()).find(el => el.type === "label" && label(el).includes(text))!
  nodes(group).find(el => el.type === "input" || el.type === "textarea")!.props.onChange({ target: { value } })
}
const posts = () => state.fetch.mock.calls.filter(([, options]) => options?.method === "POST")
async function submit() {
  nodes(tree()).find(el => el.type === "form")!.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.values[8]).toBe(false))
}
async function refresh(key?: string) {
  tree()
  for (const query of state.queries.filter(q => q.enabled !== false && (!key || q.queryKey[0] === key))) {
    const target = query.queryKey[0] === "intel-manual" ? state.sources : query.queryKey[0] === "intel-items" ? state.items : state.detail
    target.data = await query.queryFn()
  }
}
function event(url: string, id?: string) {
  const e = createEvent({ url, method: "GET", headers: { host: "127.0.0.1" } } as Parameters<typeof createEvent>[0], {} as Parameters<typeof createEvent>[1])
  e.context.params = id ? { id } : {}
  return e
}
async function interaction() {
  const controls = { failAudit: false, uncertainAfterCommit: false, now: "2026-10-20T08:00:00.000Z" }
  local = open(":memory:", (sql) => {
    if (controls.failAudit && sql.startsWith("INSERT INTO intel_manual_action")) throw new Error("synthetic storage fault")
  })
  await initShippingTables(local.database, "real")
  for (const seed of intelSourceSeeds) await local.repository.upsertSource({ ...seed, enabled: false }, controls.now)
  state.values = ["", "", "", "", "", "", "", "", false, "", null]
  state.sources = {}
  state.items = {}
  state.detail = {}
  vi.stubGlobal("fetch", () => {
    throw new Error("network forbidden")
  })
  state.fetch.mockImplementation(async (route: string, options?: { method?: string, body?: unknown }) => {
    if (options?.method === "POST") {
      const result = await manualSubmit(local!.repository, options.body, controls.now)
      if (controls.uncertainAfterCommit) {
        controls.uncertainAfterCommit = false
        throw new Error("synthetic response lost after commit")
      }
      return result
    }
    if (route === "/shipping/intel/manual") return { items: await manualChecklist(local!.repository) }
    if (route.startsWith("/shipping/intel/items?")) return readIntelItems(event(route), local!.repository)
    if (route.startsWith("/shipping/intel/items/")) return readIntelItem(event(route, decodeURIComponent(route.split("?")[0].split("/").at(-1)!)), local!.repository)
    throw new Error("unexpected application route")
  })
  state.invalidate.mockImplementation(async ({ queryKey }: { queryKey: string[] }) => refresh(queryKey[0]))
  await refresh()
  return controls
}
function fillA() {
  button("TH-W01").props.onClick()
  field("录入人", "S7 合成验收")
  field("原文链接", intelSourceSeeds[0].url)
  field("标题", "【S7合成】人工交互材料，非官方内容")
  field("许可范围纯文本", "S7 原创合成正文 A；不是真实官方通知。")
}

it("connects checklist/save/duplicate/revision/old-version/reload callbacks to real manual repositories and read DTOs", async () => {
  const controls = await interaction()
  expect(state.sources.data.items.find((x: { catalogId: string }) => x.catalogId === "TH-W01")).toMatchObject({ persistence: "full", recentActions: [] })
  fillA()
  await submit()
  const item = (await local!.repository.listItems(intelSourceSeeds[0].id))[0]
  const a = item.currentVersionId!
  expect(state.items.data.items).toHaveLength(1)
  expect(state.detail.data).toMatchObject({ manualLabel: "官方通知（人工录入）", manualEntry: { operator: "S7 合成验收" }, selectedVersion: { id: a, publishedAt: null } })
  expect(label(tree())).toContain("真实性未独立核验")
  await submit()
  expect(await local!.repository.listVersions(item.id)).toHaveLength(1)
  expect(posts()[1][1].body.requestId).not.toBe(posts()[0][1].body.requestId)
  controls.now = "2026-10-20T09:00:00.000Z"
  field("许可范围纯文本", "S7 原创合成正文 B；只用于修订断言。")
  await submit()
  const b = state.detail.data.selectedVersion.id
  expect(b).not.toBe(a)
  expect(state.detail.data.selectedVersion.blocks[1].text).toContain("正文 B")
  nodes(tree()).find(el => el.type === "select")!.props.onChange({ target: { value: a } })
  await refresh("intel-item")
  expect(state.detail.data.selectedVersion.blocks[1].text).toContain("正文 A")
  expect(state.detail.data.manualEntry.enteredAt).toBe("2026-10-20T08:00:00.000Z")
  state.values = ["", "", "", "", "", "", "", "", false, "", null]
  await refresh()
  button("TH-W01").props.onClick()
  await refresh("intel-items")
  button("【S7合成】").props.onClick()
  await refresh("intel-item")
  expect(state.detail.data.selectedVersion.id).toBe(b)
  expect(state.detail.data.versions.items).toHaveLength(2)
  expect(state.detail.data.item.publishedAt).toBeNull()
  expect(state.detail.data.manualEntry.enteredAt).toBe(controls.now)
  expect(local!.native.prepare("SELECT COUNT(*) AS n FROM provider_usage").get()).toEqual({ n: 0 })
})

it("clears body/detail on source switch and records checked-empty without creating a material or verified source", async () => {
  await interaction()
  fillA()
  await submit()
  button("CN-P05").props.onClick()
  expect(state.values[4]).toBe("")
  expect(state.values[6]).toBe("")
  expect(state.values[7]).toBe("")
  expect(nodes(tree()).find(el => el.type === "textarea")!.props.disabled).toBe(true)
  button("已查看，无新内容").props.onClick()
  await vi.waitFor(() => expect(state.values[8]).toBe(false))
  expect(posts().at(-1)![1].body).toMatchObject({ action: "checked_empty", sourceId: "intel:manual:cn-p05", operator: "S7 合成验收" })
  expect(posts().at(-1)![1].body).not.toHaveProperty("body")
  expect(await local!.repository.listItems("intel:manual:cn-p05")).toEqual([])
  expect((await local!.repository.getSource("intel:manual:cn-p05"))?.status).toBe("never_run")
  expect(state.sources.data.items.find((x: { catalogId: string }) => x.catalogId === "CN-P05").recentActions).toHaveLength(1)
  expect(label(tree())).toContain("不是抓取成功或来源已验证")
})

it("retains input and request ID after a lost committed response, and retries without duplicate audit or versions", async () => {
  const controls = await interaction()
  fillA()
  controls.uncertainAfterCommit = true
  await submit()
  expect(label(tree())).toContain("保存未确认")
  expect(state.values[4]).toContain("正文 A")
  expect(button("保存人工条目").props.disabled).toBe(false)
  const requestId = posts()[0][1].body.requestId
  await submit()
  expect(posts()[1][1].body.requestId).toBe(requestId)
  const items = await local!.repository.listItems(intelSourceSeeds[0].id)
  expect(items).toHaveLength(1)
  expect(await local!.repository.listVersions(items[0].id)).toHaveLength(1)
  expect(await local!.repository.listManualActions(intelSourceSeeds[0].id)).toHaveLength(1)
  expect(label(tree())).toContain("已保存")
})

it("rolls back an audit failure and uses the same ID until retry succeeds; edited failed input receives a new ID", async () => {
  const controls = await interaction()
  fillA()
  controls.failAudit = true
  await submit()
  expect(await local!.repository.listItems(intelSourceSeeds[0].id)).toEqual([])
  const first = posts()[0][1].body.requestId
  field("标题", "【S7合成】已编辑的失败输入")
  await submit()
  const edited = posts()[1][1].body.requestId
  expect(edited).not.toBe(first)
  controls.failAudit = false
  await submit()
  expect(posts()[2][1].body.requestId).toBe(edited)
  expect(await local!.repository.listItems(intelSourceSeeds[0].id)).toHaveLength(1)
  expect(await local!.repository.listManualActions(intelSourceSeeds[0].id)).toHaveLength(1)
})

function activeQueries() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  tree()
  const queries = state.queries.filter(query => query.enabled !== false)
  const unsubscribe = queries.map((query) => {
    const data = query.queryKey[0] === "intel-manual" ? state.sources.data : query.queryKey[0] === "intel-items" ? state.items.data : state.detail.data
    client.setQueryData(query.queryKey, data)
    const observer = new QueryObserver(client, { ...query, retry: false, staleTime: Infinity })
    const stop = observer.subscribe(() => {})
    expect(client.getQueryCache().find({ queryKey: query.queryKey, exact: true })?.isActive()).toBe(true)
    return stop
  })
  state.invalidate.mockImplementation(client.invalidateQueries.bind(client))
  return { client, queries, close: () => {
    unsubscribe.forEach(stop => stop())
    client.clear()
  } }
}

it("confirms the installed QueryClient swallows active refetch rejection by default and propagates it with throwOnError", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  const key = ["manual-refresh-contract"]
  const failure = new Error("offline active query rejection")
  const queryFn = vi.fn(async () => {
    throw failure
  })
  client.setQueryData(key, "cached")
  const observer = new QueryObserver(client, { queryKey: key, queryFn, retry: false, staleTime: Infinity })
  const stop = observer.subscribe(() => {})
  try {
    expect(client.getQueryCache().find({ queryKey: key, exact: true })?.isActive()).toBe(true)
    expect(queryFn).not.toHaveBeenCalled()
    await expect(client.invalidateQueries({ queryKey: key })).resolves.toBeUndefined()
    expect(client.getQueryState(key)?.status).toBe("error")
    expect(queryFn).toHaveBeenCalledTimes(1)
    await expect(client.invalidateQueries({ queryKey: key }, { throwOnError: true })).rejects.toBe(failure)
    expect(queryFn).toHaveBeenCalledTimes(2)
  } finally {
    stop()
    client.clear()
  }
})

it.each(["intel-manual", "intel-items", "intel-item"])("keeps a confirmed save and warns for a real active %s refetch rejection", async (failingKey) => {
  await interaction()
  fillA()
  await submit()
  const active = activeQueries()
  const route = state.fetch.getMockImplementation()!
  const readFailures: string[] = []
  state.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
    const kind = url === "/shipping/intel/manual" ? "intel-manual" : url.startsWith("/shipping/intel/items?") ? "intel-items" : "intel-item"
    if (options?.method !== "POST" && kind === failingKey) {
      readFailures.push(url)
      throw new Error(`offline ${failingKey} queryFn failed`)
    }
    return route(url, options)
  })
  try {
    field("许可范围纯文本", "S7 原创合成正文 B；只用于修订断言。")
    await submit()
    const key = active.queries.find(query => query.queryKey[0] === failingKey)!.queryKey
    expect(readFailures).toHaveLength(1)
    expect(active.client.getQueryState(key)?.status).toBe("error")
    expect(label(tree())).toContain("已保存：revised")
    expect(label(tree())).toContain("刷新失败")
    expect(label(tree())).not.toContain("保存未确认")
    expect(state.values[10]).toBeNull()
    expect(state.values[8]).toBe(false)
    expect(button("保存人工条目").props.disabled).toBe(false)
    const items = await local!.repository.listItems(intelSourceSeeds[0].id)
    expect(items).toHaveLength(1)
    expect(await local!.repository.listVersions(items[0].id)).toHaveLength(2)
    expect(await local!.repository.listManualActions(intelSourceSeeds[0].id)).toHaveLength(2)
    expect(state.values[4]).toContain("正文 B")
  } finally {
    active.close()
  }
})

it.each(["before_commit", "after_commit"])("retains input, releases busy and retries the same ID with real QueryClient after %s failure", async (mode) => {
  const controls = await interaction()
  fillA()
  await refresh("intel-items")
  const active = activeQueries()
  try {
    controls.failAudit = mode === "before_commit"
    controls.uncertainAfterCommit = mode === "after_commit"
    await submit()
    expect(label(tree())).toContain("保存未确认")
    expect(label(tree())).not.toContain("刷新失败")
    expect(state.values[4]).toContain("正文 A")
    expect(state.values[8]).toBe(false)
    expect(state.invalidate).not.toHaveBeenCalled()
    const requestId = posts()[0][1].body.requestId
    expect(state.values[10]).toMatchObject({ requestId })
    controls.failAudit = false
    await submit()
    expect(posts()[1][1].body.requestId).toBe(requestId)
    expect(state.values[10]).toBeNull()
    expect(state.values[8]).toBe(false)
    expect(label(tree())).toContain("已保存")
    expect(label(tree())).not.toContain("保存未确认")
    const items = await local!.repository.listItems(intelSourceSeeds[0].id)
    expect(items).toHaveLength(1)
    expect(await local!.repository.listVersions(items[0].id)).toHaveLength(1)
    expect(await local!.repository.listManualActions(intelSourceSeeds[0].id)).toHaveLength(1)
    expect(active.client.getQueryData<{ items: unknown[] }>(["intel-items", intelSourceSeeds[0].id])?.items).toHaveLength(1)
  } finally {
    active.close()
  }
})

it("disables save while its actual callback is pending, then restores the button after confirmation", async () => {
  await interaction()
  fillA()
  const actual = state.fetch.getMockImplementation()!
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  state.fetch.mockImplementation(async (route: string, options?: { method?: string }) => {
    if (options?.method === "POST") await pending
    return actual(route, options)
  })
  nodes(tree()).find(el => el.type === "form")!.props.onSubmit({ preventDefault: vi.fn() })
  expect(button("保存中").props.disabled).toBe(true)
  expect(button("已查看，无新内容").props.disabled).toBe(true)
  release()
  await vi.waitFor(() => expect(state.values[8]).toBe(false))
  expect(button("保存人工条目").props.disabled).toBe(false)
  expect(await local!.repository.listItems(intelSourceSeeds[0].id)).toHaveLength(1)
})

it("keeps invalid date input on server rejection and saves unknown publication after the user corrects it", async () => {
  await interaction()
  fillA()
  field("原文发布时间", "S7-not-an-ISO-date")
  await submit()
  expect(state.values[5]).toBe("S7-not-an-ISO-date")
  expect(await local!.repository.listItems(intelSourceSeeds[0].id)).toEqual([])
  expect(label(tree())).toContain("保存未确认")
  const rejectedId = posts()[0][1].body.requestId
  field("原文发布时间", "")
  await submit()
  expect(posts()[1][1].body.requestId).not.toBe(rejectedId)
  expect(state.detail.data.item.publishedAt).toBeNull()
})
it("renders checklist, no-network limits, metadata-only form and escaped stored text", () => {
  const html = draw()
  expect(html).toContain("官方通知（人工录入）")
  expect(html).toContain("未知留空")
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script>")
  expect(html).toMatch(/<textarea disabled/)
  expect(html).toContain("不是失败")
})
it("separates read error/loading/empty and hides cached records on errors", () => {
  state.sources.isError = true
  state.items.isError = true
  state.detail.isError = true
  expect(draw()).toContain("检查清单读取失败")
  expect(draw()).not.toContain("Synthetic source")
  expect(draw()).not.toContain("&lt;script&gt;")
  state.sources = { isPending: true }
  expect(draw()).toContain("读取中")
})

it("renders private-capture details separately from compatible legacy declarations", () => {
  const data = state.detail.data as Record<string, unknown>
  data.clip = { actualUrl: "https://example.org/private", mode: "selection", capturedAt: "2026-10-16T02:00:00Z", date: { raw: "", field: "", role: "unknown" }, verification: "manual_capture_unverified" }
  expect(draw()).toContain("人工私人资料；权利状态未知")
  expect(draw()).not.toContain("声明人：")
  data.clip = { ...(data.clip as object), verification: "user_declaration_unverified", rights: { basis: "permission", scope: "excerpt", evidence: "Legacy proof" }, declaredBy: "Old supplied name", declaredAt: "2026-10-16T02:00:00Z" }
  expect(draw()).toContain("Old supplied name")
  expect(draw()).toContain("Legacy proof")
})
