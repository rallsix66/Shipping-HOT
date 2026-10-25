import { Readability } from "@mozilla/readability"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type ArticleSourcePolicy, canonicalArticleBlocks, normalizeArticleBlockText } from "@shared/article"
import { extractArticle } from "./article-extractor"

const policy: ArticleSourcePolicy = {
  sourceId: "shekou-official",
  status: "allowed",
  fetchAllowed: true,
  persistence: "full",
  allowedHosts: ["www.portshekou.com"],
  allowedContentTypes: ["text/html"],
  selectors: { container: ".content", title: "h1", remove: [".promo"] },
  completeness: { minParagraphs: 2, minCharacters: 120 },
}

const paragraphs = Array.from({ length: 12 }, (_, index) => `<p>Paragraph ${String(index + 1).padStart(2, "0")} body text for the operational notice.</p>`).join("")

const html = `<!doctype html><html><head><title>Fallback title</title></head><body>
  <nav><a href="/">Home menu</a></nav>
  <script>badThing()</script>
  <style>.x { color: red }</style>
  <div class="content">
    <h1>Berth closure notice</h1>
    ${paragraphs}
    <p>See <a href="https://www.portshekou.com/notice?utm_source=x&id=5#frag">the attachment</a> for details.</p>
    <ul><li>Item one</li><li>Item two</li></ul>
    <table><thead><tr><th>Berth</th><th>Status</th></tr></thead><tbody><tr><td>1</td><td>Closed</td></tr></tbody></table>
    <figure><img src="/a.png" alt=""/><figcaption>Figure caption</figcaption></figure>
  </div>
  <aside class="ad">Buy our service now</aside>
  <div class="recommend">Recommended reading</div>
  <div class="promo">Promo block</div>
</body></html>`

