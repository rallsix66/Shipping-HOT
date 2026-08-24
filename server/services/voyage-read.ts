import type { Database } from "db0"
import type { ShippingDataMode } from "#/database/runtime"
import { VoyageRepository } from "#/database/voyages"

export async function readLatestVoyage(database: Database, dataMode: ShippingDataMode, vesselId: string) {
  return await new VoyageRepository(database, dataMode).getLatestVoyage(vesselId)
}
