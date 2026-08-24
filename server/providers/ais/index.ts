import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import type { SecretStore } from "#/providers/contracts"
import type { AisTrackingProvider } from "#/providers/ais/contracts"
import { createAisStreamTrackingProvider } from "#/providers/ais/aisstream-provider"
import { createMockAisTrackingProvider } from "#/providers/ais/mock-provider"
import { FileSecretStore } from "#/secrets/file-secret-store"

export interface AisProviderFactoryOptions {
  providerId: string
  dataMode: ShippingDataMode
  secretStore?: SecretStore
  now?: () => Date
}

function unavailableAisProvider(providerId: string, error: string): AisTrackingProvider {
  return {
    providerId,
    async subscribe() {
      throw new Error(error)
    },
    async unsubscribe() {
      throw new Error(error)
    },
    async getLatestPositions() {
      throw new Error(error)
    },
  }
}

export function createAisTrackingProvider(options: AisProviderFactoryOptions): AisTrackingProvider {
  if (options.providerId === "mock") {
    return options.dataMode === "real"
      ? unavailableAisProvider("mock", "mock_ais_not_allowed_in_real_mode")
      : createMockAisTrackingProvider(options.now)
  }
  if (options.providerId === "aisstream") {
    const secretStore = options.secretStore ?? new FileSecretStore()
    return createAisStreamTrackingProvider({ apiKeyResolver: () => secretStore.get("aisstream"), now: options.now })
  }
  return unavailableAisProvider(options.providerId, "ais_provider_unavailable")
}

export function createAisTrackingProviderForDatabase(_database: Database, options: AisProviderFactoryOptions): AisTrackingProvider {
  return createAisTrackingProvider(options)
}
