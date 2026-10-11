import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseJmaForecastJson, parseJmaTargetTcList } from "./jma-typhoon-parse"
import { cycloneVisibleToPorts, minTyphoonDistanceKmForPort } from "./tropical-cyclone-display"

const fixtureDir = join(process.cwd(), "server/fixtures/jma")

describe("jma typhoon parse and display", () => {
  it("parses targetTc list", () => {
    const payload = JSON.parse(readFileSync(join(fixtureDir, "targetTc-multi.json"), "utf8"))
    expect(parseJmaTargetTcList(payload)).toHaveLength(2)
  })

  it("parses forecast.json track and centers", () => {
    const payload = JSON.parse(readFileSync(join(fixtureDir, "TC2634-forecast.sample.json"), "utf8"))
    const parsed = parseJmaForecastJson("TC2634", payload)
    expect(parsed?.trackHistory.length).toBeGreaterThan(0)
    expect(parsed?.forecast.length).toBeGreaterThan(0)
    expect(parsed?.current?.at).toBe("2026-10-10T00:00:00Z")
    expect(parsed?.trackHistory.every(point => point.at === undefined)).toBe(true)
  })

  it("filters display by 1000 km port proximity and computes WR-S03 distance", () => {
    const payload = JSON.parse(readFileSync(join(fixtureDir, "TC2634-forecast.sample.json"), "utf8"))
    const cyclone = parseJmaForecastJson("TC2634", payload)!
    const shekou = { portId: "port-shekou", unlocode: "CNSHK", latitude: 22.48, longitude: 113.91 }
    expect(cycloneVisibleToPorts(cyclone, [shekou])).toBe(false)
    const distance = minTyphoonDistanceKmForPort([cyclone], shekou, false)
    expect(distance).toBeGreaterThan(300)
  })
})
