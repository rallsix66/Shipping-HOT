import type { AnnualCalendarResponse, AnnualCountry, AnnualCountryStatus, AnnualCountryStatusRecord, AnnualDataset } from "@shared/annual-calendar"
import id2026 from "../data/annual-calendar/ID-2026.json"
import th2026 from "../data/annual-calendar/TH-2026.json"
import my2026 from "../data/annual-calendar/MY-2026.json"
import ph2026 from "../data/annual-calendar/PH-2026.json"
import vn2026 from "../data/annual-calendar/VN-2026.json"

interface RawDataset {
  countryCode: string
  year: number
  sourceDocuments: AnnualDataset["sourceDocuments"]
  events: AnnualDataset["events"]
}

const warnings: Record<string, string> = {
  "ID-2026": "年度公告 17 个全国假日、8 个集体休假日期；企业执行条件不同。",
  "TH-2026": "23 条参考事项，全国主依据仍待核验；政府机关、金融机构、地区和企业适用范围不得混用。",
  "MY-2026": "联邦表及已核查追加日期；州别例外和替代休假未全部展开，不是全州完整日历。",
  "PH-2026": "年度及后续公告参考（已补 PCO/PIA 官方页面，Official Gazette 签署原件待取；Lawphil 为法律文本镜像）；特别工作日不是休假。",
  "VN-2026": "参考政府说明；公职安排与企业方案不同，劳动法正式全文核验仍待补齐。",
  "MY-2027": "马来西亚 2027 联邦与州别公共假日；替代休假规则须逐项核对，不等于港口停工。",
}

// Explicit registry of display-approved annual snapshots. To publish a new year,
// add `<COUNTRY>-<YEAR>.json` and its import here; the service then serves it with
// no database, Repository, Runtime Job, cache or Provider.
const registry = [id2026, th2026, my2026, ph2026, vn2026] as unknown as RawDataset[]

const countries: AnnualCountry[] = ["ID", "TH", "MY", "PH", "VN"]
// Years selectable in the existing /calendar page.
const supportedYears = [2026, 2027]

// Lightweight hints for country-years without a formal snapshot (2027 not imported yet).
const status2027: Record<AnnualCountry, { status: AnnualCountryStatus, detailZh: string }> = {
  TH: { status: "sector_evidence_only", detailZh: "仅泰国央行（BOT）公告 No. 37/2569 金融机构范围证据；未取得全国政府机关主依据。" },
  ID: { status: "not_published", detailZh: "截至 2026-09-12 未找到 2027 官方年度公告。" },
  MY: { status: "published_not_imported", detailZh: "BKPP/JPM 已公布 Hari Kelepasan Am 2027；官方文件尚未取得/导入。" },
  PH: { status: "not_published", detailZh: "截至 2026-09-12 未找到 2027 年度公告。" },
  VN: { status: "proposal_not_effective", detailZh: "内务部 2027 春节 7 天提案，待总理审批，尚未生效。" },
}

function buildDataset(data: RawDataset): AnnualDataset {
  return {
    countryCode: data.countryCode as AnnualCountry,
    year: data.year,
    warning: warnings[`${data.countryCode}-${data.year}`] ?? "",
    sourceDocuments: data.sourceDocuments,
    events: data.events,
  }
}

const datasets: AnnualDataset[] = registry.map(buildDataset)

function statusesFor(year: number): AnnualCountryStatusRecord[] {
  return countries.map((countryCode): AnnualCountryStatusRecord => {
    if (datasets.some(dataset => dataset.countryCode === countryCode && dataset.year === year)) {
      return { countryCode, year, status: "available", detailZh: "" }
    }
    if (year === 2027) {
      const hint = status2027[countryCode]
      return { countryCode, year, status: hint.status, detailZh: hint.detailZh }
    }
    return { countryCode, year, status: "not_published", detailZh: `${year} 年资料尚未公布或尚未导入。` }
  })
}

/** No Repository, database, credentials, Provider or external network access. */
export function getAnnualCalendar(year: number): AnnualCalendarResponse {
  return structuredClone({
    year,
    availableYears: [...supportedYears],
    datasets: datasets.filter(dataset => dataset.year === year),
    statuses: statusesFor(year),
  })
}
