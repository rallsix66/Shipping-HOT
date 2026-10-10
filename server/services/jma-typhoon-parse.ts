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
