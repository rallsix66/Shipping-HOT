export interface JmaTargetTcEntry {
  tropicalCyclone: string
  typhoonNumber?: string
  category?: string
  issue?: string
}

export type JmaTargetTcListParseResult =
  | { status: "empty" }
  | { status: "ok", entries: JmaTargetTcEntry[] }
  | { status: "list_invalid", message: string }
  | { status: "mixed", entries: JmaTargetTcEntry[], invalidCount: number }

export interface NormalizedTyphoonPosition {
  lat: number
  lon: number
  at?: string
}

export type TropicalCycloneLifecycleStatus = "active" | "dissipated" | "missing_from_list"

export interface NormalizedTropicalCyclone {
  id: string
  basin: string
  jmaId: string
  typhoonNumber?: string
  nameEn?: string
  nameJp?: string
  category?: string
  issuedAt?: string
  current?: NormalizedTyphoonPosition & { at: string }
  trackHistory: NormalizedTyphoonPosition[]
  forecast: Array<NormalizedTyphoonPosition & { at: string }>
  dissipatedAt?: string
  dissipatedReason?: string
  lifecycleStatus?: TropicalCycloneLifecycleStatus
  missingFromListAt?: string
  summaryZhPersisted?: string
  /** Per-row path snapshot time (distinct from sync attempt). */
  pathFetchedAt?: string
  rawForecastJson: unknown
}

function isValidTargetEntry(entry: unknown): entry is JmaTargetTcEntry {
  return Boolean(entry && typeof entry === "object" && typeof (entry as JmaTargetTcEntry).tropicalCyclone === "string")
}

/** Strict list parse — only `[]` is ok_empty; mixed/invalid non-empty arrays are not silent success. */
export function parseJmaTargetTcListStrict(payload: unknown): JmaTargetTcListParseResult {
  if (!Array.isArray(payload)) {
    return { status: "list_invalid", message: "JMA targetTc payload is not an array" }
  }
  if (payload.length === 0) {
    return { status: "empty" }
  }
  const entries: JmaTargetTcEntry[] = []
  let invalidCount = 0
  for (const entry of payload) {
    if (isValidTargetEntry(entry)) entries.push(entry)
    else invalidCount += 1
  }
  if (!entries.length) {
    return { status: "list_invalid", message: "JMA targetTc array has no valid tropicalCyclone entries" }
  }
  if (invalidCount > 0) {
    return { status: "mixed", entries, invalidCount }
  }
  return { status: "ok", entries }
}

/** @deprecated Use parseJmaTargetTcListStrict */
export function parseJmaTargetTcList(payload: unknown): JmaTargetTcEntry[] | "invalid_format" {
  const parsed = parseJmaTargetTcListStrict(payload)
  if (parsed.status === "list_invalid") return "invalid_format"
  if (parsed.status === "empty") return []
  if (parsed.status === "mixed") return parsed.entries
  return parsed.entries
}

