import type { CalendarCoverage, CalendarEvent } from "./calendar"

export type SourceStatus = "healthy" | "degraded" | "failed" | "disabled" | "never_succeeded"
export type SourceType = "official" | "third_party" | "user" | "mock"
export type SourceLineage = "real" | "mock" | "imported" | "derived"
export type DataNature = "observed" | "reported" | "forecast" | "modelled" | "derived" | "estimated" | "planned"
export type FreshnessState = "fresh" | "stale" | "unknown"
export type Severity = "info" | "watch" | "warning" | "critical"
export type EventStatus = "active" | "resolved"
export type NavigationStatus = "under_way" | "anchored" | "moored" | "aground" | "unknown"
export type FeedCategory = "shipping_news" | "carrier_notice" | "weather" | "port_notice"
export type FeedFreshnessClass = "ordinary" | "operational" | "official"
export type FeedVisibility = "current" | "history" | "quarantine"
export type WeatherRiskSource = "model" | "official"
export type WeatherAlertState = "active" | "expired" | "unknown"

export interface DataProvenance {
  sourceType: SourceType
  dataNature: DataNature
  sourceId: string
  sourceUrl?: string
  verified?: boolean
}

export interface DataEvidence {
  provenance: DataProvenance
  sourceUpdatedAt?: string
}

export interface Freshness {
  updatedAt?: string
  sourceUpdatedAt?: string
  fetchedAt?: string
  stale: boolean
  sourceStatus: SourceStatus
  error?: string
  errorCode?: string
}

export interface ProvenanceAware {
  provenance?: DataProvenance
  /** Migration lineage; deliberately distinct from provenance.sourceType. */
  source_type?: SourceLineage
}

export type PortCongestionCoverage = "public" | "no_public_data"

export interface PortCongestionDetail {
  coverageStatus: PortCongestionCoverage
  congestionCategory?: Port["congestionLevel"]
  medianWaitingHours?: number
  previousMedianWaitingHours?: number
  weekOverWeekChangePct?: number
  longTailCongestion?: boolean
}

export interface ProviderResult<T> {
  data: T[]
  provenance: DataProvenance
  fetchedAt: string
  sourceUpdatedAt?: string
  freshness: Freshness
}

export interface ShippingProviderFreshness {
  port: Freshness
  weather: Freshness
  weatherAlerts: Freshness
  feed?: Freshness
}

export type DatabasePersistenceState = "healthy" | "read_only_degraded" | "unavailable"

export interface DatabasePersistenceStatus {
  status: DatabasePersistenceState
  schemaVersion: number
  bootstrapCompletedAt?: string
  errorCode?: "persistence_unavailable" | "persistence_write_failed"
}

export function deriveProvenance(source?: DataProvenance): DataProvenance | undefined {
  return source ? { ...source, dataNature: "derived" } : undefined
}

export function provenanceEvidence(source?: DataProvenance, sourceUpdatedAt?: string): DataEvidence[] {
  return source ? [{ provenance: source, sourceUpdatedAt }] : []
}

const knownMockProvenance: Record<string, DataProvenance> = {
  "mock-port": { sourceType: "mock", dataNature: "derived", sourceId: "mock-port", verified: false },
  "mock-weather": { sourceType: "mock", dataNature: "forecast", sourceId: "mock-weather", verified: false },
  "mock-port-notice": { sourceType: "mock", dataNature: "reported", sourceId: "mock-port-notice", verified: false },
}

export function knownMockProvenanceFor(sourceId?: string): DataProvenance | undefined {
  const provenance = sourceId ? knownMockProvenance[sourceId] : undefined
  return provenance ? { ...provenance } : undefined
}

export function isMockProvenance(provenance?: DataProvenance): boolean {
  return provenance?.sourceType === "mock"
}

export function sourceLineageForRecord(record: ProvenanceAware, fallback: SourceLineage = "mock"): SourceLineage {
  if (record.source_type) return record.source_type
  if (record.provenance) return isMockProvenance(record.provenance) ? "mock" : "real"
  return fallback
}

