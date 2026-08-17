import { useQuery } from "@tanstack/react-query"
import type { HotItem, ShippingSnapshot } from "@shared/shipping"
import { myFetch } from "~/utils"

export type ShippingResponse = ShippingSnapshot & { hot: HotItem[], provider: { vessel: string, port: string, schedule: string, weather: string, weatherAlerts: "off" | "public" | "experimental", feed: string, calendar: string, calendarSourceIds?: string[] }, realProviders: { vessel: string, port: string, schedule: string, weather: string, weatherAlerts: string, feed: string, calendar: string }, calendarAttribution?: string }

export function useShipping() {
  return useQuery({
    queryKey: ["shipping"],
    queryFn: () => myFetch<ShippingResponse>("/shipping"),
    staleTime: 10_000,
    refetchInterval: data => data.state.data ? data.state.data.settings.refreshInterval * 60 * 1000 : false,
  })
}
