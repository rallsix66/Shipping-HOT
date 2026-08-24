import process from "node:process"
import { getRouterParam } from "h3"
import { AIS_POSITION_DEFAULT_TTL_MS, AisPositionRepository } from "#/database/ais-positions"
import { initShippingTables } from "#/database/shipping"

function positionTtlMs(): number {
  const minutes = Number(process.env.SHIPPING_AIS_POSITION_TTL_MINUTES ?? 15)
  return Math.max(1, Number.isFinite(minutes) ? minutes : 15) * 60 * 1000
}

export default defineEventHandler(async (event) => {
  const vesselId = getRouterParam(event, "id")
  if (!vesselId) throw createError({ statusCode: 400, message: "vessel_id_required" })
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const database = useDatabase()
  await initShippingTables(database, dataMode)
  const position = await new AisPositionRepository(database, dataMode).getLatestPosition(vesselId, new Date(), positionTtlMs() || AIS_POSITION_DEFAULT_TTL_MS)
  return position ?? null
})
