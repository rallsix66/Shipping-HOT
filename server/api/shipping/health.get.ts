import { getShippingPersistenceStatus } from "#/shipping-store"

export default defineEventHandler(async () => ({
  database: await getShippingPersistenceStatus(),
}))
