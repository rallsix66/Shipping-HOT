/**
 * R1.5-5 e-commerce promo calendar layer (9.29 plan §6, ADR-008, source catalog §9). Operational reference only:
 * promos are NOT shutdown facts and never feed holiday/port-closure semantics.
 */
export const promoCountries = ["VN", "TH", "MY", "ID", "PH"] as const
export type PromoCountry = typeof promoCountries[number]

export const promoPlatforms = { shopee: "Shopee", lazada: "Lazada", tiktok_shop: "TikTok Shop", unspecified: "未指定" } as const
export type PromoPlatform = keyof typeof promoPlatforms

export type PromoRuleId = "E-R01" | "E-R02" | "E-R03" | "E-R04" | "E-R05" | "E-R06"
export type PromoEntryKind = "rule" | "manual" | "legacy"
/** "pending" = only an anchor holiday date is known; the promo window itself is 待定. */
export type PromoWindowStatus = "determined" | "pending"

/** Evidence sources allowed for an explicit confirmation (catalog §9 XX-E01..E06) plus a manual HTTPS reference. */
export const promoEvidenceSources: Record<string, { label: string, host?: string, platforms?: PromoPlatform[], countries?: PromoCountry[], ruleIds?: PromoRuleId[] }> = {
  "XX-E01": { label: "Shopee 越南博客", host: "shopee.vn", platforms: ["shopee"], countries: ["VN"] },
  "XX-E02": { label: "Lazada Solutions 活动公告", host: "lazadasolutions.com", platforms: ["lazada"] },
  "XX-E03": { label: "Shopee 各国活动页", host: "shopee.", platforms: ["shopee"] },
  "XX-E04": { label: "Shopee 卖家学习中心", host: "banhang.shopee.vn", platforms: ["shopee"], countries: ["VN"] },
  "XX-E05": { label: "TikTok Shop 卖家大学", host: "tiktok.com", platforms: ["tiktok_shop"] },
  "XX-E06": { label: "Harbolnas 官网", host: "harbolnas.com", countries: ["ID"], ruleIds: ["E-R05"] },
  "manual_url": { label: "人工证据（HTTPS 链接）" },
}

export interface PromoConfirmation {
  sourceId: string
  evidenceRef: string
  note: string | null
  confirmedAt: string
}

export interface PromoCalendarEvent {
  id: string
  countryCode: string
  platform: PromoPlatform
  title: string
  startsAt: string
  endsAt: string
  category: string
  ruleId: string | null
  entryKind: PromoEntryKind
  windowStatus: PromoWindowStatus
  /** Original generation basis (never overwritten by confirmation). */
  generationBasis: string | null
  basisKind: string
  basisRef: string | null
  /** Effective status: "confirmed" only when stored as confirmed AND evidence + dates are valid. */
  confirmationStatus: "pending" | "confirmed"
  confirmation: PromoConfirmation | null
  manualEditedAt: string | null
  notes: string | null
  /** Set when stored data is abnormal (invalid date / platform / missing evidence); never shown as confirmed. */
  dataIssue: string | null
}

export interface PromoRuleGap {
  ruleId: PromoRuleId
  countryCode: string
  reasonZh: string
}

export interface PromoCalendarResponse {
  year: number
  events: PromoCalendarEvent[]
  gaps: PromoRuleGap[]
}

export function promoStatusLabel(event: Pick<PromoCalendarEvent, "confirmationStatus" | "confirmation" | "entryKind" | "windowStatus" | "dataIssue">): string {
  if (event.confirmationStatus === "confirmed" && event.confirmation) {
    return event.confirmation.sourceId === "manual_url" ? "已由人工证据确认" : `已由 ${event.confirmation.sourceId} 确认`
  }
  if (event.dataIssue) return "数据异常（待确认）"
  if (event.windowStatus === "pending") return "节日锚点（促销窗口待定）"
  if (event.entryKind === "manual") return "人工录入（待确认）"
  if (event.entryKind === "legacy") return "历史记录（来源未指定，待确认）"
  return "规则生成（待确认）"
}

/** Strict civil-date check: YYYY-MM-DD that round-trips (rejects 02-30, 13-01, etc.). */
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export function addCivilDays(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function promoDaysInRange(startsAt: string, endsAt: string): string[] {
  const out: string[] = []
  for (let day = startsAt; day <= endsAt && out.length < 400; day = addCivilDays(day, 1)) out.push(day)
  return out
}
