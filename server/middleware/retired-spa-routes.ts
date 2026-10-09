import { createError, defineEventHandler, getMethod, getRequestURL } from "h3"

/** R1 (ADR-006): retired client routes must not be served as SPA shell — direct GET/HEAD returns 404. */
function isRetiredSpaPath(pathname: string): boolean {
  return pathname === "/vessels"
    || pathname.startsWith("/vessels/")
    || pathname === "/voyages"
    || pathname.startsWith("/voyages/")
}

export default defineEventHandler((event) => {
  const method = getMethod(event).toUpperCase()
  if (method !== "GET" && method !== "HEAD") return

  const { pathname } = getRequestURL(event)
  if (!isRetiredSpaPath(pathname)) return

  throw createError({ statusCode: 404, statusMessage: "Not Found" })
})
