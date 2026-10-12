/**
 * R1.5-7 policy library (9.29 plan §4.11). Manual entry only (R3 auto extraction/matching is NOT implemented).
 * Policies are reference records: they never infer port shutdown or risk events.
 */
import { isCivilDate } from "./promo-calendar"

export const policyCountries = { CN: "中国", VN: "越南", TH: "泰国", MY: "马来西亚", ID: "印度尼西亚", PH: "菲律宾" } as const
export type PolicyCountry = keyof typeof policyCountries
export const policyCategories = { customs_tax: "海关与税收", trade_export: "贸易与出口", ecommerce_platform: "电商平台" } as const
export type PolicyCategory = keyof typeof policyCategories
export const policyPlatforms = { shopee: "Shopee", lazada: "Lazada", tiktok_shop: "TikTok Shop" } as const
export type PolicyPlatform = keyof typeof policyPlatforms
/** official = 🏛 government original; platform = 📰 platform (an interested party); media = report only (rumor). */
export const policySourceTypes = { official: "🏛 官方原文", platform: "📰 平台原文（当事方）", media: "媒体报道" } as const
export type PolicySourceType = keyof typeof policySourceTypes
export const policyDeclaredStatuses = { rumor: "传闻", draft: "征求意见", published: "已发布待生效", effective: "已生效", revised: "已修订", repealed: "已废止" } as const
export type PolicyDeclaredStatus = keyof typeof policyDeclaredStatuses
export type PolicyDisplayStatus = PolicyDeclaredStatus | "expired"
export const policyDisplayLabels: Record<PolicyDisplayStatus, string> = { ...policyDeclaredStatuses, expired: "已过失效日" }

export interface PolicyInput {
  category: unknown
  countryCode: unknown
  platform?: unknown
  title: unknown
  documentNumber?: unknown
  publisher?: unknown
  publishedAt?: unknown
  effectiveAt?: unknown
  expiresAt?: unknown
  status: unknown
  scopeText?: unknown
  stage?: unknown
  sourceType: unknown
  sourceUrl: unknown
  bodyExcerpt?: unknown
  fullText?: unknown
  basisText: unknown
  enteredBy: unknown
  isFixture?: unknown
}

export interface PolicyFields {
  category: PolicyCategory
  countryCode: PolicyCountry
  platform: PolicyPlatform | null
  title: string
  documentNumber: string | null
  publisher: string | null
  publishedAt: string | null
  effectiveAt: string | null
  expiresAt: string | null
  status: PolicyDeclaredStatus
  scopeText: string | null
  stage: string | null
  sourceType: PolicySourceType
  sourceUrl: string
  bodyExcerpt: string | null
  fullText: string | null
  basisText: string
  enteredBy: string
  isFixture: boolean
}

export interface PolicyVersionView {
  id: string
  versionNumber: number
  status: PolicyDeclaredStatus
  title: string
  effectiveAt: string | null
  changeSummary: string | null
  sourceUrl: string
  createdAt: string
  supersededByVersionId: string | null
  enteredBy: string | null
  snapshot: PolicyFields | null
}

export interface PolicyChangeLogEntry {
  id: string
  versionId: string | null
  action: string
  actor: string
  summary: string
  createdAt: string
}

export interface PolicyRecordView extends PolicyFields {
  id: string
  entryMethod: string
  currentVersionId: string | null
  currentVersionNumber: number
  displayStatus: PolicyDisplayStatus
  /** published + effective date reached under the injected/system clock (⚙ automatic). */
  autoActivated: boolean
  /** Date position relative to "today": future / in_effect / past_expiry / undated / not_applicable. */
  datePosition: "future" | "in_effect" | "past_expiry" | "undated" | "not_applicable"
  supersedesPolicyId: string | null
  supersededByPolicyId: string | null
  relationKind: string | null
  createdAt: string
  updatedAt: string
}

