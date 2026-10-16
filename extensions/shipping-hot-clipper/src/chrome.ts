import type { ClipSender } from "../../../shared/clipper-bridge"

type Listener = (message: unknown, sender: ClipSender, reply: (value: unknown) => void) => boolean | undefined
export interface ChromeAPI {
  runtime: { id: string, lastError?: { message?: string }, onMessage: { addListener: (listener: Listener) => void }, onMessageExternal: { addListener: (listener: Listener) => void }, sendMessage: (idOrMessage: unknown, message?: unknown, reply?: (value: unknown) => void) => Promise<unknown> }
  tabs: { query: (query: { active: boolean, currentWindow: boolean }) => Promise<{ id?: number, url?: string }[]>, create: (options: { url: string, active: boolean }) => Promise<{ id?: number }>, update: (id: number, options: { url: string, active: boolean }) => Promise<unknown>, onRemoved: { addListener: (listener: (id: number) => void) => void } }
  scripting: { executeScript: (options: { target: { tabId: number, frameIds: number[] }, files?: string[], func?: () => unknown }) => Promise<{ documentId?: string, frameId: number, result: unknown }[]> }
  storage: { session: { get: (key: string) => Promise<Record<string, unknown>>, set: (value: Record<string, unknown>) => Promise<void>, remove: (key: string) => Promise<void>, setAccessLevel: (options: { accessLevel: "TRUSTED_CONTEXTS" }) => Promise<void> } }
}
export const chromeAPI = (globalThis as unknown as { chrome: ChromeAPI }).chrome
