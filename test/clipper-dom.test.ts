import { readFileSync } from "node:fs"
import { parseHTML } from "linkedom"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { extractDocument, inertSnapshot } from "../extensions/shipping-hot-clipper/src/extract"
import { serializeChildren } from "../extensions/shipping-hot-clipper/src/dom-utils"
import { selectedHTML } from "../extensions/shipping-hot-clipper/src/selection"

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
