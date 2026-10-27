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
    const binding = await new LlmRegistryRepository(database).upsertBinding({
      step: body.step,
      modelId: body.modelId,
      updatedBy: body.updatedBy,
    })
    return binding
  } catch (error) {
    throwLlmRegistryHttpError(error)
  }
})
