import { useQuery } from "@tanstack/react-query"
import type { HotItem, ShippingSnapshot } from "@shared/shipping"
import type { VoyageRecord } from "@shared/voyage"
import { myFetch } from "~/utils"

export type ShippingResponse = ShippingSnapshot & { hot: HotItem[], provider: { vessel: string, port: string, schedule: string, weather: string, weatherAlerts: "off" | "public" | "experimental", feed: string, calendar: string, aisArea?: "off" | "aisstream", calendarSourceIds?: string[] }, realProviders: { vessel: string, port: string, schedule: string, weather: string, weatherAlerts: string, aisArea: string, feed: string, calendar: string }, calendarAttribution?: string }

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

export function useLatestVoyage(vesselId: string) {
  return useQuery({
    queryKey: ["voyage", vesselId],
    queryFn: () => myFetch<VoyageRecord | null>(`/shipping/vessels/${encodeURIComponent(vesselId)}/voyage`),
    staleTime: 30_000,
    enabled: Boolean(vesselId),
  })
}
