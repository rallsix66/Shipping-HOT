import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { open } from "#/intel/__fixtures__/isolated-db"
import { initShippingTables } from "#/database/shipping"
import { manualSubmit } from "#/intel/manual"
import { manualChecklist } from "#/intel/manual-checklist"
import { MANUAL_SCOPE_20261026_IDS, manualScope20261026Migration } from "#/database/migrations/030-manual-scope-r2-20261026"
import { shippingMigrations } from "#/database/migrations"
import { manualCatalog } from "#/intel/manual-catalog"

const NOW = "2026-10-26T08:00:00.000Z"
const LATER = "2026-10-26T09:00:00.000Z"
const SCOPE9 = [...MANUAL_SCOPE_20261026_IDS]
const MY_L01 = "intel:manual:my-l01"
const PH_W01 = "intel:manual:ph-w01"
const PH_W02 = "intel:manual:ph-w02"
const ENTRY = Object.fromEntries(SCOPE9.map((id) => {
  const row = manualCatalog.find(item => item.id === id)!
  return [id, row.urls[0] ?? ""]
}))

let state: ReturnType<typeof open>

beforeEach(async () => {
  state = open(":memory:")
  await initShippingTables(state.database, "real")
  vi.stubGlobal("fetch", () => {
    throw new Error("No network allowed")
  })
})
afterEach(() => {
  state.native.close()
  vi.unstubAllGlobals()
})

function base(sourceId: string, extra: Record<string, unknown> = {}) {
  return {
    requestId: `gap-${Math.random().toString(36).slice(2, 10)}`,
    sourceId,
    operator: "Gapfill reviewer",
    action: "submit",
    url: ENTRY[sourceId],
    title: "Offline synthetic metadata",
    body: "",
    ...extra,
  }
}