describe("extractArticle", () => {
  it("extracts structured blocks from a long article and drops non-content", () => {
    const result = extractArticle(html, "https://www.portshekou.com/ywgg/1", policy)
    const texts = result.blocks.map(block => block.text)
    expect(result.status).toBe("complete")
    expect(result.title).toBe("Berth closure notice")
    expect(texts).toContain("Paragraph 01 body text for the operational notice.")
    expect(texts).toContain("Paragraph 06 body text for the operational notice.")
    expect(texts).toContain("Paragraph 12 body text for the operational notice.")
    const joined = texts.join(" ")
    expect(joined).not.toContain("Buy our service now")
    expect(joined).not.toContain("Home menu")
    expect(joined).not.toContain("badThing")
    expect(joined).not.toContain("Recommended reading")
    expect(joined).not.toContain("Promo block")
    expect(result.blocks.some(block => block.type === "heading")).toBe(true)
    expect(result.blocks.some(block => block.type === "list" && block.metadata?.ordered === false)).toBe(true)
    expect(result.blocks.some(block => block.type === "table" && block.metadata?.header === true)).toBe(true)
    expect(result.blocks.some(block => block.type === "caption" && block.text === "Figure caption")).toBe(true)
  })

  it("reads language provenance from <html lang> and never guesses", () => {
    const wrap = (lang: string) => `<html ${lang}><body><div class="content"><h1>T</h1><p>Body body body body body body body.</p><p>More more more more more more more.</p></div></body></html>`
    expect(extractArticle(wrap("lang=\"en\""), "https://www.portshekou.com/ywgg/1", policy).language).toBe("en")
    expect(extractArticle(wrap("lang=\"zh-CN\""), "https://www.portshekou.com/ywgg/1", policy).language).toBe("zh-CN")
    expect(extractArticle("<html><body><div class='content'><p>Body body body body body body.</p><p>More more more more more more.</p></div></body></html>", "https://www.portshekou.com/ywgg/1", policy).language).toBeUndefined()
  })

  it("does not fall back to the whole page when the configured container is missing", () => {
    const bodyOnly = `<body>${Array.from({ length: 12 }, (_, index) => `<p>Paragraph ${index + 1} body text body text body text.</p>`).join("")}</body>`
    const result = extractArticle(bodyOnly, "https://www.portshekou.com/ywgg/1", policy)
    expect(result.status).toBe("source_unavailable")
    expect(result.blocks).toHaveLength(0)
  })

  it("canonicalizes link metadata and marks thin pages incomplete", () => {
    const result = extractArticle(html, "https://www.portshekou.com/ywgg/1", policy)
    const linked = result.blocks.find(block => block.metadata?.href !== undefined)
    expect(linked?.metadata?.href).toBe("https://www.portshekou.com/notice?id=5")
    const thin = extractArticle("<div class='content'><p>Too short</p></div>", "https://www.portshekou.com/ywgg/1", policy)
    expect(thin.status).toBe("incomplete")
    const empty = extractArticle("<div class='content'></div>", "https://www.portshekou.com/ywgg/1", policy)
    expect(empty.status).toBe("source_unavailable")
  })

  it("keeps one line per table row so a real multi-row table survives extraction", () => {
    const table = "<table><thead><tr><th>Berth</th><th>Status</th></tr></thead><tbody><tr><td>1</td><td>Closed</td></tr><tr><td>2</td><td>Open</td></tr><tr><td>3</td><td>Open</td></tr></tbody></table>"
    const page = `<div class="content"><h1>Berth table</h1>${paragraphs}${table}</div>`
    const block = extractArticle(page, "https://www.portshekou.com/ywgg/1", policy).blocks.find(candidate => candidate.type === "table")
    // One line per row: the reader splits on "\n" to build the rows, so a
    // collapsed text would render a real 4-row table as a single row.
    expect(block?.text.split("\n")).toEqual(["Berth | Status", "1 | Closed", "2 | Open", "3 | Open"])
    expect(block?.metadata).toMatchObject({ header: true, columns: 2 })
  })

  it("never turns a newline inside a table cell into a phantom row", () => {
    // Pretty-printed markup puts newlines inside a `<td>`; row boundaries are
    // stored as "\n", so an un-normalized cell newline would render as an extra
    // row holding a stray "|".
    const table = "<table><thead><tr><th>Berth</th><th>Status</th></tr></thead><tbody>"
      + "<tr><td>\n  <p>AE7</p>\n  <p>since 06:00</p>\n</td><td>Open</td></tr>"
      + "<tr><td>MD2</td><td>\n Closed\n for dredging \n</td></tr></tbody></table>"
    const page = `<div class="content"><h1>Berth table</h1>${paragraphs}${table}</div>`
    const block = extractArticle(page, "https://www.portshekou.com/ywgg/1", policy).blocks.find(candidate => candidate.type === "table")
    expect(block?.text.split("\n")).toEqual(["Berth | Status", "AE7 since 06:00 | Open", "MD2 | Closed for dredging"])
    // Every rendered row must have exactly the declared column count.
    expect(block?.text.split("\n").every(row => row.split(" | ").length === 2)).toBe(true)
  })

  it("preserving table row lines does not change the content hash input", () => {
    // Content hashing collapses every whitespace run, so a row-preserving table
    // hashes exactly like the previously row-collapsed text: no stored article
    // version is invalidated by this normalization.
    const rowPreserved = [{ id: "b0", blockKey: "0", order: 0, type: "table" as const, text: "Berth | Status\n1 | Closed", metadata: { header: true, columns: 2 } }]
    const rowCollapsed = [{ id: "b0", blockKey: "0", order: 0, type: "table" as const, text: "Berth | Status 1 | Closed", metadata: { header: true, columns: 2 } }]
    expect(normalizeArticleBlockText(rowPreserved[0].text)).toBe(normalizeArticleBlockText(rowCollapsed[0].text))
    expect(canonicalArticleBlocks(rowPreserved)).toBe(canonicalArticleBlocks(rowCollapsed))
  })
})

