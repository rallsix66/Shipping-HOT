import { readFileSync } from "node:fs"
import { parseHTML } from "linkedom"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { extractDocument, inertSnapshot, plainSelection } from "../extensions/shipping-hot-clipper/src/extract"
import { serializeChildren } from "../extensions/shipping-hot-clipper/src/dom-utils"
import { selectedHTML } from "../extensions/shipping-hot-clipper/src/selection"
import { clipSavePayload } from "../shared/clipper-bridge"

let page: ReturnType<typeof parseHTML>
let attempts = 0
beforeEach(() => {
  attempts = 0
  page = parseHTML("<!doctype html><html lang=\"en\"><head><title>Synthetic article</title><meta property=\"article:published_time\" content=\"Fri, 16 Oct 2026 10:00:00 +0800\"></head><body><article><h1>Synthetic article</h1><p>This is a synthetic article used only for offline acceptance. It describes a fictional event without making any claim about a real port or provider. The content is deliberately long enough for meaningful article extraction.</p><p>A second synthetic paragraph retains readable text and structure. It is not a source-site sample, copyrighted third-party text, or a live official notice.</p><img src=\"https://example.org/pixel\"><iframe src=\"https://example.org/frame\"></iframe><script>throw new Error(\"must not run\")</script><form><input value=\"private form value\"></form></article></body></html>")
  Object.defineProperty(page.document, "URL", { value: "https://example.org/article#section", configurable: true })
  Object.defineProperty(page.document, "implementation", { value: { createHTMLDocument: (title = "") => {
    const doc = parseHTML(`<!doctype html><html><head><title>${title}</title></head><body></body></html>`).document
    return doc
  } }, configurable: true })
  for (const key of ["DOMParser", "Node", "Element", "HTMLElement", "HTMLImageElement", "NodeFilter"]) vi.stubGlobal(key, page.window[key as keyof typeof page.window])
  vi.stubGlobal("window", page.window)
  vi.stubGlobal("document", page.document)
  vi.stubGlobal("fetch", () => {
    attempts++
    throw new Error("external forbidden")
  })
})
afterEach(() => {
  expect(attempts).toBe(0)
  vi.unstubAllGlobals()
})
it("copies text structure without resources, executable nodes or private form inputs", () => {
  const doc = inertSnapshot(page.document)
  expect(doc.body.textContent).toContain("synthetic article")
  expect(doc.querySelector("img,iframe,script,input,form,[src],[href]")).toBeNull()
  expect(doc.body.textContent).not.toContain("private form value")
  expect(page.document.querySelector("img")?.getAttribute("src")).toBe("https://example.org/pixel")
})
it("extracts metadata without date truncation or network and keeps unknown date role", () => {
  const draft = extractDocument(page.document, "metadata", "", "2026-10-16T02:00:00.000Z")
  expect(draft.actualUrl).toBe("https://example.org/article#section")
  expect(draft.date).toEqual({ raw: "Fri, 16 Oct 2026 10:00:00 +0800", field: "meta:article:published_time", role: "unknown" })
  expect(draft.body).toBe("")
})
it("uses Defuddle synchronously on a resource-free snapshot, leaving the live document intact", () => {
  const before = page.document.documentElement.outerHTML
  const draft = extractDocument(page.document, "article", "", "2026-10-16T02:00:00.000Z")
  expect(draft.body).toContain("synthetic article")
  expect(draft.body).not.toContain("must not run")
  expect(page.document.documentElement.outerHTML).toBe(before)
})
it("reuses selected range cloning and serialization while returning plain text", () => {
  const fragment = page.document.createDocumentFragment()
  const span = page.document.createElement("span")
  span.textContent = "Synthetic & selected text"
  fragment.append(span)
  vi.stubGlobal("window", { getSelection: () => ({ rangeCount: 1, getRangeAt: () => ({ cloneContents: () => fragment.cloneNode(true) }) }) })
  expect(selectedHTML()).toContain("Synthetic &amp; selected text")
  expect(extractDocument(page.document, "selection", selectedHTML(), "2026-10-16T02:00:00.000Z").body).toBe("Synthetic & selected text")
  const div = page.document.createElement("div")
  div.append(page.document.createTextNode("<&>"))
  expect(serializeChildren(div)).toBe("&lt;&amp;&gt;")
})
it("never permits async parsing, interpreter or remote-resource helpers in adapted code", () => {
  const source = readFileSync("extensions/shipping-hot-clipper/src/clip-utils.ts", "utf8")
  expect(source).toContain("useAsync: false")
  expect(source).not.toMatch(/\.parseAsync\(|defuddle\/full|defuddle\/node/)
})

const boundaryCases = [
  { name: "paragraphs", html: "<p>关闭10:00</p><p>恢复18:00</p>", expected: "关闭10:00\n\n恢复18:00" },
  { name: "line breaks", html: "<p>关闭10:00<br>恢复18:00<br><br>次日复核</p>", expected: "关闭10:00\n恢复18:00\n\n次日复核" },
  { name: "list items", html: "<ul><li>关闭10:00</li><li>恢复18:00</li></ul>", expected: "关闭10:00\n恢复18:00" },
  { name: "table cells and rows", html: "<table><tbody><tr><th>作业</th><th>时间</th></tr><tr><td>关闭</td><td>10:00</td></tr><tr><td>恢复</td><td>18:00</td></tr></tbody></table>", expected: "作业\t时间\n关闭\t10:00\n恢复\t18:00" },
  { name: "selected cell fragment", html: "<td>关闭10:00</td><td>恢复18:00</td>", expected: "关闭10:00\t恢复18:00", selectionOnly: true },
  { name: "selected row fragments", html: "<tr><td>关闭</td><td>10:00</td></tr><tr><td>恢复</td><td>18:00</td></tr>", expected: "关闭\t10:00\n恢复\t18:00", selectionOnly: true },
  { name: "PRE double spaces and lines", html: "<pre>港口A  10:00\n港口B  18:00</pre>", expected: "港口A  10:00\n港口B  18:00" },
  // Defuddle's existing code-block transform expands tabs and trims/dedents
  // before plainSelection. Pin that article output separately; do not change
  // the upstream parser or mistake it for raw-selection whitespace fidelity.
  { name: "PRE tabs", html: "<pre>港口A\t10:00\n港口B\t\t18:00</pre>", expected: "港口A\t10:00\n港口B\t\t18:00", articleExpected: "港口A    10:00\n港口B        18:00" },
  { name: "PRE edge spaces and blank lines", html: "<pre>  港口A  10:00 \n\n\n\t港口B  18:00  \n </pre>", expected: "  港口A  10:00 \n\n\n\t港口B  18:00  \n ", articleExpected: "港口A  10:00 \n\n  港口B  18:00" },
  { name: "PRE inline elements", html: "<pre>  <strong>港口A</strong>  <code>10:00\t开港</code>\n\n\n<span>港口B</span>\t 18:00  <script>unsafe script</script><iframe src=\"https://example.org/unsafe\">unsafe frame</iframe></pre>", expected: "  港口A  10:00\t开港\n\n\n港口B\t 18:00  ", articleExpected: "港口A  10:00    开港\n\n港口B     18:00" },
  { name: "PRE surrounded by normal blocks", html: "<p> 前文 </p><pre>  港口A  10:00 \n\n\n港口B\t18:00  </pre><p> 后文<br>复核 </p>", expected: "前文\n\n  港口A  10:00 \n\n\n港口B\t18:00  \n\n后文\n复核", articleExpected: "前文\n\n港口A  10:00 \n\n港口B    18:00\n\n后文\n复核" },
]
it.each(boundaryCases)("preserves exact $name separators and strips dangerous nodes", ({ html, expected }) => {
  expect(plainSelection(`${html}<script>unsafe script</script><style>unsafe style</style><iframe src=\"https://example.org/unsafe\">unsafe frame</iframe><form>private field</form>`)).toBe(expected)
})
it.each(boundaryCases.flatMap(fixture => (fixture.selectionOnly ? ["selection"] as const : ["selection", "article"] as const).map(mode => ({ ...fixture, mode, expected: mode === "article" ? fixture.articleExpected ?? fixture.expected : fixture.expected }))))("preserves $name from $mode preview through save payload to stored material", async ({ mode, html, expected, name }) => {
  // Runtime-load real server modules without mixing their Node-only TS project
  // into this browser-DOM test's TypeScript project. Production types stay checked.
  const { open } = await vi.importActual<{ open: (path: string) => { database: unknown, repository: unknown, native: { close: () => void } } }>("#/intel/__fixtures__/isolated-db")
  const { initShippingTables } = await vi.importActual<{ initShippingTables: (db: unknown, mode: string) => Promise<void> }>("#/database/shipping")
  const { manualSubmit } = await vi.importActual<{ manualSubmit: (repo: unknown, input: unknown, now: string) => Promise<{ itemId: string, versionId: string }> }>("#/intel/manual")
  const { readIntelMaterial } = await vi.importActual<{ readIntelMaterial: (repo: unknown, item: string, version: string) => Promise<{ ok: boolean, material?: { bodyText: string | null } }> }>("#/intel/material-read")
  const db = open(":memory:")
  try {
    await initShippingTables(db.database, "real")
    page.document.body.innerHTML = `<main><article>${html}</article></main>`
    const preview = extractDocument(page.document, mode, html, "2026-10-16T02:00:00.000Z")
    expect(preview.body).toBe(expected)
    const payload = clipSavePayload({ draft: preview, rights: { basis: "own_work", scope: "full_text", evidence: "Synthetic boundary acceptance fixture", applicableUrl: preview.actualUrl }, operator: "Synthetic author", requestId: `boundary-${mode}-${name.replace(/ /g, "-")}` })
    expect(payload.clip.body).toBe(expected)
    const saved = await manualSubmit(db.repository, payload, "2026-10-16T02:01:00.000Z")
    const read = await readIntelMaterial(db.repository, saved.itemId!, saved.versionId!)
    expect(read.ok && read.material?.bodyText).toBe(expected)
  } finally {
    db.native.close()
  }
})
