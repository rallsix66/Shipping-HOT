import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { createVesselWatchlistService } from "#/search/vessel-watchlist"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ id?: unknown }>(event)
  if (!body || typeof body.id !== "string" || !body.id.trim()) throw createError({ statusCode: 400, message: "id is required" })
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const db = useDatabase()
  await initShippingTables(db, dataMode)
  return { id: body.id, removed: await createVesselWatchlistService(db, dataMode).remove(body.id) }
})
