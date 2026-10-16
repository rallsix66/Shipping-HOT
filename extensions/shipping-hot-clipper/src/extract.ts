import { CLIP_PROTOCOL, clipActualUrl, parseClipDraft } from "../../../shared/manual-clip"
import type { ClipDraft, ClipMode } from "../../../shared/manual-clip"
import { parseForClip } from "./clip-utils"

const allowed = new Set("DIV MAIN ARTICLE SECTION P SPAN H1 H2 H3 H4 H5 H6 UL OL LI TABLE THEAD TBODY TR TH TD CAPTION BLOCKQUOTE BR TIME B STRONG I EM A PRE CODE".split(" "))
/** Copy structural/text nodes only, never resource attributes, forms or active DOM. */
export function inertSnapshot(source: Document): Document {
  const target = source.implementation.createHTMLDocument(source.title)
  let nodes = 0
  let characters = 0
  function copy(node: Node, parent: Node) {
    if (++nodes > 50000) throw new Error("clip_page_too_large_use_selection")
    if (node.nodeType === 3) {
      const text = node.textContent ?? ""
      characters += text.length
      if (characters > 1000000) throw new Error("clip_page_too_large_use_selection")
      parent.appendChild(target.createTextNode(text))
      return
    }
    if (node.nodeType !== 1) return
    const element = node as Element
    if (!allowed.has(element.tagName.toUpperCase())) return
    const child = target.createElement(element.tagName)
    for (const attr of ["class", "id", "datetime", "lang"]) {
      const value = element.getAttribute(attr)
      if (value) child.setAttribute(attr, value)
    }
    parent.appendChild(child)
    element.childNodes.forEach(n => copy(n, child))
  }
  source.body.childNodes.forEach(n => copy(n, target.body))
  return target
}
export function plainSelection(html: string): string {
  if (html.length > 1000000) throw new Error("clip_page_too_large_use_selection")
  // Template contents are inert and never adopted into the active document.
  // This is parsing to text, not an HTML preview or a general-purpose sanitizer.
  const template = document.createElement("template")
  template.innerHTML = html
  template.content.querySelectorAll("script,style,form,input,textarea,iframe,object,svg").forEach(n => n.remove())
  const blocks = new Set("P DIV MAIN ARTICLE SECTION H1 H2 H3 H4 H5 H6 BLOCKQUOTE CAPTION UL OL TABLE".split(" "))
  type TextPart = string | { pre: string }
  // Keep PRE text separate so neither structural trimming nor final normal-flow
  // whitespace normalization can change its spaces, tabs or line breaks.
  function trim(parts: TextPart[]): TextPart[] {
    const result = [...parts]
    while (typeof result[0] === "string") {
      result[0] = (result[0] as string).trimStart()
      if (result[0]) break
      result.shift()
    }
    while (typeof result[result.length - 1] === "string") {
      const last = result.length - 1
      result[last] = (result[last] as string).trimEnd()
      if (result[last]) break
      result.pop()
    }
    return result
  }
  function readPre(node: Node): string {
    if (node.nodeType === 3) return node.textContent ?? ""
    if (node.nodeType !== 1 && node.nodeType !== 11) return ""
    if (node.nodeType === 1 && (node as Element).tagName.toUpperCase() === "BR") return "\n"
    return Array.from(node.childNodes).map(readPre).join("")
  }
  function read(node: Node): TextPart[] {
    if (node.nodeType === 3) return [(node.textContent ?? "").replace(/[ \t\r\n\f]+/g, " ")]
    if (node.nodeType !== 1 && node.nodeType !== 11) return []
    const tag = node.nodeType === 1 ? (node as Element).tagName.toUpperCase() : ""
    if (tag === "PRE") return ["\n\n", { pre: readPre(node) }, "\n\n"]
    if (tag === "BR") return ["\n"]
    if (tag === "TR") {
      const cells = Array.from((node as Element).children).filter(cell => ["TD", "TH"].includes(cell.tagName.toUpperCase()))
      return [...cells.flatMap((cell, index) => [...(index ? ["\t"] : []), ...trim(Array.from(cell.childNodes).flatMap(read))]), "\n"]
    }
    const text = Array.from(node.childNodes).flatMap(read)
    if (["TD", "TH"].includes(tag)) {
      const next = (node as Element).nextElementSibling?.tagName.toUpperCase()
      return [...trim(text), ...(next && ["TD", "TH"].includes(next) ? ["\t"] : [])]
    }
    if (tag === "LI") return [...trim(text), "\n"]
    return blocks.has(tag) ? ["\n\n", ...text, "\n\n"] : text
  }
  const parts: TextPart[] = []
  for (const part of read(template.content)) {
    const last = parts.length - 1
    if (typeof part === "string" && typeof parts[last] === "string") parts[last] += part
    else parts.push(part)
  }
  const text = parts.map((part, index) => {
    if (typeof part !== "string") return part.pre
    let normal = part.replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n")
    if (index === 0) normal = normal.replace(/^[ \n]+/g, "")
    if (index === parts.length - 1) normal = normal.replace(/[ \n]+$/g, "")
    return normal
  }).join("")
  return text.trim() ? text : ""
}
export function extractDocument(doc: Document, mode: ClipMode, selection: string, now: string): ClipDraft {
  const actualUrl = clipActualUrl(doc.URL)
  const raw = doc.querySelector("meta[property=\"article:published_time\"]")
  const time = doc.querySelector("time[datetime]")
  const date = { raw: raw?.getAttribute("content") ?? time?.getAttribute("datetime") ?? "", field: raw ? "meta:article:published_time" : time ? "time:datetime" : "", role: "unknown" as const }
  let title = doc.title
  let body = ""
  if (mode === "selection") body = plainSelection(selection)
  if (mode === "article") {
    const parsed = parseForClip(inertSnapshot(doc))
    title = parsed.title || title
    body = plainSelection(parsed.content)
  }
  if (mode !== "metadata" && !body) throw new Error("clip_empty_use_metadata")
  if (doc.URL !== actualUrl) throw new Error("clip_navigation_changed")
  return parseClipDraft({ protocol: CLIP_PROTOCOL, actualUrl, title, body, mode, date, capturedAt: now, extractorVersion: "defuddle-0.19.2-dom-v1" })
}
