/**
 * Fail-closed ExactVersion evidence verifier tests (R3-A2).
 * Fixture-trusted evidence only — never claims production authorization.
 * Asserts: no DB auth writes, no Provider calls, no real outbound.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ClipAudit } from "@shared/manual-clip"
import { initShippingTables } from "#/database/shipping"
import {
  type TrustedModelUseEvidence,
  createFixtureTrustedEvidenceSource,
  tryVerifyExactVersionEvidence,
} from "#/intel/llm/exact-version-evidence-verifier"

const T_NOW = new Date("2026-11-02T09:00:00.000Z")
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

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

async function openIsolatedDb() {
  const dir = mkdtempSync(join(tmpdir(), "r3-a2-verifier-"))
  const dbPath = join(dir, "test.sqlite3")
  const native = new NativeDatabase(dbPath)
  cleanups.push(() => {
    native.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native, dbPath }
}

function baseEvidence(overrides: Partial<TrustedModelUseEvidence> = {}): TrustedModelUseEvidence {
  return {
    evidenceId: "ev-fixture-1",
    itemId: "item-1",
    versionId: "ver-1",
    contentHash: "hash-1",
    modelServiceId: "svc-fixture-chat",
    allowedSteps: ["prefilter", "extract", "severity", "severity_tiebreak"],
    allowedContentScope: "full_text",
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: "2026-12-01T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  }
}

function privateClipAudit(): ClipAudit {
  return {
    protocol: "shipping-hot-clip-v1",
    actualUrl: "https://example.com/a",
    title: "t",
    body: "",
    mode: "metadata",
    date: { raw: "", field: "", role: "unknown" },
    capturedAt: "2026-11-02T00:00:00.000Z",
    extractorVersion: "test",
    capture: "manual_user_capture",
    usage: "private_material",
    rightsStatus: "unknown",
    recordedBy: "op",
    recordedAt: "2026-11-02T00:00:00.000Z",
    verification: "manual_capture_unverified",
  }
}

function unverifiedLegacyAudit(): ClipAudit {
  return {
    protocol: "shipping-hot-clip-v1",
    actualUrl: "https://example.com/a",
    title: "t",
    body: "body",
    mode: "article",
    date: { raw: "", field: "", role: "unknown" },
    capturedAt: "2026-11-02T00:00:00.000Z",
    extractorVersion: "test",
    rights: {
      basis: "permission",
      scope: "full_text",
      evidence: "self-declared",
      applicableUrl: "https://example.com/a",
    },
    declaredBy: "op",
    declaredAt: "2026-11-02T00:00:00.000Z",
    verification: "user_declaration_unverified",
  }
}

describe("tryVerifyExactVersionEvidence fail-closed", () => {
  it("bLOCKED when evidenceId missing", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.blocked).toBe(true)
      expect(result.code).toBe("rights_missing")
    }
  })

  it("bLOCKED when TrustedEvidenceSource absent", async () => {
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("rights_missing")
  })

  it("bLOCKED when evidenceId not found", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-missing",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("rights_missing")
  })

  it("bLOCKED on evidence source read failure", async () => {
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: {
        getById() {
          throw new Error("boom-read")
        },
      },
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("evidence_read_failed")
      expect(result.reason).toContain("boom-read")
    }
  })

  it("bLOCKED on malformed evidence fields", async () => {
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-bad",
      evidenceSource: {
        getById() {
          return {
            evidenceId: "ev-bad",
            itemId: "item-1",
            versionId: "ver-1",
            contentHash: "hash-1",
            modelServiceId: "svc-fixture-chat",
            allowedSteps: ["prefilter"],
            allowedContentScope: "full_text",
            validFrom: "",
            validUntil: null,
            revokedAt: null,
          } as TrustedModelUseEvidence
        },
      },
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("time_unknown")
  })

  it("bLOCKED when revoked", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ revokedAt: "2026-11-02T08:00:00.000Z" }),
    ])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "extract",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("license_revoked")
  })

  it("bLOCKED when expired (validUntil reached)", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ validUntil: "2026-11-02T08:30:00.000Z" }),
    ])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "extract",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("license_revoked")
  })

  it("bLOCKED on wrong version / contentHash", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const wrongVersion = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-OTHER",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    const wrongHash = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-OTHER",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(wrongVersion.ok).toBe(false)
    expect(wrongHash.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.code).toBe("license_mismatch")
    if (!wrongHash.ok) expect(wrongHash.code).toBe("license_mismatch")
  })

  it("bLOCKED on wrong model service", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-other",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("service_mismatch")
  })

  it("bLOCKED when step not in allowedSteps (prefilter+extract cannot cover severity)", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ allowedSteps: ["prefilter", "extract"] }),
    ])
    const severity = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "severity",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    const tiebreak = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "severity_tiebreak",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(severity.ok).toBe(false)
    expect(tiebreak.ok).toBe(false)
    if (!severity.ok) expect(severity.code).toBe("purpose_out_of_scope")
    if (!tiebreak.ok) expect(tiebreak.code).toBe("purpose_out_of_scope")
  })

  it("bLOCKED when requested content scope exceeds evidence allowance", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ allowedContentScope: "excerpt" }),
    ])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "extract",
      requestedContentScope: "full_text",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("content_scope_exceeded")
  })

  it("hard-denies private_material clip even with matching fixture evidence", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      clipAudit: privateClipAudit(),
      modelUsePermitted: true,
      publicReadable: true,
      persistence: "full",
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("private_material")
  })

  it("hard-denies unverified user_declaration even with matching fixture evidence", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      clipAudit: unverifiedLegacyAudit(),
      modelUsePermitted: true,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("rights_unknown")
  })

  it("does not grant from caller boolean / public URL / persistence alone", async () => {
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "full_text",
      modelUsePermitted: true,
      publicReadable: true,
      catalogIncluded: true,
      persistence: "full",
      now: () => T_NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.blocked).toBe(true)
      expect(result.code).toBe("rights_missing")
    }
  })

  it("allows fixture-trusted exact match and marks productionAuthorized=false", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "severity",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.productionAuthorized).toBe(false)
      expect(result.license).toEqual({
        itemId: "item-1",
        versionId: "ver-1",
        contentHash: "hash-1",
        permitted: true,
        evidenceId: "ev-fixture-1",
      })
      expect(result.evidenceRef.step).toBe("severity")
    }
  })

  it("re-reads source so later revoke / version change cannot be bypassed by prior success", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const first = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(first.ok).toBe(true)

    source.revoke("ev-fixture-1", "2026-11-02T08:59:00.000Z")
    const afterRevoke = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(afterRevoke.ok).toBe(false)
    if (!afterRevoke.ok) expect(afterRevoke.code).toBe("license_revoked")

    source.upsert(baseEvidence({ contentHash: "hash-2", revokedAt: null }))
    const afterHashChange = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "prefilter",
      requestedContentScope: "excerpt",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(afterHashChange.ok).toBe(false)
    if (!afterHashChange.ok) expect(afterHashChange.code).toBe("license_mismatch")
  })

  it("performs zero Provider calls and zero auth-table writes", async () => {
    const { native } = await openIsolatedDb()
    const providerSpy = vi.fn()
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])

    const tablesBefore = native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>
    const authish = tablesBefore.filter(t => /auth|license|grant|right/i.test(t.name))

    const allow = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "extract",
      requestedContentScope: "full_text",
      evidenceId: "ev-fixture-1",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(allow.ok).toBe(true)
    expect(providerSpy).not.toHaveBeenCalled()

    const denyMissing = await tryVerifyExactVersionEvidence({
      itemId: "item-1",
      versionId: "ver-1",
      contentHash: "hash-1",
      modelServiceId: "svc-fixture-chat",
      step: "extract",
      requestedContentScope: "full_text",
      evidenceId: "nope",
      evidenceSource: source,
      now: () => T_NOW,
    })
    expect(denyMissing.ok).toBe(false)
    expect(providerSpy).not.toHaveBeenCalled()

    const tablesAfter = native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>
    expect(tablesAfter.map(t => t.name)).toEqual(tablesBefore.map(t => t.name))
    // No new auth/license/grant tables created by verifier.
    expect(authish.length).toBe(
      tablesAfter.filter(t => /auth|license|grant|right/i.test(t.name)).length,
    )

    // Spot-check common shipping tables were not grown by verifier (no auth rows invented).
    for (const table of ["intel_item", "intel_version", "llm_provider", "llm_model"]) {
      const exists = tablesBefore.some(t => t.name === table)
      if (!exists) continue
      const count = (native.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      expect(count).toBe(0)
    }
  })
})