describe("generic Readability articles (offline)", () => {
  const genericPolicy: ArticleSourcePolicy = { ...policy, selectors: undefined }
  const url = "https://www.portshekou.com/notices/current"
  const prose = "The port authority published operational guidance for safe cargo handling, berth access and the revised terminal working arrangements. Operators should review the official timetable and coordinate arrival before dispatch. "
  const body = Array.from({ length: 6 }, (_, i) => `<p>Section ${i + 1}. ${prose.repeat(2)}</p>`).join("")
  const page = (content: string, lang = "en") => `<html lang="${lang}"><head><title>Cargo handling guidance</title></head><body><div id="story"><h1>Cargo handling guidance</h1>${content}</div></body></html>`

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("finds generic prose, removes navigation interference and keeps structured blocks and safe links", () => {
    const chrome = `<div class="menu">${Array.from({ length: 50 }, (_, i) => `<a href="/menu/${i}">Navigation ${i}</a>`).join(" ")}</div>`
    const markup = page(`<h2>Terminal arrangements</h2>${body}<p>${prose}<a href="../attachment?id=5&utm_source=test#part">Official attachment</a></p><ol><li>First procedure</li><li>Second procedure</li></ol><table><thead><tr><th>Berth</th><th>Status</th></tr></thead><tbody><tr><td>1</td><td>Closed</td></tr><tr><td>2</td><td>Open</td></tr></tbody></table>`).replace("<div id=\"story\">", `${chrome}<div id="story">`)
    const result = extractArticle(markup, url, genericPolicy)
    expect(result).toMatchObject({ status: "complete", title: "Cargo handling guidance", language: "en" })
    expect(result.blocks.map(b => b.text).join(" ")).not.toContain("Navigation")
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: "heading", text: "Terminal arrangements", metadata: { level: 2 } }))
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: "list", text: "First procedure • Second procedure", metadata: { ordered: true } }))
    expect(result.blocks).toContainEqual(expect.objectContaining({ type: "table", text: "Berth | Status\n1 | Closed\n2 | Open", metadata: { header: true, columns: 2 } }))
    expect(result.blocks.find(b => b.metadata?.href)?.metadata?.href).toBe("https://www.portshekou.com/attachment?id=5")
    expect(result.blocks.filter(b => b.type === "paragraph")).toHaveLength(7)
  })

  it.each([
    ["zh-CN", "港口作业通知：船舶靠泊及货物装卸安排已调整，请码头运营方核对官方通告、协调车辆到港时间，并按照安全要求组织作业。"],
    ["th", "ประกาศการท่าเรือเกี่ยวกับการขนส่งสินค้า ผู้ประกอบการต้องตรวจสอบตารางเวลาทำการและปฏิบัติตามข้อกำหนดความปลอดภัยของท่าเรือ "],
    ["vi", "Thông báo cảng biển về lịch khai thác hàng hóa. Doanh nghiệp cần kiểm tra thông tin chính thức, phối hợp thời gian đến cảng và tuân thủ yêu cầu an toàn. "],
  ])("retains %s source text without language or timezone inference", (lang, text) => {
    const result = extractArticle(page(`<h2>Notice</h2><p>${text.repeat(6)}</p><p>${text.repeat(6)}</p>`, lang), url, genericPolicy)
    expect(result.status).toBe("complete")
    expect(result.language).toBe(lang)
    expect(result.blocks.filter(b => b.type === "paragraph").map(b => b.text)).toEqual([text.repeat(6).trim(), text.repeat(6).trim()])
  })

  it("never executes scripts, handlers or loads resources and ignores a malicious base", () => {
    const fetcher = vi.fn(() => {
      throw new Error("external resource requested")
    })
    vi.stubGlobal("fetch", fetcher)
    const marker = vi.fn()
    vi.stubGlobal("articleScriptProbe", marker)
    const markup = page(`${body}<p>${prose}<a href="../safe">Safe attachment</a><a href="javascript:articleScriptProbe()">Unsafe link</a></p><img src="https://invalid.example/remote" onload="articleScriptProbe()"><iframe src="https://invalid.example/frame"></iframe><script>articleScriptProbe(); fetch('https://invalid.example/script')</script>`).replace("<head>", "<head><base href=\"https://attacker.invalid/\"><link rel=\"stylesheet\" href=\"https://invalid.example/style\">")
    const result = extractArticle(markup, url, genericPolicy)
    expect(result.status).toBe("complete")
    expect(result.blocks.find(b => b.metadata?.href)?.metadata?.href).toBe("https://www.portshekou.com/safe")
    expect(fetcher).not.toHaveBeenCalled()
    expect(marker).not.toHaveBeenCalled()
    expect(JSON.stringify(result.blocks)).not.toContain("articleScriptProbe")
  })

  it.each(["", "<html><body></body></html>", "<nav><a href='/'>Home only</a></nav>", "<p>A tiny fragment.</p>"])("rejects empty or unconfirmed generic content without whole-body fallback: %s", (markup) => {
    expect(extractArticle(markup, url, genericPolicy)).toEqual({ blocks: [], status: "source_unavailable" })
  })

  it("fails closed when Readability cannot parse, with no alternate extractor", () => {
    vi.spyOn(Readability.prototype, "parse").mockImplementation(() => {
      throw new Error("DOM parsing failure")
    })
    expect(extractArticle(page(body), url, genericPolicy)).toEqual({ blocks: [], status: "source_unavailable" })
  })

  it("keeps explicit containers authoritative and the original completeness contract", () => {
    const parse = vi.spyOn(Readability.prototype, "parse")
    expect(extractArticle(page(body), url, policy)).toEqual({ blocks: [], status: "source_unavailable" })
    const result = extractArticle("<div class=\"content\"><h2>Short notice</h2><p>Short body.</p></div>", url, policy)
    expect(result.status).toBe("incomplete")
    expect(result.blocks.map(b => b.text)).toEqual(["Short notice", "Short body."])
    expect(parse).not.toHaveBeenCalled()
    expect(extractArticle(page(body), url, { ...genericPolicy, completeness: { minParagraphs: 20 } }).status).toBe("incomplete")
  })
})
