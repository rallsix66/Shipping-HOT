import type { AnnualCalendarResponse, AnnualCountry, AnnualDataset } from "@shared/annual-calendar"
import id from "../data/annual-calendar/ID-2026.json"
import th from "../data/annual-calendar/TH-2026.json"
import my from "../data/annual-calendar/MY-2026.json"
import ph from "../data/annual-calendar/PH-2026.json"
import vn from "../data/annual-calendar/VN-2026.json"

const warnings: Record<AnnualCountry, string> = {
  ID: "年度公告 17 个全国假日、8 个集体休假日期；企业执行条件不同。",
  TH: "23 条参考事项，全国主依据仍待核验；政府机关、金融机构、地区和企业适用范围不得混用。",
  MY: "联邦表及已核查追加日期；州别例外和替代休假未全部展开，不是全州完整日历。",
  PH: "年度及后续公告参考；特别工作日不是休假。部分来源为法律文本转载站。",
  VN: "参考政府说明；公职安排与企业方案不同，劳动法正式全文核验仍待补齐。",
}

// Frozen, display-approved references. Candidate work files are not a runtime dependency.
const datasets = [id, th, my, ph, vn].map(data => ({
  countryCode: data.countryCode as AnnualCountry,
  year: data.year,
  warning: warnings[data.countryCode as AnnualCountry],
  sourceDocuments: data.sourceDocuments,
  events: data.events,
})) as AnnualDataset[]

/** No Repository, database, credentials, Provider or external network access. */
export function getAnnualCalendar(year: number): AnnualCalendarResponse {
  return structuredClone({ year, availableYears: [2026], datasets: datasets.filter(data => data.year === year) })
}
