import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ClipAudit } from "@shared/manual-clip"
import { initShippingTables } from "#/database/shipping"
import { readDatabaseMetadata } from "#/database/runtime"
import {
  LLM_SECRET_REF_PREFIX,
  LlmRegistryError,
  LlmRegistryRepository,
  llmSecretRefForProviderId,
} from "#/database/llm-registry"
import { createProviderWithSecret, patchProviderWithSecret } from "#/services/llm-provider-write"
import { BudgetAggregateError, aggregatePaidMonthSpend } from "#/intel/llm/budget-aggregate"
import { admitModelPayload } from "#/intel/llm/model-payload-gate"
import { resolveStepBinding } from "#/intel/llm/registry"
import { MOCK_TRANSPORT_LABEL, createMockOpenAiTransport } from "#/intel/llm/openai-compatible.mock"
import { runLlmTestConnection } from "#/intel/llm/test-connection"
import { type ReceiptRequest, paidRequest } from "#/intel/llm/receipts"
import type { SecretStore } from "#/providers/contracts"
import { llmRegistryMigration } from "#/database/migrations/031-llm-registry"

const T0 = new Date("2026-10-27T06:00:00.000Z")
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

type Native = InstanceType<typeof NativeDatabase>

function wrap(native: Native) {
  return createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
}

async function setup(path = ":memory:") {
  const native = new NativeDatabase(path)
  cleanups.push(() => native.close())
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native }
}

function secrets(values: Record<string, string> = {}): SecretStore {
  const map = new Map(Object.entries(values))
  return {
    get: async id => map.get(id),
    set: async (id, value) => void map.set(id, value),
    delete: async id => void map.delete(id),
    has: async id => map.has(id),
    source: async id => (map.has(id) ? "file" : "missing") as never,
  }
}

function controllableSecrets(options: {
  values?: Record<string, string>
  envIds?: string[]
  failSet?: "before" | "after" | null
  failDelete?: boolean
  /** Throw once on the first has() call (snapshot fail-closed). */
  failHasOnce?: boolean
  /** Throw once on the first get() call (snapshot fail-closed). */
  failGetOnce?: boolean
} = {}): SecretStore & { _map: Map<string, string>, _setCalls: number, _deleteCalls: number } {
  const map = new Map(Object.entries(options.values ?? {}))
  const env = new Set(options.envIds ?? [])
  let hasFailuresLeft = options.failHasOnce ? 1 : 0
  let getFailuresLeft = options.failGetOnce ? 1 : 0
  const store = {
    _map: map,
    _setCalls: 0,
    _deleteCalls: 0,
    get: async (id: string) => {
      if (getFailuresLeft > 0) {
        getFailuresLeft -= 1
        throw new Error("snapshot_get_fail")
      }
      return env.has(id) ? "env-value" : map.get(id)
    },
    set: async (id: string, value: string) => {
      store._setCalls += 1
      if (env.has(id)) throw new Error("managed_by_environment")
      if (options.failSet === "before") throw new Error("write_before_fail")
      map.set(id, value)
      if (options.failSet === "after") throw new Error("write_after_fail")
    },
    delete: async (id: string) => {
      store._deleteCalls += 1
      if (options.failDelete) throw new Error("delete_fail")
      map.delete(id)
    },
    has: async (id: string) => {
      if (hasFailuresLeft > 0) {
        hasFailuresLeft -= 1
        throw new Error("snapshot_has_fail")
      }
      return env.has(id) || map.has(id)
    },
    source: async (id: string) => (env.has(id) ? "environment" : map.has(id) ? "file" : "missing") as never,
  }
  return store
}

