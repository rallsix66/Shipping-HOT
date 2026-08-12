import type { FeedItem, Port, Vessel, Voyage } from "@shared/shipping"
import { mockFeedItems, mockPorts, mockVessels, mockVoyages } from "@shared/shipping-fixtures"

export interface VesselProvider { getVessels(): Promise<Vessel[]> }
export interface PortProvider { getPorts(): Promise<Port[]> }
export interface ScheduleProvider { getVoyages(): Promise<Voyage[]> }
export interface WeatherProvider { getFeedItems(): Promise<FeedItem[]> }

export const MockVesselProvider: VesselProvider = { async getVessels() { return structuredClone(mockVessels) } }
export const MockPortProvider: PortProvider = { async getPorts() { return structuredClone(mockPorts) } }
export const MockScheduleProvider: ScheduleProvider = { async getVoyages() { return structuredClone(mockVoyages) } }
export const MockWeatherProvider: WeatherProvider = { async getFeedItems() { return structuredClone(mockFeedItems) } }

export const realProviders = {
  vessel: "deferred",
  port: "deferred",
  schedule: "deferred",
  weather: "deferred",
} as const
