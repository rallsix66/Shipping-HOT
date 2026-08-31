import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { isVesselIdentityConflict } from "#/database/vessel-search"
import { configureVesselSearchProvider } from "#/providers/vessel-search"
import { ProviderError } from "#/providers/contracts"
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
    if (error instanceof ProviderError) {
      throw createError({
        statusCode: error.status && error.status >= 400 && error.status < 600 ? error.status : 502,
        statusMessage: error.code,
        message: error.code,
        data: { code: error.code, providerStatus: error.status },
      })
    }
    throw error
  }
})
