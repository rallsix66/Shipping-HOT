import { randomUUID } from "node:crypto"
import type { Database } from "db0"

export const LLM_STEPS = [
  "prefilter",
  "extract",
  "group",
  "group_second_opinion",
  "summary",
  "daily_report",
  "embeddings",
  "translation",
] as const

export type LlmStep = (typeof LLM_STEPS)[number]
export type LlmPurpose = "chat" | "embedding"
export type LlmApiCompat = "openai"

export interface LlmProviderRecord {
  id: string
  name: string
  baseUrl: string
  apiCompat: LlmApiCompat
  secretRef: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface LlmModelRecord {
  id: string
  providerId: string
  modelName: string
  purpose: LlmPurpose
  unitPriceIn: number
  unitPriceOut: number
  currency: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface LlmStepBindingRecord {
  step: LlmStep
  modelId: string
  updatedAt: string
  updatedBy: string
}

export interface LlmBindingAuditRecord {
  id: string
  step: LlmStep
  previousModelId: string | null
  modelId: string
  updatedAt: string
  updatedBy: string
}

export class LlmRegistryError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = "LlmRegistryError"
    this.code = code
  }
}

/** SecretStore namespace for registry-managed keys — never equals bare translation ids (deepseek, …). */
export const LLM_SECRET_REF_PREFIX = "llm-registry:"

/** Bare SecretStore ids reserved by FileSecretStore env map / translation providers. */
export const RESERVED_BARE_SECRET_IDS = [
  "deepseek",
  "qwen-mt",
  "gemini",
  "openai",
  "claude",
  "deepl",
  "azure",
] as const

export function llmSecretRefForProviderId(providerId: string): string {
  return `${LLM_SECRET_REF_PREFIX}${providerId}`
}

/** Registry secrets must use the isolated namespace; bare reserved ids are rejected. */
export function assertLlmRegistrySecretRef(secretRef: unknown): string {
  if (typeof secretRef !== "string" || !secretRef.startsWith(LLM_SECRET_REF_PREFIX)) {
    throw new LlmRegistryError("secret_ref_namespace_required")
  }
  const bare = secretRef.slice(LLM_SECRET_REF_PREFIX.length)
  if (!bare || bare !== bare.trim()) throw new LlmRegistryError("secret_ref_namespace_required")
  if ((RESERVED_BARE_SECRET_IDS as readonly string[]).includes(secretRef)) {
    throw new LlmRegistryError("secret_ref_reserved_collision")
  }
  if ((RESERVED_BARE_SECRET_IDS as readonly string[]).includes(bare) && secretRef === bare) {
    throw new LlmRegistryError("secret_ref_reserved_collision")
  }
  return secretRef
}

/** Refuse client attempts to target a reserved bare SecretStore id. */
export function assertNotReservedBareSecretTarget(id: unknown): void {
  if (typeof id === "string" && (RESERVED_BARE_SECRET_IDS as readonly string[]).includes(id)) {
    // Creating provider id=deepseek is allowed; writing SecretStore key "deepseek" is not.
    // Callers must use llmSecretRefForProviderId — this guards explicit bare writes.
  }
}

export function assertSecretWriteTargetAllowed(secretRef: string): string {
  assertLlmRegistrySecretRef(secretRef)
  if ((RESERVED_BARE_SECRET_IDS as readonly string[]).includes(secretRef)) {
    throw new LlmRegistryError("secret_ref_reserved_collision")
  }
  return secretRef
}

const ID_RE = /^[a-z][a-z0-9_-]{1,63}$/
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._\-/]{0,79}$/u
const MODEL_NAME_RE = /^[A-Z0-9][\w.:/-]{0,127}$/i
const CURRENCY_RE = /^[A-Z]{3}$/

function requireId(value: unknown, code = "invalid_id"): string {
  if (typeof value !== "string" || !ID_RE.test(value)) throw new LlmRegistryError(code)
  return value
}

