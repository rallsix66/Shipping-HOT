import { describe, expect, it } from "vitest"
import type { ArticleSourcePolicy } from "@shared/article"
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

  it("canonicalizes link metadata and marks thin pages incomplete", () => {
    const result = extractArticle(html, "https://www.portshekou.com/ywgg/1", policy)
    const linked = result.blocks.find(block => block.metadata?.href !== undefined)
    expect(linked?.metadata?.href).toBe("https://www.portshekou.com/notice?id=5")
    const thin = extractArticle("<div class='content'><p>Too short</p></div>", "https://www.portshekou.com/ywgg/1", policy)
    expect(thin.status).toBe("incomplete")
    const empty = extractArticle("<div class='content'></div>", "https://www.portshekou.com/ywgg/1", policy)
    expect(empty.status).toBe("source_unavailable")
  })
})
