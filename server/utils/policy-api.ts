import type { H3Event } from "h3"
import type { PolicyFilter } from "@shared/policy"
import { PolicyError } from "#/database/policy"

export function policyFilterFromQuery(event: H3Event): PolicyFilter {
  const q = getQuery(event)
  const pick = (k: string) => typeof q[k] === "string" && q[k] ? String(q[k]).slice(0, 200) : undefined
  return { countryCode: pick("country"), platform: pick("platform"), category: pick("category"), status: pick("status"), effectiveFrom: pick("effectiveFrom"), effectiveTo: pick("effectiveTo"), q: pick("q") }
}

export async function withPolicyErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof PolicyError) throw createError({ statusCode: error.statusCode, statusMessage: error.code })
    throw error
  }
}
