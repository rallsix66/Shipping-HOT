import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import { decodeResponse } from "./response-decoding"

describe("response encoding selection", () => {
  it("defaults to strict UTF-8 and preserves combining characters", () => {
    const text = "港口 การ Ca\u0309ng"
    expect(decodeResponse(Buffer.from(text), "text/html")).toMatchObject({ body: text, decoding: { encoding: "utf-8", selectedBy: "default", conflict: false } })
  })
  it("selects BOM before HTTP and records conflicts without fallback", () => {
    const bytes = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from("港口")])
    expect(decodeResponse(bytes, "text/html; charset=gbk")).toMatchObject({ body: "港口", decoding: { encoding: "utf-8", selectedBy: "bom", conflict: true } })
  })
  it("selects HTTP before XML; equivalent labels are not conflicts", () => {
    const bytes = Buffer.from("<?xml version=\"1.0\" encoding=\"GB2312\"?><rss/>")
    expect(decodeResponse(bytes, "application/rss+xml; CHARSET='gbk'").decoding).toMatchObject({ encoding: "gbk", selectedBy: "http", conflict: false })
    expect(decodeResponse(bytes, "application/rss+xml; charset=utf-8").decoding.conflict).toBe(true)
    expect(decodeResponse(bytes, "application/rss+xml").decoding.selectedBy).toBe("xml")
  })
  it("selects the first HTML declaration, supports either attribute order and records conflicts", () => {
    const bytes = Buffer.from("<meta content=\"text/html; charset=TIS-620\" http-equiv=\"Content-Type\"><meta charset=\"utf-8\">")
    expect(decodeResponse(bytes, "text/html").decoding).toMatchObject({ encoding: "windows-874", selectedBy: "meta", conflict: true })
    expect(decodeResponse(bytes, "text/html; charset=utf-8").decoding.selectedBy).toBe("http")
  })
  it("does not sniff comments, arbitrary body text, or declarations past 4096 bytes", () => {
    for (const body of ["<!-- <meta charset=\"gbk\"> -->hi", "charset=\"gbk\"", "<script>\"<meta charset=gbk>\"</script>", `${" ".repeat(4096)}<meta charset="gbk">`]) {
      expect(decodeResponse(Buffer.from(body), "text/html").decoding.selectedBy).toBe("default")
    }
  })
  it("rejects unknown selected encodings and invalid byte sequences without guessing", () => {
    expect(() => decodeResponse(Buffer.from("ok"), "text/html; charset=unknown")).toThrow("encoding_unsupported")
    expect(() => decodeResponse(Buffer.from([0xC3, 0x28]), "text/html")).toThrow("encoding_invalid")
    expect(() => decodeResponse(Buffer.from([0x81]), "application/xml; charset=gbk")).toThrow("encoding_invalid")
  })
})
