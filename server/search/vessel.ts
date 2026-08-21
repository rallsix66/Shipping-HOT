import type { Database } from "db0"
import { type VesselSearchQuery, type VesselSearchResponse, normalizeVesselSearchQuery } from "@shared/vessel-search"
import { VesselMetadataRepository } from "#/database/vessel-search"
import type { ShippingDataMode } from "#/database/runtime"
import type { VesselSearchProvider } from "#/providers/vessel-search"

export interface VesselSearchServiceOptions {
  now?: () => Date
  cacheTtlMs?: number
}

export class VesselSearchService {
  private readonly now: () => Date
  private readonly cacheTtlMs: number

  constructor(
    private readonly repository: VesselMetadataRepository,
    private readonly provider: VesselSearchProvider,
    options: VesselSearchServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
    this.cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60 * 1000
  }

  async search(input: VesselSearchQuery): Promise<VesselSearchResponse> {
    const query = normalizeVesselSearchQuery(input)
    const now = this.now()
    const cached = await this.repository.getCachedSearch(query, now)
    if (cached) {
      return { query, results: cached.results, cacheHit: true, providerId: cached.providerId, fetchedAt: cached.fetchedAt }
    }
    const results = await this.provider.search(query)
    const sourceType = results.some(result => result.source_type === "mock") || this.provider.providerId.startsWith("mock") ? "mock" : "real"
    await this.repository.saveSearch(query, results, this.provider.providerId, sourceType, now, this.cacheTtlMs)
    return { query, results, cacheHit: false, providerId: this.provider.providerId, fetchedAt: now.toISOString() }
  }
}

export function createVesselSearchService(db: Database, dataMode: ShippingDataMode, provider: VesselSearchProvider, options?: VesselSearchServiceOptions): VesselSearchService {
  return new VesselSearchService(new VesselMetadataRepository(db, dataMode), provider, options)
}
