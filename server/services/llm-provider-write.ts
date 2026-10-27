import { randomUUID } from "node:crypto"
import type { ProviderSecret, SecretStore } from "#/providers/contracts"
import {
  LlmRegistryError,
  assertSecretWriteTargetAllowed,
  llmSecretRefForProviderId,
  parseProviderBaseUrl,
  parseProviderEnabled,
  parseProviderName,
} from "#/database/llm-registry"
import type {
  LlmProviderRecord,
  LlmRegistryRepository,
} from "#/database/llm-registry"

export interface LlmProviderWriteDeps {
  repo: LlmRegistryRepository
  secretStore: SecretStore
}

export interface CreateProviderWithSecretInput {
  id?: unknown
  name: unknown
  baseUrl: unknown
  apiCompat?: unknown
  enabled?: unknown
  /** Optional API key; when present, written only after env preflight. */
  apiKey?: string
}

export interface PatchProviderWithSecretInput {
  name?: unknown
  baseUrl?: unknown
  enabled?: unknown
  apiKey?: string
}

export interface ProviderWithSecretMeta {
  provider: LlmProviderRecord
  secret: {
    configured: boolean
    source: "environment" | "file" | "missing"
    maskedLast4?: string
  }
}

type SecretStoreWithRedacted = SecretStore & {
  redacted?: (providerId: string) => Promise<ProviderSecret>
}

function parseOptionalApiKey(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined) return undefined
  const trimmed = apiKey.trim()
  if (!trimmed) throw new LlmRegistryError("secret_required")
  if (trimmed.length > 512) throw new LlmRegistryError("secret_too_long")
  return trimmed
}

/** Env-managed targets must fail before any DB/secret mutation. */
async function assertNotEnvironmentManaged(store: SecretStore, secretRef: string): Promise<void> {
  assertSecretWriteTargetAllowed(secretRef)
  const source = await store.source(secretRef)
  if (source === "environment") throw new LlmRegistryError("managed_by_environment")
}

async function readSecretMeta(store: SecretStore, secretRef: string): Promise<ProviderWithSecretMeta["secret"]> {
  const withRedacted = store as SecretStoreWithRedacted
  if (typeof withRedacted.redacted === "function") {
    const secret = await withRedacted.redacted(secretRef)
    return { configured: secret.configured, source: secret.source, maskedLast4: secret.maskedLast4 }
  }
  const source = await store.source(secretRef)
  const configured = await store.has(secretRef)
  return { configured, source, maskedLast4: undefined }
}

interface PriorSecretState {
  keyPresent: boolean
  keyValue: string | undefined
}

/**
 * After a failed secret set on create: restore prior key/row state.
 * Do not assume the target was originally both-absent — never delete a pre-existing key.
 * If compensate cannot verify prior state, throw provider_secret_inconsistent (never silent success).
 */
async function compensateCreateFailure(
  deps: LlmProviderWriteDeps,
  providerId: string,
  secretRef: string,
  original: unknown,
  prior: PriorSecretState,
): Promise<never> {
  if (prior.keyPresent) {
    // Keep / restore the pre-existing secret; do not delete it.
    try {
      const current = await deps.secretStore.get(secretRef)
      if (prior.keyValue !== undefined && current !== prior.keyValue) {
        await deps.secretStore.set(secretRef, prior.keyValue)
      }
    } catch {
      try {
        if (prior.keyValue !== undefined) await deps.secretStore.set(secretRef, prior.keyValue)
      } catch {
        // verify below
      }
    }
  } else {
    try {
      await deps.secretStore.delete(secretRef)
    } catch {
      // verify below
    }
  }

  let keyOk = false
  let rowAbsent = false
  try {
    const hasKey = await deps.secretStore.has(secretRef)
    if (prior.keyPresent) {
      if (!hasKey) {
        keyOk = false
      } else if (prior.keyValue === undefined) {
        keyOk = true
      } else {
        keyOk = (await deps.secretStore.get(secretRef)) === prior.keyValue
      }
    } else {
      keyOk = !hasKey
    }
  } catch {
    keyOk = false
  }
  try {
    await deps.repo.deleteProvider(providerId)
    rowAbsent = !(await deps.repo.getProvider(providerId))
  } catch {
    rowAbsent = !(await deps.repo.getProvider(providerId))
  }
  if (!keyOk || !rowAbsent) {
    throw new LlmRegistryError("provider_secret_inconsistent")
  }
  if (original instanceof LlmRegistryError) throw original
  throw new LlmRegistryError("secret_store_failed")
}

