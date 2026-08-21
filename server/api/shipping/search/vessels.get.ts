import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { configureVesselSearchProvider } from "#/providers/vessel-search"
import { createVesselSearchService } from "#/search/vessel"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (typeof query.q !== "string" || !query.q.trim()) throw createError({ statusCode: 400, message: "q is required" })
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const db = useDatabase()
  await initShippingTables(db, dataMode)
  const field = typeof query.field === "string" && ["name", "imo", "mmsi", "callsign"].includes(query.field) ? query.field as "name" | "imo" | "mmsi" | "callsign" : undefined
  return createVesselSearchService(db, dataMode, configureVesselSearchProvider()).search({ query: query.q, field })
})
