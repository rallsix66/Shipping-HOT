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

/**
 * Strict local qualification: PAGASA_STRICT_PRIVATE_REPLAY=1 makes missing raw FAIL
 * instead of skip. Default CI/dev path uses explicit it.skipWhenMissingRaw.
 */
const STRICT_PRIVATE_REPLAY = process.env.PAGASA_STRICT_PRIVATE_REPLAY === "1"

interface PrivateCapture {
  html: string
  wireSha256: string
  httpStatus: number
  expectedWireSha256: string
  publicWireSha256: string
  publicHttpStatus: number
}

type PrivateCaptureLoad =
  | { ok: true, capture: PrivateCapture }
  | { ok: false, reason: "missing_raw" | "incomplete_evidence", detail: string }

function loadPrivateCapture(productId: "PH-W01" | "PH-W02"): PrivateCaptureLoad {
  const binPath = path.join(PRIVATE_CAPTURE_ROOT, "private", `${productId}.response.bin`)
  const capturePath = path.join(PRIVATE_CAPTURE_ROOT, `${productId}-capture.json`)
  const publicLedger = path.resolve(
    process.cwd(),
    `docs/evidence/r2-4-pagasa-phw-20261026/${productId}-fields.public.json`,
  )
  if (!existsSync(binPath) || !existsSync(capturePath)) {
    return {
      ok: false,
      reason: "missing_raw",
      detail: `missing ${productId} private raw and/or capture json`,
    }
  }
  if (!existsSync(publicLedger)) {
    return {
      ok: false,
      reason: "incomplete_evidence",
      detail: `missing public ledger ${productId}-fields.public.json`,
    }
  }
  const buf = readFileSync(binPath)
  const wireSha256 = createHash("sha256").update(buf).digest("hex")
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as {
    httpStatus?: number
    wireSha256?: string
  }
  const fields = JSON.parse(readFileSync(publicLedger, "utf8")) as {
    httpStatus?: number
    wireSha256?: string
  }
  if (typeof capture.httpStatus !== "number") {
    return {
      ok: false,
      reason: "incomplete_evidence",
      detail: `${productId} capture.httpStatus missing`,
    }
  }
  if (typeof capture.wireSha256 !== "string" || capture.wireSha256.length === 0) {
    return {
      ok: false,
      reason: "incomplete_evidence",
      detail: `${productId} capture.wireSha256 missing`,
    }
  }
  if (typeof fields.httpStatus !== "number") {
    return {
      ok: false,
      reason: "incomplete_evidence",
      detail: `${productId} public ledger httpStatus missing`,
    }
  }
  if (typeof fields.wireSha256 !== "string" || fields.wireSha256.length === 0) {
    return {
      ok: false,
      reason: "incomplete_evidence",
      detail: `${productId} public ledger wireSha256 missing`,
    }
  }
  return {
    ok: true,
    capture: {
      html: buf.toString("utf8"),
      wireSha256,
      httpStatus: capture.httpStatus,
      expectedWireSha256: capture.wireSha256,
      publicWireSha256: fields.wireSha256,
      publicHttpStatus: fields.httpStatus,
    },
  }
}

const privateW01 = loadPrivateCapture("PH-W01")
const privateW02 = loadPrivateCapture("PH-W02")
const bothPrivateReady = privateW01.ok && privateW02.ok

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

  it("keeps PH-W01 Archive PDF out of active-body conflict", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-empty-positive.html"),
    )
    expect(result.status).toBe("parsed_empty")
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

  it("rejects PH-W02 div body after empty-state p (not only extra p)", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-div-body-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W01 second h3 body (matched empty h3 is not a blanket h3 skip)", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-second-h3-body.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W02 bare text residual after empty-state p", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-bare-text-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W01 nested body after empty h3 while Archive stays excluded", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-nested-body-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W01 direct img after empty h3 (self media, not only descendants)", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-direct-img-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W01 direct iframe after empty h3 (self media, not only descendants)", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-direct-iframe-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W01 nested media after empty h3 while Archive stays excluded", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-nested-media-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W02 direct img after empty p (self media, not only descendants)", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-direct-img-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W02 direct iframe after empty p (self media, not only descendants)", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-direct-iframe-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W02 nested media after empty p", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-nested-media-after-empty.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W02 duplicate product regions conservatively", () => {
    const result = parsePagasaEmptyState(
      "PH-W02",
      readFixture("ph-w02-duplicate-product.html"),
    )
    expect(result).toMatchObject({ status: "not_empty", reason: "active_body_conflict" })
  })

  it("rejects PH-W01 duplicate product regions conservatively", () => {
    const result = parsePagasaEmptyState(
      "PH-W01",
      readFixture("ph-w01-duplicate-product.html"),
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
  it.skipIf(!STRICT_PRIVATE_REPLAY)("strict mode requires both private originals + ledger evidence (no synthetic substitute)", () => {
    expect(privateW01.ok, privateW01.ok ? undefined : privateW01.detail).toBe(true)
    expect(privateW02.ok, privateW02.ok ? undefined : privateW02.detail).toBe(true)
  })

  it.skipIf(!privateW01.ok)("replays PH-W01: wire SHA matches ledger and parse yields parsed_empty with citations", () => {
    if (!privateW01.ok) throw new Error("unreachable: skipIf should have skipped")
    const capture = privateW01.capture
    expect(capture.wireSha256).toBe(capture.expectedWireSha256)
    expect(capture.wireSha256).toBe(capture.publicWireSha256)
    expect(capture.httpStatus).toBe(capture.publicHttpStatus)
    expect(capture.httpStatus).toBeGreaterThanOrEqual(200)
    expect(capture.httpStatus).toBeLessThan(300)
    const result = parsePagasaEmptyState("PH-W01", capture.html, {
      httpStatus: capture.httpStatus,
    })
    expect(result.status).toBe("parsed_empty")
    if (result.status !== "parsed_empty") return
    expect(result.emptyStateOriginalText).toBe(PH_W01_EMPTY_TEXT)
    expect(result.citations.emptyTextExactMatch).toBe(true)
    expect(result.citations.activeBodyConflict).toBe(false)
  })

  it.skipIf(!privateW02.ok)("replays PH-W02: wire SHA matches ledger and parse yields parsed_empty with citations", () => {
    if (!privateW02.ok) throw new Error("unreachable: skipIf should have skipped")
    const capture = privateW02.capture
    expect(capture.wireSha256).toBe(capture.expectedWireSha256)
    expect(capture.wireSha256).toBe(capture.publicWireSha256)
    expect(capture.httpStatus).toBe(capture.publicHttpStatus)
    expect(capture.httpStatus).toBeGreaterThanOrEqual(200)
    expect(capture.httpStatus).toBeLessThan(300)
    const result = parsePagasaEmptyState("PH-W02", capture.html, {
      httpStatus: capture.httpStatus,
    })
    expect(result.status).toBe("parsed_empty")
    if (result.status !== "parsed_empty") return
    expect(result.emptyStateOriginalText).toBe(PH_W02_EMPTY_TEXT)
    expect(result.citations.emptyTextExactMatch).toBe(true)
  })

  it.skipIf(STRICT_PRIVATE_REPLAY || bothPrivateReady)("non-strict path explicitly skips when private raw is absent (not false PASS)", () => {
    expect(privateW01.ok).toBe(false)
    expect(privateW02.ok).toBe(false)
  })
})