export function hasMockEvidence(record: ProvenanceAware & { evidence?: DataEvidence[] }): boolean {
  return sourceLineageForRecord(record) === "mock"
    || isMockProvenance(record.provenance)
    || Boolean(record.evidence?.some(evidence => isMockProvenance(evidence.provenance)))
}

export function recordAllowedForDataMode(record: ProvenanceAware & { evidence?: DataEvidence[] }, dataMode: "mock" | "real"): boolean {
  return dataMode !== "real" || (sourceLineageForRecord(record) !== "mock" && !hasMockEvidence(record))
}

export function normalizeLegacyTrust<T extends ProvenanceAware>(entity: T, provenance?: DataProvenance): T {
  if (entity.provenance || !provenance) return entity
  return { ...entity, provenance: { ...provenance } }
}

export function normalizeLegacyEventTrust(event: ShippingEvent, source?: Freshness & ProvenanceAware): ShippingEvent {
  if (event.provenance || !source?.provenance) return event
  const sourceUpdatedAt = event.sourceUpdatedAt ?? source.sourceUpdatedAt ?? source.updatedAt
  return {
    ...event,
    provenance: deriveProvenance(source.provenance),
    evidence: event.evidence?.length ? event.evidence : provenanceEvidence(source.provenance, sourceUpdatedAt),
    updatedAt: event.updatedAt ?? source.updatedAt,
    sourceUpdatedAt,
    fetchedAt: event.fetchedAt ?? source.fetchedAt,
    stale: event.stale ?? source.stale,
  }
}

export interface Port extends Freshness, ProvenanceAware {
  id: string
  name: string
  nameEn: string
  country: string
  unlocode: string
  isWatched: boolean
  congestionLevel?: "low" | "medium" | "high" | "critical"
  congestionDetail?: PortCongestionDetail
  waitingVessels?: number
  containerWaitingVessels?: number
  waitingHours?: number
  operationalStatus?: "normal" | "disrupted" | "closed"
}

export interface ShippingProviderModes {
  dataMode?: "mock" | "real"
  port?: string
  weather?: string
  weatherAlerts?: string
  feed?: string
  calendar?: string
  calendarSourceIds?: readonly string[]
}

export interface OperationalSourceContext {
  modes: ShippingProviderModes
  activeSourceIds: ReadonlySet<string>
}

const realFeedSourceIds = new Set([
  "shipping-feed",
  "the-loadstar",
  "maritime-executive",
  "shekou-official",
  "laem-chabang-official",
  "port-klang-official",
  "yantian-official",
  "nansha-official",
])

const officialWeatherAlertSourceIds = new Set(["official-weather-alerts", "jma", "tmd", "bmkg"])

export function sourceAllowedForProviderModes(sourceId: string | undefined, modes: ShippingProviderModes): boolean {
  if (!sourceId) return false
  if (sourceId === "mock-port") return modes.dataMode !== "real" && modes.port === "mock"
  if (sourceId === "portcast-public") return modes.port === "portcast"
  if (sourceId === "mock-weather") return modes.dataMode !== "real" && modes.weather === "mock"
  if (sourceId === "open-meteo-marine") return modes.weather === "open-meteo"
  if (officialWeatherAlertSourceIds.has(sourceId)) return modes.weatherAlerts === "public" || modes.weatherAlerts === "experimental"
  if (sourceId === "mock-port-notice") return modes.dataMode !== "real" && modes.feed === "mock"
  if (realFeedSourceIds.has(sourceId)) return modes.feed === "public"
  if (sourceId === "mock-calendar") return modes.dataMode !== "real" && modes.calendar === "mock"
  if (sourceId === "calendarific") return modes.calendar === "calendarific"
  if (sourceId === "official-holiday-source" || ["official-th", "official-id", "official-my", "official-ph", "official-vn"].includes(sourceId)) return modes.calendar === "calendarific" || modes.calendar === "official"
  if (sourceId === "manual-holiday") return modes.calendar === "calendarific" || modes.calendar === "official" || modes.calendar === "manual"
  return false
}

const sourceScopedEventTypes = new Set(["port_congestion"])

