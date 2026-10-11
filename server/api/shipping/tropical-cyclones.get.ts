import process from "node:process"
import { ShippingRepository } from "#/database/shipping"
import { getTropicalCyclonePanel } from "#/services/tropical-cyclone-panel"

export default defineEventHandler(async (event) => {
  const db = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  const repository = new ShippingRepository(db, dataMode)
  const query = getQuery(event)
  const asOf = typeof query.asOf === "string" && query.asOf.trim() ? query.asOf.trim() : undefined
  const now = asOf ? new Date(asOf) : new Date()
  if (Number.isNaN(now.getTime())) throw createError({ statusCode: 400, statusMessage: "invalid asOf" })
  return getTropicalCyclonePanel(repository, { now })
})
