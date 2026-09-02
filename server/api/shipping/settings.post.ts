import type { Port, ShippingSettings, TranslationSettings } from "@shared/shipping"
import { updateShippingSettings } from "#/shipping-store"

const congestionLevels: Port["congestionLevel"][] = ["low", "medium", "high", "critical"]
type SettingsPatch = Partial<Omit<ShippingSettings, "eventThresholds" | "translation">> & { eventThresholds?: Partial<ShippingSettings["eventThresholds"]>, translation?: Partial<TranslationSettings> }

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
  if (body.translation !== undefined) {
    const translation = body.translation as Partial<TranslationSettings> | undefined
    if (!translation || typeof translation !== "object" || Array.isArray(translation)) throw createError({ statusCode: 400, message: "translation must be an object" })
    if (translation.enabled !== undefined && typeof translation.enabled !== "boolean") throw createError({ statusCode: 400, message: "translation.enabled must be boolean" })
    if (translation.providerId !== undefined && translation.providerId !== "deepseek") throw createError({ statusCode: 400, message: "translation.providerId is invalid" })
    if (translation.model !== undefined && translation.model !== "deepseek-v4-flash") throw createError({ statusCode: 400, message: "translation.model is invalid" })
    if (translation.targetLanguage !== undefined && (typeof translation.targetLanguage !== "string" || !translation.targetLanguage.trim())) throw createError({ statusCode: 400, message: "translation.targetLanguage is invalid" })
    if (translation.monthlyBudget !== undefined && (typeof translation.monthlyBudget !== "number" || !Number.isFinite(translation.monthlyBudget) || translation.monthlyBudget < 0)) throw createError({ statusCode: 400, message: "translation.monthlyBudget is invalid" })
    next.translation = translation
  }
  return updateShippingSettings(next)
})