export function sourceScopedEventDedupeKey(logicalDedupeKey: string, sourceId?: string): string {
  return `${logicalDedupeKey}:${sourceId ?? "unknown"}`
}

function sourceScopeForEvent(event: Pick<ShippingEvent, "provenance" | "evidence">): string | undefined {
  return event.provenance?.sourceId ?? event.evidence?.[0]?.provenance.sourceId
}

function entityIdForSourceScopedEvent(event: Pick<ShippingEvent, "type" | "portId">): string | undefined {
  if (event.type === "port_congestion") return event.portId
  return undefined
}

export function eventHasSourceScopedIdentity(event: Pick<ShippingEvent, "type" | "dedupeKey" | "provenance" | "evidence" | "portId">): boolean {
  if (!sourceScopedEventTypes.has(event.type)) return true
  const entityId = entityIdForSourceScopedEvent(event)
  const sourceId = sourceScopeForEvent(event)
  return Boolean(entityId && sourceId && event.dedupeKey === sourceScopedEventDedupeKey(`${event.type}:${entityId}`, sourceId))
}

export function sourceAllowedForOperationalContext(sourceId: string | undefined, context: OperationalSourceContext): boolean {
  return Boolean(sourceId && context.activeSourceIds.has(sourceId) && sourceAllowedForProviderModes(sourceId, context.modes))
}

export function eventIsCompatibleWithCurrentProviders(event: Pick<ShippingEvent, "type" | "dedupeKey" | "provenance" | "evidence" | "portId">, modes: ShippingProviderModes): boolean {
  if (!eventHasSourceScopedIdentity(event)) return false
  if (!recordAllowedForDataMode(event, modes.dataMode ?? "mock")) return false
  const sourceId = event.provenance?.sourceId
  if (sourceId) return sourceAllowedForProviderModes(sourceId, modes)
  return (event.evidence ?? []).some(evidence => sourceAllowedForProviderModes(evidence.provenance.sourceId, modes))
}

export function filterEventsForProviderModes(events: ShippingEvent[], modes: ShippingProviderModes): ShippingEvent[] {
  return events.filter(event => eventIsCompatibleWithCurrentProviders(event, modes))
}

export function eventIsCompatibleWithOperationalContext(event: ShippingEvent, context: OperationalSourceContext): boolean {
  if (!eventHasSourceScopedIdentity(event)) return false
  if (!recordAllowedForDataMode(event, context.modes.dataMode ?? "mock")) return false
  const sourceId = event.provenance?.sourceId ?? event.evidence?.[0]?.provenance.sourceId
  return sourceAllowedForOperationalContext(sourceId, context)
}

export function filterEventsForOperationalContext(events: ShippingEvent[], context: OperationalSourceContext): ShippingEvent[] {
  return events.filter(event => eventIsCompatibleWithOperationalContext(event, context))
}

export interface FeedItem extends Freshness, ProvenanceAware {
  id: string
  sourceId: string
  category: FeedCategory
  freshnessPolicy?: FeedFreshnessClass
  type: string
  title: string
  summary: string
  sourceUrl: string
  canonicalUrl?: string
  publishedAt: string
  publicationTimeKnown?: boolean
  effectiveAt?: string
  expiresAt?: string
  currentUntil?: string
  visibility?: FeedVisibility
  eventEligibility?: boolean
  severity: Severity
  hotReason?: string
  tags?: string[]
  weather?: WeatherDetail
  relatedPortIds: string[]
  relatedVesselIds: string[]
}

export type TranslationDisplayState = "translated" | "historical" | "original" | "pending" | "unavailable"

export interface FeedTranslationDisplayState {
  title: TranslationDisplayState
  summary: TranslationDisplayState
}

/** API-only enrichment DTO; FeedItem.title/summary remain the original facts. */
export interface FeedItemDisplay extends FeedItem {
  displayTitle: string
  displaySummary: string
  translation: FeedTranslationDisplayState
}

