import { describe, expect, it } from "vitest"
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
