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

// Original fixtures, not a reconstruction of any publisher's page. The saved
// real-world text does not tell us which DOM containers that publisher used.
const nonArticleRegions = [
  { name: "subscription sidebar", attrs: "role=\"complementary\"", text: "原创测试：订阅入口及会员权益推广。" },
  { name: "recommended-story navigation", attrs: "role=\"navigation\"", text: "原创测试：另一则推荐消息，点击前往阅读。" },
  { name: "purchase footer", attrs: "role=\"contentinfo\"", text: "原创测试：文章购买服务入口。" },
  { name: "case-insensitive sidebar", attrs: "role=\" COMPLEMENTARY \"", text: "原创测试：大小写不同的侧栏入口。" },
  { name: "hidden widget", attrs: "hidden", text: "原创测试：隐藏的推荐入口。" },
  { name: "display-none widget", attrs: "style=\"display: none !important\"", text: "原创测试：不显示的订阅入口。" },
]
it.each(nonArticleRegions)("excludes the structurally marked $name before Defuddle can retry", ({ attrs, text }) => {
  page.document.body.innerHTML = `<article><p>原创正文说明订阅行业和购买行为的研究结果，保留完整句子。</p><div ${attrs}><p>${text}</p></div><p>原创正文的最后一段，仍应保留。</p></article>`
  const before = page.document.documentElement.outerHTML
  const snapshot = inertSnapshot(page.document)
  expect(snapshot.body.textContent).not.toContain(text)
  expect(snapshot.body.textContent).toContain("原创正文说明订阅行业和购买行为的研究结果，保留完整句子。")
  const draft = extractDocument(page.document, "article", "", "2026-10-19T04:00:00.000Z")
  expect(draft.body).not.toContain(text)
  expect(draft.body).toContain("原创正文的最后一段，仍应保留。")
  expect(draft.extractorVersion).toBe("defuddle-0.19.2-dom-v4")
  expect(page.document.documentElement.outerHTML).toBe(before)
})
const visibleArticleRegions = [
  { name: "aria-hidden visual prose", html: "<div aria-hidden=\"true\"><p>原创视觉正文：订阅服务的购买条件。</p></div>", expected: "原创视觉正文：订阅服务的购买条件。" },
  { name: "visibility-hidden parent with visible child", html: "<div style=\"visibility: hidden\"><p style=\"visibility: visible\">原创可见子段：购买与订阅研究。</p></div>", expected: "原创可见子段：购买与订阅研究。" },
  { name: "visibility-collapse parent with visible child", html: "<div style=\"visibility: collapse\"><p style=\"visibility: visible\">原创可见子段：折叠容器中的正文。</p></div>", expected: "原创可见子段：折叠容器中的正文。" },
]
it.each(visibleArticleRegions)("retains visually meaningful $name through snapshot and article extraction", ({ html, expected }) => {
  page.document.body.innerHTML = `<article>${html}</article>`
  const before = page.document.documentElement.outerHTML
  expect(inertSnapshot(page.document).body.textContent).toBe(expected)
  expect(extractDocument(page.document, "article", "", "2026-10-19T04:00:00.000Z").body).toBe(expected)
  expect(page.document.documentElement.outerHTML).toBe(before)
})
it("preserves subscription and purchase prose, quotes, and an unmarked trailing paragraph", () => {
  page.document.body.innerHTML = `<article role="article"><p>研究人员讨论订阅定价和购买行为，正文中这些词语不能成为截断依据。</p><blockquote><p>受访者说：订阅费用影响购买决定。</p></blockquote><section role="region" class="research-data"><p>另一段关于购买文章和订阅制度的原创分析。</p></section><p>请订阅并购买文章。这段没有非正文结构信号，不能猜测删除。</p><p>后续正文仍然完整。</p></article>`
  const snapshot = inertSnapshot(page.document)
  expect(snapshot.body.textContent).toContain("另一段关于购买文章和订阅制度的原创分析。")
  expect(snapshot.body.textContent).toContain("请订阅并购买文章。这段没有非正文结构信号，不能猜测删除。")
  const draft = extractDocument(page.document, "article", "", "2026-10-19T04:00:00.000Z")
  expect(draft.body).toContain("研究人员讨论订阅定价和购买行为，正文中这些词语不能成为截断依据。")
  expect(draft.body).toContain("受访者说：订阅费用影响购买决定。")
  expect(draft.body).toContain("另一段关于购买文章和订阅制度的原创分析。")
  expect(draft.body).toContain("请订阅并购买文章。这段没有非正文结构信号，不能猜测删除。")
  expect(draft.body).toContain("后续正文仍然完整。")
})
it("does not assume every generic region or dialog is a non-article widget", () => {
  page.document.body.innerHTML = "<div role=\"dialog\"><article role=\"article\"><div role=\"region\"><p>原创阅读窗口内的文章内容。</p></div></article></div>"
  expect(inertSnapshot(page.document).body.textContent).toBe("原创阅读窗口内的文章内容。")
})
it("does not let a short-article fallback restore a long excluded widget", () => {
  const widget = "Original synthetic membership widget content that must stay outside the captured article. ".repeat(40)
  page.document.body.innerHTML = `<article><p>一段简短原创正文。</p><div role="complementary"><p>${widget}</p></div><div hidden><p>${widget}</p></div></article>`
  expect(extractDocument(page.document, "article", "", "2026-10-19T04:00:00.000Z").body).toBe("一段简短原创正文。")
})
it("fails visibly rather than returning widgets when no article text remains", () => {
  page.document.body.innerHTML = "<article><div role=\"complementary\"><p>原创测试会员入口。</p></div><div hidden><p>原创测试隐藏材料。</p></div></article>"
  expect(() => extractDocument(page.document, "article", "", "2026-10-19T04:00:00.000Z")).toThrow("clip_empty_use_metadata")
  expect(extractDocument(page.document, "metadata", "", "2026-10-19T04:00:00.000Z").body).toBe("")
})
it("leaves explicitly selected landmark text under the user's selection control", () => {
  const html = "<div role=\"complementary\"><p>用户明确选择的订阅分析。</p><p>用户明确选择的购买说明。</p></div>"
  const draft = extractDocument(page.document, "selection", html, "2026-10-19T04:00:00.000Z")
  expect(draft.body).toBe("用户明确选择的订阅分析。\n\n用户明确选择的购买说明。")
  expect(draft.extractorVersion).toBe("defuddle-0.19.2-dom-v1")
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
  { name: "widgets with formatted prose", html: "<p>正文讨论订阅和购买行为。</p><blockquote><p>引用：购买并不代表订阅。</p></blockquote><ul><li>订阅10:00</li><li>购买18:00</li></ul><table><tr><td>订阅</td><td>10:00</td></tr><tr><td>购买</td><td>18:00</td></tr></table><pre>订阅  10:00\n购买  18:00</pre><div role=\"complementary\"><p>原创测试推广入口</p></div><div role=\"navigation\"><p>原创测试推荐导航</p></div><div role=\"contentinfo\"><p>原创测试购买控件</p></div><p>尾段正文。</p>", expected: "正文讨论订阅和购买行为。\n\n引用：购买并不代表订阅。\n\n订阅10:00\n购买18:00\n\n订阅\t10:00\n购买\t18:00\n\n订阅  10:00\n购买  18:00\n\n原创测试推广入口\n\n原创测试推荐导航\n\n原创测试购买控件\n\n尾段正文。", articleExpected: "正文讨论订阅和购买行为。\n\n引用：购买并不代表订阅。\n\n订阅10:00\n购买18:00\n\n订阅\t10:00\n购买\t18:00\n\n订阅  10:00\n购买  18:00\n\n尾段正文。" },
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