async function seedTwoProviders(repo: LlmRegistryRepository) {
  const chatProvider = await repo.createProvider({
    id: "fixture-chat",
    name: "Fixture Chat",
    baseUrl: "https://api.fixture-chat.example/v1",
  })
  const embedProvider = await repo.createProvider({
    id: "fixture-embed",
    name: "Fixture Embed",
    baseUrl: "https://api.fixture-embed.example/v1",
  })
  const chatModel = await repo.createModel({
    id: "mdl-chat-a",
    providerId: chatProvider.id,
    modelName: "fixture-chat-v1",
    purpose: "chat",
    unitPriceIn: 0.1,
    unitPriceOut: 0.2,
    currency: "USD",
  })
  const embedModel = await repo.createModel({
    id: "mdl-embed-a",
    providerId: embedProvider.id,
    modelName: "fixture-embed-v1",
    purpose: "embedding",
    unitPriceIn: 0.05,
    unitPriceOut: 0,
    currency: "USD",
  })
  const chatModelB = await repo.createModel({
    id: "mdl-chat-b",
    providerId: embedProvider.id,
    modelName: "fixture-chat-b",
    purpose: "chat",
    unitPriceIn: 0.15,
    unitPriceOut: 0.25,
    currency: "USD",
  })
  return { chatProvider, embedProvider, chatModel, embedModel, chatModelB }
}

