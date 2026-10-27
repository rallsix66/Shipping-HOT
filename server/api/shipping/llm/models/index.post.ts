import process from "node:process"
import { throwLlmRegistryHttpError } from "../_errors"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository } from "#/database/llm-registry"

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: "invalid_payload" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  try {
    return await new LlmRegistryRepository(database).createModel({
      id: body.id,
      providerId: body.providerId,
      modelName: body.modelName,
      purpose: body.purpose,
      unitPriceIn: body.unitPriceIn,
      unitPriceOut: body.unitPriceOut,
      currency: body.currency,
      enabled: body.enabled,
    })
  } catch (error) {
    throwLlmRegistryHttpError(error)
  }
})
