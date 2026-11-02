/**
 * Fail-closed ExactVersion evidence verifier tests (R3-A2).
 * Fixture-trusted evidence only — never claims production authorization.
 * Asserts: no DB auth writes, no Provider calls, no real outbound,
 * no consumable license return, strict time parse, material-scope honesty.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ClipAudit } from "@shared/manual-clip"
import { initShippingTables } from "#/database/shipping"
import { admitModelPayload } from "#/intel/llm/model-payload-gate"
import {
  type TrustedModelUseEvidence,
  createFixtureTrustedEvidenceSource,
  parseStrictInstant,
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
  // Project .tmp only — never system tmpdir for evidence/test DBs.
  const root = resolve(process.cwd(), ".tmp")
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, "r3-a2-verifier-"))
  const dbPath = join(dir, "test.sqlite3")
  const native = new NativeDatabase(dbPath)
  cleanups.push(() => {
    native.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const db = wrap(native)
  await initShippingTables(db, "mock")
  return { db, native, dbPath, dir }
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

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "item-1",
    versionId: "ver-1",
    contentHash: "hash-1",
    modelServiceId: "svc-fixture-chat",
    step: "prefilter" as const,
    requestedContentScope: "excerpt" as const,
    evidenceId: "ev-fixture-1",
    persistence: "full" as const,
    now: () => T_NOW,
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

describe("parseStrictInstant", () => {
  it("accepts explicit Z / offset instants and rejects Date.parse leniency", () => {
    expect(parseStrictInstant("2026-11-01T00:00:00.000Z", "validFrom").ok).toBe(true)
    expect(parseStrictInstant("2026-11-01T08:00:00+08:00", "validFrom").ok).toBe(true)
    expect(parseStrictInstant("1", "validFrom").ok).toBe(false)
    expect(parseStrictInstant("2026-02-30T00:00:00.000Z", "validFrom").ok).toBe(false)
    expect(parseStrictInstant("2026-11-01T00:00:00", "validFrom").ok).toBe(false)
    expect(parseStrictInstant("2026-11-01T00:00:00.000+99:00", "validFrom").ok).toBe(false)
    expect(parseStrictInstant("2026-11-01T00:00:00.000UTC", "validFrom").ok).toBe(false)
  })
})

describe("tryVerifyExactVersionEvidence fail-closed", () => {
  it("bLOCKED when evidenceId missing", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      evidenceId: undefined,
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.blocked).toBe(true)
      expect(result.code).toBe("rights_missing")
    }
  })

  it("bLOCKED when TrustedEvidenceSource absent", async () => {
    const result = await tryVerifyExactVersionEvidence(baseInput())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("rights_missing")
  })

  it("bLOCKED when evidenceId not found", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      evidenceId: "ev-missing",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("rights_missing")
  })

  it("bLOCKED on evidence source read failure", async () => {
    const result = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: {
        getById() {
          throw new Error("boom-read")
        },
      },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("evidence_read_failed")
      expect(result.reason).toContain("boom-read")
    }
  })

  it("bLOCKED on malformed evidence fields", async () => {
    const result = await tryVerifyExactVersionEvidence(baseInput({
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
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("time_unknown")
  })

  it("bLOCKED on calendar overflow / missing timezone / illegal timezone", async () => {
    const overflow = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: createFixtureTrustedEvidenceSource([
        baseEvidence({ validFrom: "2026-02-30T00:00:00.000Z" }),
      ]),
    }))
    const noZoneSource = {
      getById() {
        return baseEvidence({ validFrom: "2026-11-01T00:00:00.000" })
      },
    }
    const noZone = await tryVerifyExactVersionEvidence(baseInput({ evidenceSource: noZoneSource }))
    const badZoneSource = {
      getById() {
        return baseEvidence({ validFrom: "2026-11-01T00:00:00.000+99:99" })
      },
    }
    const badZone = await tryVerifyExactVersionEvidence(baseInput({ evidenceSource: badZoneSource }))
    const loose = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: {
        getById() {
          return baseEvidence({ validFrom: "1" })
        },
      },
    }))
    for (const result of [overflow, noZone, badZone, loose]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe("time_unknown")
    }
  })

  it("bLOCKED on malformed revokedAt / validUntil and invalid now()", async () => {
    const badRevoke = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: {
        getById() {
          return baseEvidence({ revokedAt: "tomorrow" })
        },
      },
    }))
    const badUntil = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: {
        getById() {
          return baseEvidence({ validUntil: "2026-13-40T00:00:00.000Z" })
        },
      },
    }))
    const badNow = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: createFixtureTrustedEvidenceSource([baseEvidence()]),
      now: () => new Date(Number.NaN),
    }))
    const nowThrows = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: createFixtureTrustedEvidenceSource([baseEvidence()]),
      now: () => {
        throw new Error("clock-broken")
      },
    }))
    for (const result of [badRevoke, badUntil, badNow, nowThrows]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe("time_unknown")
    }
  })

  it("keeps explicit null open-ended validUntil semantics", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ validUntil: null }),
    ])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.licenseIssued).toBe(false)
  })

  it("bLOCKED when revoked", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ revokedAt: "2026-11-02T08:00:00.000Z" }),
    ])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("license_revoked")
  })

  it("bLOCKED when expired (validUntil reached)", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ validUntil: "2026-11-02T08:30:00.000Z" }),
    ])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("license_revoked")
  })

  it("bLOCKED on wrong version / contentHash", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const wrongVersion = await tryVerifyExactVersionEvidence(baseInput({
      versionId: "ver-OTHER",
      evidenceSource: source,
    }))
    const wrongHash = await tryVerifyExactVersionEvidence(baseInput({
      contentHash: "hash-OTHER",
      evidenceSource: source,
    }))
    expect(wrongVersion.ok).toBe(false)
    expect(wrongHash.ok).toBe(false)
    if (!wrongVersion.ok) expect(wrongVersion.code).toBe("license_mismatch")
    if (!wrongHash.ok) expect(wrongHash.code).toBe("license_mismatch")
  })

  it("bLOCKED on wrong model service", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      modelServiceId: "svc-other",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("service_mismatch")
  })

  it("bLOCKED when step not in allowedSteps (prefilter+extract cannot cover severity)", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ allowedSteps: ["prefilter", "extract"] }),
    ])
    const severity = await tryVerifyExactVersionEvidence(baseInput({
      step: "severity",
      evidenceSource: source,
    }))
    const tiebreak = await tryVerifyExactVersionEvidence(baseInput({
      step: "severity_tiebreak",
      evidenceSource: source,
    }))
    expect(severity.ok).toBe(false)
    expect(tiebreak.ok).toBe(false)
    if (!severity.ok) expect(severity.code).toBe("purpose_out_of_scope")
    if (!tiebreak.ok) expect(tiebreak.code).toBe("purpose_out_of_scope")
  })

  it("bLOCKED when requested content scope exceeds evidence allowance", async () => {
    const source = createFixtureTrustedEvidenceSource([
      baseEvidence({ allowedContentScope: "excerpt" }),
    ])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      requestedContentScope: "full_text",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("content_scope_exceeded")
  })

  it("bLOCKED when stored material persistence missing (material scope unverified)", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const missing = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
      persistence: undefined,
    }))
    const nulled = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
      persistence: null,
    }))
    expect(missing.ok).toBe(false)
    expect(nulled.ok).toBe(false)
    if (!missing.ok) expect(missing.code).toBe("material_scope_unverified")
    if (!nulled.ok) expect(nulled.code).toBe("material_scope_unverified")
  })

  it("bLOCKED when persistence disallowed even if evidence allows full_text", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      requestedContentScope: "excerpt",
      persistence: "disallowed",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("content_scope_exceeded")
  })

  it("narrows by excerpt_only persistence; never lets storage produce a grant", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const tooWide = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      requestedContentScope: "full_text",
      persistence: "excerpt_only",
      evidenceSource: source,
    }))
    expect(tooWide.ok).toBe(false)
    if (!tooWide.ok) expect(tooWide.code).toBe("content_scope_exceeded")

    const narrowedOk = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      requestedContentScope: "excerpt",
      persistence: "excerpt_only",
      evidenceSource: source,
    }))
    expect(narrowedOk.ok).toBe(true)
    if (narrowedOk.ok) {
      expect(narrowedOk.evidenceRef.effectiveContentScope).toBe("excerpt")
      expect(narrowedOk.evidenceRef.storedPersistence).toBe("excerpt_only")
    }

    // persistence alone still cannot grant without evidence
    const storageOnly = await tryVerifyExactVersionEvidence(baseInput({
      evidenceId: undefined,
      persistence: "full",
      evidenceSource: source,
    }))
    expect(storageOnly.ok).toBe(false)
    if (!storageOnly.ok) expect(storageOnly.code).toBe("rights_missing")
  })

  it("hard-denies private_material clip even with matching fixture evidence", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
      clipAudit: privateClipAudit(),
      modelUsePermitted: true,
      publicReadable: true,
      persistence: "full",
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("private_material")
  })

  it("hard-denies unverified user_declaration even with matching fixture evidence", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
      clipAudit: unverifiedLegacyAudit(),
      modelUsePermitted: true,
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("rights_unknown")
  })

  it("does not grant from caller boolean / public URL / persistence alone", async () => {
    const result = await tryVerifyExactVersionEvidence(baseInput({
      requestedContentScope: "full_text",
      evidenceId: undefined,
      evidenceSource: undefined,
      modelUsePermitted: true,
      publicReadable: true,
      catalogIncluded: true,
      persistence: "full",
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.blocked).toBe(true)
      expect(result.code).toBe("rights_missing")
    }
  })

  it("allows fixture-trusted exact match without returning a consumable license", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const result = await tryVerifyExactVersionEvidence(baseInput({
      step: "severity",
      evidenceSource: source,
    }))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.productionAuthorized).toBe(false)
      expect(result.licenseIssued).toBe(false)
      expect(result).not.toHaveProperty("license")
      expect(result.evidenceRef.step).toBe("severity")
      expect(result.evidenceRef.effectiveContentScope).toBe("full_text")
      expect(result.evidenceRef.requestedContentScope).toBe("excerpt")
      // evidenceRef alone must NOT open the existing model-send gate
      const gate = admitModelPayload({
        materialRef: {
          itemId: result.evidenceRef.itemId,
          versionId: result.evidenceRef.versionId,
          contentHash: result.evidenceRef.contentHash,
        },
        modelUsePermitted: true,
      })
      expect(gate.allow).toBe(false)
      if (!gate.allow) expect(gate.code).toBe("no_model_permission")
    }
  })

  it("re-reads source so later revoke / version change cannot be bypassed by prior success", async () => {
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])
    const first = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
    }))
    expect(first.ok).toBe(true)

    source.revoke("ev-fixture-1", "2026-11-02T08:59:00.000Z")
    const afterRevoke = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
    }))
    expect(afterRevoke.ok).toBe(false)
    if (!afterRevoke.ok) expect(afterRevoke.code).toBe("license_revoked")

    source.upsert(baseEvidence({ contentHash: "hash-2", revokedAt: null }))
    const afterHashChange = await tryVerifyExactVersionEvidence(baseInput({
      evidenceSource: source,
    }))
    expect(afterHashChange.ok).toBe(false)
    if (!afterHashChange.ok) expect(afterHashChange.code).toBe("license_mismatch")
  })

  it("performs zero Provider calls and zero auth-table writes; DB stays under project .tmp", async () => {
    const { native, dir } = await openIsolatedDb()
    expect(dir.replace(/\\/g, "/")).toContain("/.tmp/r3-a2-verifier-")
    const providerSpy = vi.fn()
    const source = createFixtureTrustedEvidenceSource([baseEvidence()])

    const tablesBefore = native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>
    const authish = tablesBefore.filter(t => /auth|license|grant|right/i.test(t.name))

    const allow = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      requestedContentScope: "full_text",
      evidenceSource: source,
    }))
    expect(allow.ok).toBe(true)
    expect(providerSpy).not.toHaveBeenCalled()

    const denyMissing = await tryVerifyExactVersionEvidence(baseInput({
      step: "extract",
      requestedContentScope: "full_text",
      evidenceId: "nope",
      evidenceSource: source,
    }))
    expect(denyMissing.ok).toBe(false)
    expect(providerSpy).not.toHaveBeenCalled()

    const tablesAfter = native.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>
    expect(tablesAfter.map(t => t.name)).toEqual(tablesBefore.map(t => t.name))
    expect(authish.length).toBe(
      tablesAfter.filter(t => /auth|license|grant|right/i.test(t.name)).length,
    )

    for (const table of ["intel_item", "intel_version", "llm_provider", "llm_model"]) {
      const exists = tablesBefore.some(t => t.name === table)
      if (!exists) continue
      const count = (native.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
      expect(count).toBe(0)
    }
  })
})