describe("migration 031 llm-registry", () => {
  it("upgrades a fresh isolated DB to schema v31 and is idempotent", async () => {
    const { db, native } = await setup()
    expect((await readDatabaseMetadata(db)).schemaVersion).toBe(31)
    await initShippingTables(db, "mock")
    expect((await readDatabaseMetadata(db)).schemaVersion).toBe(31)
    const tables = native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'llm_%' ORDER BY name").all()
    expect(tables).toEqual([
      { name: "llm_binding_audit" },
      { name: "llm_model" },
      { name: "llm_provider" },
      { name: "llm_step_binding" },
    ])
  })

  it("upgrades a real v30 DB to v31 and re-running 031 stays idempotent", async () => {
    const { shippingMigrations } = await import("#/database/migrations")
    const dir = mkdtempSync(join(tmpdir(), "r3-1-mig-"))
    const path = join(dir, "v30.sqlite3")
    const native = new NativeDatabase(path)
    const db = wrap(native)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
    for (const migration of shippingMigrations.filter(m => m.version <= 30)) {
      await migration.up(db)
      await db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-10-01T00:00:00.000Z",
      )
    }
    expect(native.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: 30 })
    expect(native.prepare("SELECT name FROM sqlite_master WHERE name = 'llm_provider'").get()).toBeUndefined()
    await initShippingTables(db, "mock")
    expect((await readDatabaseMetadata(db)).schemaVersion).toBe(31)
    expect(native.prepare("SELECT name FROM sqlite_master WHERE name = 'llm_provider'").get()).toEqual({ name: "llm_provider" })
    await llmRegistryMigration.up(db)
    await llmRegistryMigration.up(db)
    expect(native.prepare("SELECT COUNT(*) AS c FROM llm_provider").get()).toEqual({ c: 0 })
    native.close()
    rmSync(dir, { recursive: true, force: true })
  })
  it("rolls back a mid-fail 031 injected via production migration entry, stays on v30, then retries to v31", async () => {
    const { shippingMigrations } = await import("#/database/migrations")
    const dir = mkdtempSync(join(tmpdir(), "r3-1-mig-rb-"))
    const path = join(dir, "v30-fail.sqlite3")
    const native = new NativeDatabase(path)
    const db = wrap(native)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `)
    for (const migration of shippingMigrations.filter(m => m.version <= 30)) {
      await migration.up(db)
      await db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        "2026-10-01T00:00:00.000Z",
      )
    }
    expect(native.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: 30 })
    expect(native.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'llm_%'").all()).toEqual([])

    const upSpy = vi.spyOn(llmRegistryMigration, "up").mockImplementation(async (migDb) => {
      await migDb.exec(`
        CREATE TABLE IF NOT EXISTS llm_provider (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_compat TEXT NOT NULL,
          secret_ref TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `)
      throw new Error("injected_031_mid_fail")
    })
    try {
      await expect(initShippingTables(db, "mock")).rejects.toThrow(/injected_031_mid_fail/)
    } finally {
      upSpy.mockRestore()
    }

    expect(native.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: 30 })
    expect(native.prepare("SELECT version FROM schema_migrations WHERE version = 31").get()).toBeUndefined()
    expect(native.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'llm_%'").all()).toEqual([])

    await initShippingTables(db, "mock")
    expect((await readDatabaseMetadata(db)).schemaVersion).toBe(31)
    expect(native.prepare("SELECT name FROM sqlite_master WHERE name = 'llm_provider'").get()).toEqual({ name: "llm_provider" })
    native.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("llm registry repository", () => {
  it("registers two fixture providers (one embedding) and switches step bindings with audit", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    expect((await repo.listProviders()).map(p => p.id).sort()).toEqual(["fixture-chat", "fixture-embed"])
    await repo.upsertBinding({ step: "extract", modelId: seeded.chatModel.id, updatedBy: "test" })
    let resolved = await resolveStepBinding(db, "extract")
    expect(resolved.ok && resolved.model.id).toBe("mdl-chat-a")
    await repo.upsertBinding({ step: "extract", modelId: seeded.chatModelB.id, updatedBy: "test" })
    resolved = await resolveStepBinding(db, "extract")
    expect(resolved.ok && resolved.model.id).toBe("mdl-chat-b")
    expect(resolved.ok && resolved.model.modelName).toBe("fixture-chat-b")
    const audit = await repo.listBindingAudit()
    expect(audit.map(a => a.modelId)).toEqual(["mdl-chat-b", "mdl-chat-a"])
    expect(audit[0]?.previousModelId).toBe("mdl-chat-a")
  })

  it("enforces purpose and bidirectional second-opinion different-provider constraints", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    await expect(repo.upsertBinding({ step: "embeddings", modelId: seeded.chatModel.id })).rejects.toMatchObject({ code: "model_purpose_mismatch" })
    await expect(repo.upsertBinding({ step: "extract", modelId: seeded.embedModel.id })).rejects.toMatchObject({ code: "model_purpose_mismatch" })
    // second then group
    await repo.upsertBinding({ step: "group_second_opinion", modelId: seeded.chatModelB.id })
    await expect(repo.upsertBinding({ step: "group", modelId: seeded.chatModelB.id })).rejects.toMatchObject({ code: "second_opinion_same_provider" })
    await repo.upsertBinding({ step: "group", modelId: seeded.chatModel.id })
    // changing group to same provider as second must fail
    await expect(repo.upsertBinding({ step: "group", modelId: seeded.chatModelB.id })).rejects.toMatchObject({ code: "second_opinion_same_provider" })
    const resolvedSecond = await resolveStepBinding(db, "group_second_opinion")
    expect(resolvedSecond.ok).toBe(true)
    const resolvedGroup = await resolveStepBinding(db, "group")
    expect(resolvedGroup.ok).toBe(true)
  })

  it("uses namespaced secretRef and does not collide with reserved bare ids", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const provider = await repo.createProvider({
      id: "deepseek",
      name: "Registry DeepSeek",
      baseUrl: "https://api.deepseek-registry.example/v1",
    })
    expect(provider.secretRef).toBe(`${LLM_SECRET_REF_PREFIX}deepseek`)
    expect(provider.secretRef).toBe(llmSecretRefForProviderId("deepseek"))
    expect(provider.secretRef).not.toBe("deepseek")
  })

  it("rolls back binding write when audit insert fails (same serial transaction)", async () => {
    const { db, native } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    await repo.upsertBinding({ step: "extract", modelId: seeded.chatModel.id, updatedBy: "seed" })
    native.exec(`CREATE TRIGGER fail_llm_audit BEFORE INSERT ON llm_binding_audit BEGIN
      SELECT RAISE(ABORT, 'audit_fail');
    END;`)
    await expect(repo.upsertBinding({ step: "extract", modelId: seeded.chatModelB.id, updatedBy: "should-roll-back" }))
      .rejects
      .toThrow(/audit_fail/)
    const binding = await repo.getBinding("extract")
    expect(binding?.modelId).toBe(seeded.chatModel.id)
    expect(binding?.updatedBy).toBe("seed")
    const audit = await repo.listBindingAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.modelId).toBe(seeded.chatModel.id)
  })

  it("records full binding audit history across switches", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    await repo.upsertBinding({ step: "summary", modelId: seeded.chatModel.id, updatedBy: "a" })
    await repo.upsertBinding({ step: "summary", modelId: seeded.chatModelB.id, updatedBy: "b" })
    await repo.upsertBinding({ step: "summary", modelId: seeded.chatModel.id, updatedBy: "c" })
    const audit = await repo.listBindingAudit()
    expect(audit.map(row => [row.modelId, row.previousModelId, row.updatedBy])).toEqual([
      ["mdl-chat-a", "mdl-chat-b", "c"],
      ["mdl-chat-b", "mdl-chat-a", "b"],
      ["mdl-chat-a", null, "a"],
    ])
  })

  it("createProviderWithSecret: env reject leaves no DB row and no key", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const id = "env-reject-create"
    const ref = llmSecretRefForProviderId(id)
    const store = controllableSecrets({ envIds: [ref] })
    await expect(createProviderWithSecret(
      { repo, secretStore: store },
      { id, name: "Env Reject", baseUrl: "https://api.env-reject.example/v1", apiKey: "sk-test-create" },
    )).rejects.toMatchObject({ code: "managed_by_environment" })
    expect(await repo.getProvider(id)).toBeNull()
    expect(store._map.has(ref)).toBe(false)
    expect(await store.source(ref)).toBe("environment")
  })

  it("createProviderWithSecret: write-before failure leaves no DB row and no key", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const id = "write-before-create"
    const ref = llmSecretRefForProviderId(id)
    const store = controllableSecrets({ failSet: "before" })
    await expect(createProviderWithSecret(
      { repo, secretStore: store },
      { id, name: "Before Fail", baseUrl: "https://api.before-fail.example/v1", apiKey: "sk-before" },
    )).rejects.toMatchObject({ code: "secret_store_failed" })
    expect(await repo.getProvider(id)).toBeNull()
    expect(store._map.has(ref)).toBe(false)
  })

  it("createProviderWithSecret: pre-existing orphan key survives write-before create failure", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const id = "orphan-key-create"
    const ref = llmSecretRefForProviderId(id)
    const store = controllableSecrets({ values: { [ref]: "sk-orphan-keep" }, failSet: "before" })
    await expect(createProviderWithSecret(
      { repo, secretStore: store },
      { id, name: "Orphan Keep", baseUrl: "https://api.orphan-keep.example/v1", apiKey: "sk-new-should-not-land" },
    )).rejects.toMatchObject({ code: "secret_store_failed" })
    expect(await repo.getProvider(id)).toBeNull()
    expect(store._map.get(ref)).toBe("sk-orphan-keep")
  })

  it("createProviderWithSecret: snapshot get failure fail-closed leaves orphan key and DB untouched", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const id = "orphan-snapshot-fail"
    const ref = llmSecretRefForProviderId(id)
    const store = controllableSecrets({ values: { [ref]: "sk-orphan-snapshot" }, failGetOnce: true })
    expect(await store.source(ref)).toBe("file")
    await expect(createProviderWithSecret(
      { repo, secretStore: store },
      { id, name: "Orphan Snapshot", baseUrl: "https://api.orphan-snapshot.example/v1", apiKey: "sk-new-must-not-write" },
    )).rejects.toMatchObject({ code: "secret_store_failed" })
    expect(await repo.getProvider(id)).toBeNull()
    expect(store._map.get(ref)).toBe("sk-orphan-snapshot")
    expect(store._setCalls).toBe(0)
    expect(store._deleteCalls).toBe(0)
  })

  it("createProviderWithSecret: write-after failure compensates to both-absent", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const id = "write-after-create"
    const ref = llmSecretRefForProviderId(id)
    const store = controllableSecrets({ failSet: "after" })
    await expect(createProviderWithSecret(
      { repo, secretStore: store },
      { id, name: "After Fail", baseUrl: "https://api.after-fail.example/v1", apiKey: "sk-after" },
    )).rejects.toMatchObject({ code: "secret_store_failed" })
    expect(await repo.getProvider(id)).toBeNull()
    expect(store._map.has(ref)).toBe(false)
  })

  it("createProviderWithSecret: compensate delete failure surfaces inconsistent (not silent success)", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const id = "inconsistent-create"
    const ref = llmSecretRefForProviderId(id)
    const store = controllableSecrets({ failSet: "after", failDelete: true })
    await expect(createProviderWithSecret(
      { repo, secretStore: store },
      { id, name: "Inconsistent", baseUrl: "https://api.inconsistent.example/v1", apiKey: "sk-bad" },
    )).rejects.toMatchObject({ code: "provider_secret_inconsistent" })
    // Key may remain; row must not be claimed successful. Row compensate may still run.
    expect(store._map.has(ref)).toBe(true)
  })

  it("patchProviderWithSecret: env reject leaves DB unchanged and writes no key", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const created = await repo.createProvider({
      id: "patch-env",
      name: "Patch Env",
      baseUrl: "https://api.patch-env.example/v1",
    })
    const store = controllableSecrets({ envIds: [created.secretRef] })
    const before = await repo.getProvider(created.id)
    await expect(patchProviderWithSecret(
      { repo, secretStore: store },
      created.id,
      { name: "Should Not Apply", apiKey: "sk-patch" },
    )).rejects.toMatchObject({ code: "managed_by_environment" })
    const after = await repo.getProvider(created.id)
    expect(after?.name).toBe(before?.name)
    expect(after?.updatedAt).toBe(before?.updatedAt)
    expect(store._map.has(created.secretRef)).toBe(false)
  })

  it("patchProviderWithSecret: write-before failure leaves DB unchanged", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const created = await repo.createProvider({
      id: "patch-before",
      name: "Patch Before",
      baseUrl: "https://api.patch-before.example/v1",
    })
    const store = controllableSecrets({ failSet: "before" })
    await expect(patchProviderWithSecret(
      { repo, secretStore: store },
      created.id,
      { name: "Renamed", apiKey: "sk-before" },
    )).rejects.toMatchObject({ code: "secret_store_failed" })
    const after = await repo.getProvider(created.id)
    expect(after?.name).toBe("Patch Before")
    expect(store._map.has(created.secretRef)).toBe(false)
  })

  it("patchProviderWithSecret: write-after failure does not update DB metadata", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const created = await repo.createProvider({
      id: "patch-after",
      name: "Patch After",
      baseUrl: "https://api.patch-after.example/v1",
    })
    const store = controllableSecrets({ failSet: "after" })
    await expect(patchProviderWithSecret(
      { repo, secretStore: store },
      created.id,
      { name: "Renamed After", apiKey: "sk-after" },
    )).rejects.toMatchObject({ code: "provider_secret_inconsistent" })
    const after = await repo.getProvider(created.id)
    expect(after?.name).toBe("Patch After")
    // Key may have persisted; metadata must not claim success via rename.
    expect(store._map.get(created.secretRef)).toBe("sk-after")
  })

  it("patchProviderWithSecret: invalid name with new apiKey rejects before any secret write", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const created = await repo.createProvider({
      id: "patch-precheck",
      name: "Patch Precheck",
      baseUrl: "https://api.patch-precheck.example/v1",
    })
    const store = controllableSecrets()
    store._map.set(created.secretRef, "sk-existing")
    const before = await repo.getProvider(created.id)
    await expect(patchProviderWithSecret(
      { repo, secretStore: store },
      created.id,
      { name: "", apiKey: "sk-fake-new" },
    )).rejects.toMatchObject({ code: "invalid_name" })
    const after = await repo.getProvider(created.id)
    expect(after?.name).toBe(before?.name)
    expect(after?.updatedAt).toBe(before?.updatedAt)
    expect(store._map.get(created.secretRef)).toBe("sk-existing")
  })

  it("promise.all concurrent binding upserts succeed serially with consistent audit", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    const results = await Promise.all([
      repo.upsertBinding({ step: "extract", modelId: seeded.chatModel.id, updatedBy: "c1" }),
      repo.upsertBinding({ step: "extract", modelId: seeded.chatModelB.id, updatedBy: "c2" }),
    ])
    expect(results).toHaveLength(2)
    expect(results.map(r => r.updatedBy).sort()).toEqual(["c1", "c2"])
    const binding = await repo.getBinding("extract")
    expect(binding).toBeTruthy()
    expect([seeded.chatModel.id, seeded.chatModelB.id]).toContain(binding!.modelId)
    // Returned snapshots match their own writes (no post-commit re-read race).
    for (const snap of results) {
      expect(snap.step).toBe("extract")
      expect([seeded.chatModel.id, seeded.chatModelB.id]).toContain(snap.modelId)
      expect(["c1", "c2"]).toContain(snap.updatedBy)
    }
    const audit = await repo.listBindingAudit()
    expect(audit).toHaveLength(2)
    expect(audit.map(a => a.updatedBy).sort()).toEqual(["c1", "c2"])
    expect(new Set(audit.map(a => a.modelId))).toEqual(new Set([seeded.chatModel.id, seeded.chatModelB.id]))
  })

  it("rejects invalid provider URLs and does not silent-fallback missing bindings", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    await expect(repo.createProvider({ name: "Bad", baseUrl: "http://insecure.example/v1" })).rejects.toBeInstanceOf(LlmRegistryError)
    await expect(repo.createProvider({ name: "Bad", baseUrl: "https://user:pass@api.example/v1" })).rejects.toBeInstanceOf(LlmRegistryError)
    const miss = await resolveStepBinding(db, "summary")
    expect(miss).toEqual({ ok: false, step: "summary", code: "binding_missing" })
  })
})

describe("scoped budget aggregate (does not replace ADR-011 capability gates)", () => {
  it("sums same-currency spend in scope and keeps pending/unknown reserved", async () => {
    const { db, native } = await setup()
    native.prepare(`
      INSERT INTO provider_usage (id, provider_id, capability, window_start, request_count, success_count, failure_count, estimated_cost, currency)
      VALUES
        ('u1', 'p-a', 'intel_extract', '2026-10-01T00:00:00.000Z', 1, 1, 0, 1.5, 'USD'),
        ('u2', 'p-b', 'translation', '2026-10-01T00:00:00.000Z', 1, 1, 0, 2.0, 'USD'),
        ('u3', 'p-d', 'search', '2026-10-01T00:00:00.000Z', 1, 1, 0, 9.0, 'CNY')
    `).run()
    native.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, purpose, status, estimated_cost, attempts, created_at, updated_at)
      VALUES ('r1', 'k1', 'p-c', 'llm_test_chat', 'x', 'pending', 0.5, 1, 't', 't')
    `).run()
    native.prepare(`
      INSERT INTO paid_receipt_attempt (id, receipt_id, attempt, provider_id, capability, status, estimated_cost, currency, started_at, usage_recorded)
      VALUES ('a1', 'r1', 1, 'p-c', 'llm_test_chat', 'pending', 0.5, 'USD', '2026-10-15T00:00:00.000Z', 0)
    `).run()
    const agg = await aggregatePaidMonthSpend(db, { currency: "USD" }, T0)
    expect(agg.usageSpend).toBe(3.5)
    expect(agg.pendingReserve).toBe(0.5)
    expect(agg.total).toBe(4)
    expect(agg.currency).toBe("USD")
  })

  it("fail-closes on mixed currency in scope and on unknown/blank currency", async () => {
    const { db, native } = await setup()
    native.prepare(`
      INSERT INTO provider_usage (id, provider_id, capability, window_start, request_count, success_count, failure_count, estimated_cost, currency)
      VALUES
        ('u1', 'p-a', 'intel_extract', '2026-10-01T00:00:00.000Z', 1, 1, 0, 1.5, 'USD'),
        ('u2', 'p-b', 'translation', '2026-10-01T00:00:00.000Z', 1, 1, 0, 2.0, 'CNY')
    `).run()
    await expect(aggregatePaidMonthSpend(db, { currency: "USD", capabilities: ["intel_extract", "translation"] }, T0))
      .rejects
      .toMatchObject({ name: "BudgetAggregateError", code: "budget_currency_mixed" })
    await expect(aggregatePaidMonthSpend(db, { currency: "ZZ" } as never, T0))
      .rejects
      .toBeInstanceOf(BudgetAggregateError)
    native.prepare(`
      INSERT INTO provider_usage (id, provider_id, capability, window_start, request_count, success_count, failure_count, estimated_cost, currency)
      VALUES ('u3', 'p-c', 'llm_test_chat', '2026-10-01T00:00:00.000Z', 1, 1, 0, 0.1, '')
    `).run()
    await expect(aggregatePaidMonthSpend(db, { currency: "USD", capabilities: ["llm_test_chat"] }, T0))
      .rejects
      .toMatchObject({ code: "budget_currency_unknown" })
  })

  it("capability filter keeps Search and Fetch domains separate; paidRequest gates per capability", async () => {
    const { db, native } = await setup()
    native.prepare(`
      INSERT INTO provider_usage (id, provider_id, capability, window_start, request_count, success_count, failure_count, estimated_cost, currency)
      VALUES
        ('u1', 'deepseek', 'search', '2026-10-01T00:00:00.000Z', 1, 1, 0, 1, 'CNY')
    `).run()
    const searchOnly = await aggregatePaidMonthSpend(db, { currency: "CNY", capabilities: ["search"] }, T0)
    expect(searchOnly.total).toBe(1)
    const fetchOnly = await aggregatePaidMonthSpend(db, { currency: "CNY", capabilities: ["fetch"] }, T0)
    expect(fetchOnly.total).toBe(0)
    // Search spend must not exhaust Fetch's own monthlyBudget.
    const fake = { hits: 0 }
    const req: ReceiptRequest = {
      providerId: "deepseek",
      capability: "fetch",
      model: "deepseek-fetch",
      purpose: "invariant_test",
      subject: "cap-sep",
      identity: { subject: "cap-sep" },
      requestSummary: {},
      estimatedCost: 1,
    }
    await paidRequest(
      { db, secretStore: secrets({ deepseek: "test-placeholder" }), monthlyBudget: 1, currency: "CNY", now: () => T0 },
      req,
      async () => {
        fake.hits++
        return { response: { ok: true }, requestId: "x", usage: { tokensIn: 1, tokensOut: 0 } }
      },
    )
    expect(fake.hits).toBe(1)
  })

  it("zero/unconfigured budget still sends zero calls (per-capability gate, not aggregate)", async () => {
    const { db, native } = await setup()
    const fake = { hits: 0 }
    const req: ReceiptRequest = {
      providerId: "fixture-chat",
      capability: "llm_test_chat",
      model: "fixture-chat-v1",
      purpose: "invariant_test",
      subject: "agg-zero",
      identity: { subject: "agg-zero" },
      requestSummary: {},
      estimatedCost: 0.01,
    }
    await expect(paidRequest(
      { db, secretStore: secrets({ "fixture-chat": "test-placeholder" }), monthlyBudget: 0, currency: "USD", now: () => T0 },
      req,
      async () => {
        fake.hits++
        return { response: { ok: true }, requestId: "x", usage: { tokensIn: 1, tokensOut: 1 } }
      },
    )).rejects.toMatchObject({ name: "PaidGateError", code: "paid_budget_zero" })
    await expect(paidRequest(
      { db, secretStore: secrets({ "fixture-chat": "test-placeholder" }), monthlyBudget: undefined, currency: "USD", now: () => T0 },
      req,
      async () => {
        fake.hits++
        return { response: { ok: true }, requestId: "x", usage: { tokensIn: 1, tokensOut: 1 } }
      },
    )).rejects.toMatchObject({ code: "paid_budget_unconfigured" })
    expect(fake.hits).toBe(0)
    expect(native.prepare("SELECT COUNT(*) AS c FROM paid_receipt").get()).toEqual({ c: 0 })
  })
})

