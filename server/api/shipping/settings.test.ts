import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const store = { updateShippingSettings: vi.fn() }
const recovery = { clearBlockedTranslationCircuitBestEffort: vi.fn() }

type SettingsHandler = (event: { body?: unknown }) => Promise<unknown>

async function loadSettingsHandler(): Promise<SettingsHandler> {
  vi.doMock("#/shipping-store", () => store)
  vi.doMock("#/services/translation-recovery", () => recovery)
  vi.stubGlobal("defineEventHandler", (handler: unknown) => handler)
  vi.stubGlobal("createError", (input: { statusCode: number, message: string }) => Object.assign(new Error(input.message), input))
  vi.stubGlobal("readBody", async (event: { body?: unknown }) => event.body)
  vi.stubGlobal("useDatabase", () => ({}))
  return (await import("./settings.post")).default as SettingsHandler
}

describe("shipping settings API translation recovery", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    store.updateShippingSettings.mockImplementation(async (patch: unknown) => ({ ...store.updateShippingSettings.mock.calls.at(-1)?.[0] as object, applied: patch }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("#/shipping-store")
    vi.doUnmock("#/services/translation-recovery")
    vi.resetModules()
  })

  it("clears a blocked translation circuit when translation settings are saved", async () => {
    const handler = await loadSettingsHandler()
    await handler({ body: { translation: { enabled: true, monthlyBudget: 5 } } })
    expect(recovery.clearBlockedTranslationCircuitBestEffort).toHaveBeenCalledWith(expect.anything(), "translation_settings_updated")
  })

  it("does not touch the translation circuit for unrelated settings", async () => {
    const handler = await loadSettingsHandler()
    await handler({ body: { refreshInterval: 30 } })
    expect(store.updateShippingSettings).toHaveBeenCalledWith({ refreshInterval: 30 })
    expect(recovery.clearBlockedTranslationCircuitBestEffort).not.toHaveBeenCalled()
  })

  it("does not clear the circuit for an empty translation patch", async () => {
    // `translation: {}` changes no field, and each clear buys one paid retry.
    const handler = await loadSettingsHandler()
    await handler({ body: { translation: {} } })
    expect(store.updateShippingSettings).toHaveBeenCalledWith({ translation: {} })
    expect(recovery.clearBlockedTranslationCircuitBestEffort).not.toHaveBeenCalled()
  })

  it("still returns the saved settings when recovery reports nothing to clear", async () => {
    const handler = await loadSettingsHandler()
    // The production wrapper resolves false instead of throwing when the circuit is
    // not blocked or the runtime table is unavailable, so the write stays successful.
    recovery.clearBlockedTranslationCircuitBestEffort.mockResolvedValueOnce(false)
    await expect(handler({ body: { translation: { enabled: true } } })).resolves.toMatchObject({ applied: { translation: { enabled: true } } })
    expect(store.updateShippingSettings).toHaveBeenCalled()
  })

  it("rejects an invalid translation setting before any write", async () => {
    const handler = await loadSettingsHandler()
    await expect(handler({ body: { translation: { monthlyBudget: -1 } } })).rejects.toMatchObject({ statusCode: 400 })
    expect(store.updateShippingSettings).not.toHaveBeenCalled()
    expect(recovery.clearBlockedTranslationCircuitBestEffort).not.toHaveBeenCalled()
  })
})
