import { beforeEach, expect, it } from "vitest"
import { CLIP_EXTENSION_ID, CLIP_ORIGIN, CLIP_TTL_MS, ClipBroker, clipSavePayload } from "../shared/clipper-bridge"
import type { ClipSender, ClipSession, ClipTransfer } from "../shared/clipper-bridge"
import { CLIP_PROTOCOL, CLIP_UNIDENTIFIED_OPERATOR, MANUAL_CLIP_SOURCE_ID } from "../shared/manual-clip"
import { receiveClip } from "../src/utils/clip-import"

const nonce = "a".repeat(64)
const now = 1800000000000
const transfer: ClipTransfer = { draft: { protocol: CLIP_PROTOCOL, actualUrl: "https://example.org/story?utm_source=test#section", title: "Synthetic material", body: "", mode: "metadata", date: { raw: "2026-10-16", field: "time:datetime", role: "unknown" }, capturedAt: "2026-10-16T02:00:00.000Z", extractorVersion: "synthetic-v1" }, operator: "Synthetic operator", requestId: "synthetic-request-1", rights: { basis: "unknown", scope: "metadata_only", evidence: "", applicableUrl: "https://example.org/story?utm_source=test#section" } }
const sender: ClipSender = { origin: CLIP_ORIGIN, url: `${CLIP_ORIGIN}/feed`, tab: { id: 17 }, frameId: 0, documentId: "document-a", documentLifecycle: "active" }
let row: ClipSession | undefined
let clock = now
let broker: ClipBroker
beforeEach(() => {
  clock = now
  row = { nonce, createdAt: now, expiresAt: now + CLIP_TTL_MS, tabId: 17, transfer: structuredClone(transfer) }
  broker = new ClipBroker({ get: async () => row, put: async (value) => {
    row = value
  }, remove: async () => {
    row = undefined
  } }, () => clock)
})
const msg = (type = "claim") => ({ protocol: CLIP_PROTOCOL, nonce, type })
it.each([undefined, "", " \t\n"])("normalizes an omitted/blank clipping operator without requiring a name: %j", async (operator) => {
  row!.transfer.operator = operator
  const response = await receiveClip(nonce, { sendMessage: async (_id, value) => broker.claim(value, sender) })
  expect(response.operator).toBe(CLIP_UNIDENTIFIED_OPERATOR)
  expect(clipSavePayload(response)).toMatchObject({ operator: CLIP_UNIDENTIFIED_OPERATOR, requestId: transfer.requestId })
})
it("pulls into application preview without saving, then constructs only the manual source payload", async () => {
  const response = await receiveClip(nonce, { sendMessage: async (id, value) => {
    expect(id).toBe(CLIP_EXTENSION_ID)
    return broker.claim(value, sender)
  } })
  expect(response).toEqual(transfer)
  expect(row).toBeUndefined()
  expect(clipSavePayload(response)).toMatchObject({ sourceId: MANUAL_CLIP_SOURCE_ID, action: "submit", requestId: transfer.requestId })
})
it.each([
  { origin: "http://127.0.0.1:5174" },
  { origin: "http://localhost:5173" },
  { origin: "null" },
  { origin: undefined },
  { url: `${CLIP_ORIGIN}/settings` },
  { url: `${CLIP_ORIGIN}/feed?next=evil` },
  { url: `${CLIP_ORIGIN}/feed#bad` },
  { tab: { id: 18 } },
  { tab: undefined },
  { frameId: 1 },
  { frameId: undefined },
  { documentId: undefined },
  { documentLifecycle: "prerender" },
  { id: "other-extension" },
])("rejects an incorrect sender without exposing/consuming the draft: %j", async (patch) => {
  await expect(broker.claim(msg("bind"), { ...sender, ...patch })).rejects.toThrow("forbidden")
  expect(row?.transfer).toEqual(transfer)
})
it("rejects navigation to a different document after binding, even in the same tab/origin", async () => {
  await broker.claim(msg("bind"), sender)
  await expect(broker.claim(msg(), { ...sender, documentId: "document-b" })).rejects.toThrow("forbidden")
})
it("requires binding and consumes at most once under concurrent claims/replay", async () => {
  await expect(broker.claim(msg(), sender)).rejects.toThrow("not_bound")
  await broker.claim(msg("bind"), sender)
  const results = await Promise.allSettled([broker.claim(msg(), sender), broker.claim(msg(), sender)])
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
  await expect(broker.claim(msg(), sender)).rejects.toThrow("consumed")
})
it.each([now - 1, now + CLIP_TTL_MS, now + CLIP_TTL_MS + 1])("expires on clock rollback or TTL boundary %i", async (value) => {
  clock = value
  await expect(broker.claim(msg("bind"), sender)).rejects.toThrow("expired")
  expect(row).toBeUndefined()
})
it("never releases content if atomic consume fails", async () => {
  row!.documentId = sender.documentId
  broker = new ClipBroker({ get: async () => row, put: async () => {}, remove: async () => {
    throw new Error("storage fault")
  } }, () => now)
  await expect(broker.claim(msg(), sender)).rejects.toThrow("storage fault")
})
it("rejects wrong nonce, unknown actions and oversized/corrupt stored draft", async () => {
  await expect(broker.claim({ ...msg(), nonce: "b".repeat(64) }, sender)).rejects.toThrow("forbidden")
  await expect(broker.claim({ ...msg(), action: "save" }, sender)).rejects.toThrow("invalid")
  row!.documentId = sender.documentId
  row!.transfer.draft.body = "X".repeat(100001)
  await expect(broker.claim(msg(), sender)).rejects.toThrow("invalid")
})
