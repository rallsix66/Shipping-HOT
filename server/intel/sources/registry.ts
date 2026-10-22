import { type IntelSourceSeed, intelSourceSeeds } from "../sources"
import { htmlIndexCandidates } from "./html-index-candidates"
import { rssCandidates } from "./rss-candidates"

/**
 * Default-closed registration (not a qualification claim): enabled=false and persistence=disallowed (metadata only).
 * Covers HTML/JSON index candidates and RSS candidates (MY-C01 via the existing Feed parser).
 * Each entry keeps its own matrix status; e.g. CN-T01 is R2-4 OK / R2-5 PARTIAL (7/8). Registering does not fill missing identities
 * or change the 28/39 and 25/34 counts.
 */
export const REGISTERED_CLOSED_CANDIDATE_IDS = ["CN-T02", "TH-C01", "PH-C01", "CN-P01", "TH-C02", "VN-P03", "VN-T01", "ID-T01", "XX-K03", "ID-T02", "VN-D01", "XX-K02", "XX-K01", "CN-T01", "MY-C01"] as const

function closedCandidate(catalogId: string): IntelSourceSeed {
  const seed = [...htmlIndexCandidates, ...rssCandidates].find(row => row.catalogId === catalogId)
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
