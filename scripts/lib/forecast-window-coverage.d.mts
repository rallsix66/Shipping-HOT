export declare const HOUR_MS: number
export declare const SEVEN_DAY_MS: number
export declare const LAND_FIELDS: string[]
export interface CoverageRow {
  forecastAt: string
  horizon?: string
  windGustKmh?: number
  precipitationMm?: number
  visibilityM?: number
  waveHeightM?: number
  swellWaveHeightM?: number
}
export interface CoverageCheck {
  id: string
  pass: boolean
  detail: string
}
export interface CoverageResult {
  window: { start: string, end: string, gridStart: string, gridEnd: string, expectedHours: number }
  hourlyInWindow: number
  uniqueHourlyInWindow: number
  currentRows: number
  firstHourly?: string
  lastHourly?: string
  maxGapHours: number
  missingHoursCount: number
  missingHoursSample: string[]
  duplicateTimestamps: string[]
  fieldMissing: Record<string, number>
  checks: CoverageCheck[]
  failed: string[]
  pass: boolean
}
export declare function sevenDayWindow(nowMs: number): { startMs: number, endMs: number }
export declare function evaluateForecastWindowCoverage(rows: CoverageRow[], nowMs: number, options?: { requireMarine?: boolean, requireLand?: boolean }): CoverageResult
