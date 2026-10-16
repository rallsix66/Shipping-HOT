import { CLIP_EXTENSION_ID, CLIP_ORIGIN, CLIP_TTL_MS, ClipBroker, parseClipTransfer } from "../../../shared/clipper-bridge"
import type { ClipSession } from "../../../shared/clipper-bridge"
import { chromeAPI as chrome } from "./chrome"

const store = {
  get: async () => (await chrome.storage.session.get("draft")).draft as ClipSession | undefined,
  put: async (row: ClipSession) => chrome.storage.session.set({ draft: row }),
  remove: async () => chrome.storage.session.remove("draft"),
}
const broker = new ClipBroker(store, Date.now)
const ready = chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
chrome.runtime.onMessageExternal.addListener((input, sender, reply) => {
  void ready.then(() => broker.claim(input, sender)).then(reply, () => reply({ error: "clip_claim_rejected" }))
  return true
})
chrome.runtime.onMessage.addListener((input, sender, reply) => {
  if (sender.id !== CLIP_EXTENSION_ID || sender.url !== `chrome-extension://${CLIP_EXTENSION_ID}/popup.html`) return
  void (async () => {
    await ready
    if (chrome.runtime.id !== CLIP_EXTENSION_ID) throw new Error("clip_extension_id_mismatch")
    const transfer = parseClipTransfer(input)
    // Bind before navigation: never open a ready-to-claim URL before knowing tab ID.
    const tab = await chrome.tabs.create({ url: "about:blank", active: false })
    if (tab.id === undefined) throw new Error("clip_tab_failed")
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("")
    const createdAt = Date.now()
    await broker.stage({ nonce, createdAt, expiresAt: createdAt + CLIP_TTL_MS, tabId: tab.id, transfer })
    try {
      await chrome.tabs.update(tab.id, { url: `${CLIP_ORIGIN}/feed#${nonce}`, active: true })
    } catch (error) {
      await broker.cancel(nonce)
      throw error
    }
    return { ok: true }
  })().then(reply, () => reply({ error: "clip_send_failed" }))
  return true
})
chrome.tabs.onRemoved.addListener((tabId) => {
  void broker.cancel(undefined, tabId)
})