function pointFromCenter(center: unknown, at?: string): NormalizedTyphoonPosition | undefined {
  if (!Array.isArray(center) || center.length < 2) return undefined
  const lat = Number(center[0])
  const lon = Number(center[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  return at === undefined ? { lat, lon } : { lat, lon, at }
}

function partLabel(part: unknown): string {
  if (typeof part === "string") return part
  if (part && typeof part === "object" && typeof (part as { en?: string }).en === "string") {
    return (part as { en: string }).en
  }
  return ""
}

export function parseJmaForecastJson(jmaId: string, payload: unknown): NormalizedTropicalCyclone | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined
  let typhoonNumber: string | undefined
  let nameEn: string | undefined
  let nameJp: string | undefined
  let issuedAt: string | undefined
  let current: (NormalizedTyphoonPosition & { at: string }) | undefined
  const trackHistory: NormalizedTyphoonPosition[] = []
  const forecast: Array<NormalizedTyphoonPosition & { at: string }> = []
  let dissipatedAt: string | undefined
  let dissipatedReason: string | undefined

  for (const block of payload) {
    if (!block || typeof block !== "object") continue
    const part = (block as { part?: unknown }).part
    if (part === "title") {
      typhoonNumber = typeof (block as { typhoonNumber?: string }).typhoonNumber === "string"
        ? (block as { typhoonNumber: string }).typhoonNumber
        : typhoonNumber
      const name = (block as { name?: { en?: string, jp?: string } }).name
      nameEn = name?.en ?? nameEn
      nameJp = name?.jp ?? nameJp
      issuedAt = (block as { issue?: { UTC?: string } }).issue?.UTC ?? issuedAt
      continue
    }
    const label = partLabel(part)
    const validtime = (block as { validtime?: { UTC?: string } }).validtime?.UTC
    const advancedHours = Number((block as { advancedHours?: number }).advancedHours)
    const centerRaw = (block as { center?: unknown }).center

    if (/dissipat|extratropical|transformed/i.test(label) && validtime) {
      dissipatedAt = validtime
      dissipatedReason = "jma_dissipation_block"
    }

    if (!Number.isFinite(advancedHours)) continue

    if (advancedHours === 0) {
      if (!validtime) continue
      const center = pointFromCenter(centerRaw, validtime)
      if (!center) continue
      current = { lat: center.lat, lon: center.lon, at: validtime }
      const typhoonTrack = (block as { track?: { typhoon?: unknown[] } }).track?.typhoon
      if (Array.isArray(typhoonTrack)) {
        for (const pair of typhoonTrack) {
          const pt = pointFromCenter(pair)
          if (pt) trackHistory.push(pt)
        }
      }
    } else if (validtime) {
      const center = pointFromCenter(centerRaw, validtime)
      if (center?.at) forecast.push({ lat: center.lat, lon: center.lon, at: center.at })
    }
  }

  if (!current && !trackHistory.length && !forecast.length) return undefined
  return {
    id: `tc-jma-${jmaId}`,
    basin: "NW_PACIFIC",
    jmaId,
    typhoonNumber,
    nameEn,
    nameJp,
    category: undefined,
    issuedAt,
    current,
    trackHistory,
    forecast,
    dissipatedAt,
    dissipatedReason,
    lifecycleStatus: dissipatedAt ? "dissipated" : "active",
    rawForecastJson: payload,
  }
}

/** Legacy SQLite rows stored `track` instead of `trackHistory`. */
export function normalizeStoredTropicalCyclonePayload(payload: {
  track?: Array<{ lat: number, lon: number, at?: string }>
  trackHistory?: NormalizedTyphoonPosition[]
  forecast?: Array<{ lat: number, lon: number, at: string }>
  current?: NormalizedTyphoonPosition & { at: string }
  typhoonNumber?: string
  nameEn?: string
  nameJp?: string
  category?: string
  issuedAt?: string
  lifecycleStatus?: TropicalCycloneLifecycleStatus
  missingFromListAt?: string
  dissipatedReason?: string
  summaryZhPersisted?: string
  pathFetchedAt?: string
} | undefined): Pick<NormalizedTropicalCyclone, "current" | "trackHistory" | "forecast" | "typhoonNumber" | "nameEn" | "nameJp" | "category" | "issuedAt" | "lifecycleStatus" | "missingFromListAt" | "dissipatedReason" | "summaryZhPersisted" | "pathFetchedAt"> {
  if (!payload) {
    return { trackHistory: [], forecast: [] }
  }
  const trackHistory = payload.trackHistory ?? (payload.track ?? []).map((point) => {
    if (point.at) return { lat: point.lat, lon: point.lon, at: point.at }
    return { lat: point.lat, lon: point.lon }
  })
  return {
    current: payload.current,
    trackHistory,
    forecast: payload.forecast ?? [],
    typhoonNumber: payload.typhoonNumber,
    nameEn: payload.nameEn,
    nameJp: payload.nameJp,
    category: payload.category,
    issuedAt: payload.issuedAt,
    lifecycleStatus: payload.lifecycleStatus,
    missingFromListAt: payload.missingFromListAt,
    dissipatedReason: payload.dissipatedReason,
    summaryZhPersisted: payload.summaryZhPersisted,
    pathFetchedAt: payload.pathFetchedAt,
  }
}

/** Official map.html TyphoonTable labels (inline script evidence). */
export const JMA_GALE_WARNING_LABEL_JP = "15m/s以上の強風域"
export const JMA_STORM_WARNING_LABEL_ANALYSIS_JP = "25m/s以上の暴風域"
export const JMA_STORM_WARNING_LABEL_FORECAST_JP = "暴風警戒域"

export interface JmaLocalizedText {
  jp?: string
  en?: string
}

export type JmaWindCircleArea =
  | { kind: "direction_string", value: string }
  | { kind: "bilingual", jp?: string, en?: string }
  | { kind: "unknown", raw: unknown }

export interface JmaWindCircleRange {
  /** Present only when source provides a finite non-negative number; never invent 0 for absence. */
  km?: number
  nm?: number
  /** Raw source values retained even when non-numeric / unknown. */
  rawKm: unknown
  rawNm: unknown
}

export interface JmaWindCircleSector {
  area: JmaWindCircleArea
  range: JmaWindCircleRange
}

/**
 * Field-level presence for galeWarning / stormWarning.
 * - absent: key missing on the row (official UI skips render; not an error; not radius 0)
 * - present: array of sectors (may be empty array if source emits [])
 * - invalid: key present but not a usable array / sector shape
 */
export type JmaWindCircleField =
  | { status: "absent" }
  | { status: "present", sectors: JmaWindCircleSector[] }
  | { status: "invalid", reason: string, raw: unknown }

export interface JmaSpecificationsTitle {
  part: "title"
  typhoonNumber?: string
  nameEn?: string
  nameJp?: string
  categoryEn?: string
  categoryJp?: string
  issueUtc?: string
  issueJst?: string
}

export interface JmaSpecificationsRow {
  partLabelEn?: string
  partLabelJp?: string
  advancedHours?: number
  validtimeUtc?: string
  validtimeJst?: string
  galeWarning: JmaWindCircleField
  stormWarning: JmaWindCircleField
  /** Retained when present; not a hard gate for wind-circle parsing. */
  probabilityCircleRadius?: JmaWindCircleRange
}

export type JmaSpecificationsParseResult =
  | {
    status: "ok"
    title: JmaSpecificationsTitle
    rows: JmaSpecificationsRow[]
  }
  | { status: "invalid", message: string }

function parseLocalizedPart(part: unknown): { en?: string, jp?: string } | undefined {
  if (typeof part === "string") return { en: part }
  if (part && typeof part === "object" && !Array.isArray(part)) {
    const en = (part as { en?: unknown }).en
    const jp = (part as { jp?: unknown }).jp
    return {
      en: typeof en === "string" ? en : undefined,
      jp: typeof jp === "string" ? jp : undefined,
    }
  }
  return undefined
}

function parseWindCircleArea(area: unknown): JmaWindCircleArea {
  if (typeof area === "string") return { kind: "direction_string", value: area }
  if (area && typeof area === "object" && !Array.isArray(area)) {
    const jp = (area as { jp?: unknown }).jp
    const en = (area as { en?: unknown }).en
    if (typeof jp === "string" || typeof en === "string") {
      return {
        kind: "bilingual",
        jp: typeof jp === "string" ? jp : undefined,
        en: typeof en === "string" ? en : undefined,
      }
    }
  }
  return { kind: "unknown", raw: area }
}

function isUsableWindCircleRadius(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function parseWindCircleRange(range: unknown): JmaWindCircleRange | undefined {
  if (!range || typeof range !== "object" || Array.isArray(range)) return undefined
  const rawKm = (range as { km?: unknown }).km
  const rawNm = (range as { nm?: unknown }).nm
  const km = isUsableWindCircleRadius(rawKm) ? rawKm : undefined
  const nm = isUsableWindCircleRadius(rawNm) ? rawNm : undefined
  // Usable circle needs at least one finite non-negative unit value.
  // Empty {}, null/string units, or negative-only radii must not become present.
  if (km === undefined && nm === undefined) return undefined
  return { km, nm, rawKm, rawNm }
}

function parseWindCircleField(row: object, key: "galeWarning" | "stormWarning"): JmaWindCircleField {
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    return { status: "absent" }
  }
  const raw = (row as Record<string, unknown>)[key]
  if (raw === null) {
    return { status: "invalid", reason: `${key}_null`, raw }
  }
  if (!Array.isArray(raw)) {
    return { status: "invalid", reason: `${key}_not_array`, raw }
  }
  const sectors: JmaWindCircleSector[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { status: "invalid", reason: `${key}_sector_not_object`, raw }
    }
    const range = parseWindCircleRange((item as { range?: unknown }).range)
    if (!range) {
      return { status: "invalid", reason: `${key}_range_invalid`, raw }
    }
    sectors.push({
      area: parseWindCircleArea((item as { area?: unknown }).area),
      range,
    })
  }
  return { status: "present", sectors }
}

