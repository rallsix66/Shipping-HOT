import process from "node:process"
import type { Database } from "db0"
import { latestSchemaVersion, readDatabaseMetadata } from "#/database/runtime"
import type { ShippingDataMode } from "#/database/runtime"

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

export interface V3ReadinessReport {
  phase: "v3-readiness"
  ready: boolean
  checkedAt: string
  dataMode: ShippingDataMode
  checks: ReadinessCheck[]
}

const allowedRuntimeJobs = new Map([
  ["ais-tracking", "ais_tracking"],
  ["voyage-sync", "voyage_sync"],
])

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

function runtimeScopeCheck(jobs: RuntimeReadinessJob[] | undefined): ReadinessCheck {
  if (!jobs) return check("runtime-scope", "skipped", "Background Runtime status is not available; no Job was started by this check")
  const invalid = jobs.filter(job => allowedRuntimeJobs.get(job.id) !== job.capability)
  return invalid.length
    ? check("runtime-scope", "fail", "Runtime contains a Job outside the approved V3 Readiness scope", invalid.map(job => ({ id: job.id, capability: job.capability })))
    : check("runtime-scope", "pass", "Runtime Job scope contains only the approved AIS/Voyage foundation jobs", jobs.map(job => ({ id: job.id, providerId: job.providerId, capability: job.capability, enabled: job.enabled })))
}

export async function readV3Readiness(db: Database, options: { dataMode?: ShippingDataMode, runtimeJobs?: RuntimeReadinessJob[] } = {}): Promise<V3ReadinessReport> {
  const dataMode: ShippingDataMode = options.dataMode ?? (process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock")
  const checks = [
    localProviderBoundaryCheck(),
    requestedValue("SHIPPING_RUNTIME_ENABLED", "true") === "true"
      ? check("background-runtime", "pass", "Background Runtime is enabled")
      : check("background-runtime", "fail", "Background Runtime must remain enabled for V3 Readiness"),
    ...(await databaseChecks(db, dataMode)),
    runtimeScopeCheck(options.runtimeJobs),
    check("network-probes", "skipped", "Readiness performs no external Provider requests; live contract and coverage checks remain deferred"),
  ]
  return {
    phase: "v3-readiness",
    ready: checks.every(item => item.status !== "fail"),
    checkedAt: new Date().toISOString(),
    dataMode,
    checks,
  }
}
