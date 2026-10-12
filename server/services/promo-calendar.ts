import type { AnnualEvent } from "@shared/annual-calendar"
import { type PromoCountry, type PromoPlatform, type PromoRuleGap, type PromoRuleId, type PromoWindowStatus, addCivilDays, promoCountries } from "@shared/promo-calendar"
import { getAnnualCalendar } from "#/services/annual-calendar"

/**
 * R1.5-5 rule generator (source catalog §9). Pure: no network, no LLM, no seller-backend login.
 * Every candidate is "规则生成（待确认）" until an explicit confirmation with evidence.
 * Only what the catalog states is generated; lead times, platform applicability and holiday matrices are not invented.
 */
export interface PromoCandidate {
  id: string
  ruleId: PromoRuleId
  ruleYear: number
  occurrence: string
  countryCode: PromoCountry
  platform: PromoPlatform
  title: string
  startsAt: string
  endsAt: string
  category: "promo" | "promo_anchor"
  windowStatus: PromoWindowStatus
  basisKind: "rule_generated" | "catalog_source"
  basisRef: string
  generationBasis: string
}

const THREE: PromoPlatform[] = ["shopee", "lazada", "tiktok_shop"]
const TWO: PromoPlatform[] = ["shopee", "lazada"]
const pad = (n: number) => String(n).padStart(2, "0")
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function promoCandidateId(ruleId: string, year: number, country: string, platform: string, occurrence: string): string {
  return `promo:${ruleId}:${year}:${country}:${platform}:${occurrence}`
}

function candidate(c: Omit<PromoCandidate, "id">): PromoCandidate {
  return { ...c, id: promoCandidateId(c.ruleId, c.ruleYear, c.countryCode, c.platform, c.occurrence) }
}

function anchorRange(events: AnnualEvent[], country: string, nameTest: RegExp, types: string[]): { start: string, end: string, verification: string } | null {
  const hits = events.filter(e => e.countryCode === country && types.includes(e.type) && nameTest.test(`${e.nameLocal} ${e.nameZh}`)).sort((a, b) => a.date.localeCompare(b.date))
  if (!hits.length) return null
  return { start: hits[0].date, end: hits[hits.length - 1].date, verification: [...new Set(hits.map(h => h.verificationStatus))].join(",") }
}

