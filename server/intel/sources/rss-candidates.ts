import { FEED_CONTENT_TYPES, type IntelSourceSeed } from "../sources"

/**
 * Default-closed RSS candidates read by the existing Feed parser (parseFeedEntries); no new parser, license, header, CA or HTTP exception.
 * MY-C01: exact catalog URL/host from docs/intel-source-catalog.md; product id "intel:my-c01" is distinct from the 2026-10-15
 * evidence-only id "bounded:MY-C01" (docs/evidence/r2-three-rss-2026-10-15/MY-C01-isolated-config.json), which is not a production identity.
 * Registering adds no qualification numerator and does not enable production collection.
 */
export const rssCandidates: readonly IntelSourceSeed[] = [
  {
    id: "intel:my-c01",
    catalogId: "MY-C01",
    name: "JKDM announcements (Royal Malaysian Customs)",
    kind: "rss",
    url: "https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss",
    enabled: false,
    persistence: "disallowed",
    allowedHosts: ["www.customs.gov.my"],
    allowedContentTypes: [...FEED_CONTENT_TYPES],
    intervalMs: 3600000,
  },
]