function parseProbabilityCircleRadius(row: object): JmaWindCircleRange | undefined {
  if (!Object.prototype.hasOwnProperty.call(row, "probabilityCircleRadius")) return undefined
  return parseWindCircleRange((row as { probabilityCircleRadius?: unknown }).probabilityCircleRadius)
}

/**
 * Minimal pure parser for JMA `specifications.json` wind-circle fields.
 * Does not invent radius units, does not coerce absent circles to 0, and does not
 * require pressure/wind hard gates outside the catalog wind-radius scope.
 */
export function parseJmaSpecificationsJson(payload: unknown): JmaSpecificationsParseResult {
  if (!Array.isArray(payload) || payload.length === 0) {
    return { status: "invalid", message: "JMA specifications payload is not a non-empty array" }
  }
  const titleBlock = payload.find(block => block && typeof block === "object" && (block as { part?: unknown }).part === "title")
  if (!titleBlock || typeof titleBlock !== "object") {
    return { status: "invalid", message: "JMA specifications payload missing title part" }
  }
  const name = (titleBlock as { name?: { en?: string, jp?: string } }).name
  const category = (titleBlock as { category?: { en?: string, jp?: string } }).category
  const issue = (titleBlock as { issue?: { UTC?: string, JST?: string } }).issue
  const title: JmaSpecificationsTitle = {
    part: "title",
    typhoonNumber: typeof (titleBlock as { typhoonNumber?: unknown }).typhoonNumber === "string"
      ? (titleBlock as { typhoonNumber: string }).typhoonNumber
      : undefined,
    nameEn: typeof name?.en === "string" ? name.en : undefined,
    nameJp: typeof name?.jp === "string" ? name.jp : undefined,
    categoryEn: typeof category?.en === "string" ? category.en : undefined,
    categoryJp: typeof category?.jp === "string" ? category.jp : undefined,
    issueUtc: typeof issue?.UTC === "string" ? issue.UTC : undefined,
    issueJst: typeof issue?.JST === "string" ? issue.JST : undefined,
  }

  const rows: JmaSpecificationsRow[] = []
  for (const block of payload) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue
    if ((block as { part?: unknown }).part === "title") continue
    const part = parseLocalizedPart((block as { part?: unknown }).part)
    const advancedHoursRaw = (block as { advancedHours?: unknown }).advancedHours
    const advancedHours = typeof advancedHoursRaw === "number" && Number.isFinite(advancedHoursRaw)
      ? advancedHoursRaw
      : undefined
    const validtime = (block as { validtime?: { UTC?: unknown, JST?: unknown } }).validtime
    rows.push({
      partLabelEn: part?.en,
      partLabelJp: part?.jp,
      advancedHours,
      validtimeUtc: typeof validtime?.UTC === "string" ? validtime.UTC : undefined,
      validtimeJst: typeof validtime?.JST === "string" ? validtime.JST : undefined,
      galeWarning: parseWindCircleField(block, "galeWarning"),
      stormWarning: parseWindCircleField(block, "stormWarning"),
      probabilityCircleRadius: parseProbabilityCircleRadius(block),
    })
  }
  if (!rows.length) {
    return { status: "invalid", message: "JMA specifications payload has title but no timed rows" }
  }
  return { status: "ok", title, rows }
}

