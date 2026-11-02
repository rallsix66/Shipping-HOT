import process from "node:process"
import { defineEventHandler, getQuery } from "h3"
import { initShippingTables } from "#/database/shipping"
import { LabelService } from "#/intel/label-service"

export default defineEventHandler(async (event) => {
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const q = getQuery(event)
  return new LabelService(database).list({
    limit: typeof q.limit === "string" ? Number(q.limit) : undefined,
    offset: typeof q.offset === "string" ? Number(q.offset) : undefined,
    queueStatus: typeof q.queueStatus === "string" ? q.queueStatus : undefined,
    category: typeof q.category === "string" ? q.category : undefined,
    language: typeof q.language === "string" ? q.language : undefined,
  })
})
