import { FEED_CONTENT_TYPES, type IntelSourceSeed } from "../sources"

/**
 * Default-closed RSS candidates read by the existing Feed parser (parseFeedEntries); no new parser, license, header, CA or HTTP exception.
 * MY-C01 / MY-T01 / PH-M01: exact catalog URL/host from docs/intel-source-catalog.md; product ids "intel:<catalog>" are distinct from the 2026-10-15
 * evidence-only ids "bounded:<catalog>" (docs/evidence/r2-three-rss-2026-10-15/*-isolated-config.json), which are not production identities.
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
  {
    id: "intel:my-t01",
    catalogId: "MY-T01",
    name: "MOF Malaysia media releases",
    kind: "rss",
    url: "https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss",
    enabled: false,
    persistence: "disallowed",
    allowedHosts: ["www.mof.gov.my"],
    allowedContentTypes: [...FEED_CONTENT_TYPES],
    intervalMs: 3600000,
  },
  {
    id: "intel:ph-m01",
    catalogId: "PH-M01",
    name: "PortCalls Asia",
    kind: "rss",
    url: "https://portcalls.com/feed/",
    enabled: false,
    persistence: "disallowed",
    allowedHosts: ["portcalls.com"],
    allowedContentTypes: [...FEED_CONTENT_TYPES],
    intervalMs: 3600000,
  },
]
