import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CalendarEvent, CalendarProviderResult } from "@shared/calendar"
import { calendarEventLegacyId } from "@shared/calendar"
import type { ShippingEvent, ShippingSnapshot } from "@shared/shipping"
import { createMockSnapshot } from "@shared/shipping-fixtures"
import { createMockCalendarEvents } from "#/providers/calendar"

interface TestState extends ShippingSnapshot {
  deletedCalendarIds: string[]
  upsertedCalendarEvents: CalendarEvent[]
  upsertedEvents: ShippingEvent[]
}

let state: TestState
let calendarResult: CalendarProviderResult
let databaseAvailable = true

class FakeRepository {
  constructor(_database: unknown) {}

  async isEmpty() {
    return false
  }

  async getSettings() {
    return structuredClone(state.settings)
  }

  async listVessels() {
    return structuredClone(state.vessels)
  }

  async listPorts() {
    return structuredClone(state.ports)
  }

  async listVoyages() {
    return structuredClone(state.voyages)
  }

  async listFeedItems() {
    return structuredClone(state.feedItems)
  }

  async listCalendarEvents() {
    return structuredClone(state.calendarEvents ?? [])
  }

  async listEvents(_sources?: unknown) {
    return structuredClone(state.events)
  }

  async deleteCalendarEvents(ids: string[]) {
    state.deletedCalendarIds.push(...ids)
    state.calendarEvents = (state.calendarEvents ?? []).filter(event => !ids.includes(event.id))
  }

  async upsertCalendarEvent(event: CalendarEvent) {
    state.upsertedCalendarEvents.push(structuredClone(event))
    state.calendarEvents = [...(state.calendarEvents ?? []).filter(item => item.id !== event.id), structuredClone(event)]
  }

  async upsertEvent(event: ShippingEvent) {
    state.upsertedEvents.push(structuredClone(event))
    state.events = [...state.events.filter(item => item.id !== event.id), structuredClone(event)]
  }

  async saveSettings(settings: ShippingSnapshot["settings"]) {
    state.settings = structuredClone(settings)
  }
}

function realOperationalSnapshot(): ShippingSnapshot {
  const snapshot = createMockSnapshot()
  return {
    ...snapshot,
    vessels: snapshot.vessels.map(vessel => ({ ...vessel, provenance: { sourceType: "third_party", dataNature: "observed", sourceId: "aisstream" } })),
    ports: snapshot.ports.map(port => ({ ...port, congestionLevel: undefined, provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "portcast-public" } })),
    feedItems: snapshot.feedItems.map(item => ({ ...item, severity: "info" as const, eventEligibility: false, provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "the-loadstar" } })),
    events: [],
    calendarEvents: [],
    calendarCoverage: [],
    settings: { ...snapshot.settings, calendarSync: [] },
  }
}

function calendarificEvent(scope: CalendarEvent["scope"], id: string): CalendarEvent {
  const [fixture] = createMockCalendarEvents(2026, "2026-08-18T00:00:00.000Z")
  return {
    ...fixture,
    id,
    countryCode: "MY",
    name: "Local Founders Day",
    date: "2026-08-22",
    scope,
    subdivisionCode: scope === "subdivision" ? "my-03" : undefined,
    subdivisionCodes: scope === "subdivision" ? ["my-03"] : undefined,
    scopeLabel: scope === "subdivision" ? "MY-03" : undefined,
    sourceId: "calendarific",
    sourceKind: "third_party",
    provenance: { sourceType: "third_party", dataNature: "reported", sourceId: "calendarific" },
  }
}

function installStoreMocks() {
  vi.stubGlobal("useDatabase", () => {
    if (!databaseAvailable) throw new Error("database unavailable")
    return {}
  })
  vi.doMock("#/database/shipping", () => ({ ShippingRepository: FakeRepository, initShippingTables: async () => undefined }))
  vi.doMock("#/providers/shipping", async () => {
    const actual = await vi.importActual<typeof import("#/providers/shipping")>("#/providers/shipping")
    const modes = { ...actual.providerModes, vessel: "aisstream", port: "portcast", weather: "open-meteo", feed: "public", calendar: "calendarific", calendarSourceIds: ["calendarific"] }
    return {
      ...actual,
      providerModes: modes,
      operationalSourceContext: actual.createOperationalSourceContext(modes),
      providers: { ...actual.providers, calendar: { getEvents: async () => structuredClone(calendarResult) } },
    }
  })
}

