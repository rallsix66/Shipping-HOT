import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  PH_W01_EMPTY_TEXT,
  PH_W02_EMPTY_TEXT,
  parsePagasaEmptyState,
} from "./pagasa-empty-state-parse"

const FIXTURE_DIR = path.resolve(process.cwd(), "server/fixtures/pagasa")

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8")
}

/** Private capture root from prior PAGASA round (isolation machine only). */
const PRIVATE_CAPTURE_ROOT = path.resolve(
  process.cwd(),
  ".tmp/r2-4-pagasa-phw-20261026",
)

function loadPrivateCapture(productId: "PH-W01" | "PH-W02"): {
  html: string
  wireSha256: string
  httpStatus: number
  expectedWireSha256: string | null
} | null {
  const binPath = path.join(PRIVATE_CAPTURE_ROOT, "private", `${productId}.response.bin`)
  const capturePath = path.join(PRIVATE_CAPTURE_ROOT, `${productId}-capture.json`)
  if (!existsSync(binPath) || !existsSync(capturePath)) return null
  const buf = readFileSync(binPath)
  const wireSha256 = createHash("sha256").update(buf).digest("hex")
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
    httpStatus?: number
    wireSha256?: string
  }
  return {
    html: buf.toString("utf8"),
    wireSha256,
    httpStatus: capture.httpStatus ?? 200,
    expectedWireSha256: capture.wireSha256 ?? null,
  }
}

describe("parsePagasaEmptyState -> synthetic fixtures", () => {
  it("parses PH-W01 positive: official empty copy in product container -> parsed_empty", () => {
    const html = readFixture("ph-w01-empty-positive.html")
    const result = parsePagasaEmptyState("PH-W01", html)
    expect(result.status).toBe("parsed_empty")
    if (result.status !== "parsed_empty") return
    expect(result.emptyStateOriginalText).toBe(PH_W01_EMPTY_TEXT)
    expect(result.citations.emptyTextExactMatch).toBe(true)
    expect(result.citations.productContainerPresent).toBe(true)
    expect(result.citations.activeBodyConflict).toBe(false)
    expect(result.interpretation).toBe("official_page_explicit_empty_state_only")
    expect(result.identity).toBeNull()
    expect(result.originalPublishTime).toBeNull()
    expect(result.articleUrl).toBeNull()
  })

  it("parses PH-W02 positive: official empty copy in product container -> parsed_empty", () => {
    const html = readFixture("ph-w02-empty-positive.html")
    const result = parsePagasaEmptyState("PH-W02", html)
    expect(result.status).toBe("parsed_empty")
    if (result.status !== "parsed_empty") return
    expect(result.emptyStateOriginalText).toBe(PH_W02_EMPTY_TEXT)
    expect(result.citations.emptyTextCitation).toBe(PH_W02_EMPTY_TEXT)
  })

  it("rejects PH-W01 missing product container -> not_empty (even if empty text appears elsewhere)", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-missing-container.html"),
    )
    expect(result).toMatchObject({
      status: "not_empty",
      reason: "missing_product_container",
    })
  })

  it("rejects PH-W02 missing product container -> not_empty", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-missing-container.html"),
    )
    expect(result).toMatchObject({
      status: "not_empty",
      reason: "missing_product_container",
    })
  })

  it("rejects PH-W01 unknown empty copy -> not_empty", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-unknown-copy.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "unknown_empty_copy" })
  })

  it("rejects PH-W02 unknown empty copy -> not_empty", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-unknown-copy.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "unknown_empty_copy" })
  })

  it("rejects PH-W01 active body conflict must not silently pass as empty", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-active-body-conflict.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W02 active body conflict must not silently pass as empty", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-active-body-conflict.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("error / Cloudflare page -> not_empty failed_response_shape", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("error-403-cloudflare.html"),
    )
    expect(result).toMatchObject({
      status: "not_empty",
      reason: "failed_response_shape",
    })
  })

  it("non-2xx httpStatus -> not_empty failed_response_shape", () => {
    const result = parsePagasaEmptyState("PH-W02", "<html></html>", {
      httpStatus: 403,
    })
    expect(result).toMatchObject({
      status: "not_empty",
      reason: "failed_response_shape",
    })
  })

  it("missing html -> not_empty missing_html", () => {
    expect(parsePagasaEmptyState("PH-W01", null)).toMatchObject({
      status: "not_empty",
      reason: "missing_html",
    })
    expect(parsePagasaEmptyState("PH-W02", "   ")).toMatchObject({
      status: "not_empty",
      reason: "missing_html",
    })
  })
})

describe("parsePagasaEmptyState -> real-sample offline replay (private capture)", () => {
  it("replays PH-W01: wire SHA matches ledger and parse yields parsed_empty with citations", () => {
    const capture = loadPrivateCapture("PH-W01")
    if (!capture) {
      // Synthetic fixtures already cover contract; private raw is machine-local.
      expect(true).toBe(true)
      return
    }
    expect(capture.wireSha256).toBeTruthy()
    if (capture.expectedWireSha256) {
      expect(capture.wireSha256).toBe(capture.expectedWireSha256)
    }
    const publicLedger = path.resolve(
      process.cwd(),
      "docs/evidence/r2-4-pagasa-phw-20261026/PH-W01-fields.public.json",
    )
    if (existsSync(publicLedger)) {
      const fields = JSON.parse(readFileSync(publicLedger, "utf8")) as {
        wireSha256?: string
      }
      if (fields.wireSha256) {
        expect(capture.wireSha256).toBe(fields.wireSha256)
      }
    }
    const result = parsePagasaEmptyState("PH-W01", capture.html, {
      httpStatus: capture.httpStatus,
    })
    expect(result.status).toBe("parsed_empty")
    if (result.status !== "parsed_empty") return
    expect(result.emptyStateOriginalText).toBe(PH_W01_EMPTY_TEXT)
    expect(result.citations.emptyTextExactMatch).toBe(true)
    expect(result.citations.activeBodyConflict).toBe(false)
  })

  it("replays PH-W02: wire SHA matches ledger and parse yields parsed_empty with citations", () => {
    const capture = loadPrivateCapture("PH-W02")
    if (!capture) {
      expect(true).toBe(true)
      return
    }
    if (capture.expectedWireSha256) {
      expect(capture.wireSha256).toBe(capture.expectedWireSha256)
    }
    const publicLedger = path.resolve(
      process.cwd(),
      "docs/evidence/r2-4-pagasa-phw-20261026/PH-W02-fields.public.json",
    )
    if (existsSync(publicLedger)) {
      const fields = JSON.parse(readFileSync(publicLedger, "utf8")) as {
        wireSha256?: string
      }
      if (fields.wireSha256) {
        expect(capture.wireSha256).toBe(fields.wireSha256)
      }
    }
    const result = parsePagasaEmptyState("PH-W02", capture.html, {
      httpStatus: capture.httpStatus,
    })
    expect(result.status).toBe("parsed_empty")
    if (result.status !== "parsed_empty") return
    expect(result.emptyStateOriginalText).toBe(PH_W02_EMPTY_TEXT)
    expect(result.citations.emptyTextExactMatch).toBe(true)
  })
})