describe("manual-scope acceptance gaps (dots 1792999604)", () => {
  it("true old v29 fixture missing the 9 rows upgrades via 030, idempotent, preserves old rows", async () => {
    const old = open(":memory:")
    try {
      old.native.exec("PRAGMA foreign_keys=OFF; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)")
      for (const migration of shippingMigrations.filter(row => row.version <= 29)) {
        await migration.up(old.database)
        old.native.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(migration.version, migration.name, NOW)
      }
      // Current 028 seeds today's full catalog; strip the 9 to simulate true pre-scope v29.
      for (const id of SCOPE9) old.native.prepare("DELETE FROM intel_source WHERE id = ?").run(id)
      const beforeSources = old.native.prepare("SELECT * FROM intel_source ORDER BY id").all() as Array<{ id: string, kind: string }>
      expect(SCOPE9.every(id => !beforeSources.some(row => row.id === id))).toBe(true)
      expect(beforeSources.some(row => row.id === "intel:manual:cn-p05")).toBe(true)

      const auto = old.native.prepare("SELECT id FROM intel_source WHERE kind != 'manual' LIMIT 1").get() as { id: string } | undefined
      let beforeItems: unknown[] = []
      let beforeVersions: unknown[] = []
      if (auto) {
        await old.repository.writeEntry({
          sourceId: auto.id,
          canonicalUrl: "https://example.test/old-preserved",
          title: "Preserved pre-030",
          contentHash: "preserved-hash",
          contentScope: "metadata_only",
          extractorVersion: "pre-030",
          blocks: [],
          fetchedAt: NOW,
        })
        beforeItems = old.native.prepare("SELECT * FROM intel_item").all()
        beforeVersions = old.native.prepare("SELECT * FROM intel_item_version").all()
      }

      await manualScope20261026Migration.up(old.database)
      old.native.prepare("INSERT INTO schema_migrations VALUES (?,?,?)").run(30, manualScope20261026Migration.name, NOW)
      for (const id of SCOPE9) {
        const row = await old.repository.getSource(id)
        expect(row?.kind).toBe("manual")
        expect(row?.enabled).toBe(false)
        expect(row?.persistence).toBe("disallowed")
      }
      await manualScope20261026Migration.up(old.database)
      await manualScope20261026Migration.up(old.database)
      const placeholders = SCOPE9.map(() => "?").join(",")
      const afterNine = old.native.prepare(`SELECT COUNT(*) AS n FROM intel_source WHERE id IN (${placeholders})`).get(...SCOPE9) as { n: number }
      expect(afterNine.n).toBe(9)

      if (beforeItems.length) {
        expect(old.native.prepare("SELECT * FROM intel_item").all()).toEqual(beforeItems)
        expect(old.native.prepare("SELECT * FROM intel_item_version").all()).toEqual(beforeVersions)
      }
      const nonScopeManual = beforeSources.filter(row => row.kind === "manual").length
      expect(old.native.prepare(`SELECT COUNT(*) AS n FROM intel_source WHERE kind='manual' AND id NOT IN (${placeholders})`).get(...SCOPE9)).toEqual({ n: nonScopeManual })
    } finally {
      old.native.close()
    }
  })

  it("covers 9-item path: checklist, metadata save, empty date, checked_empty, body reject", async () => {
    const list = await manualChecklist(state.repository)
    for (const id of SCOPE9) {
      expect(list.some(row => row.id === id)).toBe(true)
      const source = await state.repository.getSource(id)
      expect(source?.kind).toBe("manual")

      await expect(manualSubmit(state.repository, base(id, { body: "Restricted full text" }), NOW)).rejects.toThrow("invalid")

      const emptyDate = await manualSubmit(state.repository, base(id, {
        requestId: `meta-empty-${id.replace(/[^\w-]/g, "").slice(-12)}`,
        title: "Metadata without publish time",
      }), NOW)
      expect(emptyDate.outcome).toBe("created")
      expect((await state.repository.getItem(emptyDate.itemId!))?.publishedAt).toBeNull()
      expect((await state.repository.listVersions(emptyDate.itemId!))[0].contentScope).toBe("metadata_only")

      const check = { requestId: `empty-${id.replace(/[^\w-]/g, "").slice(-12)}`, sourceId: id, operator: "Gapfill reviewer", action: "checked_empty" as const }
      await manualSubmit(state.repository, check, LATER)
      expect((await state.repository.listManualActions(id)).some(row => row.action === "checked_empty")).toBe(true)
    }
  })

  it("my-l01 shared entry url revises one whole-page record; invented slug rejected; date-only rejected", async () => {
    const url = ENTRY[MY_L01]
    const first = await manualSubmit(state.repository, base(MY_L01, {
      requestId: "myl01-aa",
      title: "Service update page snapshot A",
      url,
    }), NOW)
    const second = await manualSubmit(state.repository, base(MY_L01, {
      requestId: "myl01-bb",
      title: "Service update page snapshot B",
      url,
    }), LATER)
    expect(second.itemId).toBe(first.itemId)
    expect(second.outcome).toBe("revised")
    expect(await state.repository.listItems(MY_L01)).toHaveLength(1)
    expect(await state.repository.listVersions(first.itemId!)).toHaveLength(2)

    await expect(manualSubmit(state.repository, base(MY_L01, {
      requestId: "myl01-slug1",
      url: "https://www.pos.com.my/service-update/invented-card",
      title: "Invented card",
    }), NOW)).rejects.toThrow("invalid")
    expect(await state.repository.listItems(MY_L01)).toHaveLength(1)

    await expect(manualSubmit(state.repository, base(MY_L01, {
      requestId: "myl01-dateonly",
      publishedAt: "2026-10-14",
    }), NOW)).rejects.toThrow("invalid")
    await expect(manualSubmit(state.repository, base(MY_L01, {
      requestId: "myl01-midnight1",
      publishedAt: "2026-10-14T00:00:00",
    }), NOW)).rejects.toThrow("invalid")

    const withTz = await manualSubmit(state.repository, base(MY_L01, {
      requestId: "myl01-tz01",
      title: "Trusted timezone publish",
      publishedAt: "2026-10-14T12:00:00+08:00",
    }), LATER)
    expect(withTz.itemId).toBe(first.itemId)
    expect((await state.repository.getItem(withTz.itemId!))?.publishedAt).toBe("2026-10-14T04:00:00.000Z")
  })

  it("pagasa allows www html entry metadata only; rejects pubfiles pdf host; no body", async () => {
    for (const id of [PH_W01, PH_W02]) {
      const ok = await manualSubmit(state.repository, base(id, {
        requestId: `pagasa-ok-${id.slice(-3)}`,
        title: "PAGASA HTML entry metadata",
      }), NOW)
      expect(ok.outcome).toBe("created")
      expect((await state.repository.listVersions(ok.itemId!))[0].contentScope).toBe("metadata_only")

      await expect(manualSubmit(state.repository, base(id, {
        requestId: `pagasa-pdf-${id.slice(-3)}`,
        url: "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin.pdf",
        title: "PDF must stay outside save permission",
      }), NOW)).rejects.toThrow("invalid")

      await expect(manualSubmit(state.repository, base(id, {
        requestId: `pagasa-other-${id.slice(-3)}`,
        url: "https://www.pagasa.dost.gov.ph/other/path.pdf",
        title: "Non-entry path rejected",
      }), NOW)).rejects.toThrow("invalid")

      await expect(manualSubmit(state.repository, base(id, {
        requestId: `pagasa-body-${id.slice(-3)}`,
        body: "Full bulletin text not permitted",
      }), NOW)).rejects.toThrow("invalid")
    }
  })
})