export interface ShippingEvent extends ProvenanceAware {
  id: string
  type: string
  severity: Severity
  status: EventStatus
  title: string
  summary: string
  occurredAt: string
  detectedAt: string
  dedupeKey: string
  firstDetectedAt: string
  lastDetectedAt: string
  resolvedAt?: string
  feedItemId?: string
  portId?: string
  calendarEventId?: string
  evidenceJson: Record<string, unknown>
  evidence?: DataEvidence[]
  updatedAt?: string
  sourceUpdatedAt?: string
  fetchedAt?: string
  expiresAt?: string
  stale?: boolean
  sourceStatus: SourceStatus
  error?: string
}

export interface ShippingSettings {
  refreshInterval: number
  sourceEnabled: boolean
  providerEnabled: boolean
  eventThresholds: {
    anchoredHours: number
    delayMinutes: number
    congestionLevel: NonNullable<Port["congestionLevel"]>
  }
  retentionDays: number
  calendarSync?: CalendarCoverage[]
  translation?: TranslationSettings
}

export interface TranslationSettings {
  enabled: boolean
  providerId: "deepseek"
  model: "deepseek-v4-flash"
  targetLanguage: string
  monthlyBudget: number
}

export const defaultTranslationSettings: TranslationSettings = {
  enabled: false,
  providerId: "deepseek",
  model: "deepseek-v4-flash",
  targetLanguage: "zh-CN",
  monthlyBudget: 0,
}

export interface WeatherDetail {
  riskSource: WeatherRiskSource
  alertState?: WeatherAlertState
  forecastWindowHours?: number
  forecastStartAt?: string
  forecastEndAt?: string
  waveHeightM?: number
  swellWaveHeightM?: number
  swellPeriodSeconds?: number
  waveDirectionDeg?: number
  swellDirectionDeg?: number
  swellWaveDirectionDeg?: number
  windows?: WeatherWindows
  windSpeedKmh?: number
  windGustKmh?: number
  alertId?: string
  alertRegion?: string
  alertIssuedAt?: string
  alertEffectiveAt?: string
  alertExpiresAt?: string
  alertUrgency?: string
  alertCertainty?: string
  /** Validity of the official record; "unknown" when the source times cannot be interpreted (MY-W01). */
  validityStatus?: "unknown"
  /** Source datetimes carry no confirmed timezone (MY-W01); raw strings are kept and never converted. */
  timezoneStatus?: "unconfirmed"
  /** The source publishes no official severity field. */
  officialSeverity?: "not_provided"
  /** publishedAt is the time the record was first received, not an official issue time. */
  timeBasis?: "received_at"
  /** Raw official strings exactly as received (MY-W01 data.gov.my warning row). */
  alertRaw?: WeatherAlertRaw
}

export interface WeatherAlertRaw {
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
  sourceUrl: string
  fetchedAt: string
}

export interface WeatherWindow {
  severity: Severity
  forecastStartAt?: string
  forecastEndAt?: string
  maxWaveHeightM?: number
  maxSwellWaveHeightM?: number
  maxSwellPeriodSeconds?: number
  maxWindSpeedKmh?: number
  maxWindGustKmh?: number
  waveDirectionDeg?: number
  swellDirectionDeg?: number
  swellWaveDirectionDeg?: number
}

export interface WeatherWindows {
  h24: WeatherWindow
  h72: WeatherWindow
  d7: WeatherWindow
}

export interface PortWeatherForecastRow {
  id: string
  portId: string
  unlocode?: string
  forecastAt: string
  horizon: "hourly" | "current"
  waveHeightM?: number
  swellWaveHeightM?: number
  windSpeedKmh?: number
  windGustKmh?: number
  precipitationMm?: number
  visibilityM?: number
  sourceId: string
  fetchedAt: string
}

export interface PortWeatherImpactRow {
  id: string
  portId: string
  validFrom: string
  validUntil: string
  ruleId: string
  severity: Severity
  status: "potential"
  provenance: "system"
  summaryZh: string
  inputValues: Record<string, number>
  computedAt: string
}

export interface PortWeatherOfficialAlertSummary {
  id: string
  title: string
  summary: string
  severity: Severity
  publishedAt: string
  sourceId: string
  provenance?: DataProvenance
}

