import type { SourceLineage } from "@shared/shipping"

export const AIS_TRACKING_CAPABILITY = "ais_tracking"

export interface AisTrackingVessel {
  vesselId: string
  mmsi: string
}

export interface AisPosition {
  id?: string
  vesselId?: string
  mmsi: string
  latitude: number
  longitude: number
  speed?: number
  course?: number
  heading?: number
  navigationStatus?: string
  timestamp: string
  source: string
  sourceType: SourceLineage
}

export interface AisTrackingProvider {
  readonly providerId: string
  subscribe: (vessels: readonly AisTrackingVessel[]) => Promise<void>
  unsubscribe: (vessels: readonly AisTrackingVessel[]) => Promise<void>
  getLatestPositions: (vessels: readonly AisTrackingVessel[]) => Promise<readonly AisPosition[]>
}

export interface AisLiveStreamCallbacks {
  onPosition: (position: AisPosition) => void | Promise<void>
  onSubscriptionConfirmed?: () => void | Promise<void>
  onError?: (error: Error) => void | Promise<void>
  onClose?: (error?: Error) => void | Promise<void>
}

export interface AisLiveStreamOptions {
  vessels: readonly AisTrackingVessel[]
  callbacks: AisLiveStreamCallbacks
}

export interface AisLiveStreamHandle {
  readonly socketCount: number
  readonly confirmedSocketCount: number
  close: () => Promise<void>
}

export interface AisLiveStreamProvider {
  readonly providerId: string
  openStream: (options: AisLiveStreamOptions) => Promise<AisLiveStreamHandle>
}
