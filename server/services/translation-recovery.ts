import type { Database } from "db0"
import { RuntimeRepository, isProviderCircuitBlocked } from "#/database/runtime-jobs"
import { TRANSLATION_CAPABILITY, TRANSLATION_PROVIDER_ID } from "#/services/translation-settings"

/**
 * Explicit operator recovery for a blocked Translation circuit.
 *
 * The circuit stays fail-closed on every call: a still-broken contract simply
 * re-blocks on the next attempt. Without a product-level caller, however, a
 * `provider_contract_changed` block (for example a Provider that stops sending
 * `finish_reason`) would permanently stop both Feed title/summary and article
 * translation with no way back except editing the database by hand.
 *
 * Called only on a deliberate configuration write (saving Translation settings
 * or the DeepSeek secret), which is exactly the operator action that should be
 * allowed to retry. Returns whether a blocked circuit was actually released.
 */
export async function clearBlockedTranslationCircuit(database: Database, reason: string): Promise<boolean> {
  const runtime = new RuntimeRepository(database)
  const current = await runtime.getProviderRuntime(TRANSLATION_PROVIDER_ID, TRANSLATION_CAPABILITY)
  if (!isProviderCircuitBlocked(current)) return false
  await runtime.clearProviderCircuit({ providerId: TRANSLATION_PROVIDER_ID, capability: TRANSLATION_CAPABILITY, reason })
  return true
}

/**
 * Route-safe wrapper. The configuration write that triggers recovery has already
 * succeeded by the time this runs, so a recovery failure (for example the runtime
 * table being unavailable) must not be reported to the operator as a failed
 * settings/secret write: the new configuration is stored, and the circuit simply
 * stays blocked until the next deliberate write or successful call.
 */
export async function clearBlockedTranslationCircuitBestEffort(database: Database, reason: string): Promise<boolean> {
  try {
    return await clearBlockedTranslationCircuit(database, reason)
  } catch {
    return false
  }
}