export function parseProviderName(value: unknown): string {
  if (typeof value !== "string" || !NAME_RE.test(value.trim())) throw new LlmRegistryError("invalid_name")
  return value.trim()
}

function requireName(value: unknown): string {
  return parseProviderName(value)
}

/** Strict OpenAI-compatible HTTPS base URL (no credentials, no fragment, path may end with /v1). */
export function parseProviderBaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 300) throw new LlmRegistryError("invalid_base_url")
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new LlmRegistryError("invalid_base_url")
  }
  if (url.protocol !== "https:") throw new LlmRegistryError("invalid_base_url")
  if (url.username || url.password || url.hash || url.search) throw new LlmRegistryError("invalid_base_url")
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new LlmRegistryError("invalid_base_url")
  const path = url.pathname.replace(/\/+$/, "") || ""
  if (path && path !== "/v1" && !/^\/[\w./-]+$/.test(path)) throw new LlmRegistryError("invalid_base_url")
  return `${url.origin}${path}`
}

function requireNonNegNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new LlmRegistryError(code)
  return value
}

function requireCurrency(value: unknown): string {
  if (typeof value !== "string" || !CURRENCY_RE.test(value)) throw new LlmRegistryError("invalid_currency")
  return value
}

function requirePurpose(value: unknown): LlmPurpose {
  if (value !== "chat" && value !== "embedding") throw new LlmRegistryError("invalid_purpose")
  return value
}

function requireStep(value: unknown): LlmStep {
  if (typeof value !== "string" || !(LLM_STEPS as readonly string[]).includes(value)) throw new LlmRegistryError("invalid_step")
  return value as LlmStep
}

function requireModelName(value: unknown): string {
  if (typeof value !== "string" || !MODEL_NAME_RE.test(value)) throw new LlmRegistryError("invalid_model_name")
  return value
}

export function parseProviderEnabled(value: unknown, fallback = true): boolean {
  if (value === undefined) return fallback
  if (typeof value === "boolean") return value
  if (value === 0 || value === 1) return value === 1
  throw new LlmRegistryError("invalid_enabled")
}

function bool01(value: unknown, fallback = true): boolean {
  return parseProviderEnabled(value, fallback)
}

interface ProviderRow {
  id: string
  name: string
  base_url: string
  api_compat: string
  secret_ref: string
  enabled: number
  created_at: string
  updated_at: string
}

interface ModelRow {
  id: string
  provider_id: string
  model_name: string
  purpose: string
  unit_price_in: number
  unit_price_out: number
  currency: string
  enabled: number
  created_at: string
  updated_at: string
}

interface BindingRow {
  step: string
  model_id: string
  updated_at: string
  updated_by: string
}

