import type { Port, ShippingSettings } from "@shared/shipping"
import { updateShippingSettings } from "#/shipping-store"

const congestionLevels: Port["congestionLevel"][] = ["low", "medium", "high", "critical"]
type SettingsPatch = Partial<Omit<ShippingSettings, "eventThresholds">> & { eventThresholds?: Partial<ShippingSettings["eventThresholds"]> }

function positiveInteger(value: unknown, name: string, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) throw createError({ statusCode: 400, message: `${name} must be an integer from 1 to ${max}` })
  return value
}

export default defineEventHandler(async (event) => {
  const body = await readBody<SettingsPatch>(event)
  if (!body || typeof body !== "object" || Array.isArray(body)) throw createError({ statusCode: 400, message: "settings object is required" })
  const next: SettingsPatch = {}
  if (body.refreshInterval !== undefined) next.refreshInterval = positiveInteger(body.refreshInterval, "refreshInterval", 1440)
  if (body.retentionDays !== undefined) next.retentionDays = positiveInteger(body.retentionDays, "retentionDays", 3650)
  if (body.sourceEnabled !== undefined) {
    if (typeof body.sourceEnabled !== "boolean") throw createError({ statusCode: 400, message: "sourceEnabled must be boolean" })
    next.sourceEnabled = body.sourceEnabled
  }
  if (body.providerEnabled !== undefined) {
    if (typeof body.providerEnabled !== "boolean") throw createError({ statusCode: 400, message: "providerEnabled must be boolean" })
    next.providerEnabled = body.providerEnabled
  }
  if (body.eventThresholds) {
    const thresholds = body.eventThresholds
    next.eventThresholds = {}
    if (thresholds.anchoredHours !== undefined) next.eventThresholds.anchoredHours = positiveInteger(thresholds.anchoredHours, "anchoredHours", 720)
    if (thresholds.delayMinutes !== undefined) next.eventThresholds.delayMinutes = positiveInteger(thresholds.delayMinutes, "delayMinutes", 525600)
    if (thresholds.congestionLevel !== undefined) {
      if (!congestionLevels.includes(thresholds.congestionLevel)) throw createError({ statusCode: 400, message: "congestionLevel is invalid" })
      next.eventThresholds.congestionLevel = thresholds.congestionLevel
    }
  }
  return updateShippingSettings(next)
})
