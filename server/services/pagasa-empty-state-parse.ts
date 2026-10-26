/**
 * Product-scoped PAGASA empty-state parse for PH-W01 / PH-W02.
 *
 * Scope: offline verification of official-page explicit empty-state only.
 * Not a production collector, not an ingest job, and does not invent risk events.
 * parsed_empty means the official product container shows the known empty copy ?
 * it does NOT mean "Philippines has no weather risk".
 */
import * as cheerio from "cheerio"

export type PagasaEmptyProductId = "PH-W01" | "PH-W02"

export const PH_W01_EMPTY_TEXT
  = "No Active Tropical Cyclone within the Philippine Area of Responsibility"
export const PH_W02_EMPTY_TEXT
  = "As of today, there is no Weather Advisory issued."

export const PH_W01_PRODUCT_CONTAINER
  = ".tropical-cyclone-weather-bulletin-page"
export const PH_W01_BULLETIN_PANEL
  = ".tropical-cyclone-weather-bulletin-page .article-content .panel-body"
export const PH_W01_EMPTY_NODE
  = ".tropical-cyclone-weather-bulletin-page .article-content .panel-body > h3"

export const PH_W02_PRODUCT_CONTAINER = ".article-content.weather-advisory"
export const PH_W02_EMPTY_REGION
  = ".article-content.weather-advisory .weekly-content-adv"
export const PH_W02_EMPTY_NODE
  = ".article-content.weather-advisory .weekly-content-adv > p"

const ACTIVE_BODY_RE
  = /Issued\s+at|Severe\s+Weather\s+Bulletin|Bulletin\s+No\.?\s*\d|TCWS|Tropical\s+Cyclone\s+Warning\s+Signal|Public\s+Storm\s+Warning/i

export interface PagasaParsedEmptyResult {
  status: "parsed_empty"
  productId: PagasaEmptyProductId
  emptyStateOriginalText: string
  productContainerSelector: string
  emptyNodeSelector: string
  citations: {
    productContainerPresent: true
    emptyTextExactMatch: true
    emptyTextCitation: string
    activeBodyConflict: false
  }
  interpretation: "official_page_explicit_empty_state_only"
  identity: null
  originalPublishTime: null
  articleUrl: null
}

export type PagasaNotEmptyReason =
  | "missing_html"
  | "failed_response_shape"
  | "missing_product_container"
  | "unknown_empty_copy"
  | "active_body_conflict"

export interface PagasaNotEmptyResult {
  status: "not_empty"
  productId: PagasaEmptyProductId
  reason: PagasaNotEmptyReason
  detail?: string
  productContainerSelector?: string
  emptyNodeSelector?: string
}

export type PagasaEmptyParseResult =
  | PagasaParsedEmptyResult
  | PagasaNotEmptyResult