/** Official UI storm-warning section label depends on analysis vs forecast timing. */
export function jmaStormWarningLabelJp(advancedHours: number | undefined): string {
  if (advancedHours !== undefined && advancedHours <= 1) return JMA_STORM_WARNING_LABEL_ANALYSIS_JP
  return JMA_STORM_WARNING_LABEL_FORECAST_JP
}

export type JmaIdentityFieldMatch = boolean | "unknown"

function matchOptionalIdentityField(
  left: string | undefined,
  right: string | undefined,
): JmaIdentityFieldMatch {
  const a = typeof left === "string" && left.length > 0 ? left : undefined
  const b = typeof right === "string" && right.length > 0 ? right : undefined
  // Three-way: both non-empty equal => true; both non-empty unequal => false;
  // missing/empty on either side (no comparable value) => unknown.
  if (a === undefined || b === undefined) return "unknown"
  return a === b
}

/** Cross-check specifications title identity against a forecast parse (same TC). */
export function crossCheckJmaSpecificationsAgainstForecast(
  specs: Extract<JmaSpecificationsParseResult, { status: "ok" }>,
  forecast: Pick<NormalizedTropicalCyclone, "typhoonNumber" | "nameEn" | "nameJp" | "issuedAt">,
): {
    typhoonNumberMatch: JmaIdentityFieldMatch
    nameEnMatch: JmaIdentityFieldMatch
    nameJpMatch: JmaIdentityFieldMatch
    issuedAtMatch: JmaIdentityFieldMatch
  } {
  return {
    typhoonNumberMatch: matchOptionalIdentityField(specs.title.typhoonNumber, forecast.typhoonNumber),
    nameEnMatch: matchOptionalIdentityField(specs.title.nameEn, forecast.nameEn),
    nameJpMatch: matchOptionalIdentityField(specs.title.nameJp, forecast.nameJp),
    issuedAtMatch: matchOptionalIdentityField(specs.title.issueUtc, forecast.issuedAt),
  }
}
