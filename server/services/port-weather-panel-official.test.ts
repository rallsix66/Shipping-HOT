import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import type { FeedItem } from "@shared/shipping"
import { getPortWeatherPanel } from "./port-weather-panel"
import { ShippingRepository, initShippingTables } from "#/database/shipping"

function createRepository() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

const now = new Date("2026-10-10T04:00:00.000Z")

function alert(patch: Partial<FeedItem> = {}, weather: Record<string, unknown> = {}): FeedItem {
  return {
    id: "tmd-cap-001",
    sourceId: "tmd",
    category: "weather",
    type: "weather_alert",
    title: "Heavy rain warning",
    summary: "",
    sourceUrl: "https://www.tmd.go.th/en/api/xml/CAP",
    publishedAt: "2026-10-10T01:00:00.000Z",
    expiresAt: "2026-10-11T00:00:00.000Z",
    severity: "warning",
    eventEligibility: true,
    relatedPortIds: ["port-laem-chabang"],
    relatedVesselIds: [],
    stale: false,
    sourceStatus: "healthy",
    weather: { riskSource: "official", alertState: "active", alertId: "CAP-001", alertRegion: "Chon Buri", ...weather },
    ...patch,
  } as FeedItem
}

async function panelFor(items: FeedItem[]) {
  const { database, native } = createRepository()
  await initShippingTables(database, "mock")
  const repository = new ShippingRepository(database, "mock")
  try {
    return await getPortWeatherPanel(repository, "port-laem-chabang", items, "test", "alerts", { now })
  } finally {
    native.close()
  }
}

describe("port weather panel — officialAlertImpacts passthrough", () => {
  it("positive: a valid official alert for the port appears as a WR-O01 potential impact", async () => {
    const panel = await panelFor([alert()])
    expect(panel.officialAlertImpacts).toHaveLength(1)
    expect(panel.officialAlertImpacts[0]).toMatchObject({ ruleId: "WR-O01", status: "potential", provenance: "system", severity: "warning" })
    expect(panel.officialAlertImpacts[0].officialBasis).toMatchObject({ provenance: "official", sourceId: "tmd", alertId: "CAP-001" })
    // kept separate from model-rule impacts
    expect(panel.impacts.some(row => row.ruleId === "WR-O01")).toBe(false)
  })

  it.each([
    ["expired", alert({}, { alertState: "expired" })],
    ["lifecycle unknown", alert({}, { alertState: "unknown" })],
    ["missing from current index", alert({ eventEligibility: false })],
    ["stale", alert({ stale: true })],
    ["source degraded", alert({ sourceStatus: "degraded" })],
    ["past expiry", alert({ expiresAt: "2026-10-10T03:00:00.000Z" })],
    ["other port", alert({ relatedPortIds: ["port-manila"] })],
  ] as const)("negative: %s alert disappears from officialAlertImpacts", async (_label, item) => {
    const panel = await panelFor([item])
    expect(panel.officialAlertImpacts).toEqual([])
  })

  it("no alerts => empty array (never undefined)", async () => {
    const panel = await panelFor([])
    expect(panel.officialAlertImpacts).toEqual([])
  })
})
