import { MANUAL_CLIP_SOURCE_ID } from "@shared/manual-clip"
import type { IntelRepository } from "#/database/intel"
import { manualCatalog } from "#/intel/manual-catalog"
import { intelSourceSeeds } from "#/intel/sources.ts"
import { manualPersistenceFor } from "#/intel/manual-license"

export async function manualChecklist(repo: IntelRepository) {
  const existing = intelSourceSeeds.map(row => ({ id: row.id, catalogId: row.catalogId, name: row.name, urls: [row.url], grade: "A", cadence: "有灾害时", focus: "现有许可来源的可选人工补充；不代替自动来源健康证据", historicalOnly: false }))
  const clip = { id: MANUAL_CLIP_SOURCE_ID, catalogId: "MANUAL-CLIP", name: "人工剪藏资料（未经独立核验）", urls: [] as string[], grade: "unknown", cadence: "用户自行选择", focus: "目录外资料；正文需明确的用户权利声明，不是官方预警或自动来源验证。", historicalOnly: false }
  return Promise.all([...manualCatalog, ...existing, clip].map(async (row) => {
    const source = await repo.getSource(row.id)
    return { ...row, persistence: source ? manualPersistenceFor(source, row.urls[0] ?? "") : "disallowed", recentActions: await repo.listManualActions(row.id) }
  }))
}
