/**
 * Product-scoped PAGASA empty-state parse for PH-W01 / PH-W02.
 *
 * Scope: offline verification of official-page explicit empty-state only.
 * Not a production collector, not an ingest job, and does not invent risk events.
 * parsed_empty means the official product container shows the known empty copy —
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

/**
 * Residual body after exempting only the matched empty-state node.
 * Conservative: any other meaningful text/body node in the target region is a conflict.
 * Does not rely solely on keyword or tag allowlists.
 */
function hasResidualMeaningfulBody(
  $: cheerio.CheerioAPI,
  region: cheerio.Cheerio<any>,
  exemptNode: cheerio.Cheerio<any>,
): boolean {
  const exemptEl = exemptNode.length ? exemptNode.get(0) : null
  const nodes = region.contents().toArray()
  for (const node of nodes) {
    if (exemptEl && node === exemptEl) continue
    if (node.type === "text") {
      if (normalizeText((node as { data?: string }).data ?? "").length > 0) return true
      continue
    }
    if (node.type === "comment") continue
    if (node.type !== "tag") continue
    const el = node as any
    const text = normalizeText($(el).text())
    if (text.length > 0) return true
    // Current node itself OR descendants: direct img/iframe (find excludes self) counts as body.
    const $el = $(el)
    if (
      $el.is("img, iframe, object, embed, video, a[href]")
      || $el.find("img, iframe, object, embed, video, a[href]").length > 0
    ) {
      return true
    }
  }
  return false
}

function hasPdfLink(root: cheerio.Cheerio<any>): boolean {
  return root.find(`a[href$=".pdf"], a[href*=".pdf?"]`).length > 0
}

function parsePhW01(html: string): PagasaEmptyParseResult {
  const $ = cheerio.load(html)
  const products = $(PH_W01_PRODUCT_CONTAINER)
  if (products.length === 0) {
    return notEmpty("PH-W01", "missing_product_container", "product container absent", {
      productContainerSelector: PH_W01_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W01_EMPTY_NODE,
    })
  }
  // Duplicate product regions: do not trust .first(); treat as conflict.
  if (products.length > 1) {
    return notEmpty(
      "PH-W01",
      "active_body_conflict",
      `duplicate product containers (${products.length}); refusing empty classification`,
      {
        productContainerSelector: PH_W01_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W01_EMPTY_NODE,
      },
    )
  }

  const product = products.first()

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

  const panelBodies = bulletinContent.find(".panel-body")
  if (panelBodies.length > 1) {
    return notEmpty(
      "PH-W01",
      "active_body_conflict",
      `duplicate bulletin panel-body regions (${panelBodies.length}); refusing empty classification`,
      {
        productContainerSelector: PH_W01_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W01_EMPTY_NODE,
      },
    )
  }

  const panelBody = panelBodies.first()
  const emptyNode = panelBody.find("> h3").filter((_, el) => {
    return normalizeText($(el).text()) === PH_W01_EMPTY_TEXT
  }).first()
  const emptyText = emptyNode.length ? normalizeText(emptyNode.text()) : ""

  if (!emptyNode.length || emptyText !== PH_W01_EMPTY_TEXT) {
    const firstH3 = panelBody.find("> h3").first()
    const observed = firstH3.length ? normalizeText(firstH3.text()) : ""
    return notEmpty(
      "PH-W01",
      "unknown_empty_copy",
      firstH3.length
        ? `h3 text did not match known empty copy: ${JSON.stringify(observed.slice(0, 160))}`
        : "empty-state h3 missing inside bulletin panel-body",
      {
        productContainerSelector: PH_W01_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W01_EMPTY_NODE,
      },
    )
  }

  const bulletinRegionText = normalizeText(bulletinContent.text())
  const pdfInBulletin = hasPdfLink(bulletinContent)
  const residualInPanel = hasResidualMeaningfulBody($, panelBody, emptyNode)
  const activeBody
    = ACTIVE_BODY_RE.test(bulletinRegionText)
      || pdfInBulletin
      || residualInPanel

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
  const products = $(PH_W02_PRODUCT_CONTAINER)
  if (products.length === 0) {
    return notEmpty("PH-W02", "missing_product_container", "product container absent", {
      productContainerSelector: PH_W02_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W02_EMPTY_NODE,
    })
  }
  if (products.length > 1) {
    return notEmpty(
      "PH-W02",
      "active_body_conflict",
      `duplicate product containers (${products.length}); refusing empty classification`,
      {
        productContainerSelector: PH_W02_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W02_EMPTY_NODE,
      },
    )
  }

  const product = products.first()
  const regions = product.find(".weekly-content-adv")
  if (regions.length === 0) {
    return notEmpty("PH-W02", "missing_product_container", "weekly-content-adv region absent", {
      productContainerSelector: PH_W02_PRODUCT_CONTAINER,
      emptyNodeSelector: PH_W02_EMPTY_NODE,
    })
  }
  if (regions.length > 1) {
    return notEmpty(
      "PH-W02",
      "active_body_conflict",
      `duplicate weekly-content-adv regions (${regions.length}); refusing empty classification`,
      {
        productContainerSelector: PH_W02_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W02_EMPTY_NODE,
      },
    )
  }

  const region = regions.first()
  const emptyNode = region.find("> p").filter((_, el) => {
    return normalizeText($(el).text()) === PH_W02_EMPTY_TEXT
  }).first()
  const emptyText = emptyNode.length ? normalizeText(emptyNode.text()) : ""

  if (!emptyNode.length || emptyText !== PH_W02_EMPTY_TEXT) {
    const firstP = region.find("> p").first()
    const observed = firstP.length ? normalizeText(firstP.text()) : ""
    return notEmpty(
      "PH-W02",
      "unknown_empty_copy",
      firstP.length
        ? `p text did not match known empty copy: ${JSON.stringify(observed.slice(0, 160))}`
        : "empty-state p missing inside weekly-content-adv",
      {
        productContainerSelector: PH_W02_PRODUCT_CONTAINER,
        emptyNodeSelector: PH_W02_EMPTY_NODE,
      },
    )
  }

  const regionText = normalizeText(region.text())
  const pdfInRegion = hasPdfLink(region)
  const residualInRegion = hasResidualMeaningfulBody($, region, emptyNode)
  const activeBody
    = ACTIVE_BODY_RE.test(regionText) || pdfInRegion || residualInRegion

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
