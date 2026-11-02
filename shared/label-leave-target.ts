/**
 * Build TanStack navigate args so leave-confirm keeps search + hash from the blocked target.
 * Note: @tanstack/react-router useBlocker getLocation omits hash/href; callers may pass
 * the clicked <a href> via mergeHref so hash survives.
 */
export type BlockedLocationLike = {
  pathname?: string
  search?: unknown
  hash?: string
  href?: string
} | null | undefined

export function blockedLeaveTarget(next: BlockedLocationLike): {
  to: string
  search?: unknown
  hash?: string
} {
  const to = (next?.pathname && String(next.pathname)) || "/"
  const search = next?.search
  let hash: string | undefined
  if (typeof next?.hash === "string" && next.hash.length > 0) {
    hash = next.hash.startsWith("#") ? next.hash.slice(1) : next.hash
  }
  return { to, search, hash }
}

/** Prefer an explicit clicked-link href (includes hash) when blocker.next omitted it. */
export function mergeLeaveFromHref(next: BlockedLocationLike, href: string | null | undefined): BlockedLocationLike {
  const base = next && typeof next === "object" ? { ...next } : {}
  if (typeof href === "string" && href.length > 0) {
    try {
      const u = new URL(href, "http://local.invalid")
      if (!base.pathname) base.pathname = u.pathname
      if (base.hash == null || base.hash === "") {
        if (u.hash) base.hash = u.hash
      }
      const searchEmpty
        = base.search == null
          || base.search === ""
          || (typeof base.search === "object"
            && !Array.isArray(base.search)
            && Object.keys(base.search as Record<string, unknown>).length === 0)
      if (searchEmpty && u.search) {
        base.search = Object.fromEntries(new URLSearchParams(u.search))
      }
      // Clicked <a href> is authority for the leave-confirm href string (path+search+hash).
      base.href = `${u.pathname}${u.search}${u.hash}`
    } catch {
      base.href = href
    }
  }
  return base
}

export function blockedLeaveHref(next: BlockedLocationLike): string {
  if (typeof next?.href === "string" && next.href.length > 0) return next.href
  const t = blockedLeaveTarget(next)
  const searchStr = (() => {
    if (t.search == null) return ""
    if (typeof t.search === "string") return t.search.startsWith("?") || t.search === "" ? t.search : `?${t.search}`
    try {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(t.search as Record<string, unknown>)) {
        if (v == null) continue
        params.set(k, String(v))
      }
      const s = params.toString()
      return s ? `?${s}` : ""
    } catch {
      return ""
    }
  })()
  const hashStr = t.hash ? `#${t.hash}` : ""
  return `${t.to}${searchStr}${hashStr}`
}
