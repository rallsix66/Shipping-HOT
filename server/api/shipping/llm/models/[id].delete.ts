import process from "node:process"
import { throwLlmRegistryHttpError } from "../_errors"
import { initShippingTables } from "#/database/shipping"
import { LlmRegistryRepository } from "#/database/llm-registry"

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id) throw createError({ statusCode: 400, message: "invalid_id" })
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  try {
    await new LlmRegistryRepository(database).deleteModel(id)
    return { ok: true }
  } catch (error) {
    throwLlmRegistryHttpError(error)
  }
})