function mapProvider(row: ProviderRow): LlmProviderRecord {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiCompat: row.api_compat as LlmApiCompat,
    secretRef: row.secret_ref,
    enabled: Number(row.enabled) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapModel(row: ModelRow): LlmModelRecord {
  return {
    id: row.id,
    providerId: row.provider_id,
    modelName: row.model_name,
    purpose: row.purpose as LlmPurpose,
    unitPriceIn: Number(row.unit_price_in),
    unitPriceOut: Number(row.unit_price_out),
    currency: row.currency,
    enabled: Number(row.enabled) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBinding(row: BindingRow): LlmStepBindingRecord {
  return {
    step: row.step as LlmStep,
    modelId: row.model_id,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

// db0 over one connection cannot nest BEGIN; serialise binding upserts in-process.
// BEGIN IMMEDIATE still covers other connections; SQLITE_BUSY / nested-txn map to binding_conflict (409, retryable).
let bindingUpsertChain: Promise<unknown> = Promise.resolve()
function serialiseBindingUpsert<T>(work: () => Promise<T>): Promise<T> {
  const next = bindingUpsertChain.then(work, work)
  bindingUpsertChain = next.catch(() => undefined)
  return next
}

function isBindingBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /SQLITE_BUSY|database is locked|cannot start a transaction within a transaction|transaction within a transaction/i.test(message)
}

export class LlmRegistryRepository {
  constructor(private readonly db: Database) {}

  async listProviders(): Promise<LlmProviderRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM llm_provider ORDER BY created_at, id").all() as ProviderRow[]
    return rows.map(mapProvider)
  }

  async getProvider(id: string): Promise<LlmProviderRecord | null> {
    const row = await this.db.prepare("SELECT * FROM llm_provider WHERE id = ?").get(id) as ProviderRow | undefined
    return row ? mapProvider(row) : null
  }

  async createProvider(input: {
    id?: unknown
    name: unknown
    baseUrl: unknown
    apiCompat?: unknown
    enabled?: unknown
  }): Promise<LlmProviderRecord> {
    const id = input.id === undefined ? `llm-${randomUUID().slice(0, 8)}` : requireId(input.id)
    if (await this.getProvider(id)) throw new LlmRegistryError("provider_exists")
    const name = requireName(input.name)
    const baseUrl = parseProviderBaseUrl(input.baseUrl)
    if (input.apiCompat !== undefined && input.apiCompat !== "openai") throw new LlmRegistryError("invalid_api_compat")
    const enabled = bool01(input.enabled, true)
    const secretRef = assertSecretWriteTargetAllowed(llmSecretRefForProviderId(id))
    const now = new Date().toISOString()
    await this.db.prepare(`
      INSERT INTO llm_provider (id, name, base_url, api_compat, secret_ref, enabled, created_at, updated_at)
      VALUES (?, ?, ?, 'openai', ?, ?, ?, ?)
    `).run(id, name, baseUrl, secretRef, enabled ? 1 : 0, now, now)
    const created = await this.getProvider(id)
    if (!created) throw new LlmRegistryError("provider_create_failed")
    return created
  }

  async updateProvider(id: string, patch: {
    name?: unknown
    baseUrl?: unknown
    enabled?: unknown
  }): Promise<LlmProviderRecord> {
    const existing = await this.getProvider(requireId(id))
    if (!existing) throw new LlmRegistryError("provider_not_found")
    const name = patch.name === undefined ? existing.name : requireName(patch.name)
    const baseUrl = patch.baseUrl === undefined ? existing.baseUrl : parseProviderBaseUrl(patch.baseUrl)
    const enabled = patch.enabled === undefined ? existing.enabled : bool01(patch.enabled, existing.enabled)
    const now = new Date().toISOString()
    await this.db.prepare(`
      UPDATE llm_provider SET name = ?, base_url = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(name, baseUrl, enabled ? 1 : 0, now, id)
    const updated = await this.getProvider(id)
    if (!updated) throw new LlmRegistryError("provider_not_found")
    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    requireId(id)
    const existing = await this.getProvider(id)
    if (!existing) throw new LlmRegistryError("provider_not_found")
    const bound = await this.db.prepare(`
      SELECT b.step FROM llm_step_binding b
      JOIN llm_model m ON m.id = b.model_id
      WHERE m.provider_id = ?
      LIMIT 1
    `).get(id) as { step?: string } | undefined
    if (bound?.step) throw new LlmRegistryError("provider_in_use")
    await this.db.prepare("DELETE FROM llm_model WHERE provider_id = ?").run(id)
    await this.db.prepare("DELETE FROM llm_provider WHERE id = ?").run(id)
  }

  async listModels(providerId?: string): Promise<LlmModelRecord[]> {
    const rows = providerId
      ? await this.db.prepare("SELECT * FROM llm_model WHERE provider_id = ? ORDER BY created_at, id").all(requireId(providerId)) as ModelRow[]
      : await this.db.prepare("SELECT * FROM llm_model ORDER BY created_at, id").all() as ModelRow[]
    return rows.map(mapModel)
  }

  async getModel(id: string): Promise<LlmModelRecord | null> {
    const row = await this.db.prepare("SELECT * FROM llm_model WHERE id = ?").get(id) as ModelRow | undefined
    return row ? mapModel(row) : null
  }

  async createModel(input: {
    id?: unknown
    providerId: unknown
    modelName: unknown
    purpose: unknown
    unitPriceIn: unknown
    unitPriceOut: unknown
    currency: unknown
    enabled?: unknown
  }): Promise<LlmModelRecord> {
    const providerId = requireId(input.providerId, "invalid_provider_id")
    if (!(await this.getProvider(providerId))) throw new LlmRegistryError("provider_not_found")
    const id = input.id === undefined ? `mdl-${randomUUID().slice(0, 8)}` : requireId(input.id)
    if (await this.getModel(id)) throw new LlmRegistryError("model_exists")
    const modelName = requireModelName(input.modelName)
    const purpose = requirePurpose(input.purpose)
    const unitPriceIn = requireNonNegNumber(input.unitPriceIn, "invalid_unit_price_in")
    const unitPriceOut = requireNonNegNumber(input.unitPriceOut, "invalid_unit_price_out")
    const currency = requireCurrency(input.currency)
    const enabled = bool01(input.enabled, true)
    const now = new Date().toISOString()
    try {
      await this.db.prepare(`
        INSERT INTO llm_model (
          id, provider_id, model_name, purpose, unit_price_in, unit_price_out, currency, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, providerId, modelName, purpose, unitPriceIn, unitPriceOut, currency, enabled ? 1 : 0, now, now)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/UNIQUE/i.test(message)) throw new LlmRegistryError("model_duplicate")
      throw error
    }
    const created = await this.getModel(id)
    if (!created) throw new LlmRegistryError("model_create_failed")
    return created
  }

  async updateModel(id: string, patch: {
    modelName?: unknown
    purpose?: unknown
    unitPriceIn?: unknown
    unitPriceOut?: unknown
    currency?: unknown
    enabled?: unknown
  }): Promise<LlmModelRecord> {
    const existing = await this.getModel(requireId(id))
    if (!existing) throw new LlmRegistryError("model_not_found")
    const modelName = patch.modelName === undefined ? existing.modelName : requireModelName(patch.modelName)
    const purpose = patch.purpose === undefined ? existing.purpose : requirePurpose(patch.purpose)
    const unitPriceIn = patch.unitPriceIn === undefined ? existing.unitPriceIn : requireNonNegNumber(patch.unitPriceIn, "invalid_unit_price_in")
    const unitPriceOut = patch.unitPriceOut === undefined ? existing.unitPriceOut : requireNonNegNumber(patch.unitPriceOut, "invalid_unit_price_out")
    const currency = patch.currency === undefined ? existing.currency : requireCurrency(patch.currency)
    const enabled = patch.enabled === undefined ? existing.enabled : bool01(patch.enabled, existing.enabled)
    const now = new Date().toISOString()
    try {
      await this.db.prepare(`
        UPDATE llm_model
        SET model_name = ?, purpose = ?, unit_price_in = ?, unit_price_out = ?, currency = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(modelName, purpose, unitPriceIn, unitPriceOut, currency, enabled ? 1 : 0, now, id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/UNIQUE/i.test(message)) throw new LlmRegistryError("model_duplicate")
      throw error
    }
    const updated = await this.getModel(id)
    if (!updated) throw new LlmRegistryError("model_not_found")
    return updated
  }

  async deleteModel(id: string): Promise<void> {
    requireId(id)
    const existing = await this.getModel(id)
    if (!existing) throw new LlmRegistryError("model_not_found")
    const bound = await this.db.prepare("SELECT step FROM llm_step_binding WHERE model_id = ? LIMIT 1").get(id) as { step?: string } | undefined
    if (bound?.step) throw new LlmRegistryError("model_in_use")
    await this.db.prepare("DELETE FROM llm_model WHERE id = ?").run(id)
  }

  async listBindings(): Promise<LlmStepBindingRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM llm_step_binding ORDER BY step").all() as BindingRow[]
    return rows.map(mapBinding)
  }

  async getBinding(step: LlmStep): Promise<LlmStepBindingRecord | null> {
    const row = await this.db.prepare("SELECT * FROM llm_step_binding WHERE step = ?").get(step) as BindingRow | undefined
    return row ? mapBinding(row) : null
  }

  async upsertBinding(input: {
    step: unknown
    modelId: unknown
    updatedBy?: unknown
  }): Promise<LlmStepBindingRecord> {
    const step = requireStep(input.step)
    const modelId = requireId(input.modelId, "invalid_model_id")
    const updatedBy = typeof input.updatedBy === "string" && input.updatedBy.trim() && input.updatedBy.trim().length <= 80
      ? input.updatedBy.trim()
      : "settings"

    return serialiseBindingUpsert(async () => {
      try {
        await this.db.prepare("BEGIN IMMEDIATE").run()
      } catch (error) {
        if (isBindingBusyError(error)) throw new LlmRegistryError("binding_conflict")
        throw error
      }
      try {
        const model = await this.getModel(modelId)
        if (!model || !model.enabled) throw new LlmRegistryError("model_not_found")
        const provider = await this.getProvider(model.providerId)
        if (!provider || !provider.enabled) throw new LlmRegistryError("provider_not_found")
        if (step === "embeddings" && model.purpose !== "embedding") throw new LlmRegistryError("model_purpose_mismatch")
        if (step !== "embeddings" && model.purpose !== "chat") throw new LlmRegistryError("model_purpose_mismatch")

        // Bidirectional different-provider constraint for group -> group_second_opinion.
        if (step === "group" || step === "group_second_opinion") {
          const otherStep: LlmStep = step === "group" ? "group_second_opinion" : "group"
          const other = await this.getBinding(otherStep)
          if (other) {
            const otherModel = await this.getModel(other.modelId)
            if (otherModel && otherModel.providerId === model.providerId) {
              throw new LlmRegistryError("second_opinion_same_provider")
            }
          }
        }

        const previous = await this.getBinding(step)
        const now = new Date().toISOString()
        await this.db.prepare(`
        INSERT INTO llm_step_binding (step, model_id, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(step) DO UPDATE SET model_id = excluded.model_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by
      `).run(step, modelId, now, updatedBy)
        await this.db.prepare(`
        INSERT INTO llm_binding_audit (id, step, previous_model_id, model_id, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), step, previous?.modelId ?? null, modelId, now, updatedBy)

        // Snapshot inside the transaction; return it after COMMIT (do not re-read post-commit).
        const snapshot: LlmStepBindingRecord = {
          step,
          modelId,
          updatedAt: now,
          updatedBy,
        }
        await this.db.prepare("COMMIT").run()
        return snapshot
      } catch (error) {
        try {
          await this.db.prepare("ROLLBACK").run()
        } catch {
          // Preserve original error.
        }
        if (error instanceof LlmRegistryError) throw error
        if (isBindingBusyError(error)) throw new LlmRegistryError("binding_conflict")
        throw error
      }
    })
  }

  async listBindingAudit(limit = 50): Promise<LlmBindingAuditRecord[]> {
    const capped = Math.min(Math.max(1, Math.floor(limit)), 200)
    const rows = await this.db.prepare(`
      SELECT * FROM llm_binding_audit ORDER BY updated_at DESC, rowid DESC LIMIT ?
    `).all(capped) as Array<{
      id: string
      step: string
      previous_model_id: string | null
      model_id: string
      updated_at: string
      updated_by: string
    }>
    return rows.map(row => ({
      id: row.id,
      step: row.step as LlmStep,
      previousModelId: row.previous_model_id,
      modelId: row.model_id,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    }))
  }
}