export type PortWeatherPanelState =
  | "ready"
  | "no_rule_hits"
  | "partial_rule_coverage"
  | "data_stale"
  | "data_empty"
  | "data_insufficient"
  | "sync_failed"

export type Precip24hCoverageStatus = "full" | "partial" | "insufficient"

export interface PortWeatherPrecipCoverage {
  hourlySamplesInWindow: number
  fullRequired: number
  partialMinimum: number
  status: Precip24hCoverageStatus
  totalMm?: number
  partialSumMm?: number
}

export interface PortWeatherRuleCoverageEntry {
  ruleId: string
  evaluation: "evaluated" | "unevaluated"
  reason?: string
}

export interface PortWeatherPanelNotice {
  code: PortWeatherPanelState
  messageZh: string
  referenceFetchedAt?: string
  referenceComputedAt?: string
  showingHistoricalData: boolean
}

export interface PortWeatherForecastMeta {
  /** Target evaluation/display window (product policy). */
  targetWindow: { start: string, end: string }
  /** Instants actually present in persisted rows returned to the client. */
  actualCoverage: {
    firstInstant?: string
    lastInstant?: string
    totalReturned: number
    hourlyReturned: number
    currentReturned: number
  }
  sourceId?: string
  fetchedAt?: string
  missingCounts: {
    windGust: number
    wave: number
    precipitation: number
    visibility: number
  }
  /** When Open-Meteo marine `cell_selection=sea` yields no wave/swell at inland coordinates. */
  marineCoverageNote?: string
}

export type TropicalCycloneSyncOutcome = "ok" | "ok_empty" | "partial" | "failed" | "not_run"

export interface TropicalCycloneSyncMeta {
  sourceId: "jma-typhoon" | "jtwc-typhoon-fixture"
  /** Most recent sync attempt (any outcome). */
  lastCheckedAt?: string
  /** Last ok / ok_empty list outcome (full list success). */
  lastFullSuccessAt?: string
  /** Last time at least one TC detail was persisted (partial or ok). */
  lastPathFetchAt?: string
  /** @deprecated Use lastFullSuccessAt — kept for readers */
  lastSuccessAt?: string
  dataValidUntil?: string
  outcome: TropicalCycloneSyncOutcome
  errorCode?: string
  errorMessage?: string
  failedTcIds?: string[]
  listInvalidCount?: number
  stale?: boolean
}

export interface TropicalCycloneGeoPoint {
  lat: number
  lon: number
  at?: string
}

export interface TropicalCycloneSummary {
  id: string
  jmaId?: string
  nameEn?: string
  nameJp?: string
  typhoonNumber?: string
  category?: string
  sourceId: string
  /** Per-path snapshot time from SQLite row. */
  pathFetchedAt: string
  /** @deprecated Alias of pathFetchedAt */
  fetchedAt: string
  dissipatedAt?: string
  lifecycleStatus?: "active" | "dissipated" | "missing_from_list"
  minDistanceKm?: number
  wrS03DistanceKm?: number
  current?: TropicalCycloneGeoPoint & { at: string }
  trackHistory: TropicalCycloneGeoPoint[]
  forecast: Array<TropicalCycloneGeoPoint & { at: string }>
  summaryZh?: string
}

export interface TropicalCyclonePanelResponse {
  asOf: string
  sync: TropicalCycloneSyncMeta
  cyclones: TropicalCycloneSummary[]
  activeCount: number
  historicalSummaryCount: number
  messageZh: string
  seasonHintZh?: string
}

/**
 * Independent area-reference marine (ADR-009). Never the port's own marine; shown separately and labelled as an
 * engineering point (not an official representative point, not berth conditions).
 */
export type MarineReferenceStatus = "not_run" | "failed" | "fresh" | "stale" | "insufficient"

