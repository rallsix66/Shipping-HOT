import { toggleWatch } from "#/shipping-store"

export default defineEventHandler(async (event) => {
  const body = await readBody<{ kind?: "vessel" | "port", id?: string }>(event)
  if (!body?.kind || !body.id) throw createError({ statusCode: 400, message: "kind and id are required" })
  return toggleWatch(body.kind, body.id)
})