describe("model-payload-gate", () => {
  it("denies private_material and unknown rights; readIntelMaterial is not a grant", () => {
    const privateAudit = {
      title: "t",
      body: "",
      actualUrl: "https://example.com/a",
      capture: "manual_user_capture",
      usage: "private_material",
      rightsStatus: "unknown",
      recordedBy: "op",
      recordedAt: "t",
      verification: "manual_capture_unverified",
    } as ClipAudit
    expect(admitModelPayload({ clipAudit: privateAudit }).allow).toBe(false)
    expect(admitModelPayload({ clipAudit: privateAudit, modelUsePermitted: true }).allow).toBe(false)
    expect(admitModelPayload({}).allow).toBe(false)
    expect(admitModelPayload({ modelUsePermitted: true }).allow).toBe(true)
  })
})

describe("test-connection mock", () => {
  it("labels mock results as test_result and refuses zero-budget egress", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    const store = secrets({ [llmSecretRefForProviderId("fixture-chat")]: "test-placeholder" })
    const denied = await runLlmTestConnection({
      db,
      secretStore: store,
      monthlyBudget: 0,
      providerId: seeded.chatProvider.id,
      modelId: seeded.chatModel.id,
      now: () => T0,
    })
    expect(denied.ok).toBe(false)
    expect(denied.kind).toBe("test_result")
    expect(denied.transport).toBe(MOCK_TRANSPORT_LABEL)
    if (!denied.ok) expect(denied.code).toBe("paid_budget_zero")

    const transport = createMockOpenAiTransport()
    const ok = await runLlmTestConnection({
      db,
      secretStore: store,
      monthlyBudget: 10,
      providerId: seeded.chatProvider.id,
      modelId: seeded.chatModel.id,
      transport,
      now: () => T0,
    })
    expect(ok).toMatchObject({
      ok: true,
      kind: "test_result",
      transport: MOCK_TRANSPORT_LABEL,
      providerId: "fixture-chat",
      modelId: "mdl-chat-a",
    })
    expect(ok.ok && ok.note).toContain("不是真实服务商")
    expect(transport.state.chatHits).toBe(1)
    if (!ok.ok) throw new Error("expected ok")
    const firstReceipt = ok.receiptId

    // Changing baseUrl must not reuse the prior receipt identity.
    await repo.updateProvider(seeded.chatProvider.id, { baseUrl: "https://api.fixture-chat-v2.example/v1" })
    const store2 = secrets({ [llmSecretRefForProviderId(seeded.chatProvider.id)]: "test-placeholder" })
    const again = await runLlmTestConnection({
      db,
      secretStore: store2,
      monthlyBudget: 10,
      providerId: seeded.chatProvider.id,
      modelId: seeded.chatModel.id,
      transport,
      now: () => T0,
    })
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.reused).toBe(false)
      expect(again.receiptId).not.toBe(firstReceipt)
    }
    expect(transport.state.chatHits).toBe(2)
  })

  it("looks up secrets via namespaced secretRef (not bare provider id)", async () => {
    const { db } = await setup()
    const repo = new LlmRegistryRepository(db)
    const seeded = await seedTwoProviders(repo)
    const bareOnly = secrets({ "fixture-chat": "test-placeholder" })
    const denied = await runLlmTestConnection({
      db,
      secretStore: bareOnly,
      monthlyBudget: 10,
      providerId: seeded.chatProvider.id,
      modelId: seeded.chatModel.id,
      now: () => T0,
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.code).toBe("paid_secret_missing")
    const namespaced = secrets({ [llmSecretRefForProviderId("fixture-chat")]: "test-placeholder" })
    const transport = createMockOpenAiTransport()
    const ok = await runLlmTestConnection({
      db,
      secretStore: namespaced,
      monthlyBudget: 10,
      providerId: seeded.chatProvider.id,
      modelId: seeded.chatModel.id,
      transport,
      now: () => T0,
    })
    expect(ok.ok).toBe(true)
  })
})
