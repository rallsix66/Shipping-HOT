import { Buffer } from "node:buffer"

export interface ResponseDecoding {
  encoding: string
  selectedBy: "bom" | "http" | "xml" | "meta" | "default"
  declarations: Array<{ source: "bom" | "http" | "xml" | "meta", label: string, encoding: string | null }>
  conflict: boolean
  byteLength: number
}

/** Bounded declaration sniffing only; never guesses from words or retries another encoding. */
export function decodeResponse(bytes: Uint8Array, contentType: string): { body: string, decoding: ResponseDecoding } {
  const declarations: ResponseDecoding["declarations"] = []
  const add = (source: ResponseDecoding["declarations"][number]["source"], label: string) => {
    const cleaned = label.trim().toLowerCase().slice(0, 80)
    let encoding: string | null = null
    try {
      encoding = new TextDecoder(cleaned, { fatal: true }).encoding
    } catch { /* unknown labels fail if selected */ }
    declarations.push({ source, label: cleaned, encoding })
  }
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) add("bom", "utf-8")
  else if (bytes[0] === 0xFF && bytes[1] === 0xFE) add("bom", "utf-16le")
  else if (bytes[0] === 0xFE && bytes[1] === 0xFF) add("bom", "utf-16be")
  const charset = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/gi
  for (const match of contentType.matchAll(charset)) add("http", match[1] ?? match[2] ?? match[3])
  // ASCII-compatible declaration bytes; UTF-16 declarations are not sniffed, their BOM wins.
  const prefix = Buffer.from(bytes.subarray(declarations[0]?.encoding === "utf-8" && declarations[0]?.source === "bom" ? 3 : 0, 4096)).toString("latin1")
  const mime = contentType.split(";")[0].trim().toLowerCase()
  if (mime.endsWith("+xml") || mime === "application/xml" || mime === "text/xml") {
    const declaration = /^\s*<\?xml\s[^?]*\?>/i.exec(prefix)?.[0]
    const match = declaration && /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(declaration)
    if (match) add("xml", match[1] ?? match[2])
  } else if (mime === "text/html") {
    // Ignore comments; inspect only real meta start tags, with attributes in either order.
    const uncommented = prefix.replace(/<!--[\s\S]*?(?:-->|$)/g, "").replace(/<(script|style|title|textarea)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    for (const tag of uncommented.matchAll(/<meta\s[^>]*>/gi)) {
      const attrs = new Map<string, string>()
      for (const attr of tag[0].slice(5).matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        const key = attr[1].toLowerCase()
        if (!attrs.has(key)) attrs.set(key, attr[2] ?? attr[3] ?? attr[4])
      }
      if (attrs.has("charset")) {
        add("meta", attrs.get("charset")!)
      } else if (attrs.get("http-equiv")?.toLowerCase() === "content-type") {
        const match = /(?:^|;)\s*charset\s*=\s*([^;\s]+)/i.exec(attrs.get("content") ?? "")
        if (match) add("meta", match[1])
      }
    }
  }
  const selected = declarations[0]
  if (selected && !selected.encoding) throw new Error("encoding_unsupported")
  const encoding = selected?.encoding ?? "utf-8"
  let body: string
  try {
    body = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  } catch {
    throw new Error("encoding_invalid")
  }
  return {
    body,
    decoding: {
      encoding,
      selectedBy: selected?.source ?? "default",
      declarations,
      conflict: declarations.some(entry => entry.encoding !== encoding),
      byteLength: bytes.byteLength,
    },
  }
}