export interface PolicyDetail {
  record: PolicyRecordView
  versions: PolicyVersionView[]
  changeLog: PolicyChangeLogEntry[]
  today: string
  clock: "test" | "system"
}

export interface PolicyListResponse {
  records: PolicyRecordView[]
  total: number
  today: string
  clock: "test" | "system"
}

export interface PolicyFilter {
  countryCode?: string
  platform?: string
  category?: string
  status?: string
  effectiveFrom?: string
  effectiveTo?: string
  q?: string
}

/** Civil date of `now` at UTC+8 (Asia/Shanghai). Effective dates switch at 00:00 UTC+8 of the stated date. */
export function policyToday(now: Date): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}

/**
 * Only an explicitly "published" (已发布待生效) record auto-activates when its effective date arrives.
 * rumor / draft / revised / repealed never auto-activate.
 */
export function policyDisplay(fields: Pick<PolicyFields, "status" | "effectiveAt" | "expiresAt">, today: string): { displayStatus: PolicyDisplayStatus, autoActivated: boolean, datePosition: PolicyRecordView["datePosition"] } {
  const { status, effectiveAt, expiresAt } = fields
  if (status !== "published" && status !== "effective") return { displayStatus: status, autoActivated: false, datePosition: "not_applicable" }
  if (!effectiveAt) return { displayStatus: status, autoActivated: false, datePosition: "undated" }
  if (effectiveAt > today) return { displayStatus: status === "effective" ? "effective" : "published", autoActivated: false, datePosition: "future" }
  if (expiresAt && expiresAt < today) return { displayStatus: "expired", autoActivated: status === "published", datePosition: "past_expiry" }
  return { displayStatus: "effective", autoActivated: status === "published", datePosition: "in_effect" }
}

function str(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}
const own = (obj: object, key: unknown): boolean => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key)

export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

export const POLICY_FULL_TEXT_MAX = 200_000
export const POLICY_EXCERPT_MAX = 4_000

