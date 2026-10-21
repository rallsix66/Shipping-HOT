/** Pure ID-W02 parsing only. No fetch, clock, repository, provider registration or freshness verdict. */
export type BmkgField<T> = { state: "missing" } | { state: "null", raw: null } | { state: "value", raw: T }
const numericKeys = ["visibility", "temp_avg", "rh_avg", "wind_speed", "wind_gust", "wave_height", "current_speed", "tides"] as const
const textKeys = ["weather", "wind_from", "wave_cat", "current_to"] as const
type NumericKey = typeof numericKeys[number]
type TextKey = typeof textKeys[number]
export interface BmkgUtcTime {
  raw: string
  iso: string
}
export interface BmkgParseContext {
  source: { url: string, fetchedAt: string }
  expected: { code: string, name: string }
}
export interface BmkgForecastPoint {
  time: BmkgUtcTime
  numeric: Record<NumericKey, BmkgField<number>>
  text: Record<TextKey, BmkgField<string>>
  normalized: { waveHeightM?: number, windSpeedKmh?: number, windGustKmh?: number, visibilityM?: number }
  uninterpretedFields: string[]
}
export interface BmkgPortForecast {
  source: { catalogId: "ID-W02", url: string, fetchedAt: string, unitBasis: string }
  identity: { code: string, name: string }
  issued: BmkgUtcTime
  validRange: { from: BmkgUtcTime, to: BmkgUtcTime }
  groups: { key: "forecast_day1" | "forecast_day2-4", cadenceMinutes: 60 | 180, points: BmkgForecastPoint[] }[]
  pointCount: number
  missingFields: string[]
  nullFields: string[]
  uninterpretedFields: string[]
}
export class BmkgForecastParseError extends Error {
  constructor(public readonly code: string, public readonly path: string) {
    super(`${code}:${path}`)
  }
}
function fail(code: string, path: string): never {
  throw new BmkgForecastParseError(code, path)
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("object_required", path)
  return value as Record<string, unknown>
}
function utc(value: unknown, path: string): BmkgUtcTime {
  if (typeof value !== "string") return fail("utc_required", path)
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) UTC$/.exec(value)
  if (!m) return fail("utc_required", path)
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || date.getUTCHours() !== h || date.getUTCMinutes() !== mi) return fail("invalid_calendar_time", path)
  return { raw: value, iso: date.toISOString() }
}

/** Numeric units: official BMKG /apidoc; source values remain separate from the four projections. */
export function parseBmkgPortForecast(input: unknown, context: BmkgParseContext): BmkgPortForecast {
  const root = object(input, "$")
  if (!context.expected.code || !context.expected.name || root.code !== context.expected.code || root.name !== context.expected.name) return fail("identity_mismatch", "$.code/name")
  const issued = utc(root.issued, "$.issued")
  const from = utc(root.valid_from, "$.valid_from")
  const to = utc(root.valid_to, "$.valid_to")
  const fromMs = Date.parse(from.iso)
  const toMs = Date.parse(to.iso)
  if (fromMs >= toMs) return fail("invalid_valid_range", "$.valid_from/to")
  const missingFields: string[] = []
  const nullFields: string[] = []
  const seen = new Set<number>()
  let previous = -Infinity
  function field<T>(row: Record<string, unknown>, key: string, path: string, kind: "number" | "string"): BmkgField<T> {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      missingFields.push(path)
      return { state: "missing" }
    }
    const raw = row[key]
    if (raw === null) {
      nullFields.push(path)
      return { state: "null", raw: null }
    }
    if (kind === "number" ? typeof raw !== "number" || !Number.isFinite(raw) : typeof raw !== "string") return fail("invalid_field_type", path)
    if (kind === "number" && ((["visibility", "rh_avg", "wind_speed", "wind_gust", "wave_height", "current_speed"].includes(key) && (raw as number) < 0) || (key === "rh_avg" && (raw as number) > 100))) return fail("invalid_physical_value", path)
    return { state: "value", raw: raw as T }
  }
  const definitions = [["forecast_day1", 60], ["forecast_day2-4", 180]] as const
  const groups = definitions.map(([key, cadenceMinutes]) => {
    const rows = root[key]
    if (!Array.isArray(rows)) return fail("array_required", `$.${key}`)
    let previousInGroup: number | undefined
    const points = rows.map((value, index): BmkgForecastPoint => {
      const path = `$.${key}[${index}]`
      const row = object(value, path)
      const time = utc(row.time, `${path}.time`)
      const ms = Date.parse(time.iso)
      if (seen.has(ms)) return fail("duplicate_time", `${path}.time`)
      if (ms <= previous) return fail("time_order", `${path}.time`)
      if (ms < fromMs || ms > toMs) return fail("outside_valid_range", `${path}.time`)
      if (previousInGroup !== undefined && ms - previousInGroup !== cadenceMinutes * 60_000) return fail("invalid_cadence", `${path}.time`)
      seen.add(ms)
      previous = ms
      previousInGroup = ms
      const numeric = Object.fromEntries(numericKeys.map(k => [k, field<number>(row, k, `${path}.${k}`, "number")])) as BmkgForecastPoint["numeric"]
      const text = Object.fromEntries(textKeys.map(k => [k, field<string>(row, k, `${path}.${k}`, "string")])) as BmkgForecastPoint["text"]
      const normalized: BmkgForecastPoint["normalized"] = {}
      for (const [sourceKey, targetKey, factor] of [["wave_height", "waveHeightM", 1], ["wind_speed", "windSpeedKmh", 1.852], ["wind_gust", "windGustKmh", 1.852], ["visibility", "visibilityM", 1000]] as const) {
        const evidence = numeric[sourceKey]
        if (evidence.state === "value") {
          const projected = evidence.raw * factor
          if (!Number.isFinite(projected)) return fail("projection_overflow", `${path}.${sourceKey}`)
          normalized[targetKey] = projected
        }
      }
      return { time, numeric, text, normalized, uninterpretedFields: Object.keys(row).filter(k => k !== "time" && !numericKeys.includes(k as NumericKey) && !textKeys.includes(k as TextKey)) }
    })
    return { key, cadenceMinutes, points }
  })
  const known = new Set(["code", "name", "issued", "valid_from", "valid_to", ...definitions.map(([key]) => key)])
  return {
    source: { catalogId: "ID-W02", url: context.source.url, fetchedAt: context.source.fetchedAt, unitBasis: "https://maritim.bmkg.go.id/apidoc: m; wind/gust knot; visibility km" },
    identity: { code: context.expected.code, name: context.expected.name },
    issued,
    validRange: { from, to },
    groups,
    pointCount: groups.reduce((n, group) => n + group.points.length, 0),
    missingFields,
    nullFields,
    uninterpretedFields: Object.keys(root).filter(k => !known.has(k)),
  }
}
