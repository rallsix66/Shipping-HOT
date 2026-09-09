/** Display-only annual reference; never feeds operational Calendar/Event/HOT. */
export const annualCountries = { ID: "印度尼西亚", TH: "泰国", MY: "马来西亚", PH: "菲律宾", VN: "越南" } as const
export type AnnualCountry = keyof typeof annualCountries

export const annualTypes: Record<string, { label: string, scope: string, work?: boolean }> = {
  national_holiday: { label: "全国假日", scope: "全国" },
  collective_leave: { label: "集体休假", scope: "依单位安排" },
  government_office_holiday: { label: "政府机关假日", scope: "仅政府机关" },
  regional_government_holiday: { label: "地区政府假日", scope: "仅曼谷政府机关" },
  federal_public_holiday: { label: "联邦假日", scope: "须核对州别" },
  additional_public_holiday: { label: "追加假日", scope: "半岛及纳闽" },
  regular_holiday: { label: "常规假日", scope: "全国" },
  special_non_working_day: { label: "特别非工作日", scope: "全国" },
  special_working_day: { label: "特别工作日", scope: "非休假", work: true },
  government_office_substitute_holiday: { label: "政府机关补休", scope: "仅政府机关" },
  statutory_holiday: { label: "法定假日", scope: "全国劳动者" },
  civil_service_statutory_schedule: { label: "公职休假", scope: "公职固定安排" },
  civil_service_swapped_day_off: { label: "公职调休", scope: "仅公职安排" },
  civil_service_makeup_workday: { label: "公职补班", scope: "仅公职安排", work: true },
  conditional_substitute_day: { label: "条件性补休", scope: "周休重合者" },
}

export interface AnnualSource {
  id: string
  url: string
  officialInstitutions: string[]
  documentNumbers: string[]
  evidenceStatus: string
  publishedAt: string | null
}
export interface AnnualEvent {
  id: string
  countryCode: AnnualCountry
  date: string
  nameZh: string
  shortNameZh: string
  nameLocal: string
  type: string
  holidaySubtype?: string
  geographicScope: string
  subjectAndConditionsZh: string
  sourceDocumentIds: string[]
  verificationStatus: string
  notesZh: string
}
export interface AnnualDataset {
  countryCode: AnnualCountry
  year: number
  warning: string
  sourceDocuments: AnnualSource[]
  events: AnnualEvent[]
}
export interface AnnualCalendarResponse {
  year: number
  availableYears: number[]
  datasets: AnnualDataset[]
}

/** UTC is used only for arithmetic; the resulting strings are civil dates. */
export function annualMonthDays(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1))
  const offset = (start.getUTCDay() + 6) % 7
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, i) => {
    const date = new Date(Date.UTC(year, month, i - offset + 1))
    return { date: date.toISOString().slice(0, 10), day: date.getUTCDate(), outside: date.getUTCMonth() !== month }
  })
}

export function annualEventScope(event: AnnualEvent): string {
  if (event.countryCode === "MY" && /except Sarawak/i.test(event.geographicScope)) return "不含砂拉越"
  return annualTypes[event.type]?.scope ?? "适用范围待核对"
}

export function annualEvidenceLabel(status: string): string | null {
  if (status.includes("primary_pending")) return "交叉核对，主依据待核验"
  return null
}

export function annualSourceLabel(source: AnnualSource): string {
  return source.evidenceStatus.includes("access_pending") ? "待核验入口" : "来源"
}

export function annualSourcePublishedLabel(source: AnnualSource): string {
  return source.publishedAt ?? "发布日期未知"
}