describe("calendar sync persisted baseline", () => {
  beforeEach(() => {
    state = { ...realOperationalSnapshot(), deletedCalendarIds: [], upsertedCalendarEvents: [], upsertedEvents: [] }
    calendarResult = { events: [], coverage: [], fetchedAt: "2026-08-18T00:00:00.000Z" }
    databaseAvailable = true
    installStoreMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock("#/database/shipping")
    vi.doUnmock("#/providers/shipping")
    vi.resetModules()
  })

  it("migrates a persisted legacy local fact after a process-like restart", async () => {
    const scoped = calendarificEvent("subdivision", "new-scoped-id")
    const legacy = { ...scoped, id: calendarEventLegacyId(scoped, "calendarific"), scope: undefined, subdivisionCode: undefined, subdivisionCodes: undefined, scopeLabel: undefined }
    const historicalEvent = {
      ...createMockSnapshot().events[0],
      id: "legacy-shipping-event",
      type: "calendar_reminder",
      title: "Legacy local reminder",
      dedupeKey: `calendar:${legacy.id}:7`,
      calendarEventId: legacy.id,
      provenance: { sourceType: "third_party" as const, dataNature: "reported" as const, sourceId: "calendarific" },
    }
    state.calendarEvents = [legacy]
    state.calendarCoverage = [{ countryCode: "MY", year: 2026, sourceId: "calendarific", status: "partial", lastCheckedAt: "2026-08-18T00:00:00.000Z" }]
    state.settings.calendarSync = state.calendarCoverage
    state.events = [historicalEvent]
    calendarResult = {
      events: [scoped],
      coverage: [{ countryCode: "MY", year: 2026, sourceId: "calendarific", status: "partial", lastCheckedAt: "2026-08-18T00:00:00.000Z" }],
      fetchedAt: "2026-08-18T00:00:00.000Z",
    }

    const { syncCalendarEvents } = await import("./shipping-store")
    await syncCalendarEvents(2026, ["MY"])

    expect(state.deletedCalendarIds).toEqual([legacy.id])
    expect(state.upsertedCalendarEvents.map(event => event.id)).toEqual([scoped.id])
    expect(state.calendarEvents).toEqual([scoped])
    expect(state.events.find(event => event.id === historicalEvent.id)).toEqual(historicalEvent)
    expect(state.events.find(event => event.id === historicalEvent.id)?.resolvedAt).toBeUndefined()
    expect(state.upsertedEvents.some(event => event.calendarEventId === legacy.id)).toBe(false)
    expect(state.upsertedEvents.every(event => event.provenance?.sourceId === "mock-schedule")).toBe(true)
  })

  it("filters mixed persisted sources at the operational Event boundary while retaining history", async () => {
    const persistedFixture = createMockSnapshot()
    const mockVessel = { ...persistedFixture.vessels[0], id: "historical-mock-vessel", navigationStatus: "anchored" as const, statusChangedAt: "2026-08-17T00:00:00.000Z", provenance: { sourceType: "mock" as const, dataNature: "observed" as const, sourceId: "mock-vessel" } }
    const mockPort = { ...persistedFixture.ports[0], id: "historical-mock-port", congestionLevel: "critical" as const, provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-port" } }
    const mockNotice = { ...(persistedFixture.feedItems.find(item => item.provenance?.sourceId === "mock-port-notice") ?? persistedFixture.feedItems[0]), id: "historical-mock-notice", severity: "critical" as const, eventEligibility: true, publicationTimeKnown: true, provenance: { sourceType: "mock" as const, dataNature: "reported" as const, sourceId: "mock-port-notice" } }
    const mockWeather = { ...(persistedFixture.feedItems.find(item => item.provenance?.sourceId === "mock-weather") ?? persistedFixture.feedItems[0]), id: "historical-mock-weather", severity: "critical" as const, eventEligibility: true, publicationTimeKnown: true, provenance: { sourceType: "mock" as const, dataNature: "forecast" as const, sourceId: "mock-weather" } }
    const mockCalendar = { ...createMockCalendarEvents(2026, "2026-08-18T00:00:00.000Z")[0], id: "historical-mock-calendar" }
    const realVessel = { ...state.vessels[0], navigationStatus: "anchored" as const, statusChangedAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", fetchedAt: "2026-08-18T00:00:00.000Z", stale: false, sourceStatus: "healthy" as const }
    const historicalMockVesselEvent = { ...persistedFixture.events[0], id: "historical-mock-vessel-event", type: "vessel_anchored", vesselId: mockVessel.id, dedupeKey: `vessel_anchored:${mockVessel.id}:mock-vessel`, provenance: { sourceType: "mock" as const, dataNature: "derived" as const, sourceId: "mock-vessel" } }
    const historicalMockFeedEvent = { ...persistedFixture.events[0], id: "historical-mock-feed-event", type: "shipping_notice", feedItemId: mockNotice.id, dedupeKey: `feed:${mockNotice.id}`, provenance: { sourceType: "mock" as const, dataNature: "reported" as const, sourceId: "mock-port-notice" } }
    const activeRealEvent = { ...persistedFixture.events[0], id: "active-real-vessel-event", type: "vessel_anchored", vesselId: realVessel.id, dedupeKey: `vessel_anchored:${realVessel.id}:aisstream`, provenance: { sourceType: "third_party" as const, dataNature: "derived" as const, sourceId: "aisstream" } }
    state.vessels = [...state.vessels.map(item => item.id === realVessel.id ? realVessel : item), mockVessel]
    state.ports = [...state.ports, mockPort]
    state.feedItems = [...state.feedItems, mockNotice, mockWeather]
    state.calendarEvents = [mockCalendar]
    state.events = [historicalMockVesselEvent, historicalMockFeedEvent, activeRealEvent]
    const national = { ...calendarificEvent("national", "national-id"), name: "National Day", date: "2026-08-25", businessImpact: "medium" as const }
    calendarResult = {
      events: [national],
      coverage: [{ countryCode: "MY", year: 2026, sourceId: "calendarific", status: "partial", lastCheckedAt: "2026-08-18T00:00:00.000Z" }],
      fetchedAt: "2026-08-18T00:00:00.000Z",
    }

    const { syncCalendarEvents } = await import("./shipping-store")
    await syncCalendarEvents(2026, ["MY"])

    expect(state.vessels.some(item => item.id === mockVessel.id)).toBe(true)
    expect(state.ports.some(item => item.id === mockPort.id)).toBe(true)
    expect(state.feedItems.some(item => item.id === mockNotice.id)).toBe(true)
    expect(state.feedItems.some(item => item.id === mockWeather.id)).toBe(true)
    expect(state.calendarEvents?.some(item => item.id === mockCalendar.id)).toBe(true)
    expect(state.events.some(event => event.id === historicalMockVesselEvent.id)).toBe(true)
    expect(state.events.some(event => event.id === historicalMockFeedEvent.id)).toBe(true)
    expect(state.events.find(event => event.id === historicalMockVesselEvent.id)?.resolvedAt).toBeUndefined()
    expect(state.upsertedEvents.some(event => event.id === activeRealEvent.id)).toBe(true)
    expect(state.upsertedEvents.length).toBeGreaterThan(0)
    expect(state.upsertedEvents.every(event => event.provenance?.sourceId !== "mock-vessel" && event.provenance?.sourceId !== "mock-port" && event.provenance?.sourceId !== "mock-port-notice" && event.provenance?.sourceId !== "mock-weather" && event.provenance?.sourceId !== "mock-calendar")).toBe(true)
    expect(state.upsertedEvents.some(event => event.provenance?.sourceId === "mock-schedule")).toBe(true)
    expect(state.upsertedEvents.some(event => event.provenance?.sourceId === "calendarific")).toBe(true)
  })

  it("keeps the memory fallback path working when Repository is unavailable", async () => {
    databaseAvailable = false
    const national = { ...calendarificEvent("national", "memory-national-id"), name: "National Day", date: "2026-08-25", businessImpact: "medium" as const }
    calendarResult = { events: [national], coverage: [{ countryCode: "MY", year: 2026, sourceId: "calendarific", status: "partial" }], fetchedAt: "2026-08-18T00:00:00.000Z" }

    const { syncCalendarEvents } = await import("./shipping-store")
    await expect(syncCalendarEvents(2026, ["MY"])).resolves.toMatchObject({ events: [national] })
  })
})