export async function createProviderWithSecret(
  deps: LlmProviderWriteDeps,
  input: CreateProviderWithSecretInput,
): Promise<ProviderWithSecretMeta> {
  const apiKey = parseOptionalApiKey(input.apiKey)
  // Full validation before any write.
  parseProviderBaseUrl(input.baseUrl)
  if (input.apiCompat !== undefined && input.apiCompat !== "openai") {
    throw new LlmRegistryError("invalid_api_compat")
  }
  const id = input.id === undefined ? `llm-${randomUUID().slice(0, 8)}` : String(input.id)
  const secretRef = llmSecretRefForProviderId(id)
  assertSecretWriteTargetAllowed(secretRef)
  if (apiKey) await assertNotEnvironmentManaged(deps.secretStore, secretRef)

  // Snapshot prior secret state before any mutation — do not assume both-absent.
  const prior: PriorSecretState = { keyPresent: false, keyValue: undefined }
  if (apiKey) {
    try {
      prior.keyPresent = await deps.secretStore.has(secretRef)
      if (prior.keyPresent) prior.keyValue = await deps.secretStore.get(secretRef)
    } catch {
      prior.keyPresent = false
      prior.keyValue = undefined
    }
  }

  const provider = await deps.repo.createProvider({
    id,
    name: input.name,
    baseUrl: input.baseUrl,
    apiCompat: input.apiCompat,
    enabled: input.enabled,
  })

  if (apiKey) {
    try {
      await deps.secretStore.set(provider.secretRef, apiKey)
    } catch (error) {
      await compensateCreateFailure(deps, provider.id, provider.secretRef, error, prior)
    }
  }

  return {
    provider,
    secret: await readSecretMeta(deps.secretStore, provider.secretRef),
  }
}

export async function patchProviderWithSecret(
  deps: LlmProviderWriteDeps,
  id: string,
  input: PatchProviderWithSecretInput,
): Promise<ProviderWithSecretMeta> {
  const apiKey = parseOptionalApiKey(input.apiKey)
  // Full field validation before any secret/DB write (do not rely on updateProvider for early reject).
  if (input.name !== undefined) parseProviderName(input.name)
  if (input.baseUrl !== undefined) parseProviderBaseUrl(input.baseUrl)
  if (input.enabled !== undefined) parseProviderEnabled(input.enabled)

  const existing = await deps.repo.getProvider(id)
  if (!existing) throw new LlmRegistryError("provider_not_found")
  assertSecretWriteTargetAllowed(existing.secretRef)

  if (apiKey) {
    await assertNotEnvironmentManaged(deps.secretStore, existing.secretRef)
    try {
      await deps.secretStore.set(existing.secretRef, apiKey)
    } catch (error) {
      // Write-before: no DB change. Write-after (key may persist): DB still untouched.
      if (error instanceof LlmRegistryError) throw error
      const hasKey = await deps.secretStore.has(existing.secretRef).catch(() => false)
      if (hasKey) throw new LlmRegistryError("provider_secret_inconsistent")
      throw new LlmRegistryError("secret_store_failed")
    }
    try {
      const provider = await deps.repo.updateProvider(id, {
        name: input.name,
        baseUrl: input.baseUrl,
        enabled: input.enabled,
      })
      return {
        provider,
        secret: await readSecretMeta(deps.secretStore, provider.secretRef),
      }
    } catch {
      // Secret already written; metadata update failed — explicit partial, not silent success.
      throw new LlmRegistryError("provider_update_after_secret_failed")
    }
  }

  const provider = await deps.repo.updateProvider(id, {
    name: input.name,
    baseUrl: input.baseUrl,
    enabled: input.enabled,
  })
  return {
    provider,
    secret: await readSecretMeta(deps.secretStore, provider.secretRef),
  }
}
