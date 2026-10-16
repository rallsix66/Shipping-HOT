import type { Database } from "db0"
import { MANUAL_CLIP_SOURCE_ID } from "@shared/manual-clip"

export const manualClipMigration = {
  version: 29,
  name: "manual-clip",
  async up(db: Database) {
    await db.exec("ALTER TABLE intel_manual_action ADD COLUMN metadata_json TEXT NULL CHECK(metadata_json IS NULL OR length(metadata_json) <= 16000)")
    await db.prepare("INSERT INTO intel_source (id,catalog_id,name,kind,url,persistence,enabled,updated_at) VALUES (?, 'MANUAL-CLIP', '人工剪藏资料（未经独立核验）', 'manual', '', 'disallowed', 0, '2026-10-16T02:18:00.000Z')").run(MANUAL_CLIP_SOURCE_ID)
  },
} as const
