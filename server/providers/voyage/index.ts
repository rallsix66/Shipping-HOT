import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { PortDirectoryRepository } from "#/database/port-directory"
import type { VoyageProvider } from "#/providers/voyage/contracts"
import { createMockVoyageProvider } from "#/providers/voyage/mock-provider"
import { ProviderError } from "#/providers/contracts"
import type { SecretStore } from "#/providers/contracts"
import { FileSecretStore } from "#/secrets/file-secret-store"
import { createVesselApiVoyageProvider } from "#/providers/voyage/vesselapi-provider"

export { createVesselApiVoyageProvider } from "#/providers/voyage/vesselapi-provider"

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
  secretStore?: SecretStore
}

export function createVoyageProviderForDatabase(database: Database, options: VoyageProviderFactoryOptions): VoyageProvider {
  if (options.providerId === "mock") {
    if (options.dataMode === "real") return unavailableVoyageProvider("mock", "mock_voyage_not_allowed_in_real_mode")
    return createMockVoyageProvider({ portDirectory: new PortDirectoryRepository(database, options.dataMode), now: options.now })
  }
  if (options.providerId === "vesselapi") {
    if (options.dataMode !== "real") return unavailableVoyageProvider("vesselapi", "real_voyage_provider_not_allowed_in_mock_mode")
    const secretStore = options.secretStore ?? new FileSecretStore()
    return createVesselApiVoyageProvider({
      apiKeyResolver: () => secretStore.get("vesselapi"),
      portDirectory: new PortDirectoryRepository(database, options.dataMode),
    })
  }
  return unavailableVoyageProvider(options.providerId, "voyage_provider_unavailable")
}