/** Grid metadata of one reference batch, as returned by the provider (never back-filled from diagnosis docs). */
export interface MarineReferenceGridMeta {
  requestedLatitude: number
  requestedLongitude: number
  /** Provider-returned grid cell centre; undefined when the provider did not return it. */
  returnedLatitude?: number
  returnedLongitude?: number
  /** Great-circle km between requested point and returned grid cell. */
  requestedToReturnedKm?: number
  /** Model requested (Open-Meteo does not echo the resolved model for best_match). */
  modelRequested: string
  providerGenerationTimeMs?: number
  fetchedAt: string
}

export interface MarineReferenceAttempt {
  refKey: string
  attemptedAt: string
  outcome: "success" | "failed"
  error?: string
  grid?: MarineReferenceGridMeta
}

export interface MarineReferenceSyncMeta {
  refKey: string
  lastAttemptAt: string
  lastAttemptOutcome: "success" | "failed"
  lastAttemptError?: string
  lastSuccessAt?: string
  /** Grid of the last successful batch (the batch whose rows are stored). */
  grid?: MarineReferenceGridMeta
}

export interface PortMarineReferencePanel {
  refKey: string
  nameZh: string
  kind: "engineering_reference_point"
  latitude: number
  longitude: number
  model: "best_match"
  approxDistanceKm: number
  officialRepresentativePoint: false
  berthConditions: false
  labelZh: string
  sourceId: string
  fetchedAt?: string
  hourlyReturned: number
  hourlyWithMarine: number
  firstInstant?: string
  lastInstant?: string
  maxWaveHeightM?: number
  forecasts: PortWeatherForecastRow[]
  /** Currently active reference rule hits; empty unless status is fresh or insufficient. */
  impacts: PortWeatherImpactRow[]
  status: MarineReferenceStatus
  statusNoteZh: string
  lastAttemptAt?: string
  lastAttemptOutcome?: "success" | "failed"
  lastAttemptError?: string
  lastSuccessAt?: string
  /** True when the values shown are an older (historical) reference batch, not current. */
  showingHistoricalData: boolean
  /** Stored reference rule hits NOT counted as currently active (failed/stale/not_run). */
  historicalImpactCount: number
  grid?: MarineReferenceGridMeta
  coverage: { expectedHours: number, hourlyWithMarine: number, missingHours: number, complete: boolean }
}

export interface PortWeatherPanelResponse {
  portId: string
  state: PortWeatherPanelState
  asOf: string
  forecasts: PortWeatherForecastRow[]
  forecastMeta: PortWeatherForecastMeta
  impacts: PortWeatherImpactRow[]
  ruleCoverage: PortWeatherRuleCoverageEntry[]
  precipCoverage: PortWeatherPrecipCoverage
  typhoonSync?: TropicalCycloneSyncMeta
  officialAlerts: PortWeatherOfficialAlertSummary[]
  /** §4.8 WR-O01/WR-O02 potential impacts derived from current official alerts (⚙ judgement, 🏛 basis). */
  officialAlertImpacts: import("./weather-impact").WeatherImpactRuleHit[]
  panelNotice?: PortWeatherPanelNotice
  displayMeta: {
    forecastLimit: number
    impactLimit: number
    forecastsReturned: number
    impactsReturned: number
  }
  impactMeta: {
    totalMatched: number
    returned: number
    truncated: boolean
  }
  sources: {
    forecast: string
    impacts: "system"
    alerts: string
  }
  /** Separate area-reference marine block; the port's own marine (forecasts/forecastMeta) is unaffected. */
  marineReference?: PortMarineReferencePanel
}

export interface ShippingSnapshot {
  ports: Port[]
  events: ShippingEvent[]
  feedItems: FeedItem[]
  settings: ShippingSettings
  providerFreshness?: ShippingProviderFreshness
  calendarEvents?: CalendarEvent[]
  calendarCoverage?: CalendarCoverage[]
  database?: DatabasePersistenceStatus
}

export interface HotItem {
  id: string
  kind: "event" | "feed"
  title: string
  summary: string
  severity: Severity
  freshness: FreshnessState
  sourceStatus: SourceStatus
  provenance?: DataProvenance
  occurredAt: string
  relatedLabel?: string
  eventId?: string
  feedItemId?: string
  hotReason?: string
}
