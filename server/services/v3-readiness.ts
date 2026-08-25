import { readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import type { Database } from "db0"
import { latestSchemaVersion, readDatabaseMetadata } from "#/database/runtime"
import type { ShippingDataMode } from "#/database/runtime"

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
}

export interface RuntimeReadinessStatus {
  running: boolean
  jobs: RuntimeReadinessJob[]
}

export interface V3ToolchainObservation {
  packageManager?: string
  betterSqlite3Version?: string
  betterSqlite3VersionError?: string
  betterSqlite3LoadError?: string
}

export interface V3ReadinessReport {
  phase: "v3-readiness"
  ready: boolean
  checkedAt: string
  dataMode: ShippingDataMode
  checks: ReadinessCheck[]
}

export interface V3ReadinessOptions {
  dataMode?: ShippingDataMode
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

function localProviderBoundaryCheck(): ReadinessCheck {
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

function runtimeChecks(runtime: RuntimeReadinessStatus | undefined, bootstrapFailed: boolean | undefined): ReadinessCheck[] {
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

  const expected = new Map(approvedRuntimeJobs.map(job => [`${job.id}:${job.capability}`, job]))
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
    check("runtime-scope", exact ? "pass" : "fail", exact ? "Runtime Job set exactly matches the approved AIS Tracking and Voyage Sync jobs" : "Runtime Job set does not exactly match the approved AIS Tracking and Voyage Sync jobs", {
      expected: [...expected.keys()],
      actual: actualKeys,
      duplicate: duplicateKeys,
      missing: missingKeys,
      unexpected: unexpectedKeys,
      disabled: disabledKeys,
    }),
  ]
}

export async function readV3Readiness(db: Database, options: V3ReadinessOptions = {}): Promise<V3ReadinessReport> {
  const dataMode: ShippingDataMode = options.dataMode ?? (process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
  const checks = [
    ...readV3ToolchainChecks(options.toolchain),
    localProviderBoundaryCheck(),
    requestedValue("SHIPPING_RUNTIME_ENABLED", "true") === "true"
      ? check("background-runtime-enabled", "pass", "Background Runtime is enabled")
      : check("background-runtime-enabled", "fail", "Background Runtime must be enabled for V3 Readiness"),
    ...(await databaseChecks(db, dataMode)),
    ...runtimeChecks(options.runtime, options.bootstrapFailed),
    check("network-probes", "skipped", "Readiness performs no external Provider requests; live contract and coverage checks remain deferred"),
  ]
  return {
    phase: "v3-readiness",
    ready: checks.filter(item => item.id !== "network-probes").every(item => item.status === "pass"),
    checkedAt: new Date().toISOString(),
    dataMode,
    checks,
  }
}
