// Seven-day forecast window coverage for R1.5-1 acceptance (pure, no I/O).
// Window = [now - 1h, now + 7d]; only horizon=hourly rows count toward coverage.
// `current` rows are reported separately and never pad hourly coverage.
// The expected grid is every whole UTC hour inside the window; coverage requires:
//   unique timestamps, the first and last grid hour present, no missing grid hours,
//   no off-grid timestamps, and the required land (+ marine when requested) fields on every hour.

export const HOUR_MS = 60 * 60 * 1000
export const SEVEN_DAY_MS = 7 * 24 * HOUR_MS

export function sevenDayWindow(nowMs) {
  return { startMs: nowMs - HOUR_MS, endMs: nowMs + SEVEN_DAY_MS }
}

function ceilHour(ms) {
  return Math.ceil(ms / HOUR_MS) * HOUR_MS
}

function floorHour(ms) {
  return Math.floor(ms / HOUR_MS) * HOUR_MS
}

const iso = ms => (ms === undefined ? undefined : new Date(ms).toISOString())

const isNum = v => typeof v === "number" && Number.isFinite(v)

export const LAND_FIELDS = ["windGustKmh", "precipitationMm", "visibilityM"]

/**
 * @param {Array<{forecastAt: string, horizon?: string, windGustKmh?: number, precipitationMm?: number, visibilityM?: number, waveHeightM?: number, swellWaveHeightM?: number}>} rows
 * @param {number} nowMs
 * @param {{ requireMarine?: boolean }} [options]
 */
export function evaluateForecastWindowCoverage(rows, nowMs, options = {}) {
  const requireMarine = options.requireMarine ?? true
  const { startMs, endMs } = sevenDayWindow(nowMs)
  const gridStart = ceilHour(startMs)
  const gridEnd = floorHour(endMs)
  const expectedHours = Math.floor((gridEnd - gridStart) / HOUR_MS) + 1

  const currentRows = rows.filter(r => r.horizon === "current")
  const hourlyRows = rows.filter(r => r.horizon !== "current")
  let invalidTimestamps = 0
  const inWindow = []
  for (const row of hourlyRows) {
    const t = Date.parse(row.forecastAt)
    if (!Number.isFinite(t)) {
      invalidTimestamps++
      continue
    }
    if (t >= startMs && t <= endMs) inWindow.push({ t, row })
  }
  const seen = new Map()
  for (const { t } of inWindow) seen.set(t, (seen.get(t) ?? 0) + 1)
  const duplicateTimestamps = [...seen.entries()].filter(([, c]) => c > 1).map(([t]) => iso(t))
  const offGridTimestamps = [...seen.keys()].filter(t => t % HOUR_MS !== 0).map(iso)
  const missingHours = []
  for (let t = gridStart; t <= gridEnd; t += HOUR_MS) {
    if (!seen.has(t)) missingHours.push(iso(t))
  }
  const sorted = [...seen.keys()].sort((a, b) => a - b)
  let maxGapHours = 0
  for (let i = 1; i < sorted.length; i++) maxGapHours = Math.max(maxGapHours, (sorted[i] - sorted[i - 1]) / HOUR_MS)

  const fieldMissing = {}
  for (const field of LAND_FIELDS) fieldMissing[field] = inWindow.filter(({ row }) => !isNum(row[field])).length
  const marineMissing = inWindow.filter(({ row }) => !isNum(row.waveHeightM) && !isNum(row.swellWaveHeightM)).length

  const checks = [
    { id: "hourly_timestamps_valid", pass: invalidTimestamps === 0, detail: `${invalidTimestamps} unparseable hourly timestamps` },
    { id: "hourly_timestamps_unique", pass: duplicateTimestamps.length === 0, detail: duplicateTimestamps.length ? `duplicates: ${duplicateTimestamps.slice(0, 5).join(", ")}` : "unique" },
    { id: "hourly_on_hour_grid", pass: offGridTimestamps.length === 0, detail: offGridTimestamps.length ? `off-grid: ${offGridTimestamps.slice(0, 5).join(", ")}` : "aligned" },
    { id: "window_start_covered", pass: seen.has(gridStart), detail: `first grid hour ${iso(gridStart)}; first returned ${iso(sorted[0]) ?? "none"}` },
    { id: "window_end_covered", pass: seen.has(gridEnd), detail: `last grid hour ${iso(gridEnd)}; last returned ${iso(sorted[sorted.length - 1]) ?? "none"}` },
    { id: "no_missing_hours", pass: missingHours.length === 0, detail: missingHours.length ? `${missingHours.length}/${expectedHours} grid hours missing (first ${missingHours[0]}, last ${missingHours[missingHours.length - 1]})` : `${expectedHours}/${expectedHours}` },
    ...LAND_FIELDS.map(field => ({ id: `land_${field}_present`, pass: inWindow.length > 0 && fieldMissing[field] === 0, detail: `${fieldMissing[field]}/${inWindow.length} missing` })),
  ]
  if (requireMarine) {
    checks.push({ id: "marine_wave_or_swell_present", pass: inWindow.length > 0 && marineMissing === 0, detail: `${marineMissing}/${inWindow.length} missing wave+swell` })
  }
  const failed = checks.filter(c => !c.pass).map(c => c.id)
  return {
    window: { start: iso(startMs), end: iso(endMs), gridStart: iso(gridStart), gridEnd: iso(gridEnd), expectedHours },
    hourlyInWindow: inWindow.length,
    uniqueHourlyInWindow: seen.size,
    currentRows: currentRows.length,
    firstHourly: iso(sorted[0]),
    lastHourly: iso(sorted[sorted.length - 1]),
    maxGapHours,
    missingHoursCount: missingHours.length,
    missingHoursSample: missingHours.slice(0, 12),
    duplicateTimestamps,
    fieldMissing: { ...fieldMissing, marineWaveOrSwell: marineMissing },
    checks,
    failed,
    pass: failed.length === 0,
  }
}
