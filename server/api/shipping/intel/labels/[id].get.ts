import process from "node:process"
import { createError, defineEventHandler, getQuery, getRouterParam } from "h3"
import { initShippingTables } from "#/database/shipping"
import { LabelInputError } from "#/database/intel-label"
import { LabelService } from "#/intel/label-service"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id || !/^[\w:.-]{1,160}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: "invalid_id" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  const q = getQuery(event)
  try {
    return await new LabelService(database).detail(id, {
      queueStatus: typeof q.queueStatus === "string" ? q.queueStatus : undefined,
      category: typeof q.category === "string" ? q.category : undefined,
      language: typeof q.language === "string" ? q.language : undefined,
    })
  } catch (error) {
    if (error instanceof LabelInputError) {
      throw createError({ statusCode: 404, statusMessage: error.message })
    }
    throw createError({ statusCode: 503, statusMessage: "label_read_failed" })
  }
})
