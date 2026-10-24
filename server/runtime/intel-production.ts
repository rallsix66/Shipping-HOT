import process from "node:process"
import { lookup } from "node:dns/promises"
import { resolve } from "node:path"
import { PRODUCTION_ALLOW_SELECT_CATALOG_IDS } from "./intel-allow-select"
import { registeredIntelSources } from "#/intel/sources/registry"
import { defaultTransport } from "#/services/article-fetch-security"
import { acquireIntelDatabaseOwnership } from "#/runtime/intel-ownership"
import type { IntelFetchDeps } from "#/intel/collect"
import type { IntelSourceSeed } from "#/intel/sources.ts"
import type { BootstrapBackgroundRuntimeOptions } from "#/runtime/bootstrap"

export { PRODUCTION_ALLOW_SELECT_CATALOG_IDS }

const ALLOW_SELECT = new Set<string>(PRODUCTION_ALLOW_SELECT_CATALOG_IDS)

export interface IntelProductionDependencies {
  fetch: IntelFetchDeps
  acquireOwnership: () => Promise<{ release: () => Promise<void> }>
}

function resolveProductionSeed(catalogId: string): IntelSourceSeed {
  const found = registeredIntelSources.find(seed => seed.catalogId === catalogId)
  if (!found) throw new Error(`intel_source_config_missing:${catalogId}`)
  const copy = structuredClone(found)
  copy.enabled = true
  copy.adaptive = { minMinutes: 15, maxMinutes: 60 }
  return copy
}

export function productionIntelOptions(options: { env?: NodeJS.ProcessEnv, cwd?: string, dependencies?: IntelProductionDependencies | null } = {}): Pick<BootstrapBackgroundRuntimeOptions, "registry" | "acquireIntelOwnership" | "recoverInterruptedIntel"> {
  const env = options.env ?? process.env
  const flag = env.SHIPPING_INTEL_ENABLED?.trim().toLowerCase()
  if (flag === undefined || flag === "" || flag === "false") return { registry: { intel: { enabled: false, seeds: [] } } }
  if (flag !== "true") throw new Error("intel_enable_flag_invalid")
  if (env.SHIPPING_RUNTIME_ENABLED?.trim().toLowerCase() === "false") throw new Error("intel_requires_running_runtime")
  const ids = (env.SHIPPING_INTEL_SOURCE_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean)
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !ALLOW_SELECT.has(id))) throw new Error("intel_source_selection_invalid")
  const dependencies = options.dependencies === undefined
    ? {
        fetch: { lookup: async (host: string) => (await lookup(host, { all: true })).map(row => ({ address: row.address, family: row.family as 4 | 6 })), transport: defaultTransport },
        acquireOwnership: () => acquireIntelDatabaseOwnership(resolve(options.cwd ?? process.cwd(), ".data/shipping-hot-v3.sqlite3")),
      }
    : options.dependencies
  if (typeof dependencies?.fetch?.lookup !== "function" || typeof dependencies.fetch.transport !== "function" || typeof dependencies.acquireOwnership !== "function") throw new Error("intel_production_dependencies_missing")
  const seeds = ids.map(resolveProductionSeed)
  return { registry: { intel: { enabled: true, seeds, fetch: dependencies.fetch } }, acquireIntelOwnership: dependencies.acquireOwnership, recoverInterruptedIntel: true }
}