export interface PagasaEmptyParseOptions {
  /** When provided and not 2xx, treat as failed response (never empty). */
  httpStatus?: number
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function looksLikeErrorPage(html: string): boolean {
  const sample = html.slice(0, 4000).toLowerCase()
  if (sample.includes("access denied") && sample.includes("cloudflare")) return true
  if (sample.includes("403 forbidden") || sample.includes("error 403")) return true
  if (sample.includes("502 bad gateway") || sample.includes("503 service")) return true
  if (sample.includes("<title>attention required") && sample.includes("cloudflare")) {
    return true
  }
  return false
}

function parsedEmpty(
  productId: PagasaEmptyProductId,
  emptyText: string,
  productContainerSelector: string,
  emptyNodeSelector: string,
  citation: string,
): PagasaParsedEmptyResult {
  return {
    status: "parsed_empty",
    productId,
    emptyStateOriginalText: emptyText,
    productContainerSelector,
    emptyNodeSelector,
    citations: {
      productContainerPresent: true,
      emptyTextExactMatch: true,
      emptyTextCitation: citation,
      activeBodyConflict: false,
    },
    interpretation: "official_page_explicit_empty_state_only",
    identity: null,
    originalPublishTime: null,
    articleUrl: null,
  }
}

function notEmpty(
  productId: PagasaEmptyProductId,
  reason: PagasaNotEmptyReason,
  detail?: string,
  selectors?: { productContainerSelector?: string, emptyNodeSelector?: string },
): PagasaNotEmptyResult {
  return {
    status: "not_empty",
    productId,
    reason,
    detail,
    ...selectors,
  }
}

function parsePhW01(html: string): PagasaEmptyParseResult {
  const $ = cheerio.load(html)
  const product = $(PH_W01_PRODUCT_CONTAINER).first()
  if (product.length === 0) {
    return notEmpty("PH-W01", "missing_product_container", "product container absent", {
      productContainerSelector: PH_W01_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W01_EMPTY_NODE,
    })
  }

  // Scope to the Tropical Cyclone Bulletin article-content only (exclude Archive).
  const bulletinHeader = product
    .find(".article-header")
    .filter((_, el) => /tropical\s+cyclone\s+bulletin/i.test($(el).text()))
    .first()
  const bulletinContent
    = bulletinHeader.length > 0
      ? bulletinHeader.nextAll(".article-content").first()
      : product.find(".article-content").first()

  if (bulletinContent.length === 0) {
    return notEmpty("PH-W01", "missing_product_container", "bulletin article-content absent", {
      productContainerSelector: PH_W01_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W01_EMPTY_NODE,
    })
  }

  const panelBody = bulletinContent.find(".panel-body").first()
  const emptyNode = panelBody.find("> h3").first()
  const emptyText = emptyNode.length ? normalizeText(emptyNode.text()) : ""

  if (!emptyNode.length || emptyText !== PH_W01_EMPTY_TEXT) {
    return notEmpty(
      "PH-W01",
      "unknown_empty_copy",
      emptyNode.length
        ? `h3 text did not match known empty copy: ${JSON.stringify(emptyText.slice(0, 160))}`
        : "empty-state h3 missing inside bulletin panel-body",
      {
        productContainerSelector: PH_W01_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W01_EMPTY_NODE,
      },
    )
  }

  const bulletinRegionText = normalizeText(bulletinContent.text())
  const pdfInBulletin = bulletinContent.find("a[href$=\".pdf\"], a[href*=\".pdf?\"]").length > 0
  const activeBody
    = ACTIVE_BODY_RE.test(bulletinRegionText)
      || pdfInBulletin
      || panelBody
        .children()
        .toArray()
        .some((el) => {
          const tag = ((el as { tagName?: string }).tagName ?? "").toLowerCase()
          if (tag === "h3") return false
          const t = normalizeText($(el).text())
          return t.length > 0 && t !== PH_W01_EMPTY_TEXT
        })

  if (activeBody) {
    return notEmpty(
      "PH-W01",
      "active_body_conflict",
      "bulletin product region contains active-body markers alongside or instead of sole empty copy",
      {
        productContainerSelector: PH_W01_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W01_EMPTY_NODE,
      },
    )
  }

  return parsedEmpty(
    "PH-W01",
    PH_W01_EMPTY_TEXT,
    PH_W01_PRODUCT_CONTAINER,
    PH_W01_EMPTY_NODE,
    emptyText,
  )
}

function parsePhW02(html: string): PagasaEmptyParseResult {
  const $ = cheerio.load(html)
  const product = $(PH_W02_PRODUCT_CONTAINER).first()
  if (product.length === 0) {
    return notEmpty("PH-W02", "missing_product_container", "product container absent", {
      productContainerSelector: PH_W02_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W02_EMPTY_NODE,
    })
  }

  const region = product.find(".weekly-content-adv").first()
  if (region.length === 0) {
    return notEmpty("PH-W02", "missing_product_container", "weekly-content-adv region absent", {
      productContainerSelector: PH_W02_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W02_EMPTY_NODE,
    })
  }

  const emptyNode = region.find("> p").first()
  const emptyText = emptyNode.length ? normalizeText(emptyNode.text()) : ""

  if (!emptyNode.length || emptyText !== PH_W02_EMPTY_TEXT) {
    return notEmpty(
      "PH-W02",
      "unknown_empty_copy",
      emptyNode.length
        ? `p text did not match known empty copy: ${JSON.stringify(emptyText.slice(0, 160))}`
        : "empty-state p missing inside weekly-content-adv",
      {
        productContainerSelector: PH_W02_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W02_EMPTY_NODE,
      },
    )
  }

  const regionText = normalizeText(region.text())
  const pdfInRegion = region.find("a[href$=\".pdf\"], a[href*=\".pdf?\"]").length > 0
  const extraParagraphs = region
    .find("> p")
    .toArray()
    .filter((el) => {
      const t = normalizeText($(el).text())
      return t.length > 0 && t !== PH_W02_EMPTY_TEXT
    })
  const activeBody
    = ACTIVE_BODY_RE.test(regionText) || pdfInRegion || extraParagraphs.length > 0

  if (activeBody) {
    return notEmpty(
      "PH-W02",
      "active_body_conflict",
      "weather-advisory region contains active-body markers alongside or instead of sole empty copy",
      {
        productContainerSelector: PH_W02_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W02_EMPTY_NODE,
      },
    )
  }

  return parsedEmpty(
    "PH-W02",
    PH_W02_EMPTY_TEXT,
    PH_W02_PRODUCT_CONTAINER,
    PH_W02_EMPTY_NODE,
    emptyText,
  )
}

/**
 * Parse official-page explicit empty-state for PH-W01 or PH-W02.
 * Missing container / unknown copy / error page / failed response / body conflict
 * must NOT count as empty.
 */
export function parsePagasaEmptyState(
  productId: PagasaEmptyProductId,
  html: string | null | undefined,
  options: PagasaEmptyParseOptions = {},
): PagasaEmptyParseResult {
  if (options.httpStatus != null && (options.httpStatus < 200 || options.httpStatus >= 300)) {
    return notEmpty(
      productId,
      "failed_response_shape",
      `httpStatus=${options.httpStatus}`,
    )
  }
  if (html == null || typeof html !== "string" || html.trim().length === 0) {
    return notEmpty(productId, "missing_html", "html empty or absent")
  }
  if (looksLikeErrorPage(html)) {
    return notEmpty(productId, "failed_response_shape", "html resembles error/block page")
  }
  return productId === "PH-W01" ? parsePhW01(html) : parsePhW02(html)
}
