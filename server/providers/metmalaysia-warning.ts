import { createHash } from "node:crypto"
import type { DataProvenance, FeedItem, WeatherDetail } from "@shared/shipping"

/**
 * MY-W01 MET Malaysia warnings via data.gov.my, limited integration (dots review 2026-10-10 16:05).
 *
 * The verified entry is exactly `https://api.data.gov.my/weather/warning/` (trailing slash; the bare path answers 301).
 * Structure (docs/evidence/metmalaysia-warning-2026-10-10.md): JSON array of rows with
 * `warning_issue{issued,title_en,title_bm}`, `valid_from`, `valid_to`, `heading_*`, `text_*`, `instruction_*`.
 *
 * Bounds enforced here (zero inference):
 * - Datetimes carry no offset and the source documents none. They are kept as RAW STRINGS only; no timezone is
 *   assumed (in particular not +08:00), so validity is never computed: every record is `alertState: "unknown"`,
 *   `validityStatus: "unknown"`, `timezoneStatus: "unconfirmed"`, `eventEligibility: false`.
 * - There is no official severity field: `officialSeverity: "not_provided"`. FeedItem.severity stays the lowest
 *   display priority ("info") only because the field is mandatory; the UI shows "官方级别：未提供" instead.
 * - There is no structured region field: `relatedPortIds` is always empty and `alertRegion` unset, so no port
 *   association and no WR-O01/WR-O02. "MY" is the ISSUING country only, never nationwide impact.
 * - "No Advisory" rows are kept as their own record: they only state that no tropical cyclone is observed in the
 *   stated MMD monitoring region and never clear any other record.
 * - Dedup identity = issued + title_en + valid_from + valid_to (raw strings): rows sharing title/issued/text but
 *   with different validity intervals are distinct records.
 * - Publication time is the time WE FIRST RECEIVED the record (`fetchedAt`), flagged by `timeBasis: "received_at"`;
 *   the official raw `issued` string is preserved next to it and never converted.
 * - Anything that is not this structure is a contract failure (thrown), never "no warnings". An empty array is a
 *   successful fetch whose meaning is unknown and is never reported as "no warnings nationwide".
 */

export const METMALAYSIA_WARNING_URL = "https://api.data.gov.my/weather/warning/"
export const METMALAYSIA_HOST = "api.data.gov.my"
export const METMALAYSIA_PATH = "/weather/warning/"
/** data.gov.my weather API published limit: 4 requests per minute. */
export const METMALAYSIA_MIN_REQUEST_INTERVAL_MS = 15_000

export interface MetMalaysiaSourceContext {
  id: string
  sourceUrl: string
  provenance: DataProvenance
}

export interface MetMalaysiaRawRecord {
  issued: string | null
  validFrom: string | null
  validTo: string | null
  titleEn: string
  titleBm?: string
  headingEn?: string
  headingBm?: string
  textEn?: string
  textBm?: string
  instructionEn?: string
  instructionBm?: string
}

export function isPinnedMetMalaysiaUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.host === METMALAYSIA_HOST && url.pathname === METMALAYSIA_PATH && !url.search && !url.hash && !url.username && !url.password
  } catch {
    return false
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function rawTime(value: unknown, field: string, index: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error(`metmalaysia_contract: row ${index} ${field} is not a string`)
  return value
}

export function metMalaysiaRecordKey(record: Pick<MetMalaysiaRawRecord, "issued" | "titleEn" | "validFrom" | "validTo">): string {
  return [record.issued ?? "", record.titleEn, record.validFrom ?? "", record.validTo ?? ""].join("|")
}

export function isMetMalaysiaNoAdvisory(record: Pick<MetMalaysiaRawRecord, "titleEn">): boolean {
  return /^no advisory$/i.test(record.titleEn.trim())
}

export function parseMetMalaysiaRows(body: string): MetMalaysiaRawRecord[] {
  let rows: unknown
  try {
    rows = JSON.parse(body)
  } catch {
    throw new Error("metmalaysia_contract: body is not JSON")
  }
  if (!Array.isArray(rows)) throw new Error("metmalaysia_contract: body is not an array")
  return rows.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`metmalaysia_contract: row ${index} is not an object`)
    const row = raw as Record<string, unknown>
    const issue = row.warning_issue
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) throw new Error(`metmalaysia_contract: row ${index} lacks warning_issue`)
    const issueRecord = issue as Record<string, unknown>
    const titleEn = str(issueRecord.title_en)
    if (!titleEn) throw new Error(`metmalaysia_contract: row ${index} lacks warning_issue.title_en`)
    return {
      issued: rawTime(issueRecord.issued, "warning_issue.issued", index),
      validFrom: rawTime(row.valid_from, "valid_from", index),
      validTo: rawTime(row.valid_to, "valid_to", index),
      titleEn,
      titleBm: str(issueRecord.title_bm),
      headingEn: str(row.heading_en),
      headingBm: str(row.heading_bm),
      textEn: str(row.text_en),
      textBm: str(row.text_bm),
      instructionEn: str(row.instruction_en),
      instructionBm: str(row.instruction_bm),
    }
  })
}

function truncate(value: string, max = 320): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export function metMalaysiaSummaryZh(record: MetMalaysiaRawRecord): string {
  const head = isMetMalaysiaNoAdvisory(record)
    ? "已接收 MetMalaysia 官方记录（No Advisory：仅表示其所述监测区域内无热带气旋系统，不代表无雷暴、海况等其他预警）。"
    : "已接收 MetMalaysia 官方预警记录，有效性待确认（时区未确认，未计算是否生效；无官方级别字段；无结构化区域，未关联港口）。"
  const text = (record.textEn ?? record.headingEn ?? record.titleEn).replace(/\s+/g, " ").trim()
  return truncate(`${head} 原文：${text}`, 480)
}

export function parseMetMalaysiaWarnings(body: string, source: MetMalaysiaSourceContext, fetchedAt: string, previous: FeedItem[] = []): FeedItem[] {
  const records = parseMetMalaysiaRows(body)
  const firstReceived = new Map(previous.map(item => [item.id, item.publishedAt]))
  const byId = new Map<string, FeedItem>()
  for (const record of records) {
    const key = metMalaysiaRecordKey(record)
    const hash = createHash("sha256").update(`${source.id}|${key}`).digest("hex").slice(0, 16)
    const alertId = `${source.id}:${hash}`
    const id = `weather-alert:${source.id}:${hash}`
    const receivedAt = firstReceived.get(id) || fetchedAt
    const noAdvisory = isMetMalaysiaNoAdvisory(record)
    const weather: WeatherDetail = {
      riskSource: "official",
      alertState: "unknown",
      alertId,
      validityStatus: "unknown",
      timezoneStatus: "unconfirmed",
      officialSeverity: "not_provided",
      timeBasis: "received_at",
      alertRaw: { ...record, sourceUrl: source.sourceUrl, fetchedAt },
    }
    byId.set(id, {
      id,
      sourceId: source.id,
      category: "weather",
      freshnessPolicy: "official",
      type: "weather_warning_official",
      title: record.titleEn,
      summary: metMalaysiaSummaryZh(record),
      sourceUrl: source.sourceUrl,
      canonicalUrl: source.sourceUrl,
      publishedAt: receivedAt,
      publicationTimeKnown: true,
      eventEligibility: false,
      severity: "info",
      tags: [
        "official",
        "issuing_country_MY",
        noAdvisory ? "tropical_cyclone_no_advisory_scope_only" : "weather_warning",
        "validity_pending_confirmation",
        "timezone_unconfirmed",
        "official_severity_not_provided",
        "no_structured_region",
      ],
      weather,
      relatedPortIds: [],
      relatedVesselIds: [],
      updatedAt: fetchedAt,
      fetchedAt,
      stale: false,
      sourceStatus: "healthy",
      provenance: source.provenance,
    })
  }
  return [...byId.values()]
}
