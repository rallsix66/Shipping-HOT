import { CLIP_PROTOCOL, MANUAL_CLIP_SOURCE_ID, clipText, exactKeys, parseClipDraft, parseClipRights } from "./manual-clip"
import type { ClipDraft, ClipRights } from "./manual-clip"

export const CLIP_ORIGIN = "http://127.0.0.1:5173"
export const CLIP_EXTENSION_ID = "jihkanbaffodclncabodmbahbbgkjoad"
export const CLIP_TTL_MS = 120000
export interface ClipTransfer {
  draft: ClipDraft
  rights: ClipRights
  operator: string
  requestId: string
}
export interface ClipSender {
  id?: string
  origin?: string
  url?: string
  tab?: { id?: number }
  frameId?: number
  documentId?: string
  documentLifecycle?: string
}
export interface ClipSession {
  nonce: string
  createdAt: number
  expiresAt: number
  tabId: number
  documentId?: string
  transfer: ClipTransfer
}
export interface ClipSessionStore {
  get: () => Promise<ClipSession | undefined>
  put: (row: ClipSession) => Promise<void>
  remove: () => Promise<void>
}

export function parseClipTransfer(input: unknown): ClipTransfer {
  const row = exactKeys(input, ["draft", "rights", "operator", "requestId"])
  const draft = parseClipDraft(row.draft)
  const rights = parseClipRights(row.rights, draft.actualUrl)
  if ((rights.scope === "metadata_only" && draft.body) || (rights.scope === "excerpt" && draft.body.length > 280)) throw new Error("clip_body_exceeds_rights")
  const requestId = clipText(row.requestId, 80)
  if (!/^[\w-]{8,80}$/.test(requestId)) throw new Error("invalid_clip_input")
  return { draft, rights, operator: clipText(row.operator, 80), requestId }
}
export function clipSavePayload(transfer: ClipTransfer) {
  const row = parseClipTransfer(transfer)
  return { requestId: row.requestId, sourceId: MANUAL_CLIP_SOURCE_ID, operator: row.operator, action: "submit", clip: row.draft, rights: row.rights }
}
export function validClipSender(sender: ClipSender, row: ClipSession): boolean {
  try {
    const url = new URL(sender.url ?? "")
    return !sender.id && sender.origin === CLIP_ORIGIN && url.origin === CLIP_ORIGIN && url.pathname === "/feed" && !url.search && (!url.hash || url.hash === `#${row.nonce}`) && sender.tab?.id === row.tabId && sender.frameId === 0 && typeof sender.documentId === "string" && /^[\w-]{1,100}$/.test(sender.documentId) && sender.documentLifecycle === "active" && (!row.documentId || row.documentId === sender.documentId)
  } catch {
    return false
  }
}
/** Serialize claims: storage.session get/remove alone is not an atomic consume. */
export class ClipBroker {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private store: ClipSessionStore, private now: () => number) {}
  stage(row: ClipSession) {
    const task = this.tail.then(() => this.store.put(row))
    this.tail = task.catch(() => undefined)
    return task
  }

  cancel(nonce?: string, tabId?: number) {
    const task = this.tail.then(async () => {
      const row = await this.store.get()
      if (row && (row.nonce === nonce || row.tabId === tabId)) await this.store.remove()
    })
    this.tail = task.catch(() => undefined)
    return task
  }

  async claim(input: unknown, sender: ClipSender) {
    const task = this.tail.then(async () => {
      const message = exactKeys(input, ["protocol", "nonce", "type"])
      if (message.protocol !== CLIP_PROTOCOL || !["bind", "claim"].includes(String(message.type)) || !/^[a-f0-9]{64}$/.test(String(message.nonce))) throw new Error("invalid_clip_claim")
      const row = await this.store.get()
      if (!row) throw new Error("clip_expired_or_consumed")
      const now = this.now()
      if (now < row.createdAt || now >= row.expiresAt || row.expiresAt - row.createdAt !== CLIP_TTL_MS) {
        await this.store.remove()
        throw new Error("clip_expired_or_consumed")
      }
      if (row.nonce !== message.nonce || !validClipSender(sender, row)) throw new Error("forbidden_clip_sender")
      if (message.type === "bind") {
        await this.store.put({ ...row, documentId: sender.documentId })
        return { protocol: CLIP_PROTOCOL, extensionId: CLIP_EXTENSION_ID, bound: true }
      }
      if (!row.documentId) throw new Error("clip_document_not_bound")
      const transfer = parseClipTransfer(row.transfer)
      // At most once, including lost replies. A failed removal never releases content.
      await this.store.remove()
      return { protocol: CLIP_PROTOCOL, extensionId: CLIP_EXTENSION_ID, transfer }
    })
    this.tail = task.catch(() => undefined)
    return task
  }
}
