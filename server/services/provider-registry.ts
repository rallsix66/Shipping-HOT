import type { ProviderConfig, ProviderSecret, SecretStore } from "#/providers/contracts"

export type ProviderConfigReader = () => Promise<ProviderConfig[]> | ProviderConfig[]

/** P0 registry contract: refreshes redacted secret metadata without loading any provider adapter. */
export class ProviderRegistry {
  private configs = new Map<string, ProviderConfig>()
  private secrets = new Map<string, ProviderSecret>()

  constructor(private readonly secretStore: SecretStore, private readonly readConfigs: ProviderConfigReader = () => []) {}

  async refresh(): Promise<void> {
    this.configs = new Map((await this.readConfigs()).map(config => [config.providerId, config]))
    const providerIds = new Set([...this.configs.keys(), ...this.secrets.keys()])
    this.secrets = new Map(await Promise.all([...providerIds].map(async providerId => [providerId, await this.redactedSecret(providerId)] as const)))
  }

  async redactedSecret(providerId: string): Promise<ProviderSecret> {
    const configured = await this.secretStore.has(providerId)
    const source = await this.secretStore.source(providerId)
    const secret = configured ? await this.secretStore.get(providerId) : undefined
    return { providerId, configured, source, maskedLast4: secret ? `****${secret.slice(-4)}` : undefined }
  }

  getConfig(providerId: string): ProviderConfig | undefined {
    const config = this.configs.get(providerId)
    return config ? structuredClone(config) : undefined
  }

  getSecret(providerId: string): ProviderSecret | undefined {
    const secret = this.secrets.get(providerId)
    return secret ? structuredClone(secret) : undefined
  }

  list(): Array<{ config?: ProviderConfig, secret: ProviderSecret }> {
    const ids = new Set([...this.configs.keys(), ...this.secrets.keys()])
    return [...ids].map(providerId => ({ config: this.getConfig(providerId), secret: this.getSecret(providerId) ?? { providerId, configured: false, source: "missing" } }))
  }
}