/** Validates manual entry. Returns fields or an error code. `today` is used only for consistency checks. */
export function validatePolicyInput(input: PolicyInput, today: string): { ok: true, fields: PolicyFields } | { ok: false, error: string } {
  if (!own(policyCategories, input.category)) return { ok: false, error: "invalid_category" }
  if (!own(policyCountries, input.countryCode)) return { ok: false, error: "invalid_country" }
  if (!own(policyDeclaredStatuses, input.status)) return { ok: false, error: "invalid_status" }
  if (!own(policySourceTypes, input.sourceType)) return { ok: false, error: "invalid_source_type" }
  const category = input.category as PolicyCategory
  const status = input.status as PolicyDeclaredStatus
  const sourceType = input.sourceType as PolicySourceType
  let platform: PolicyPlatform | null = null
  if (input.platform !== undefined && input.platform !== null && input.platform !== "") {
    if (!own(policyPlatforms, input.platform)) return { ok: false, error: "invalid_platform" }
    platform = input.platform as PolicyPlatform
  }
  if (category === "ecommerce_platform" && !platform) return { ok: false, error: "platform_required" }
  if (sourceType === "platform" && !platform) return { ok: false, error: "platform_required" }
  const title = str(input.title, 300)
  if (!title) return { ok: false, error: "title_required" }
  const sourceUrl = httpsUrl(input.sourceUrl)
  if (!sourceUrl) return { ok: false, error: "source_url_required" }
  const enteredBy = str(input.enteredBy, 100)
  if (!enteredBy) return { ok: false, error: "entered_by_required" }
  const basisText = str(input.basisText, 4000)
  if (!basisText) return { ok: false, error: "basis_required" }
  const dates: Record<string, string | null> = {}
  for (const key of ["publishedAt", "effectiveAt", "expiresAt"] as const) {
    const v = input[key]
    if (v === undefined || v === null || v === "") dates[key] = null
    else if (isCivilDate(v)) dates[key] = v
    else return { ok: false, error: `invalid_${key}` }
  }
  if (dates.effectiveAt && dates.expiresAt && dates.effectiveAt > dates.expiresAt) return { ok: false, error: "effective_after_expiry" }
  if (dates.publishedAt && dates.effectiveAt && dates.publishedAt > dates.effectiveAt) return { ok: false, error: "published_after_effective" }
  // Media-only => rumor; a rumor cannot claim an official/platform original.
  if (sourceType === "media" && status !== "rumor") return { ok: false, error: "media_source_must_be_rumor" }
  if (status === "rumor" && sourceType !== "media") return { ok: false, error: "rumor_requires_media_source" }
  if (status === "published" && !dates.effectiveAt) return { ok: false, error: "effective_date_required" }
  if (status === "effective" && dates.effectiveAt && dates.effectiveAt > today) return { ok: false, error: "effective_status_before_effective_date" }
  if (status === "revised" || status === "repealed") return { ok: false, error: "status_requires_explicit_transition" }
  const fullText = typeof input.fullText === "string" && input.fullText.trim() ? input.fullText.trim() : null
  const bodyExcerpt = str(input.bodyExcerpt, POLICY_EXCERPT_MAX + 1)
  if (fullText && fullText.length > POLICY_FULL_TEXT_MAX) return { ok: false, error: "full_text_too_long" }
  if (bodyExcerpt && bodyExcerpt.length > POLICY_EXCERPT_MAX) return { ok: false, error: "excerpt_too_long" }
  // Government notices keep a full-text copy; platform rules keep only an excerpt + link.
  if (sourceType === "official" && !fullText) return { ok: false, error: "official_full_text_required" }
  if (sourceType === "platform" && fullText) return { ok: false, error: "platform_excerpt_only" }
  if (sourceType === "platform" && !bodyExcerpt) return { ok: false, error: "platform_excerpt_required" }
  if (input.isFixture !== undefined && typeof input.isFixture !== "boolean") return { ok: false, error: "invalid_is_fixture" }
  return {
    ok: true,
    fields: {
      category,
      countryCode: input.countryCode as PolicyCountry,
      platform,
      title,
      documentNumber: str(input.documentNumber, 200),
      publisher: str(input.publisher, 200),
      publishedAt: dates.publishedAt,
      effectiveAt: dates.effectiveAt,
      expiresAt: dates.expiresAt,
      status,
      scopeText: str(input.scopeText, 2000),
      stage: str(input.stage, 200),
      sourceType,
      sourceUrl,
      bodyExcerpt,
      fullText,
      basisText,
      enteredBy,
      isFixture: input.isFixture === true,
    },
  }
}

export const policyCsvColumns = ["id", "示例", "国家", "平台", "类别", "标题", "文号", "发布方", "发布日", "生效日", "失效日", "录入状态", "当前状态", "来源类型", "来源链接", "录入人", "当前版本", "替代关系"] as const

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value)
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s
}

export function policyCsv(records: PolicyRecordView[]): string {
  const rows = records.map(r => [r.id, r.isFixture ? "示例（fixture，非真实公告）" : "", r.countryCode, r.platform ? policyPlatforms[r.platform] : "", policyCategories[r.category], r.title, r.documentNumber, r.publisher, r.publishedAt, r.effectiveAt, r.expiresAt, policyDeclaredStatuses[r.status], policyDisplayLabels[r.displayStatus], policySourceTypes[r.sourceType], r.sourceUrl, r.enteredBy, `v${r.currentVersionNumber}`, r.supersededByPolicyId ? `被 ${r.supersededByPolicyId} ${r.relationKind === "repealed" ? "废止" : "修订"}` : r.supersedesPolicyId ? `替代 ${r.supersedesPolicyId}` : ""])
  return `\uFEFF${[policyCsvColumns.join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\r\n")}\r\n`
}
