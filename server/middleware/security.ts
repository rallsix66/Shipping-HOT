import { createError, defineEventHandler, getHeader, getMethod, getRequestURL } from "h3"

// Shipping HOT is a local, single-user tool. There is no account system; access
// control here is a loopback/host boundary, not user authentication. It must not
// be described as safe to expose to a public network.
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const MAX_BODY_BYTES = 1024 * 1024

function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
  } catch {
    return undefined
  }
}

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
    return
  }

  const hostHeader = getHeader(event, "host")
  if (hostHeader) {
    const host = hostnameOf(hostHeader)
    if (!host || !ALLOWED_HOSTS.has(host)) {
      throw createError({ statusCode: 403, statusMessage: "forbidden_host" })
    }
  }

  const method = getMethod(event).toUpperCase()
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return
  }

  // Non-browser local clients may omit Origin; a present Origin must be same-host.
  const origin = getHeader(event, "origin")
  if (origin && origin !== "null") {
    const originHost = hostnameOf(origin)
    if (!originHost || !ALLOWED_HOSTS.has(originHost)) {
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
    const contentType = getHeader(event, "content-type") ?? ""
    if (!contentType.toLowerCase().includes("application/json")) {
      throw createError({ statusCode: 415, statusMessage: "unsupported_media_type" })
    }
  }
})
