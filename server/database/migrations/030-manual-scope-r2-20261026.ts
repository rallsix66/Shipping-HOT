import type { Database } from "db0"
import { manualCatalog } from "#/intel/manual-catalog"

/** User decision 2026-10-26: wire rem8 + MY-P02 into existing manual catalog/checklist/save path. Additive rows only. */
export const MANUAL_SCOPE_20261026_IDS = [
  "intel:manual:cn-p02",
  "intel:manual:vn-p01",
  "intel:manual:my-p03",
  "intel:manual:my-l01",
  "intel:manual:ph-p01",
  "intel:manual:ph-w01",
  "intel:manual:ph-w02",
  "intel:manual:xx-f01",
  "intel:manual:my-p02",
] as const

export const manualScope20261026Migration = {
  version: 30,
  name: "manual-scope-r2-20261026",
  async up(db: Database) {
    const stamp = "2026-10-26T07:10:00.000Z"
    const wanted = new Set<string>(MANUAL_SCOPE_20261026_IDS)
    for (const source of manualCatalog) {
      if (!wanted.has(source.id)) continue
      await db.prepare(
        "INSERT INTO intel_source (id, catalog_id, name, kind, url, persistence, enabled, updated_at) VALUES (?, ?, ?, 'manual', ?, 'disallowed', 0, ?) ON CONFLICT(id) DO NOTHING",
      ).run(source.id, source.catalogId, source.name, source.urls[0] ?? "", stamp)
    }
  },
} as const
