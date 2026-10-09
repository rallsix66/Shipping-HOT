import { describe, expect, it } from "vitest"
import { mockPorts } from "@shared/shipping-fixtures"
import { configureProviders, createOperationalSourceContext, disabledProviderData, providerResult, toProviderResult } from "./shipping"

describe("shipping providers", () => {
  it("defaults to mock port and weather providers in development mode", () => {
    const configured = configureProviders({ SHIPPING_DATA_MODE: "mock" })
    expect(configured.modes.port).toBe("mock")
    expect(configured.modes.weather).toBe("mock")
    expect(configured.modes.feed).toBe("mock")
  })

  it("marks real mode port and weather as unavailable without explicit providers", () => {
    const configured = configureProviders({ SHIPPING_DATA_MODE: "real" })
    expect(configured.modes.port).toBe("unavailable")
    expect(configured.modes.weather).toBe("unavailable")
  })

  it("builds operational source context from configured modes", () => {
    const configured = configureProviders({ SHIPPING_DATA_MODE: "mock" })
    const context = createOperationalSourceContext(configured.modes)
    expect(context.activeSourceIds.has("mock-port")).toBe(true)
    expect(context.activeSourceIds.has("mock-weather")).toBe(true)
  })

  it("wraps provider failures as stale last-known data", async () => {
    const lastKnown = [{ id: "port-shekou", stale: false, sourceStatus: "healthy" as const }]
    const failed = providerResult({ status: "rejected", reason: new Error("provider down") }, lastKnown)
    expect(failed[0]).toMatchObject({ stale: true, sourceStatus: "failed" })
  })

  it("returns disabled provider data without errors", () => {
    const disabled = disabledProviderData(mockPorts)
    expect(disabled.every(item => item.sourceStatus === "disabled")).toBe(true)
  })

  it("builds provider results with freshness metadata", () => {
    const healthyPorts = mockPorts.filter(port => port.sourceStatus === "healthy" && !port.stale)
    const result = toProviderResult(healthyPorts, { sourceType: "mock", dataNature: "derived", sourceId: "mock-port" })
    expect(result.data).toHaveLength(healthyPorts.length)
    expect(result.freshness.sourceStatus).toBe("healthy")
  })
})
