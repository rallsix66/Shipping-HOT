import { getFeedHistory } from "#/shipping-store"

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const text = (value: unknown) => typeof value === "string" ? value.trim() || undefined : undefined
  const sourceId = text(query.sourceId)
  const q = text(query.q)
  const rawLimit = Number(query.limit)
  const limit = Number.isFinite(rawLimit) ? rawLimit : undefined
  return {
    view: "history" as const,
    items: await getFeedHistory({ query: q, sourceId, limit }),
  }
})
