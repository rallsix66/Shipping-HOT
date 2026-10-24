import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { intelSourceSeeds } from "../sources"
import { sourcePolicy } from "../collect"
import { htmlIndexCandidates } from "./html-index-candidates"
import { assertSupportedConfig } from "./config-keys"
import { fromHtml, parseLooseDate } from "./web-list"
import { assertJsonListConfig } from "./json-list"

import { CUSTOMS_SYNTHETIC, NORTHPORT_SYNTHETIC } from "./__fixtures__/html-index-synthetic"

const northport = htmlIndexCandidates[0]
const customs = htmlIndexCandidates[1]

describe("disabled HTML index configurations and synthetic regressions", () => {
  it("uses exact catalog URLs without joining active seeds or granting body persistence", () => {
    const catalog = readFileSync("docs/intel-source-catalog.md", "utf8")
    for (const seed of htmlIndexCandidates) {
      const rows = catalog.split(/\r?\n/).filter(line => line.startsWith(`| ${seed.catalogId} |`))
      expect(rows).toHaveLength(1)
      const cells = rows[0].split("|").map(cell => cell.trim())
      if (seed.catalogId === "XX-K03") {
        expect(cells[4]).toBe(`${seed.url} ；越南站 https://sitcline.vn/`)
      } else if (seed.catalogId === "CN-T01") {
        expect(cells[4]).toBe("http://www.mofcom.gov.cn/zcfb/index.html")
        expect(seed.url).toBe("https://www.mofcom.gov.cn/zcfb/index.html")
        expect(new URL(seed.url).host + new URL(seed.url).pathname).toBe(new URL(cells[4]).host + new URL(cells[4]).pathname)
      } else {
        expect(cells[4]).toBe(seed.url)
      }
      expect(cells[5]).toBe("web_list")
      expect(seed).toMatchObject({ enabled: false, persistence: "disallowed" })
      expect(intelSourceSeeds.some(active => active.catalogId === seed.catalogId)).toBe(false)
      expect(seed.allowedHosts).toEqual([new URL(seed.url).hostname])
      if (seed.catalogId === "XX-K02") {
        expect(seed.kind).toBe("json_list")
        assertJsonListConfig(seed.jsonList)
        expect(seed.jsonList?.htmlScriptSelector).toBe("script#__NEXT_DATA__")
        expect(seed.jsonList?.publishedAtUtcOffset).toBeUndefined()
      } else {
        expect(seed.kind).toBe("web_list")
        assertSupportedConfig(seed.webList)
        expect(seed.webList?.publishedAtUtcOffset).toBeUndefined()
      }
    }
  })
  it("keeps ONE's verified inert-HTML mapping unchanged while adopting its approved catalog URL", () => {
    const saved = JSON.parse(readFileSync("docs/evidence/r2-one-newsroom-replay-final-2026-10-15/candidate-config.json", "utf8")).seed
    const one = htmlIndexCandidates.find(seed => seed.catalogId === "XX-K02")!
    expect({ ...one, name: saved.name }).toEqual(saved)
    expect(one.webList).toBeUndefined()
    expect(one.allowedContentTypes).toEqual(["text/html", "application/xhtml+xml"])
    expect(one.url).toBe("https://www.one-line.com/en/newsroom")
  })
  it("maps each synthetic Northport link's own leading date and title, excluding navigation", () => {
    const entries = fromHtml(NORTHPORT_SYNTHETIC, northport.url, northport.webList!, sourcePolicy(northport))
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ title: "Synthetic operating notice", canonicalUrl: "https://www.northport.com.my/np/docs/Announcements/2026/one.pdf", publishedAt: undefined, dateEvidence: { raw: "6-10-2026", localDate: "2026-10-06", precision: "day", timezone: "missing", publishedAt: null, calendar: "gregorian", rule: "configured_dmy_dash" } })
    expect(entries[1].dateEvidence.localDate).toBe("2024-02-29")
    expect(entries[2]).toMatchObject({ title: "10-2024 Synthetic month-only notice", dateEvidence: { raw: null, localDate: null, precision: "unknown" } })
  })
  it("maps a synthetic Thai row's title/link/date columns and preserves business query identities", () => {
    const entries = fromHtml(CUSTOMS_SYNTHETIC, customs.url, customs.webList!, sourcePolicy(customs))
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ title: "Synthetic Thai notice one", canonicalUrl: "https://www.customs.go.th/cont_strc_simple_with_date.php?current_id=first&lang=th", dateEvidence: { raw: "13 ตุลาคม 2569", localDate: "2026-10-13", precision: "day", timezone: "missing", publishedAt: null, calendar: "buddhist", rule: "configured_thai_month_name_buddhist_minus_543" } })
    expect(entries[1].dateEvidence.localDate).toBe("2024-02-29")
  })
  it.each(["29-2-2025", "31-4-2026", "0-10-2026", "1-13-2026", "1-2/2026", "6-10-26", "6-10-2026 trailing", "29-2-1900"])("rejects invalid DMY %s without an instant", (raw) => {
    expect(parseLooseDate(raw, northport.webList!).localDate).toBeNull()
  })
  it("keeps dash DMY opt-in, Gregorian leap centuries and raw date evidence", () => {
    expect(parseLooseDate("29-2-2000", northport.webList!).localDate).toBe("2000-02-29")
    expect(parseLooseDate("6-10-2026", { ...northport.webList!, dateOrder: undefined })).toMatchObject({ raw: "6-10-2026", rule: "date_order_missing", localDate: null })
  })
  it.each(["29 กุมภาพันธ์ 2568", "31 เมษายน 2569", "13 เดือนผิด 2569", "13 ตุลาคม 69", "Published 13 ตุลาคม 2569", "13 ตุลาคม 2569 09:30", "97 ตุลาคม 2569"])("rejects Thai invalid/unsupported text %s", (raw) => {
    expect(parseLooseDate(raw, customs.webList!).localDate).toBeNull()
  })
  it("requires the configured Thai grammar and calendar, never inferring it from country", () => {
    expect(parseLooseDate("13 ตุลาคม 2569", { ...customs.webList!, dateFormat: undefined }).localDate).toBeNull()
    expect(parseLooseDate("13 ตุลาคม 2569", { ...customs.webList!, calendar: "gregorian" }).localDate).toBeNull()
    expect(parseLooseDate("13 ตุลาคม 2026", { ...customs.webList!, calendar: "gregorian" }).localDate).toBe("2026-10-13")
  })
  it("checks the saved real date/column facts without treating metadata as original HTML", () => {
    const facts = JSON.parse(readFileSync("docs/evidence/r2-two-html-2026-10-13/TH-C01-relationships.json", "utf8"))
    const row = facts.examples.find((entry: { titleColumnIndex?: number }) => entry.titleColumnIndex !== undefined)
    expect(row.titleColumnIndex).toBe(3)
    expect(row.dateColumnIndex).toBe(4)
    expect(row.titleColumnText).toBe(row.title)
    expect(customs.webList?.linkSelector).toBe(`td:nth-child(${row.titleColumnIndex}) a[href]`)
    expect(parseLooseDate(row.sameItemDateText, customs.webList!)).toMatchObject({ raw: "3 ตุลาคม 2569", localDate: "2026-10-03", precision: "day", publishedAt: null })
  })
  it("fails on absent/duplicate/redesigned lists and unconfirmed emptiness", () => {
    for (const markup of ["<html>Login</html>", "<div class=\"div-article-main2\"></div>", NORTHPORT_SYNTHETIC + NORTHPORT_SYNTHETIC]) expect(() => fromHtml(markup, northport.url, northport.webList!, sourcePolicy(northport))).toThrow(/web_list_/)
    expect(() => fromHtml(CUSTOMS_SYNTHETIC.replaceAll("table-hover", "new-list"), customs.url, customs.webList!, sourcePolicy(customs))).toThrow("web_list_structure_changed")
  })
  it("does not follow external, insecure, credentialed or out-of-scope links", () => {
    for (const href of ["https://evil.test/notices/1", "http://www.northport.com.my/np/docs/Announcements/1.pdf", "https://user:pass@www.northport.com.my/np/docs/Announcements/1.pdf", "https://www.northport.com.my:9443/np/docs/Announcements/1.pdf", "/np/about.html", "https://127.0.0.1/np/docs/Announcements/1.pdf"]) {
      const markup = NORTHPORT_SYNTHETIC.replaceAll(/href="\/np\/docs\/Announcements\/[^"]+"/g, `href="${href}"`)
      expect(() => fromHtml(markup, northport.url, northport.webList!, sourcePolicy(northport))).toThrow("web_list_no_allowed_items")
    }
  })
  it("rejects conflicting or unknown text/grammar configuration", () => {
    for (const extra of [{ dateOrder: undefined }, { publishedAtSelector: "span" }, { titleSelector: "h3" }, { dateFormat: "thai_month_name" }, { linkTextFormat: "regex" }]) expect(() => assertSupportedConfig({ ...northport.webList, ...extra })).toThrow()
    expect(() => assertSupportedConfig({ ...customs.webList, dateFormat: "locale_auto" })).toThrow()
  })
})
