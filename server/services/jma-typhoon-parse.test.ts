import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  JMA_GALE_WARNING_LABEL_JP,
  crossCheckJmaSpecificationsAgainstForecast,
  jmaStormWarningLabelJp,
  parseJmaForecastJson,
  parseJmaSpecificationsJson,
  parseJmaTargetTcList,
} from "./jma-typhoon-parse"
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

describe("jma specifications wind-circle parse", () => {
  it("parses real-shaped gale/storm sectors and keeps dual units", () => {
    const payload = JSON.parse(readFileSync(join(fixtureDir, "TC2637-specifications.min.json"), "utf8"))
    const parsed = parseJmaSpecificationsJson(payload)
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.title.typhoonNumber).toBe("2631")
    expect(parsed.title.nameEn).toBe("In-fa")
    expect(parsed.title.issueUtc).toBe("2026-10-25T07:05:00Z")
    expect(parsed.rows).toHaveLength(2)

    const analysis = parsed.rows[0]!
    expect(analysis.advancedHours).toBe(0)
    expect(analysis.validtimeUtc).toBe("2026-10-25T06:00:00Z")
    expect(analysis.galeWarning.status).toBe("present")
    if (analysis.galeWarning.status === "present") {
      expect(analysis.galeWarning.sectors).toHaveLength(2)
      expect(analysis.galeWarning.sectors[0]).toMatchObject({
        area: { kind: "direction_string", value: "南西" },
        range: { km: 220, nm: 120 },
      })
    }
    expect(analysis.stormWarning.status).toBe("present")
    if (analysis.stormWarning.status === "present") {
      expect(analysis.stormWarning.sectors[0]?.area).toEqual({ kind: "bilingual", jp: "全域", en: "All" })
      expect(analysis.stormWarning.sectors[0]?.range).toMatchObject({ km: 75, nm: 40 })
    }
    expect(analysis.probabilityCircleRadius).toBeUndefined()
    expect(jmaStormWarningLabelJp(analysis.advancedHours)).toBe("25m/s以上の暴風域")
    expect(JMA_GALE_WARNING_LABEL_JP).toBe("15m/s以上の強風域")

    const forecast24 = parsed.rows[1]!
    expect(forecast24.galeWarning).toEqual({ status: "absent" })
    expect(forecast24.stormWarning.status).toBe("present")
    expect(forecast24.probabilityCircleRadius).toMatchObject({ km: 120, nm: 65 })
    expect(jmaStormWarningLabelJp(forecast24.advancedHours)).toBe("暴風警戒域")
  })

  it("treats legally absent gale/storm as absent, not zero and not total failure", () => {
    const payload = JSON.parse(readFileSync(join(fixtureDir, "TC2636-specifications.min.json"), "utf8"))
    const parsed = parseJmaSpecificationsJson(payload)
    expect(parsed.status).toBe("ok")
    if (parsed.status !== "ok") return
    expect(parsed.rows[0]?.galeWarning.status).toBe("present")
    expect(parsed.rows[0]?.stormWarning).toEqual({ status: "absent" })
    expect(parsed.rows[1]?.galeWarning).toEqual({ status: "absent" })
    expect(parsed.rows[1]?.stormWarning).toEqual({ status: "absent" })
    expect(parsed.rows[1]?.probabilityCircleRadius).toMatchObject({ km: 65, nm: 35 })
  })

  it("rejects bad types/null wind-circle fields without inventing radii", () => {
    expect(parseJmaSpecificationsJson(null).status).toBe("invalid")
    expect(parseJmaSpecificationsJson([]).status).toBe("invalid")
    const badType = parseJmaSpecificationsJson([
      { part: "title", typhoonNumber: "2631", name: { en: "In-fa" }, issue: { UTC: "2026-10-25T07:05:00Z" } },
      { part: { en: "Analysis" }, advancedHours: 0, galeWarning: "oops" },
    ])
    expect(badType.status).toBe("ok")
    if (badType.status === "ok") {
      expect(badType.rows[0]?.galeWarning).toMatchObject({ status: "invalid", reason: "galeWarning_not_array" })
      expect(badType.rows[0]?.stormWarning).toEqual({ status: "absent" })
    }

    const badNull = parseJmaSpecificationsJson([
      { part: "title", typhoonNumber: "2631", issue: { UTC: "2026-10-25T07:05:00Z" } },
      { part: { en: "Analysis" }, advancedHours: 0, stormWarning: null },
    ])
    expect(badNull.status).toBe("ok")
    if (badNull.status === "ok") {
      expect(badNull.rows[0]?.stormWarning).toMatchObject({ status: "invalid", reason: "stormWarning_null" })
    }

    const badRange = parseJmaSpecificationsJson([
      { part: "title", typhoonNumber: "2631", issue: { UTC: "2026-10-25T07:05:00Z" } },
      { part: { en: "Analysis" }, advancedHours: 0, galeWarning: [{ area: "北東", range: "120nm" }] },
    ])
    expect(badRange.status).toBe("ok")
    if (badRange.status === "ok") {
      expect(badRange.rows[0]?.galeWarning).toMatchObject({ status: "invalid", reason: "galeWarning_range_invalid" })
    }
  })

  it("cross-checks specifications identity against forecast parse", () => {
    const specsPayload = JSON.parse(readFileSync(join(fixtureDir, "TC2637-specifications.min.json"), "utf8"))
    const specs = parseJmaSpecificationsJson(specsPayload)
    expect(specs.status).toBe("ok")
    if (specs.status !== "ok") return
    const forecast = parseJmaForecastJson("TC2637", [
      { part: "title", typhoonNumber: "2631", name: { en: "In-fa", jp: "インファ" }, issue: { UTC: "2026-10-25T07:05:00Z" } },
      { part: { en: "Analysis" }, advancedHours: 0, validtime: { UTC: "2026-10-25T06:00:00Z" }, center: [12.2, 165.2] },
    ])!
    expect(crossCheckJmaSpecificationsAgainstForecast(specs, forecast)).toEqual({
      typhoonNumberMatch: true,
      nameEnMatch: true,
      nameJpMatch: true,
      issuedAtMatch: true,
    })
    expect(crossCheckJmaSpecificationsAgainstForecast(specs, { ...forecast, typhoonNumber: "9999", nameEn: "Other" })).toEqual({
      typhoonNumberMatch: false,
      nameEnMatch: false,
      nameJpMatch: true,
      issuedAtMatch: true,
    })
  })
})
