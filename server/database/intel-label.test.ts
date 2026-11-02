import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it } from "vitest"
import { initShippingTables } from "#/database/shipping"
import { IntelLabelRepository, LabelInputError } from "#/database/intel-label"

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

const keepDecision = {
  prefilterKeep: true,
  eventType: "port_closure",
  countries: ["MY"],
  ports: ["MYPKG"],
  effectiveFrom: "2026-11-02",
  isOfficialStatement: false,
}

const dropDecision = {
  prefilterKeep: false,
  eventType: null,
  countries: [] as string[],
  ports: [] as string[],
  effectiveFrom: null,
  isOfficialStatement: null,
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

  it("enrolls URL+excerpt only, AI prelabel → human confirmed; duplicate request id returns same row", async () => {
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
      aiPrelabel: { decision: { ...keepDecision } },
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
      decision: { ...keepDecision },
    })).rejects.toThrow(/operator_must_be_human/)

    const human = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-a",
      kind: "human_confirm",
      operator: "tester.one",
      decision: { ...keepDecision },
      clientRequestId: "req-1",
    })
    expect(human.isHuman).toBe(true)
    expect(human.clientRequestId).toBe("req-1")
    expect((await repo.getItem(item.id))?.queueStatus).toBe("human_confirmed")

    const dup = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-a",
      kind: "human_confirm",
      operator: "tester.one",
      decision: { ...keepDecision },
      clientRequestId: "req-1",
    })
    expect(dup.id).toBe(human.id)
  })

  it("a→B→A with distinct request ids yields three audits; latest wins; same-id conflict rejects", async () => {
    const { repo, native } = await fresh()
    const item = await repo.enroll({
      itemId: "item-aba",
      versionId: "ver-aba",
      contentHash: "hash-aba",
      sourceUrl: "https://example.test/aba",
      excerpt: "aba",
      title: "ABA",
    })
    const a1 = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-aba",
      kind: "human_correct",
      operator: "op.aba",
      decision: { ...keepDecision, notes: "A1" },
      clientRequestId: "req-A",
    })
    const b = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-aba",
      kind: "human_correct",
      operator: "op.aba",
      decision: { ...dropDecision, notes: "B" },
      clientRequestId: "req-B",
    })
    expect(b.id).not.toBe(a1.id)
    const a2 = await repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-aba",
      kind: "human_correct",
      operator: "op.aba",
      decision: { ...keepDecision, notes: "A2-back" },
      clientRequestId: "req-A-again",
    })
    expect(a2.id).not.toBe(a1.id)
    expect(a2.id).not.toBe(b.id)
    const count = native.prepare(
      "SELECT COUNT(*) AS c FROM intel_label_decision WHERE label_item_id = ? AND is_human = 1",
    ).get(item.id) as { c: number }
    expect(count.c).toBe(3)
    const latest = await repo.latestDecision(item.id, { humanOnly: true })
    expect(latest?.id).toBe(a2.id)
    expect(latest?.decision.notes).toBe("A2-back")

    await expect(repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-aba",
      kind: "human_confirm",
      operator: "op.aba",
      decision: { ...keepDecision, notes: "conflict" },
      clientRequestId: "req-A",
    })).rejects.toBeInstanceOf(LabelInputError)
    await expect(repo.saveHumanDecision({
      labelItemId: item.id,
      expectedContentHash: "hash-aba",
      kind: "human_confirm",
      operator: "op.aba",
      decision: { ...keepDecision, notes: "conflict" },
      clientRequestId: "req-A",
    })).rejects.toThrow(/client_request_id_conflict/)
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
      decision: { ...dropDecision },
    })).rejects.toThrow(/content_hash_mismatch/)
  })

  it("re-enroll after analyze refreshes AI prelabel without demoting human_confirmed", async () => {
    const { repo } = await fresh()
    const item = await repo.enroll({
      itemId: "item-c",
      versionId: "ver-c",
      contentHash: "hash-c",
      sourceUrl: "https://example.test/c",
      excerpt: "c1",
      title: "C",
    })
    expect(item.queueStatus).toBe("unreviewed")
    // enroll-before-analyze: later AI arrives, same hash
    const withAi = await repo.enroll({
      itemId: "item-c",
      versionId: "ver-c",
      contentHash: "hash-c",
      sourceUrl: "https://example.test/c",
      excerpt: "c1",
      title: "C",
      aiPrelabel: {
        decision: { ...keepDecision },
        analysisIds: ["an-1"],
        promptHash: "ph-1",
        modelId: "m-1",
        modelName: "fake-model",
      },
    })
    expect(withAi.queueStatus).toBe("ai_prelabeled")
    const ai = await repo.latestAiPrelabel(withAi.id)
    expect(ai?.modelId).toBe("m-1")
    expect(ai?.promptHash).toBe("ph-1")
    expect(ai?.analysisIds).toEqual(["an-1"])

    await repo.saveHumanDecision({
      labelItemId: withAi.id,
      expectedContentHash: "hash-c",
      kind: "human_confirm",
      operator: "human.c",
      decision: { ...keepDecision },
      clientRequestId: "req-c-human",
    })
    expect((await repo.getItem(withAi.id))?.queueStatus).toBe("human_confirmed")

    // refreshed AI must not demote human_confirmed
    const again = await repo.enroll({
      itemId: "item-c",
      versionId: "ver-c",
      contentHash: "hash-c",
      sourceUrl: "https://example.test/c",
      excerpt: "c1",
      title: "C",
      aiPrelabel: {
        decision: { ...keepDecision, eventType: "port_congestion" },
        analysisIds: ["an-2"],
        promptHash: "ph-2",
        modelId: "m-2",
        modelName: "fake-model-2",
      },
    })
    expect(again.queueStatus).toBe("human_confirmed")
    expect((await repo.latestDecision(again.id, { humanOnly: true }))?.isHuman).toBe(true)
    const ai2 = await repo.latestAiPrelabel(again.id)
    expect(ai2?.analysisIds).toEqual(["an-2"])
    expect(ai2?.modelId).toBe("m-2")
  })
})
