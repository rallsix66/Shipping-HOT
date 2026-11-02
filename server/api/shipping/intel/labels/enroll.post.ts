import process from "node:process"
import { createError, defineEventHandler, readBody } from "h3"
import type { LabelCategory } from "@shared/intel-label"
import { initShippingTables } from "#/database/shipping"
import { LabelInputError } from "#/database/intel-label"
import { LabelService } from "#/intel/label-service"

/** Enroll existing approved item+version into the label set. Never calls providers. */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: "invalid_payload" })
  }
  if (typeof body.itemId !== "string" || typeof body.versionId !== "string") {
    throw createError({ statusCode: 400, statusMessage: "invalid_identity" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  try {
    return await new LabelService(database).enrollFromExisting({
      itemId: body.itemId,
      versionId: body.versionId,
      category: typeof body.category === "string" ? body.category as LabelCategory : undefined,
      language: typeof body.language === "string" ? body.language : body.language === null ? null : undefined,
    })
  } catch (error) {
    if (error instanceof LabelInputError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw createError({ statusCode: 503, statusMessage: "label_enroll_failed" })
  }
})
