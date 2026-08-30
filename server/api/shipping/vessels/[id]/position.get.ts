import process from "node:process"
import { getRouterParam } from "h3"
import { initShippingTables } from "#/database/shipping"
import { readAisLatestPosition } from "#/services/ais-position-read"

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
  return await readAisLatestPosition({ database, dataMode, vesselId, now: new Date(), ttlMs: positionTtlMs() }) ?? null
})
