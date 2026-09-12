import process from "node:process"
import { createError, defineEventHandler, getHeader, getMethod, getRequestURL } from "h3"

// Shipping HOT is a local, single-user tool. There is no account system; access
// control here is a loopback/host boundary, not user authentication. It must not
// be described as safe to expose to a public network.
//
// Configuration (no secrets):
//   SHIPPING_ALLOWED_HOSTS       comma-separated Host hostnames (default loopback set)
//   SHIPPING_ALLOWED_ORIGINS     comma-separated full origins allowed beyond same-origin
//                                (for an explicit dev-proxy exception; scheme+host+port)
//   SHIPPING_ALLOW_NO_ORIGIN     "false" rejects state-changing requests without Origin
//                                (default: allowed, for approved local non-browser clients)
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"]
const MAX_BODY_BYTES = 1024 * 1024

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map(item => item.trim()).filter(Boolean)
}

const envHosts = splitList(process.env.SHIPPING_ALLOWED_HOSTS)
const ALLOWED_HOSTS = new Set(envHosts.length > 0 ? envHosts : DEFAULT_ALLOWED_HOSTS)
const EXPLICIT_ORIGINS = new Set(splitList(process.env.SHIPPING_ALLOWED_ORIGINS))
const ALLOW_MISSING_ORIGIN = process.env.SHIPPING_ALLOW_NO_ORIGIN !== "false"

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
  } catch {
    return undefined
  }
}

function normalizedOrigin(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.origin
  } catch {
    return undefined
  }
}

function sameOriginOf(event: Parameters<typeof getMethod>[0], hostHeader: string): string {
  const forwarded = getHeader(event, "x-forwarded-proto")?.split(",")[0]?.trim()
  const socketEncrypted = Boolean((event.node?.req?.socket as { encrypted?: boolean } | undefined)?.encrypted)
  const protocol = forwarded || (socketEncrypted ? "https" : "http")
  return `${protocol}://${hostHeader}`
}

function mediaTypeOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  const mediaType = value.split(";")[0]?.trim().toLowerCase()
  return mediaType || undefined
}

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    return
  }

  const hostHeader = getHeader(event, "host")
  const host = hostnameOf(hostHeader)
  if (!hostHeader || !host || !ALLOWED_HOSTS.has(host)) {
    throw createError({ statusCode: 403, statusMessage: "forbidden_host" })
  }

  const method = getMethod(event).toUpperCase()
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return
  }

  const originHeader = getHeader(event, "origin")
  if (originHeader === undefined || originHeader === null || originHeader.trim() === "") {
    if (!ALLOW_MISSING_ORIGIN) {
      throw createError({ statusCode: 403, statusMessage: "origin_required" })
    }
  } else {
    const rawOrigin = originHeader.trim()
    // `Origin: null` is never equivalent to a missing Origin; reject by default.
    const origin = rawOrigin.toLowerCase() === "null" ? undefined : normalizedOrigin(rawOrigin)
    const sameOrigin = sameOriginOf(event, hostHeader)
    if (!origin || (origin !== sameOrigin && !EXPLICIT_ORIGINS.has(origin))) {
      throw createError({ statusCode: 403, statusMessage: "forbidden_origin" })
    }
  }

  // Declared length is the only bounded signal available before the body is
  // read; reject chunked writes so the size cap cannot be bypassed.
  const transferEncoding = getHeader(event, "transfer-encoding")
  if (transferEncoding && transferEncoding.toLowerCase().includes("chunked")) {
    throw createError({ statusCode: 411, statusMessage: "chunked_not_supported" })
  }

  const contentLength = Number(getHeader(event, "content-length") ?? "0")
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "payload_too_large" })
  }

  if (Number.isFinite(contentLength) && contentLength > 0) {
    if (mediaTypeOf(getHeader(event, "content-type")) !== "application/json") {
      throw createError({ statusCode: 415, statusMessage: "unsupported_media_type" })
    }
  }
})
