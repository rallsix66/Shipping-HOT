import process from "node:process"
import { createError, defineEventHandler, getRouterParam, readBody } from "h3"
import type { LabelDecisionFields } from "@shared/intel-label"
import { initShippingTables } from "#/database/shipping"
import { LabelInputError } from "#/database/intel-label"
import { LabelService } from "#/intel/label-service"

/** Save human confirm/correct. Never calls providers; never marks AI as human. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id")
  if (!id || !/^[\w:.-]{1,160}$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: "invalid_id" })
  }
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: "invalid_payload" })
  }
  if (body.kind !== "human_confirm" && body.kind !== "human_correct") {
    throw createError({ statusCode: 400, statusMessage: "invalid_decision_kind" })
  }
  if (typeof body.expectedContentHash !== "string" || typeof body.operator !== "string") {
    throw createError({ statusCode: 400, statusMessage: "invalid_payload" })
  }
  if (!body.decision || typeof body.decision !== "object" || Array.isArray(body.decision)) {
    throw createError({ statusCode: 400, statusMessage: "invalid_decision" })
  }
  const database = useDatabase()
  const dataMode = process.env.SHIPPING_DATA_MODE === "real" ? "real" : "mock"
  await initShippingTables(database, dataMode)
  try {
    return await new LabelService(database).saveHuman({
      labelItemId: id,
      expectedContentHash: body.expectedContentHash,
      kind: body.kind,
      operator: body.operator,
      decision: body.decision as LabelDecisionFields,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
    })
  } catch (error) {
    if (error instanceof LabelInputError) {
      const code = error.message === "content_hash_mismatch" || error.message === "client_request_id_conflict" ? 409 : 400
      throw createError({ statusCode: code, statusMessage: error.message })
    }
    throw createError({ statusCode: 503, statusMessage: "label_save_failed" })
  }
})
