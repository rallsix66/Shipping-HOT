import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { isVesselIdentityConflict } from "#/database/vessel-search"
import { configureVesselSearchProvider } from "#/providers/vessel-search"
import { createVesselSearchService } from "#/search/vessel"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (typeof query.q !== "string" || !query.q.trim()) throw createError({ statusCode: 400, message: "q is required" })
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const db = useDatabase()
  await initShippingTables(db, dataMode)
  const field = typeof query.field === "string" && ["name", "imo", "mmsi", "callsign"].includes(query.field) ? query.field as "name" | "imo" | "mmsi" | "callsign" : undefined
  try {
    return await createVesselSearchService(db, dataMode, await configureVesselSearchProvider()).search({ query: query.q, field })
  } catch (error) {
    if (isVesselIdentityConflict(error)) throw createError({ statusCode: 409, message: "identity_conflict" })
    throw error
  }
})
