import type { ReactElement } from "react"
import { beforeEach, expect, it, vi } from "vitest"
import { ClipImporter } from "../src/components/shipping/clip-import"
import { CLIP_PROTOCOL, CLIP_UNIDENTIFIED_OPERATOR, MANUAL_CLIP_SOURCE_ID } from "../shared/manual-clip"

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, ref: { current: null as unknown }, fetch: vi.fn() }))
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useEffect: vi.fn(), useRef: () => state.ref, useState: (initial: unknown) => {
  const index = state.index++
  return [state.values[index] ?? initial, (value: unknown) => {
    state.values[index] = value
  }]
} }))
vi.mock("~/utils", () => ({ myFetch: (...args: unknown[]) => state.fetch(...args) }))
const url = "https://example.org/synthetic"
function draw() {
  state.index = 0
  return ClipImporter({ onSaved: vi.fn() })
}
function find(node: unknown, type: string): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(n => find(n, type)).find(Boolean)
  if (!node || typeof node !== "object" || !("props" in node)) return
  const element = node as ReactElement<Record<string, any>>
  return element.type === type ? element : find(element.props.children, type)
}
beforeEach(() => {
  state.values = [{ draft: { protocol: CLIP_PROTOCOL, actualUrl: url, title: "Synthetic preview", body: "Synthetic owned text", mode: "article", date: { raw: "2026-10-16", field: "time", role: "unknown" }, capturedAt: "2026-10-16T02:00:00Z", extractorVersion: "synthetic-v1" }, operator: "Synthetic owner", rights: { basis: "own_work", scope: "full_text", evidence: "Synthetic original work", applicableUrl: url }, requestId: "preview-request-001" }, "", false]
  state.ref.current = null
  state.fetch.mockReset()
})
it("preview does not call save; only form submission constructs the manual clip write", async () => {
  const form = find(draw(), "form")!
  expect(state.fetch).not.toHaveBeenCalled()
  state.fetch.mockResolvedValue({ outcome: "created", itemId: "synthetic-item" })
  form.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledOnce())
  expect(state.fetch.mock.calls[0][1]).toMatchObject({ method: "POST", body: { sourceId: MANUAL_CLIP_SOURCE_ID, action: "submit" } })
})
it.each([undefined, ""])("saves a name-free preview with automatic unidentified audit: %j", async (operator) => {
  ;(state.values[0] as { operator?: string }).operator = operator
  const tree = draw()
  expect(JSON.stringify(tree)).not.toContain("Synthetic owner")
  expect(JSON.stringify(tree)).not.toContain("\"maxLength\":80")
  state.fetch.mockResolvedValue({ outcome: "created", itemId: "synthetic-item" })
  find(tree, "form")!.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledOnce())
  expect(state.fetch.mock.calls[0][1].body.operator).toBe(CLIP_UNIDENTIFIED_OPERATOR)
})
it("retries an uncertain identical save with the same ID; edited material receives a new ID", async () => {
  state.fetch.mockRejectedValue(new Error("uncertain synthetic response"))
  find(draw(), "form")!.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.values[2]).toBe(false))
  find(draw(), "form")!.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2))
  const firstId = state.fetch.mock.calls[0][1].body.requestId
  expect(state.fetch.mock.calls[1][1].body.requestId).toBe(firstId)
  await vi.waitFor(() => expect(state.values[2]).toBe(false))
  const row = state.values[0] as { draft: { body: string } }
  row.draft.body = "Synthetic edited owned text"
  find(draw(), "form")!.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(3))
  expect(state.fetch.mock.calls[2][1].body.requestId).not.toBe(firstId)
})
it("never sends body when rights are unknown even if a draft is forged in memory", async () => {
  ;(state.values[0] as { rights: { basis: string } }).rights.basis = "unknown"
  find(draw(), "form")!.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(state.values[2]).toBe(false))
  expect(state.fetch).not.toHaveBeenCalled()
})
