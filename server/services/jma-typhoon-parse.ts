export interface JmaTargetTcEntry {
  tropicalCyclone: string
  typhoonNumber?: string
  category?: string
  issue?: string
}

export interface NormalizedTyphoonTrackPoint {
  lat: number
  lon: number
  at: string
}

export interface NormalizedTropicalCyclone {
  id: string
  basin: string
  jmaId: string
  typhoonNumber?: string
  nameEn?: string
  nameJp?: string
  category?: string
  issuedAt?: string
  track: NormalizedTyphoonTrackPoint[]
  forecast: NormalizedTyphoonTrackPoint[]
  dissipatedAt?: string
  rawForecastJson: unknown
}

export function parseJmaTargetTcList(payload: unknown): JmaTargetTcEntry[] {
  if (!Array.isArray(payload)) return []
  return payload.filter((entry): entry is JmaTargetTcEntry => {
    return Boolean(entry && typeof entry === "object" && typeof (entry as JmaTargetTcEntry).tropicalCyclone === "string")
  })
}

function pointFromCenter(center: unknown, at: string): NormalizedTyphoonTrackPoint | undefined {
  if (!Array.isArray(center) || center.length < 2) return undefined
  const lat = Number(center[0])
  const lon = Number(center[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
  return { lat, lon, at }
}

export function parseJmaForecastJson(jmaId: string, payload: unknown): NormalizedTropicalCyclone | undefined {
  if (!Array.isArray(payload) || payload.length === 0) return undefined
  let typhoonNumber: string | undefined
  let nameEn: string | undefined
  let nameJp: string | undefined
  let issuedAt: string | undefined
  const track: NormalizedTyphoonTrackPoint[] = []
  const forecast: NormalizedTyphoonTrackPoint[] = []

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
    if (!part || typeof part !== "object") continue
    const validtime = (block as { validtime?: { UTC?: string } }).validtime?.UTC ?? issuedAt ?? new Date(0).toISOString()
    const center = pointFromCenter((block as { center?: unknown }).center, validtime)
    const advancedHours = Number((block as { advancedHours?: number }).advancedHours)
    if (!center) continue
    if (advancedHours === 0) {
      track.push(center)
      const typhoonTrack = (block as { track?: { typhoon?: unknown[] } }).track?.typhoon
      if (Array.isArray(typhoonTrack)) {
        for (const pair of typhoonTrack) {
          const pt = pointFromCenter(pair, validtime)
          if (pt) track.push(pt)
        }
      }
    } else {
      forecast.push(center)
    }
  }

  if (!track.length && !forecast.length) return undefined
  return {
    id: `tc-jma-${jmaId}`,
    basin: "NW_PACIFIC",
    jmaId,
    typhoonNumber,
    nameEn,
    nameJp,
    category: undefined,
    issuedAt,
    track,
    forecast,
    rawForecastJson: payload,
  }
}
