import { useQuery } from "@tanstack/react-query"
import type { FeedItemDisplay, HotItem, ShippingSnapshot } from "@shared/shipping"
import type { VoyageRecord } from "@shared/voyage"
import { myFetch } from "~/utils"

export interface ShippingResponse extends Omit<ShippingSnapshot, "feedItems"> {
  feedItems: FeedItemDisplay[]
  hot: HotItem[]
  provider: { vessel: string, port: string, schedule: string, weather: string, weatherAlerts: "off" | "public" | "experimental", feed: string, calendar: string, aisArea?: "off" | "aisstream", calendarSourceIds?: string[] }
  realProviders: { vessel: string, port: string, schedule: string, weather: string, weatherAlerts: string, aisArea: string, feed: string, calendar: string }
  calendarAttribution?: string
}

export interface AisLatestPosition {
  vesselId: string
  mmsi: string
  latitude: number
  longitude: number
  speed?: number
  course?: number
  heading?: number
  navigationStatus?: string
  timestamp: string
  source: string
  sourceType: "real" | "mock" | "imported" | "derived"
  stale: boolean
  sourceStatus: "healthy" | "degraded" | "failed" | "never_succeeded" | "disabled"
  errorCode?: string
  lastProviderSuccessAt?: string
  lastProviderFailureAt?: string
}

export interface TranslationStatusResponse {
  enabled: boolean
  providerId: "deepseek"
  model: "deepseek-v4-flash"
  targetLanguage: string
  configured: boolean
  secretSource: "environment" | "file" | "missing"
  maskedLast4?: string
  monthlyBudget: number
  estimatedMonthSpend: number
  currency: string
  cache: { total: number, succeeded: number, pending: number, failed: number }
  usage: { requestCount: number, successCount: number, failureCount: number, cacheHitCount: number, estimatedCost: number, currency: string }
  lastCallAt?: string
  lastErrorCode?: string
  state: "disabled" | "budget_zero" | "budget_exhausted" | "secret_missing" | "provider_blocked" | "ready"
  gateCode?: string
  providerBlockCode?: string
}

export interface TranslationSecretResponse {
  providerId: "deepseek"
  configured: boolean
  source: "environment" | "file" | "missing"
  maskedLast4?: string
}

export interface TranslationTestResponse {
  ok: boolean
  providerId: "deepseek"
  model: "deepseek-v4-flash"
  cacheHit: boolean
  diagnosticMode: boolean
  providerCalled: boolean
  errorCode?: string
}

export function useShipping() {
  return useQuery({
    queryKey: ["shipping"],
    queryFn: () => myFetch<ShippingResponse>("/shipping"),
    staleTime: 10_000,
    refetchInterval: data => data.state.data ? data.state.data.settings.refreshInterval * 60 * 1000 : false,
  })
}

export function useAisLatestPosition(vesselId: string) {
  return useQuery({
    queryKey: ["ais-position", vesselId],
    queryFn: () => myFetch<AisLatestPosition | null>(`/shipping/vessels/${encodeURIComponent(vesselId)}/position`),
    staleTime: 30_000,
    enabled: Boolean(vesselId),
  })
}

export function useTranslationStatus() {
  return useQuery({
    queryKey: ["translation-status"],
    queryFn: () => myFetch<TranslationStatusResponse>("/shipping/translation/status"),
    staleTime: 10_000,
  })
}

export function useTranslationSecret() {
  return useQuery({
    queryKey: ["translation-secret"],
    queryFn: () => myFetch<TranslationSecretResponse>("/shipping/translation/secret"),
    staleTime: 10_000,
  })
}

export function useLatestVoyage(vesselId: string) {
  return useQuery({
    queryKey: ["voyage", vesselId],
    queryFn: () => myFetch<VoyageRecord | null>(`/shipping/vessels/${encodeURIComponent(vesselId)}/voyage`),
    staleTime: 30_000,
    enabled: Boolean(vesselId),
  })
}
