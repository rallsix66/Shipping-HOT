import { CLIP_EXTENSION_ID, CLIP_ORIGIN, parseClipTransfer } from "@shared/clipper-bridge"
import { CLIP_PROTOCOL, exactKeys } from "@shared/manual-clip"
import type { ClipTransfer } from "@shared/clipper-bridge"

export interface ClipMessenger {
  sendMessage: (id: string, message: unknown) => Promise<unknown>
}
export async function receiveClip(nonce: string, messenger: ClipMessenger): Promise<ClipTransfer> {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error("invalid_clip_nonce")
  const binding = await messenger.sendMessage(CLIP_EXTENSION_ID, { protocol: CLIP_PROTOCOL, type: "bind", nonce })
  const bound = exactKeys(binding, ["protocol", "extensionId", "bound"])
  if (bound.protocol !== CLIP_PROTOCOL || bound.extensionId !== CLIP_EXTENSION_ID || bound.bound !== true) throw new Error("clip_bind_failed")
  const claimed = exactKeys(await messenger.sendMessage(CLIP_EXTENSION_ID, { protocol: CLIP_PROTOCOL, type: "claim", nonce }), ["protocol", "extensionId", "transfer"])
  if (claimed.protocol !== CLIP_PROTOCOL || claimed.extensionId !== CLIP_EXTENSION_ID) throw new Error("clip_claim_failed")
  return parseClipTransfer(claimed.transfer)
}
let pending: Promise<ClipTransfer> | undefined
export function receiveLocationClip(): Promise<ClipTransfer> | null {
  if (pending) return pending
  const nonce = window.location.hash.slice(1)
  if (!/^[a-f0-9]{64}$/.test(nonce)) return null
  // Remove the capability before React rendering or any request. Never log it.
  window.history.replaceState(null, "", "/feed")
  const runtime = (globalThis as unknown as { chrome?: { runtime?: ClipMessenger } }).chrome?.runtime
  if (window.top !== window.self || window.location.origin !== CLIP_ORIGIN || !runtime?.sendMessage) return Promise.reject(new Error("clip_wrong_origin_or_missing_extension"))
  pending = receiveClip(nonce, runtime)
  void pending.then(() => {
    pending = undefined
  }, () => {
    pending = undefined
  })
  return pending
}
