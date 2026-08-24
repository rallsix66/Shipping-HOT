import process from "node:process"
import { getRouterParam } from "h3"
import { initShippingTables } from "#/database/shipping"
import { readLatestVoyage } from "#/services/voyage-read"

export default defineEventHandler(async (event) => {
  const vesselId = getRouterParam(event, "id")
  if (!vesselId) throw createError({ statusCode: 400, message: "vessel_id_required" })
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const database = useDatabase()
  await initShippingTables(database, dataMode)
  return await readLatestVoyage(database, dataMode, vesselId) ?? null
})
