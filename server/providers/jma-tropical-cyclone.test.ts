import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { syncJmaTropicalCyclones } from "./jma-tropical-cyclone"

const fixtureDir = join(process.cwd(), "server/fixtures/jma")

describe("syncJmaTropicalCyclones", () => {
  it("returns ok_empty when target list is empty", async () => {
    const empty = readFileSync(join(fixtureDir, "targetTc-empty.json"), "utf8")
    const result = await syncJmaTropicalCyclones(async (url) => {
      if (url.includes("targetTc")) {
        return new Response(empty, { status: 200 })
      }
      return new Response("{}", { status: 404 })
    }, new Date("2026-08-15T12:00:00.000Z"))
    expect(result.outcome).toBe("ok_empty")
  })

  it("loads multi-cyclone fixtures", async () => {
    const list = readFileSync(join(fixtureDir, "targetTc-multi.json"), "utf8")
    const forecast = readFileSync(join(fixtureDir, "TC2634-forecast.sample.json"), "utf8")
    const result = await syncJmaTropicalCyclones(async (url) => {
      if (url.includes("targetTc")) return new Response(list, { status: 200 })
      if (url.includes("TC2634")) return new Response(forecast, { status: 200 })
      return new Response("{}", { status: 404 })
    }, new Date("2026-08-15T12:00:00.000Z"))
    expect(result.outcome).toBe("partial")
    if (result.outcome !== "failed") {
      expect(result.cyclones.length).toBe(1)
      expect(result.failedTcIds).toContain("TC2635")
    }
  })

  it("returns partial with listInvalidCount when list mixes valid and invalid elements", async () => {
    const payload = JSON.stringify([
      { tropicalCyclone: "TC2634" },
      { bad: true },
    ])
    const forecast = readFileSync(join(fixtureDir, "TC2634-forecast.sample.json"), "utf8")
    const result = await syncJmaTropicalCyclones(async (url) => {
      if (url.includes("targetTc")) return new Response(payload, { status: 200 })
      if (url.includes("TC2634")) return new Response(forecast, { status: 200 })
      return new Response("{}", { status: 404 })
    }, new Date("2026-08-15T12:00:00.000Z"))
    expect(result.outcome).toBe("partial")
    if (result.outcome !== "failed") {
      expect(result.listInvalidCount).toBe(1)
      expect(result.cyclones.length).toBe(1)
    }
  })

  it("returns partial (not ok_empty) when every detail fetch fails", async () => {
    const list = readFileSync(join(fixtureDir, "targetTc-multi.json"), "utf8")
    const result = await syncJmaTropicalCyclones(async (url) => {
      if (url.includes("targetTc")) return new Response(list, { status: 200 })
      return new Response("{}", { status: 404 })
    }, new Date("2026-08-15T12:00:00.000Z"))
    expect(result.outcome).toBe("partial")
    if (result.outcome !== "failed") {
      expect(result.cyclones).toHaveLength(0)
    }
  })

  it("surfaces failed outcome on HTTP error", async () => {
    const result = await syncJmaTropicalCyclones(async () => new Response("", { status: 503 }), new Date("2026-08-15T12:00:00.000Z"))
    expect(result.outcome).toBe("failed")
  })
})