export function generatePromoCandidates(year: number, referenceEvents?: AnnualEvent[]): { candidates: PromoCandidate[], gaps: PromoRuleGap[] } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("invalid_year")
  const candidates: PromoCandidate[] = []
  const gaps: PromoRuleGap[] = []
  const events = referenceEvents ?? getAnnualCalendar(year).datasets.flatMap(d => d.events)
  for (let m = 1; m <= 12; m++) {
    const mm = pad(m)
    const day = `${year}-${mm}-${mm}`
    for (const country of promoCountries) {
      for (const platform of THREE) {
        candidates.push(candidate({ ruleId: "E-R01", ruleYear: year, occurrence: `m${mm}`, countryCode: country, platform, title: `${m}.${m} 双数日大促`, startsAt: addCivilDays(day, -7), endsAt: addCivilDays(day, 3), category: "promo", windowStatus: "determined", basisKind: "rule_generated", basisRef: "信源目录 §9 E-R01", generationBasis: `E-R01 每月 m.m（${day}），活动窗口为当天前 7 天到后 3 天；适用三平台、五国（规则生成，未经官方确认）` }))
        candidates.push(candidate({ ruleId: "E-R03", ruleYear: year, occurrence: `m${mm}`, countryCode: country, platform, title: `${m} 月发薪日大促（25 日至月底）`, startsAt: `${year}-${mm}-25`, endsAt: `${year}-${mm}-${pad(lastDay(year, m))}`, category: "promo", windowStatus: "determined", basisKind: "rule_generated", basisRef: "信源目录 §9 E-R03", generationBasis: "E-R03 每月 25 日到月底；适用三平台（规则生成，未经官方确认）" }))
      }
      for (const platform of TWO) {
        candidates.push(candidate({ ruleId: "E-R02", ruleYear: year, occurrence: `m${mm}`, countryCode: country, platform, title: `${m} 月中大促（15 日）`, startsAt: `${year}-${mm}-15`, endsAt: `${year}-${mm}-15`, category: "promo", windowStatus: "determined", basisKind: "rule_generated", basisRef: "信源目录 §9 E-R02", generationBasis: "E-R02 每月 15 日；仅 Shopee / Lazada（规则生成，未经官方确认）" }))
      }
    }
  }
  // E-R05: only the catalog's specific 2026 source; never extrapolated.
  if (year === 2026) {
    candidates.push(candidate({ ruleId: "E-R05", ruleYear: year, occurrence: "harbolnas", countryCode: "ID", platform: "unspecified", title: "Harbolnas 全国网购日", startsAt: "2026-12-10", endsAt: "2026-12-16", category: "promo", windowStatus: "determined", basisKind: "catalog_source", basisRef: "信源目录 §9 E-R05", generationBasis: "E-R05 2026 年 12 月 10–16 日：信源目录记录为贸易部和 idEA 于 2026-08-27 宣布、经 ANTARA 等媒体报道核实；本系统未重新核实，平台未在目录中列明" }))
  } else {
    gaps.push({ ruleId: "E-R05", countryCode: "ID", reasonZh: `目录只有 2026 年依据，${year} 年待定（不外推）` })
  }
  // E-R04: Ramadan / Eid promo season, ID and MY only. Only the Eid anchor is in reliable holiday data.
  const eidTypes: Record<string, string[]> = { ID: ["national_holiday"], MY: ["federal_public_holiday"] }
  for (const country of ["ID", "MY"] as const) {
    const anchor = anchorRange(events, country, /idulfitri|hari raya puasa/i, eidTypes[country])
    if (!anchor) {
      gaps.push({ ruleId: "E-R04", countryCode: country, reasonZh: `${year} 年无可靠假日数据中的开斋节日期，待定` })
      continue
    }
    candidates.push(candidate({ ruleId: "E-R04", ruleYear: year, occurrence: "eid-anchor", countryCode: country, platform: "unspecified", title: "斋月、开斋节促销季（锚点：开斋节）", startsAt: anchor.start, endsAt: anchor.end, category: "promo_anchor", windowStatus: "pending", basisKind: "rule_generated", basisRef: "信源目录 §9 E-R04 + 年度参考日历", generationBasis: `锚点 = 年度参考日历中的开斋节公共假日 ${anchor.start}–${anchor.end}（${anchor.verification}）；促销季起止与平台目录未列明，待定` }))
    gaps.push({ ruleId: "E-R04", countryCode: country, reasonZh: "斋月起止不在现有可靠假日数据中；促销季窗口与适用平台待定" })
  }
  // E-R06: Christmas / Tet / Songkran per country with existing reliable holiday dates only.
  const e06: { occurrence: string, label: string, country: PromoCountry, test: RegExp, types: string[] }[] = [
    { occurrence: "christmas", label: "圣诞节", country: "ID", test: /kelahiran yesus/i, types: ["national_holiday"] },
    { occurrence: "christmas", label: "圣诞节", country: "MY", test: /krismas/i, types: ["federal_public_holiday"] },
    { occurrence: "christmas", label: "圣诞节", country: "PH", test: /christmas day/i, types: ["regular_holiday"] },
    { occurrence: "tet", label: "越南春节", country: "VN", test: /tết âm lịch/i, types: ["civil_service_statutory_schedule", "statutory_holiday"] },
    { occurrence: "songkran", label: "宋干节", country: "TH", test: /สงกรานต์/, types: ["government_office_holiday", "national_holiday"] },
  ]
  for (const item of e06) {
    const anchor = anchorRange(events, item.country, item.test, item.types)
    if (!anchor) {
      gaps.push({ ruleId: "E-R06", countryCode: item.country, reasonZh: `${year} 年无可靠假日数据中的${item.label}日期，待定` })
      continue
    }
    candidates.push(candidate({ ruleId: "E-R06", ruleYear: year, occurrence: item.occurrence, countryCode: item.country, platform: "unspecified", title: `${item.label}促销（锚点：${item.label}假日）`, startsAt: anchor.start, endsAt: anchor.end, category: "promo_anchor", windowStatus: "pending", basisKind: "rule_generated", basisRef: "信源目录 §9 E-R06 + 年度参考日历", generationBasis: `锚点 = 年度参考日历中的${item.label}假日 ${anchor.start}–${anchor.end}（${anchor.verification}）；促销提前期与平台目录未列明，待定` }))
  }
  gaps.push({ ruleId: "E-R06", countryCode: "*", reasonZh: "目录中的“等”未列明具体节日，不推断其他节日；各节日促销窗口与平台待定" })
  return { candidates, gaps }
}
