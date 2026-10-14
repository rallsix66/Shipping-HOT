import type { IntelPersistence, IntelSourceRecord } from "#/database/intel"
import { intelSourceSeeds } from "#/intel/sources.ts"

/** Existing evidence covers these exact feed products, never all pages on their hosts. */
export function manualPersistenceFor(source: Pick<IntelSourceRecord, "id" | "catalogId" | "persistence">, canonicalUrl: string): IntelPersistence {
  const seed = intelSourceSeeds.find(row => row.id === source.id && row.catalogId === source.catalogId)
  if (!seed || canonicalUrl !== seed.url) return "disallowed"
  const rank = { disallowed: 0, excerpt_only: 1, full: 2 } as const
  return (["disallowed", "excerpt_only", "full"] as const)[Math.min(rank[source.persistence], rank[seed.persistence])]
}
