/**
 * Independent area-reference marine points (ADR-009).
 *
 * A reference point is NOT the port's own marine forecast and never replaces it: the port's marine stays
 * reported as missing when Open-Meteo returns no wave/swell at the port coordinate. Reference rows are stored
 * under their own key (`refKey`) and sourceId, rules computed on them are kept under that key, and the panel
 * exposes them in a separate, clearly labelled `marineReference` block.
 *
 * Authorization:
 * - user guoyong lai, Grok Bot chat, 2026-10-10 13:47 UTC+8, original words 「可以啊」, approving the proposed
 *   point 10.2917N 107.0417E, name 「胡志明关联海域海况参考（工程取点）」 and the engineering-point labelling;
 * - dots review thread 2026-10-10 13:33 UTC+8 set the implementation boundary (separate land / port marine /
 *   area-reference marine and rules; no silent replacement; label as engineering point, ~62 km, not an official
 *   representative point, not berth conditions).
 * Evidence: docs/evidence/vnsgn-point-check-2026-10-10/ (in water, inside 01/2026/TT-BXD HCM1–HCM7 zone).
 */
export interface PortMarineReference {
  /** Storage key used as weather_forecast/weather_impact port_id for reference rows; never a real port id. */
  refKey: string
  portId: string
  unlocode: string
  nameZh: string
  kind: "engineering_reference_point"
  latitude: number
  longitude: number
  model: "best_match"
  /** Great-circle distance from the port directory coordinate, rounded. */
  approxDistanceKm: number
  officialRepresentativePoint: false
  berthConditions: false
  labelZh: string
}

export const MARINE_REFERENCE_SOURCE_ID = "open-meteo-marine-reference"

export const portMarineReferences: readonly PortMarineReference[] = [
  {
    refKey: "marine-ref:port-ho-chi-minh:ganh-rai-eng",
    portId: "port-ho-chi-minh",
    unlocode: "VNSGN",
    nameZh: "胡志明关联海域海况参考（工程取点）",
    kind: "engineering_reference_point",
    latitude: 10.2917,
    longitude: 107.0417,
    model: "best_match",
    approxDistanceKm: 62,
    officialRepresentativePoint: false,
    berthConditions: false,
    labelZh: "工程取点：01/2026/TT-BXD 胡志明港水域 Gành Rái/Đồng Tranh 湾区（HCM1–HCM7）内海上点，距港口坐标约 62 km；非官方代表点，不代表泊位/港内条件；港口自身海况仍按缺测显示。",
  },
]

export function marineReferenceForPort(portId: string): PortMarineReference | undefined {
  return portMarineReferences.find(reference => reference.portId === portId)
}

export function isMarineReferenceKey(key: string): boolean {
  return key.startsWith("marine-ref:")
}
