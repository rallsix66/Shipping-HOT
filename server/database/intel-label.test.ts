import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { IntelLabelRepository } from "#/database/intel-label"

type Native = InstanceType<typeof NativeDatabase>
function wrap(native: Native) {
  return createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
}

describe("intel label repository §4.9", () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) {
      try {
        cleanups.pop()!()
      } catch { /* best-effort */ }
    }
  })

  async function fresh() {
    const native = new NativeDatabase(":memory:")
    cleanups.push(() => native.close())
    const db = wrap(native)
    await initShippingTables(db, "mock")
    return { native, db, repo: new IntelLabelRepository(db) }
  }

  it("enrolls URL+excerpt only, AI prelabel ≠ human confirmed", async () => {
    const { repo } = await fresh()
    const item = await repo.enroll({
      itemId: "item-a",
      versionId: "ver-a",
      contentHash: "hash-a",
      sourceUrl: "https://example.test/a",
      excerpt: "licensed excerpt only",
      title: "A",
      category: "port",
      language: "en",
      aiPrelabel: {
        decision: {
          prefilterKeep: true,
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-11-02",
          isOfficialStatement: false,
        },
      },
    })
    expect(item.queueStatus).toBe("ai_prelabeled")
    expect(item.excerpt).toBe("licensed excerpt only")
    const coverage = await repo.coverage()
    expect(coverage.total).toBe(1)
    expect(coverage.humanConfirmed).toBe(0)
    expect(coverage.missingNotes).toContain("no_human_confirmed_labels")
    expect(coverage.missingNotes.some(n => n.startsWith("below_r3_2_target_200"))).toBe(true)

    await expect(repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-a",
      kind: "human_confirm",
      operator: "system:ai",
      decision: {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-11-02",
        isOfficialStatement: false,
      },
    })).rejects.toThrow(/operator_must_be_human/)

    const human = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-a",
      kind: "human_confirm",
      operator: "tester.one",
      decision: {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-11-02",
        isOfficialStatement: false,
      },
      clientRequestId: "req-1",
    })
    expect(human.isHuman).toBe(true)
    expect((await repo.getItem(item.id))?.queueStatus).toBe("human_confirmed")

    // duplicate submit returns same logical decision without error
    const dup = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-a",
      kind: "human_confirm",
      operator: "tester.one",
      decision: human.decision,
      clientRequestId: "req-1",
    })
    expect(dup.id).toBe(human.id)
  })

  it("rejects stale labels when content hash changes (version binding)", async () => {
    const { repo } = await fresh()
    const item = await repo.enroll({
      itemId: "item-b",
      versionId: "ver-b1",
      contentHash: "hash-b1",
      sourceUrl: "https://example.test/b",
      excerpt: "v1",
      title: "B",
    })
    // re-enroll same item/version with new hash clears human status path
    const updated = await repo.enroll({
      itemId: "item-b",
      versionId: "ver-b1",
      contentHash: "hash-b2",
      sourceUrl: "https://example.test/b",
      excerpt: "v2",
      title: "B",
    })
    expect(updated.contentHash).toBe("hash-b2")
    expect(updated.queueStatus).toBe("unreviewed")
    await expect(repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-b1",
      kind: "human_correct",
      operator: "tester.two",
      decision: {
        prefilterKeep: false,
        eventType: null,
        countries: [],
        ports: [],
        effectiveFrom: null,
        isOfficialStatement: null,
      },
    })).rejects.toThrow(/content_hash_mismatch/)
  })
})
