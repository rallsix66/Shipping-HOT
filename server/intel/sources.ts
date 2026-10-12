import type { IntelPersistence } from "#/database/intel"
import type { WebListConfig } from "#/intel/sources/config-keys"

/**
 * R2 first-slice seeds. ADR-008: docs/intel-source-catalog.md is the only seed list; every entry here
 * must carry a catalog ID and the exact catalog URL (enforced by test). Persistence is the license scope
 * for stored body text: full = licensed full text, excerpt_only = excerpt, disallowed = metadata only.
 */
export interface IntelSourceSeed {
  id: string
  catalogId: string
  name: string
  kind: "rss" | "atom" | "rdf" | "web_list"
  webList?: WebListConfig
  url: string
  persistence: IntelPersistence
  enabled: boolean
  allowedHosts: string[]
  allowedContentTypes: string[]
  intervalMs: number
}

const FEED_CONTENT_TYPES = ["application/rss+xml", "application/atom+xml", "application/rdf+xml", "application/xml", "text/xml"]
const HOUR = 60 * 60 * 1000

export const intelSourceSeeds: readonly IntelSourceSeed[] = [
  {
    id: "intel:th-w01",
    catalogId: "TH-W01",
    name: "TMD CAP alerts",
    kind: "rss",
    url: "https://www.tmd.go.th/en/api/xml/CAP",
    // Feed declares <copyright>public domain</copyright>.
    persistence: "full",
    enabled: true,
    allowedHosts: ["www.tmd.go.th"],
    allowedContentTypes: FEED_CONTENT_TYPES,
    intervalMs: HOUR,
  },
  {
    id: "intel:id-w01",
    catalogId: "ID-W01",
    name: "BMKG nowcast alerts",
    kind: "rss",
    url: "https://www.bmkg.go.id/alerts/nowcast/en/rss.xml",
    // Catalog note: attribution required and rate limited; keep excerpts only until licensing is reviewed.
    persistence: "excerpt_only",
    enabled: true,
    allowedHosts: ["www.bmkg.go.id"],
    allowedContentTypes: FEED_CONTENT_TYPES,
    intervalMs: HOUR,
  },
]
