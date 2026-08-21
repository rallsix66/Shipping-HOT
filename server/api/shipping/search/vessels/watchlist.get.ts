import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { createVesselWatchlistService } from "#/search/vessel-watchlist"

export default defineEventHandler(async () => {
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const db = useDatabase()
  await initShippingTables(db, dataMode)
  return createVesselWatchlistService(db, dataMode).list()
})
