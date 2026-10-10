import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseJtwcFixtureRss } from "./jtwc-typhoon-fixture"

describe("jtwc typhoon fixture parser", () => {
  it("parses fixture RSS without enabling runtime provider", () => {
    const xml = readFileSync(join(process.cwd(), "server/fixtures/jtwc/sample.rss"), "utf8")
    const items = parseJtwcFixtureRss(xml)
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toContain("FIXTURE STORM")
  })
})
