import type { Database } from "db0"
import type { Port } from "@shared/shipping"
import { portDirectoryBaseline } from "@shared/port-directory"
import type { ShippingDataMode } from "#/database/runtime"
import { PortDirectoryRepository } from "#/database/port-directory"
import type { PortProvider } from "#/providers/shipping"
import type { RuntimeJob } from "#/runtime/background-runtime"
import { ShippingRepository } from "#/database/shipping"

export const PORT_INTELLIGENCE_CAPABILITY = "port_intelligence" as const

export interface PortSyncJobOptions {
  database: Database
  dataMode: ShippingDataMode
  provider: PortProvider
  intervalMs: number
  enabled?: boolean
  now?: () => Date
}

function directoryPort(record: { unlocode: string, nameEn: string, nameZh: string, countryCode: string }): Port {
  const baseline = portDirectoryBaseline.find(item => item.unlocode === record.unlocode)
  return {
    id: baseline?.shippingPortId ?? record.unlocode,
    name: record.nameZh,
    nameEn: record.nameEn,
    country: record.countryCode,
    unlocode: record.unlocode,
    isWatched: false,
    stale: true,
    sourceStatus: "never_succeeded",
    updatedAt: undefined,
    fetchedAt: undefined,
    provenance: undefined,
  }
}

export function createPortSyncJob(options: PortSyncJobOptions): RuntimeJob {
  const repository = new ShippingRepository(options.database, options.dataMode)
  const directory = new PortDirectoryRepository(options.database, options.dataMode)
  return {
    id: "port-sync",
    providerId: "portcast-public",
    capability: PORT_INTELLIGENCE_CAPABILITY,
    intervalMs: options.intervalMs,
    enabled: options.enabled ?? true,
    run: async () => {
      const existing = await repository.listPorts()
      const base = existing.length
        ? existing
        : (await directory.listActivePorts()).map(directoryPort)
      const received = await options.provider.getPorts(base)
      for (const port of received) await repository.upsertPort(port)
      const sourceUpdatedAt = received
        .map(port => Date.parse(port.sourceUpdatedAt ?? port.updatedAt ?? port.fetchedAt ?? ""))
        .filter(timestamp => Number.isFinite(timestamp))
        .sort((a, b) => b - a)[0]
      const failed = received.find(port => port.sourceStatus === "failed")
      return {
        status: failed ? "failed" : "success",
        recordsRead: received.length,
        recordsWritten: received.length,
        sourceUpdatedAt: sourceUpdatedAt === undefined ? undefined : new Date(sourceUpdatedAt).toISOString(),
        errorCode: failed?.error,
        errorMessage: failed?.error,
      }
    },
  }
}
