import type { IntelRepository } from "#/database/intel"
import { manualCatalog } from "#/intel/manual-catalog"
import { intelSourceSeeds } from "#/intel/sources.ts"

export async function manualChecklist(repo: IntelRepository) {
  const existing = intelSourceSeeds.map(row => ({ id: row.id, catalogId: row.catalogId, name: row.name, urls: [row.url], grade: "A", cadence: "有灾害时", focus: "现有许可来源的可选人工补充；不代替自动来源健康证据", historicalOnly: false }))
  return Promise.all([...manualCatalog, ...existing].map(async row => ({ ...row, persistence: (await repo.getSource(row.id))?.persistence ?? "disallowed", recentActions: await repo.listManualActions(row.id) })))
}
