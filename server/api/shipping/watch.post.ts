import { togglePortFollow } from "#/shipping-store"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ kind?: string, id?: string }>(event)
  if (!body || body.kind !== "port" || typeof body.id !== "string" || body.id.trim() === "") {
    throw createError({ statusCode: 400, message: "kind and id are required" })
  }
  return togglePortFollow(body.id)
})
