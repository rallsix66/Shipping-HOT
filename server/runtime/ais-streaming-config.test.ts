import { describe, expect, it } from "vitest"
import { getConfiguredAisWatchlistRefreshSeconds, isAisStreamingEnabled } from "#/runtime/ais-streaming-config"

describe("aIS streaming configuration", () => {
  it("accepts a positive finite watchlist refresh interval", () => {
    expect(getConfiguredAisWatchlistRefreshSeconds({ SHIPPING_AIS_WATCHLIST_REFRESH_SECONDS: "45" })).toBe(45)
  })

  it.each(["0", "-1", "abc", "Infinity", ""])("falls back for invalid watchlist refresh value %s", (value) => {
    expect(getConfiguredAisWatchlistRefreshSeconds({ SHIPPING_AIS_WATCHLIST_REFRESH_SECONDS: value })).toBe(30)
  })

  it("enables streaming only for Real AISStream runtime by default", () => {
    expect(isAisStreamingEnabled("real", { SHIPPING_AIS_PROVIDER: "aisstream", SHIPPING_RUNTIME_ENABLED: "true" })).toBe(true)
    expect(isAisStreamingEnabled("mock", { SHIPPING_AIS_PROVIDER: "aisstream" })).toBe(false)
    expect(isAisStreamingEnabled("real", { SHIPPING_AIS_PROVIDER: "aisstream", SHIPPING_AIS_STREAMING_ENABLED: "false" })).toBe(false)
    expect(isAisStreamingEnabled("real", { SHIPPING_AIS_PROVIDER: "aisstream", SHIPPING_RUNTIME_ENABLED: "false" })).toBe(false)
  })
})
