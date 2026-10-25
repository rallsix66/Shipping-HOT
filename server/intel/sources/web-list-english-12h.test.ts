import { describe, expect, it } from "vitest"
import { type WebListConfig, assertSupportedConfig } from "./config-keys"
import { fromHtml, parseLooseDate } from "./web-list"

const config: WebListConfig = { listSelector: "#notices", itemSelector: "li", publishedAtSelector: "time", calendar: "gregorian", dateFormat: "english_month_abbr_12h", dateRuleBasis: "MY-L01 2026-10-15 archived card time grammar, timezone/time role unknown; no source qualification or production configuration." }
const dates = [
  ["07 Oct 2026 06:30 pm", "2026-10-07"],
  ["22 Sep 2026 06:30 pm", "2026-09-22"],
  ["21 Sep 2026 04:00 pm", "2026-09-21"],
  ["09 Sep 2026 04:00 pm", "2026-09-09"],
  ["06 Sep 2026 06:30 pm", "2026-09-06"],
  ["03 Sep 2026 04:01 pm", "2026-09-03"],
  ["03 Sep 2026 04:00 pm", "2026-09-03"],
  ["06 Aug 2026 04:00 pm", "2026-08-06"],
  ["29 Jul 2026 04:00 pm", "2026-07-29"],
] as const

describe("explicit English abbreviated month / 12-hour local time", () => {
  it.each(dates)("parses the archived factual time %s without inventing an instant", (raw, localDate) => {
    expect(parseLooseDate(raw, config)).toEqual({ raw, rule: "configured_english_month_abbr_12h", basis: config.dateRuleBasis, calendar: "gregorian", precision: "minute", timezone: "missing", utcOffset: null, localDate, publishedAt: null })
  })
  it.each(["01 Jan 2026 12:00 am", "01 Jan 2026 12:00 pm", "29 Feb 2024 11:59 pm"])("retains valid boundary clock/date %s as local evidence", (raw) => {
    expect(parseLooseDate(raw, config)).toMatchObject({ raw, precision: "minute", timezone: "missing", publishedAt: null })
  })
  it.each(["07 Oct 2026 00:30 pm", "07 Oct 2026 13:30 pm", "07 Oct 2026 06:60 pm", "07 Oct 2026 06:30 PM", "07 October 2026 06:30 pm", "7 Oct 2026 06:30 pm", "07 Oct 2026 6:30 pm", "Published 07 Oct 2026 06:30 pm", "07 Oct 2026 06:30 pm UTC", "07 Oct 2026 06:30 pm +08:00", "(07 Oct 2026 06:30 pm)", "29 Feb 2025 06:30 pm", "31 Apr 2026 06:30 pm", "00 Oct 2026 06:30 pm", "07 Oct 1899 06:30 pm"])("leaves unsupported or invalid %s unknown", (raw) => {
    expect(parseLooseDate(raw, config)).toMatchObject({ raw, localDate: null, precision: "unknown", timezone: "missing", publishedAt: null })
  })
  it("requires explicit opt-in and forbids unproved timezone or calendar overrides", () => {
    const raw = dates[0][0]
    expect(parseLooseDate(raw, { ...config, dateFormat: undefined })).toMatchObject({ rule: "unsupported_format", precision: "unknown" })
    for (const extra of [{ publishedAtUtcOffset: "+08:00" }, { calendar: "buddhist" as const }]) {
      expect(() => assertSupportedConfig({ ...config, ...extra })).toThrow()
      expect(parseLooseDate(raw, { ...config, ...extra })).toMatchObject({ precision: "unknown", publishedAt: null })
    }
    expect(() => assertSupportedConfig(config)).not.toThrow()
  })
  it("continues rejecting cards with no article href", () => {
    const html = `<ul id="notices"><li><a>Original synthetic notice</a><time>${dates[0][0]}</time></li></ul>`
    expect(() => fromHtml(html, "https://www.pos.com.my/service-update", config, { sourceId: "test", status: "allowed", fetchAllowed: true, persistence: "disallowed", allowedHosts: ["www.pos.com.my"], allowedContentTypes: ["text/html"] })).toThrow("web_list_invalid_link")
  })
})
