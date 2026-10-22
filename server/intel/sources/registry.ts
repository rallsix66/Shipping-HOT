import { type IntelSourceSeed, intelSourceSeeds } from "../sources"
import { htmlIndexCandidates } from "./html-index-candidates"

/** Qualified candidates registered by default but kept closed: enabled=false and persistence=disallowed (metadata only). */
export const REGISTERED_CLOSED_CANDIDATE_IDS = ["CN-T02", "TH-C01", "PH-C01", "CN-P01", "TH-C02", "VN-P03", "VN-T01", "ID-T01", "XX-K03", "ID-T02", "VN-D01"] as const

function closedCandidate(catalogId: string): IntelSourceSeed {
  const seed = htmlIndexCandidates.find(row => row.catalogId === catalogId)
  if (!seed) throw new Error(`intel_registry_candidate_missing: ${catalogId}`)
  if (seed.enabled !== false || seed.persistence !== "disallowed") throw new Error(`intel_registry_candidate_not_closed: ${catalogId}`)
  return seed
}

/**
 * Default source registration for createIntelCollectJob when no seeds are passed: the two original seeds unchanged
 * (enabled) plus closed candidates reused by catalogId (same objects, no copied config). Registration upserts rows only;
 * disabled rows are never due. Production selection (intel-production.ts) and runtime/registry.ts stay explicit.
 */
export const registeredIntelSources: readonly IntelSourceSeed[] = Object.freeze([
  ...intelSourceSeeds,
  ...REGISTERED_CLOSED_CANDIDATE_IDS.map(closedCandidate),
])

if (new Set(registeredIntelSources.map(seed => seed.id)).size !== registeredIntelSources.length) throw new Error("intel_registry_duplicate_id")
if (new Set(registeredIntelSources.map(seed => seed.catalogId)).size !== registeredIntelSources.length) throw new Error("intel_registry_duplicate_catalog_id")
