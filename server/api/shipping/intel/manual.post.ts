import { defineEventHandler, readBody, setResponseStatus } from "h3"
import { IntelRepository } from "#/database/intel"
import { ManualInputError, manualSubmit } from "#/intel/manual"

// Existing security middleware applies localhost, same-origin JSON and size guards.
export default defineEventHandler(async (event) => {
  try {
    return await manualSubmit(new IntelRepository(useDatabase()), await readBody(event), new Date().toISOString())
  } catch (error) {
    const statusCode = error instanceof ManualInputError ? 400 : error instanceof Error && error.message === "manual_request_conflict" ? 409 : 503
    setResponseStatus(event, statusCode)
    return { statusCode, statusMessage: statusCode === 503 ? "manual_save_failed" : statusCode === 409 ? "manual_request_conflict" : "invalid_manual_input" }
  }
})
