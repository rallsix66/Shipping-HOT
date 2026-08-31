import { readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import type { Database } from "db0"
import { latestSchemaVersion, readDatabaseMetadata } from "#/database/runtime"
import type { ShippingDataMode } from "#/database/runtime"
import { activeShippingFeedSourceIds, shippingFeedSources } from "#/providers/feed"
import { isAisStreamingEnabled } from "#/runtime/ais-streaming-config"

export const v3ToolchainContract = {
  nodeVersion: "24.15.0",
  abi: "137",
  packageManager: "pnpm@10.30.3",
  betterSqlite3: "12.6.2",
} as const

export const approvedRuntimeJobs = [
  { id: "ais-tracking", capability: "ais_tracking" },
  { id: "voyage-sync", capability: "voyage_sync" },
] as const

export type ReadinessProfile = "DEVELOPMENT_SAFE" | "REAL_OPERATIONAL"

export function approvedRuntimeJobKeys(dataMode: ShippingDataMode): string[] {
  const keys = approvedRuntimeJobs
    .filter(job => job.id !== "ais-tracking" || !isAisStreamingEnabled(dataMode))
    .map(job => `${job.id}:${job.capability}`)
  const requestedFeed = process.env.SHIPPING_FEED_PROVIDER?.trim().toLowerCase()
  if (dataMode === "real" && requestedFeed === "public") {
    for (const source of shippingFeedSources) {
      if (activeShippingFeedSourceIds([source]).has(source.id)) keys.push(`feed-sync:${source.id}:feed_sync`)
    }
  } else if (dataMode !== "real" && requestedFeed !== "public") {
    keys.push("feed-sync:mock-port-notice:feed_sync")
  }
  keys.push("calendar-sync:calendar_sync")
  keys.push("port-sync:port_intelligence", "weather-sync:weather_sync")
  return keys
}

export type ReadinessCheckStatus = "pass" | "fail" | "skipped"

export interface ReadinessCheck {
  id: string
  status: ReadinessCheckStatus
  detail: string
  value?: unknown
}

export interface RuntimeReadinessJob {
  id: string
  providerId: string
  capability: string
  enabled: boolean
  status?: string
  lastSuccessAt?: string
  lastSourceUpdatedAt?: string
  nextSyncAt?: string
  errorCode?: string
}

export interface RuntimeReadinessStatus {
  running: boolean
  jobs: RuntimeReadinessJob[]
  aisLiveTracker?: {
    running: boolean
    providerStatus?: CapabilityReadiness["runtime"]
    lastSuccessAt?: string
    lastSourceUpdatedAt?: string
  }
}

export interface V3ToolchainObservation {
  packageManager?: string
  betterSqlite3Version?: string
  betterSqlite3VersionError?: string
  betterSqlite3LoadError?: string
}

export interface V3ReadinessReport {
  phase: "v3-readiness"
  profile: ReadinessProfile
  ready: boolean
  overall: "ready" | "degraded" | "blocked"
  checkedAt: string
  dataMode: ShippingDataMode
  checks: ReadinessCheck[]
  capabilities: CapabilityReadiness[]
}

export type CapabilityReadinessStatus = "safe_mock" | "configured" | "coverage_pending" | "credential_missing" | "entitlement_missing" | "adapter_pending" | "not_configured"

export interface CapabilityReadiness {
  capability: string
  provider: string
  configured: boolean
  credential: "available" | "missing" | "not_required" | "unknown"
  runtime: "registered" | "not_registered" | "disabled" | "never_succeeded" | "healthy" | "degraded" | "failed"
  lastSuccessAt?: string
  lastSourceUpdatedAt?: string
  freshness: "fresh" | "stale" | "unknown"
  liveVerification: "verified_live" | "connection_verified" | "coverage_pending" | "not_verified"
  status: CapabilityReadinessStatus
  sources?: ReadinessSource[]
}

export interface ReadinessSource {
  id: string
  provider: string
  runtime: CapabilityReadiness["runtime"]
  enabled: boolean
  lastSuccessAt?: string
  lastSourceUpdatedAt?: string
  errorCode?: string
}

export interface V3ReadinessOptions {
  dataMode?: ShippingDataMode
  profile?: ReadinessProfile
  runtime?: RuntimeReadinessStatus
  bootstrapFailed?: boolean
  toolchain?: Partial<V3ToolchainObservation>
}

function check(id: string, status: ReadinessCheckStatus, detail: string, value?: unknown): ReadinessCheck {
  return { id, status, detail, ...(value === undefined ? {} : { value }) }
}

function requestedValue(name: string, fallback: string): string {
  return process.env[name]?.trim().toLowerCase() || fallback
}

function providerBoundaryCheck(profile: ReadinessProfile, dataMode: ShippingDataMode): ReadinessCheck {
  if (profile === "REAL_OPERATIONAL") {
    const effectiveAisProvider = configuredValue("SHIPPING_AIS_PROVIDER") ?? configuredValue("SHIPPING_VESSEL_PROVIDER")
    const values = [
      ["SHIPPING_DATA_MODE", process.env.SHIPPING_DATA_MODE?.trim().toLowerCase(), ["real"]],
      ["SHIPPING_AIS_PROVIDER", effectiveAisProvider, ["aisstream"]],
      ["SHIPPING_VESSEL_SEARCH_PROVIDER", process.env.SHIPPING_VESSEL_SEARCH_PROVIDER?.trim().toLowerCase(), ["gfw", "vesselapi"]],
      ["SHIPPING_PORT_PROVIDER", process.env.SHIPPING_PORT_PROVIDER?.trim().toLowerCase(), ["portcast"]],
      ["SHIPPING_WEATHER_PROVIDER", process.env.SHIPPING_WEATHER_PROVIDER?.trim().toLowerCase(), ["open-meteo"]],
      ["SHIPPING_WEATHER_ALERT_PROVIDER", process.env.SHIPPING_WEATHER_ALERT_PROVIDER?.trim().toLowerCase(), ["off", "public", "experimental"]],
      ["SHIPPING_FEED_PROVIDER", process.env.SHIPPING_FEED_PROVIDER?.trim().toLowerCase(), ["public"]],
      ["SHIPPING_CALENDAR_PROVIDER", process.env.SHIPPING_CALENDAR_PROVIDER?.trim().toLowerCase(), ["calendarific", "official", "manual"]],
      ["SHIPPING_AIS_AREA_PROVIDER", process.env.SHIPPING_AIS_AREA_PROVIDER?.trim().toLowerCase(), ["off", "aisstream"]],
      ["SHIPPING_VOYAGE_PROVIDER", process.env.SHIPPING_VOYAGE_PROVIDER?.trim().toLowerCase(), ["vesselapi"]],
    ] as const
    const unsafe = values.filter(([, actual]) => actual === "mock")
    if (dataMode !== "real") return check("provider-boundary", "fail", "REAL_OPERATIONAL requires SHIPPING_DATA_MODE=real", { actual: dataMode, expected: "real" })
    if (unsafe.length) return check("provider-boundary", "fail", "Real Mode cannot activate a Mock Provider", unsafe.map(([name, actual]) => ({ name, requested: actual })))
    return check("provider-boundary", "pass", "Real Mode Provider boundary is active; missing credentials remain capability-level states")
  }
  const requested = [
    ["SHIPPING_DATA_MODE", requestedValue("SHIPPING_DATA_MODE", "mock"), "mock"],
    ["SHIPPING_VESSEL_PROVIDER", requestedValue("SHIPPING_VESSEL_PROVIDER", "mock"), "mock"],
    ["SHIPPING_VESSEL_SEARCH_PROVIDER", requestedValue("SHIPPING_VESSEL_SEARCH_PROVIDER", "mock"), "mock"],
    ["SHIPPING_PORT_PROVIDER", requestedValue("SHIPPING_PORT_PROVIDER", "mock"), "mock"],
    ["SHIPPING_WEATHER_PROVIDER", requestedValue("SHIPPING_WEATHER_PROVIDER", "mock"), "mock"],
    ["SHIPPING_WEATHER_ALERT_PROVIDER", requestedValue("SHIPPING_WEATHER_ALERT_PROVIDER", "off"), "off"],
    ["SHIPPING_FEED_PROVIDER", requestedValue("SHIPPING_FEED_PROVIDER", "mock"), "mock"],
    ["SHIPPING_CALENDAR_PROVIDER", requestedValue("SHIPPING_CALENDAR_PROVIDER", "mock"), "mock"],
    ["SHIPPING_AIS_PROVIDER", requestedValue("SHIPPING_AIS_PROVIDER", "mock"), "mock"],
    ["SHIPPING_AIS_AREA_PROVIDER", requestedValue("SHIPPING_AIS_AREA_PROVIDER", "off"), "off"],
    ["SHIPPING_VOYAGE_PROVIDER", requestedValue("SHIPPING_VOYAGE_PROVIDER", "mock"), "mock"],
  ] as const
  const unsafe = requested.filter(([, actual, safe]) => actual !== safe)
  return unsafe.length
    ? check("local-provider-boundary", "fail", "V3 Readiness requires Mock-only providers and Area AIS off; no real Provider is activated", unsafe.map(([name, actual]) => ({ name, requested: actual })))
    : check("local-provider-boundary", "pass", "Mock-only provider configuration is active; no new real or paid Provider is activated")
}

export function readV3PackageManagerObservation(userAgent = process.env.npm_config_user_agent): string | undefined {
  if (!userAgent) return undefined
  const match = userAgent.match(/(?:^|\s)(pnpm|npm|yarn)\/(\S+)/i)
  return match ? `${match[1].toLowerCase()}@${match[2]}` : "unknown"
}

function readInstalledBetterSqlite3Version(): { version?: string, error?: string } {
  try {
    const manifestPath = join(process.cwd(), "node_modules", "better-sqlite3", "package.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown }
    if (typeof manifest.version !== "string" || !manifest.version) return { error: "better-sqlite3 package version is missing" }
    return { version: manifest.version }
  } catch (error) {
    return { error: error instanceof Error ? `better-sqlite3 package version could not be read: ${error.message}` : "better-sqlite3 package version could not be read" }
  }
}

function collectV3ToolchainObservation(): V3ToolchainObservation {
  const packageVersion = readInstalledBetterSqlite3Version()
  let betterSqlite3LoadError: string | undefined
  try {
    const database = new NativeDatabase(":memory:")
    database.prepare("SELECT 1").get()
    database.close()
  } catch (error) {
    betterSqlite3LoadError = error instanceof Error ? error.message : "better-sqlite3 native load failed"
  }
  return {
    packageManager: readV3PackageManagerObservation(),
    betterSqlite3Version: packageVersion.version,
    betterSqlite3VersionError: packageVersion.error,
    betterSqlite3LoadError,
  }
}

export function readV3ToolchainChecks(overrides: Partial<V3ToolchainObservation> = {}): ReadinessCheck[] {
  const observation = { ...collectV3ToolchainObservation(), ...overrides }
  const packageManagerStatus: ReadinessCheckStatus = observation.packageManager === undefined
    ? "skipped"
    : observation.packageManager === v3ToolchainContract.packageManager
      ? "pass"
      : "fail"
  const betterSqlite3Status: ReadinessCheck = observation.betterSqlite3VersionError
    ? check("better-sqlite3", "fail", observation.betterSqlite3VersionError)
    : observation.betterSqlite3LoadError
      ? check("better-sqlite3", "fail", `better-sqlite3 native load failed: ${observation.betterSqlite3LoadError}`)
      : observation.betterSqlite3Version === undefined
        ? check("better-sqlite3", "fail", "better-sqlite3 installed version was not observed")
        : check(
            "better-sqlite3",
            observation.betterSqlite3Version === v3ToolchainContract.betterSqlite3 ? "pass" : "fail",
            `better-sqlite3 observed version ${observation.betterSqlite3Version}; expected ${v3ToolchainContract.betterSqlite3}`,
            { observed: observation.betterSqlite3Version, expected: v3ToolchainContract.betterSqlite3, abi: process.versions.modules },
          )
  return [
    check("node-version", process.versions.node === v3ToolchainContract.nodeVersion ? "pass" : "fail", `Node observed ${process.versions.node}; expected ${v3ToolchainContract.nodeVersion}`, { observed: process.versions.node, expected: v3ToolchainContract.nodeVersion }),
    check("node-abi", process.versions.modules === v3ToolchainContract.abi ? "pass" : "fail", `Node ABI observed ${process.versions.modules}; expected ${v3ToolchainContract.abi}`, { observed: process.versions.modules, expected: v3ToolchainContract.abi }),
    check("package-manager", packageManagerStatus, observation.packageManager === undefined
      ? `pnpm version unverified; expected ${v3ToolchainContract.packageManager}`
      : `Package manager observed ${observation.packageManager}; expected ${v3ToolchainContract.packageManager}`, { observed: observation.packageManager, expected: v3ToolchainContract.packageManager }),
    betterSqlite3Status,
  ]
}

async function databaseChecks(db: Database, dataMode: ShippingDataMode): Promise<ReadinessCheck[]> {
  try {
    const metadata = await readDatabaseMetadata(db)
    const checks = [
      check(
        "schema-version",
        metadata.schemaVersion === latestSchemaVersion ? "pass" : "fail",
        metadata.schemaVersion === latestSchemaVersion ? "V3 schema is current" : `V3 schema is ${metadata.schemaVersion}; expected ${latestSchemaVersion}`,
        { actual: metadata.schemaVersion, expected: latestSchemaVersion },
      ),
      check(
        "database-mode",
        metadata.dataMode === dataMode ? "pass" : "fail",
        metadata.dataMode === dataMode ? "Database mode matches process configuration" : "Database mode does not match process configuration",
        { database: metadata.dataMode, process: dataMode },
      ),
    ]
    const directory = await db.prepare(`
      SELECT
        status.port_directory_status AS status,
        status.port_directory_version AS version,
        (SELECT COUNT(*) FROM port_directory WHERE is_active = 1 AND source <> 'mock') AS port_count
      FROM port_directory_status AS status
      WHERE status.id = 'default'
    `).get() as { status?: string, version?: string, port_count?: number } | undefined
    const directoryReady = directory?.status === "ready" && Number(directory.port_count) >= 8
    checks.push(check(
      "port-directory",
      directoryReady ? "pass" : "fail",
      directoryReady ? "P1A Port Directory baseline is ready" : "P1A Port Directory baseline is not ready",
      { status: directory?.status ?? "missing", version: directory?.version ?? null, activeNonMockPorts: Number(directory?.port_count ?? 0) },
    ))
    return checks
  } catch (error) {
    return [check("database", "fail", error instanceof Error ? error.message : "V3 database readiness query failed")]
  }
}

function runtimeChecks(runtime: RuntimeReadinessStatus | undefined, bootstrapFailed: boolean | undefined, dataMode: ShippingDataMode): ReadinessCheck[] {
  if (bootstrapFailed) {
    return [
      check("runtime-bootstrap", "fail", "Background Runtime bootstrap failed"),
      check("runtime-running", "fail", "Background Runtime is unavailable after bootstrap failure"),
      check("runtime-scope", "fail", "Background Runtime Job set is unavailable after bootstrap failure"),
    ]
  }
  if (!runtime) {
    return [
      check("runtime-bootstrap", "fail", "Background Runtime is not initialized; bootstrap may have failed"),
      check("runtime-running", "fail", "Background Runtime is not running"),
      check("runtime-scope", "fail", "Background Runtime Job set is unavailable"),
    ]
  }

  const expected = new Map(approvedRuntimeJobKeys(dataMode).map(key => [key, key]))
  const actual = runtime.jobs
  const actualKeys = actual.map(job => `${job.id}:${job.capability}`)
  const counts = new Map<string, number>()
  actualKeys.forEach(key => counts.set(key, (counts.get(key) ?? 0) + 1))
  const duplicateKeys = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  const missingKeys = [...expected.keys()].filter(key => !counts.has(key))
  const unexpectedKeys = actualKeys.filter(key => !expected.has(key))
  const disabledKeys = actual.filter(job => expected.has(`${job.id}:${job.capability}`) && !job.enabled).map(job => `${job.id}:${job.capability}`)
  const exact = actual.length === expected.size && duplicateKeys.length === 0 && missingKeys.length === 0 && unexpectedKeys.length === 0 && disabledKeys.length === 0
  return [
    check("runtime-bootstrap", "pass", "Background Runtime bootstrap completed"),
    check("runtime-running", runtime.running ? "pass" : "fail", runtime.running ? "Background Runtime is running" : "Background Runtime is initialized but not running", runtime.running),
    check("runtime-scope", exact ? "pass" : "fail", exact ? "Runtime Job set exactly matches the approved V3 Job set" : "Runtime Job set does not exactly match the approved V3 Job set", {
      expected: [...expected.keys()],
      actual: actualKeys,
      duplicate: duplicateKeys,
      missing: missingKeys,
      unexpected: unexpectedKeys,
      disabled: disabledKeys,
    }),
  ]
}

function configuredValue(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function runtimeState(job: RuntimeReadinessJob): CapabilityReadiness["runtime"] {
  if (!job.enabled) return "disabled"
  return job.status === "healthy" || job.status === "degraded" || job.status === "failed" ? job.status : "never_succeeded"
}

export function aggregateRuntimeReadiness(jobs: RuntimeReadinessJob[]): CapabilityReadiness["runtime"] {
  if (!jobs.length) return "not_registered"
  const states = jobs.map(runtimeState)
  if (states.every(state => state === "disabled")) return "disabled"
  if (states.includes("disabled")) return "degraded"
  if (states.every(state => state === "healthy")) return "healthy"
  if (states.every(state => state === "failed")) return "failed"
  if (states.every(state => state === "never_succeeded")) return "never_succeeded"
  if (states.includes("healthy")) return "degraded"
  if (states.includes("degraded")) return "degraded"
  return "degraded"
}

function configuredAisProvider(): string | undefined {
  return configuredValue("SHIPPING_AIS_PROVIDER") ?? configuredValue("SHIPPING_VESSEL_PROVIDER")
}

export interface AisLiveVerificationInput {
  dataMode: ShippingDataMode
  provider: string
  streamingEnabled: boolean
  credentialAvailable: boolean
  tracker?: RuntimeReadinessStatus["aisLiveTracker"]
  runtime: CapabilityReadiness["runtime"]
  lastSuccessAt?: string
  lastSourceUpdatedAt?: string
  freshness: CapabilityReadiness["freshness"]
}

function parseableTimestamp(value: string | undefined): boolean {
  return Boolean(value && Number.isFinite(Date.parse(value)))
}

function hasHistoricalAisEvidence(input: AisLiveVerificationInput): boolean {
  return Boolean(input.lastSuccessAt) && parseableTimestamp(input.lastSourceUpdatedAt)
}

export function resolveAisLiveVerification(input: AisLiveVerificationInput): CapabilityReadiness["liveVerification"] {
  if (input.dataMode !== "real" || input.provider !== "aisstream" || !input.streamingEnabled || !input.credentialAvailable) return "coverage_pending"
  if (!input.tracker?.running || !hasHistoricalAisEvidence(input)) return "coverage_pending"
  if (input.runtime === "healthy" && input.freshness === "fresh") return "verified_live"
  if (input.runtime === "degraded" || input.runtime === "failed") return "verified_live"
  if (input.freshness === "stale" && input.runtime === "healthy") return "verified_live"
  return "coverage_pending"
}

export function resolveAisReadinessStatus(input: AisLiveVerificationInput, liveVerification: CapabilityReadiness["liveVerification"]): CapabilityReadinessStatus {
  if (!input.credentialAvailable) return "credential_missing"
  return liveVerification === "verified_live" ? "configured" : "coverage_pending"
}

function vesselSearchCapabilityDefinition(): { capability: string, provider: string, configured: boolean, credential: CapabilityReadiness["credential"], status: CapabilityReadinessStatus } {
  const provider = configuredValue("SHIPPING_VESSEL_SEARCH_PROVIDER")
  if (provider === "gfw") {
    const available = Boolean(configuredValue("GFW_API_TOKEN"))
    return { capability: "vessel_search", provider, configured: true, credential: available ? "available" : "missing", status: available ? "coverage_pending" : "credential_missing" }
  }
  if (provider === "vesselapi") {
    const available = Boolean(configuredValue("VESSELAPI_API_KEY"))
    return { capability: "vessel_search", provider, configured: true, credential: available ? "available" : "missing", status: available ? "coverage_pending" : "credential_missing" }
  }
  return { capability: "vessel_search", provider: provider ?? "unavailable", configured: false, credential: "unknown", status: "not_configured" }
}

function capabilityReadiness(profile: ReadinessProfile, runtime: RuntimeReadinessStatus | undefined, dataMode: ShippingDataMode): CapabilityReadiness[] {
  const runtimeByCapability = new Map<string, RuntimeReadinessJob[]>()
  for (const job of runtime?.jobs ?? []) runtimeByCapability.set(job.capability, [...(runtimeByCapability.get(job.capability) ?? []), job])
  const safe = profile === "DEVELOPMENT_SAFE"
  const definitions: Array<{ capability: string, provider: string, configured: boolean, credential: CapabilityReadiness["credential"], status: CapabilityReadinessStatus, liveVerification?: CapabilityReadiness["liveVerification"] }> = safe
    ? [
        { capability: "vessel_search", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "ais_tracking", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "ais_area", provider: "off", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "port_intelligence", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "weather", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "weather_alerts", provider: "off", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "feed", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "calendar", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
        { capability: "voyage_eta", provider: "mock", configured: true, credential: "not_required", status: "safe_mock" },
      ]
    : [
        vesselSearchCapabilityDefinition(),
        { capability: "ais_tracking", provider: configuredAisProvider() ?? "unavailable", configured: configuredAisProvider() === "aisstream", credential: configuredValue("AISSTREAM_API_KEY") ? "available" : "missing", status: configuredValue("AISSTREAM_API_KEY") ? "coverage_pending" : "credential_missing" },
        { capability: "ais_area", provider: configuredValue("SHIPPING_AIS_AREA_PROVIDER") ?? "off", configured: configuredValue("SHIPPING_AIS_AREA_PROVIDER") === "aisstream", credential: configuredValue("AISSTREAM_API_KEY") ? "available" : "missing", status: configuredValue("SHIPPING_AIS_AREA_PROVIDER") === "aisstream" ? (configuredValue("AISSTREAM_API_KEY") ? "coverage_pending" : "credential_missing") : "not_configured" },
        { capability: "port_intelligence", provider: configuredValue("SHIPPING_PORT_PROVIDER") ?? "unavailable", configured: configuredValue("SHIPPING_PORT_PROVIDER") === "portcast", credential: "not_required", status: configuredValue("SHIPPING_PORT_PROVIDER") === "portcast" ? "coverage_pending" : "not_configured" },
        { capability: "weather", provider: configuredValue("SHIPPING_WEATHER_PROVIDER") ?? "unavailable", configured: configuredValue("SHIPPING_WEATHER_PROVIDER") === "open-meteo", credential: "not_required", status: configuredValue("SHIPPING_WEATHER_PROVIDER") === "open-meteo" ? "coverage_pending" : "not_configured" },
        { capability: "weather_alerts", provider: configuredValue("SHIPPING_WEATHER_ALERT_PROVIDER") ?? "off", configured: configuredValue("SHIPPING_WEATHER_ALERT_PROVIDER") === "public", credential: "not_required", status: configuredValue("SHIPPING_WEATHER_ALERT_PROVIDER") === "public" ? "coverage_pending" : "not_configured" },
        { capability: "feed", provider: configuredValue("SHIPPING_FEED_PROVIDER") ?? "unavailable", configured: configuredValue("SHIPPING_FEED_PROVIDER") === "public", credential: "not_required", status: configuredValue("SHIPPING_FEED_PROVIDER") === "public" ? "coverage_pending" : "not_configured" },
        { capability: "calendar", provider: configuredValue("SHIPPING_CALENDAR_PROVIDER") ?? "unavailable", configured: Boolean(configuredValue("SHIPPING_CALENDAR_PROVIDER")), credential: configuredValue("CALENDARIFIC_API_KEY") ? "available" : "missing", status: configuredValue("SHIPPING_CALENDAR_PROVIDER") === "calendarific" && configuredValue("CALENDARIFIC_API_KEY") ? "coverage_pending" : configuredValue("SHIPPING_CALENDAR_PROVIDER") === "calendarific" ? "credential_missing" : "not_configured" },
        { capability: "voyage_eta", provider: configuredValue("SHIPPING_VOYAGE_PROVIDER") ?? "unavailable", configured: configuredValue("SHIPPING_VOYAGE_PROVIDER") === "vesselapi", credential: configuredValue("VESSELAPI_API_KEY") ? "available" : "missing", status: configuredValue("VESSELAPI_API_KEY") ? "coverage_pending" : "credential_missing" },
      ]
  return definitions.map((definition) => {
    const runtimeCapability = definition.capability === "voyage_eta"
      ? "voyage_sync"
      : definition.capability === "feed"
        ? "feed_sync"
        : definition.capability === "calendar"
          ? "calendar_sync"
          : definition.capability === "port_intelligence"
            ? "port_intelligence"
            : definition.capability === "weather"
              ? "weather_sync"
              : definition.capability
    const jobs = runtimeByCapability.get(runtimeCapability) ?? []
    const job = jobs[0]
    const aggregatedRuntime = aggregateRuntimeReadiness(jobs)
    const streamingEnabled = isAisStreamingEnabled(dataMode)
    const liveTracker = definition.capability === "ais_tracking" && streamingEnabled ? runtime?.aisLiveTracker : undefined
    const sourceDetails = runtimeCapability === "feed_sync"
      ? jobs.map(source => ({ id: source.id, provider: source.providerId, runtime: runtimeState(source), enabled: source.enabled, lastSuccessAt: source.lastSuccessAt, lastSourceUpdatedAt: source.lastSourceUpdatedAt, errorCode: source.errorCode }))
      : undefined
    const sourceUpdatedAt = liveTracker?.lastSourceUpdatedAt ?? job?.lastSourceUpdatedAt
    const freshness = sourceUpdatedAt && Date.parse(sourceUpdatedAt) > Date.now() - 24 * 60 * 60 * 1000
      ? "fresh"
      : sourceUpdatedAt
        ? "stale"
        : "unknown"
    const capabilityRuntime = liveTracker
      ? liveTracker.running ? (liveTracker.providerStatus ?? "registered") : "not_registered"
      : aggregatedRuntime
    const lastSuccessAt = liveTracker?.lastSuccessAt ?? job?.lastSuccessAt
    const lastSourceUpdatedAt = liveTracker?.lastSourceUpdatedAt ?? job?.lastSourceUpdatedAt
    const liveVerification = definition.capability === "ais_tracking" && !safe
      ? resolveAisLiveVerification({
          dataMode,
          provider: definition.provider,
          streamingEnabled,
          credentialAvailable: definition.credential === "available",
          tracker: liveTracker,
          runtime: capabilityRuntime,
          lastSuccessAt,
          lastSourceUpdatedAt,
          freshness,
        })
      : definition.liveVerification ?? (safe ? "not_verified" : "coverage_pending")
    const status = definition.capability === "ais_tracking" && !safe
      ? resolveAisReadinessStatus({
          dataMode,
          provider: definition.provider,
          streamingEnabled,
          credentialAvailable: definition.credential === "available",
          tracker: liveTracker,
          runtime: capabilityRuntime,
          lastSuccessAt,
          lastSourceUpdatedAt,
          freshness,
        }, liveVerification)
      : definition.status
    return { ...definition, status, runtime: capabilityRuntime, lastSuccessAt, lastSourceUpdatedAt, freshness, liveVerification, ...(sourceDetails ? { sources: sourceDetails } : {}) }
  })
}

export async function readV3Readiness(db: Database, options: V3ReadinessOptions = {}): Promise<V3ReadinessReport> {
  const dataMode: ShippingDataMode = options.dataMode ?? (process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
  const profile = options.profile ?? (dataMode === "real" ? "REAL_OPERATIONAL" : "DEVELOPMENT_SAFE")
  const checks = [
    ...readV3ToolchainChecks(options.toolchain),
    providerBoundaryCheck(profile, dataMode),
    profile === "REAL_OPERATIONAL" && dataMode !== "real"
      ? check("profile-data-mode", "fail", "REAL_OPERATIONAL requires real data mode")
      : check("profile-data-mode", "pass", `${profile} data mode is selected`),
    requestedValue("SHIPPING_RUNTIME_ENABLED", "true") === "true"
      ? check("background-runtime-enabled", "pass", "Background Runtime is enabled")
      : check("background-runtime-enabled", "fail", "Background Runtime must be enabled for V3 Readiness"),
    ...(await databaseChecks(db, dataMode)),
    ...runtimeChecks(options.runtime, options.bootstrapFailed, dataMode),
    check("network-probes", "skipped", "Readiness performs no external Provider requests; live contract and coverage checks remain deferred"),
  ]
  const capabilities = capabilityReadiness(profile, options.runtime, dataMode)
  const hardChecksPass = checks.filter(item => item.id !== "network-probes").every(item => item.status === "pass")
  return {
    phase: "v3-readiness",
    profile,
    ready: hardChecksPass,
    overall: hardChecksPass ? (capabilities.some(capability => capability.status !== "safe_mock" && capability.status !== "configured") ? "degraded" : "ready") : "blocked",
    checkedAt: new Date().toISOString(),
    dataMode,
    checks,
    capabilities,
  }
}
