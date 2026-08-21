import process from "node:process"
import { initShippingTables } from "#/database/shipping"
import { createPortSearchService } from "#/search/port"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const value = typeof query.q === "string" ? query.q : ""
  const parsedLimit = typeof query.limit === "string" ? Number(query.limit) : 50
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const db = useDatabase()
  await initShippingTables(db, dataMode)
  return { results: await createPortSearchService(db, dataMode).searchPorts(value, limit) }
})
