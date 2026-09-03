import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const secretStore = {
  redacted: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}

class MockSecretManagedByEnvironmentError extends Error {
  statusCode = 409
  statusMessage = "managed_by_environment"

  constructor() {
    super("managed_by_environment")
  }
}

type SecretHandler = (event: { body?: unknown }) => Promise<unknown>

async function loadSecretHandler(kind: "get" | "post" | "delete"): Promise<SecretHandler> {
  vi.doMock("#/secrets/file-secret-store", () => ({
    FileSecretStore: class {
      redacted = secretStore.redacted
      set = secretStore.set
      delete = secretStore.delete
    },
    SecretManagedByEnvironmentError: MockSecretManagedByEnvironmentError,
  }))
  vi.stubGlobal("defineEventHandler", (handler: unknown) => handler)
  vi.stubGlobal("createError", (input: { statusCode: number, message: string }) => Object.assign(new Error(input.message), input))
  vi.stubGlobal("readBody", async (event: { body?: unknown }) => event.body)
  const module = kind === "get"
    ? await import("./secret.get")
    : kind === "post"
      ? await import("./secret.post")
      : await import("./secret.delete")
  return module.default as SecretHandler
}

describe("translation Secret API routes", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    secretStore.redacted.mockResolvedValue({ providerId: "deepseek", configured: false, source: "missing" })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("#/secrets/file-secret-store")
    vi.resetModules()
  })

  it("get returns missing redacted metadata without a raw key", async () => {
    const handler = await loadSecretHandler("get")
    const result = await handler({}) as Record<string, unknown>
    expect(result).toEqual({ providerId: "deepseek", configured: false, source: "missing" })
    expect(JSON.stringify(result)).not.toContain("DEEPSEEK_API_KEY")
    expect(secretStore.redacted).toHaveBeenCalledWith("deepseek")
  })

  it("post stores a trimmed key and returns only redacted metadata", async () => {
    const masked = { providerId: "deepseek", configured: true, source: "file", maskedLast4: "****1234" }
    secretStore.redacted.mockResolvedValue(masked)
    const handler = await loadSecretHandler("post")
    const result = await handler({ body: { apiKey: "  deepseek-key-1234  " } }) as Record<string, unknown>
    expect(secretStore.set).toHaveBeenCalledWith("deepseek", "deepseek-key-1234")
    expect(result).toEqual(masked)
    expect(JSON.stringify(result)).not.toContain("deepseek-key-1234")
  })

  it("post rejects empty and unexpected payloads without echoing submitted values", async () => {
    const handler = await loadSecretHandler("post")
    for (const body of [{ apiKey: "   " }, { apiKey: "secret", extra: "do-not-echo" }]) {
      await expect(handler({ body })).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(secretStore.set).not.toHaveBeenCalled()
  })

  it("delete removes a file-managed secret and returns refreshed metadata", async () => {
    const masked = { providerId: "deepseek", configured: false, source: "missing" }
    secretStore.redacted.mockResolvedValue(masked)
    const handler = await loadSecretHandler("delete")
    await expect(handler({})).resolves.toEqual(masked)
    expect(secretStore.delete).toHaveBeenCalledWith("deepseek")
  })

  it("post and delete preserve environment-managed immutability", async () => {
    secretStore.set.mockRejectedValue(new MockSecretManagedByEnvironmentError())
    const postHandler = await loadSecretHandler("post")
    await expect(postHandler({ body: { apiKey: "replacement-key" } })).rejects.toMatchObject({ statusCode: 409, message: "managed_by_environment" })

    vi.resetModules()
    secretStore.delete.mockRejectedValue(new MockSecretManagedByEnvironmentError())
    const deleteHandler = await loadSecretHandler("delete")
    await expect(deleteHandler({})).rejects.toMatchObject({ statusCode: 409, message: "managed_by_environment" })
  })
})
