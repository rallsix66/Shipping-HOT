import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { PortDirectoryRepository } from "#/database/port-directory"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { createMockVoyageProvider } from "#/providers/voyage/mock-provider"
import { ProviderError } from "#/providers/contracts"

function unavailableVoyageProvider(providerId: string, error: string): VoyageProvider {
  return {
    providerId,
    async getVoyages() {
      throw new ProviderError("provider_unavailable", error)
    },
  }
}

export interface VoyageProviderFactoryOptions {
  providerId: string
  dataMode: ShippingDataMode
  now?: () => Date
}

export function createVoyageProviderForDatabase(database: Database, options: VoyageProviderFactoryOptions): VoyageProvider {
  if (options.providerId === "mock") {
    if (options.dataMode === "real") return unavailableVoyageProvider("mock", "mock_voyage_not_allowed_in_real_mode")
    return createMockVoyageProvider({ portDirectory: new PortDirectoryRepository(database, options.dataMode), now: options.now })
  }
  return unavailableVoyageProvider(options.providerId, "voyage_provider_unavailable")
}
