import { updateShippingSettings } from "#/shipping-store"

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return updateShippingSettings(body ?? {})
})
