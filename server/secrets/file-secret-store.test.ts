import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { FileSecretStore, SecretManagedByEnvironmentError } from "./file-secret-store"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function testStore(environment: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "shipping-hot-secrets-"))
  temporaryDirectories.push(directory)
  return new FileSecretStore({ path: join(directory, ".data", "provider-secrets.json"), environment })
}

describe("fileSecretStore", () => {
  it("persists local secrets with redacted metadata and restrictive mode", async () => {
    const store = await testStore()
    await store.set("openai", "sk-local-secret-1234")
    expect(await store.get("openai")).toBe("sk-local-secret-1234")
    expect(await store.source("openai")).toBe("file")
    expect(await store.redacted("openai")).toEqual({ providerId: "openai", configured: true, source: "file", maskedLast4: "****1234" })
    const file = await readFile(store.path, "utf8")
    expect(file).toContain("sk-local-secret-1234")
    if (process.platform !== "win32") expect((await stat(store.path)).mode & 0o777).toBe(0o600)
  })

  it("gives environment secrets precedence and makes them immutable from the UI", async () => {
    const store = await testStore({ OPENAI_API_KEY: "sk-environment-5678" })
    await expect(store.get("openai")).resolves.toBe("sk-environment-5678")
    await expect(store.source("openai")).resolves.toBe("environment")
    await expect(store.redacted("openai")).resolves.toEqual({ providerId: "openai", configured: true, source: "environment", maskedLast4: "****5678" })
    await expect(store.set("openai", "should-not-write")).rejects.toBeInstanceOf(SecretManagedByEnvironmentError)
    await expect(store.delete("openai")).rejects.toBeInstanceOf(SecretManagedByEnvironmentError)
  })
})
