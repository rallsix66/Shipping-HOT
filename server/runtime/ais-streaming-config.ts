import process from "node:process"
import type { ShippingDataMode } from "#/database/runtime"

export const AIS_LIVE_WATCHLIST_REFRESH_DEFAULT_SECONDS = 30
export const AIS_LIVE_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const
export const AIS_LIVE_RATE_LIMIT_RECONNECT_DELAY_MS = 60_000

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getConfiguredAisWatchlistRefreshSeconds(environment: NodeJS.ProcessEnv = process.env): number {
  return positiveNumber(environment.SHIPPING_AIS_WATCHLIST_REFRESH_SECONDS, AIS_LIVE_WATCHLIST_REFRESH_DEFAULT_SECONDS)
}

export function isAisStreamingEnabled(dataMode: ShippingDataMode, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (dataMode !== "real") return false
  const providerId = environment.SHIPPING_AIS_PROVIDER?.trim().toLowerCase()
    || environment.SHIPPING_VESSEL_PROVIDER?.trim().toLowerCase()
    || "mock"
  if (providerId !== "aisstream") return false
  if (environment.SHIPPING_RUNTIME_ENABLED?.trim().toLowerCase() === "false") return false
  return environment.SHIPPING_AIS_STREAMING_ENABLED?.trim().toLowerCase() !== "false"
}
