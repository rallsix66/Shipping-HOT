import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { initShippingTables } from "#/database/shipping"
import { IntelRepository } from "#/database/intel"
import { IntelAnalysisRepository } from "#/database/intel-analysis"
import { licensedBlocks } from "#/intel/content-license"
import { intelSourceSeeds } from "#/intel/sources"
import { LabelService } from "#/intel/label-service"

const ROOT = resolve(process.cwd())
const SCRIPT = resolve(ROOT, "scripts/intel-eval.ts")
const LOADER = pathToFileURL(resolve(ROOT, "scripts/tsx-alias-loader.mjs")).href

describe("intel-eval readonly open", () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) {
      try {
        cleanups.pop()!()
      } catch { /* ignore */ }
    }
  })

  function runEval(env: Record<string, string>) {
    return spawnSync(
      process.execPath,
      ["--import", "tsx/esm", "--experimental-loader", LOADER, SCRIPT],
      {
        cwd: ROOT,
        env: { ...process.env, ...env },
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000,
      },
    )
  }

  it("missing DB path does not create the DB file or parent dir; exits nonzero", () => {
    const base = mkdtempSync(join(tmpdir(), "intel-eval-missing-"))
    cleanups.push(() => rmSync(base, { recursive: true, force: true }))
    const missingParent = join(base, "no-such-dir")
    const missingDb = join(missingParent, "missing.sqlite3")
    const outDir = join(base, "out")
    expect(existsSync(missingParent)).toBe(false)
    const result = runEval({
      SHIPPING_DB_PATH: missingDb,
      INTEL_EVAL_OUT: outDir,
    })
    if (!existsSync(join(outDir, "intel-eval-report.json"))) {
      throw new Error(`eval spawn failed status=${result.status} err=${result.error} stderr=${result.stderr} stdout=${result.stdout}`)
    }
    expect(result.status).not.toBe(0)
    expect(existsSync(missingParent)).toBe(false)
    expect(existsSync(missingDb)).toBe(false)
    const out = JSON.parse(readFileSync(join(outDir, "intel-eval-report.json"), "utf8")) as { status: string, reason?: string }
    expect(out.status).toBe("NOT_RUN")
    expect(String(out.reason || "")).toContain("eval_db_missing")
  })

  it("existing DB opens readonly without schema/data mutation", async () => {
    const base = mkdtempSync(join(tmpdir(), "intel-eval-ro-"))
    cleanups.push(() => rmSync(base, { recursive: true, force: true }))
    const dbPath = join(base, "shipping.sqlite3")
    const outDir = join(base, "out")
    const native = new NativeDatabase(dbPath)
    const db = createDatabase({
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
    await initShippingTables(db, "mock")
    const tablesBefore = (native.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map(r => r.name)
    const countBefore = Number((native.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as { n: number }).n)
    native.close()
    const hashBefore = createHash("sha256").update(readFileSync(dbPath)).digest("hex")
    const mtimeBefore = statSync(dbPath).mtimeMs

    const result = runEval({
      SHIPPING_DB_PATH: dbPath,
      INTEL_EVAL_OUT: outDir,
    })
    if (!existsSync(join(outDir, "intel-eval-report.json"))) {
      throw new Error(`eval spawn failed status=${result.status} err=${result.error} stderr=${result.stderr} stdout=${result.stdout}`)
    }
    const stdout = String(result.stdout || "")
    expect(stdout.includes("eval_db_open_readonly_failed")).toBe(false)

    const probe = new NativeDatabase(dbPath, { readonly: true, fileMustExist: true } as { readonly?: boolean })
    const tablesAfter = (probe.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map(r => r.name)
    const countAfter = Number((probe.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get() as { n: number }).n)
    probe.close()
    expect(tablesAfter).toEqual(tablesBefore)
    expect(countAfter).toBe(countBefore)
    const hashAfter = createHash("sha256").update(readFileSync(dbPath)).digest("hex")
    expect(hashAfter).toBe(hashBefore)
    void mtimeBefore
  })

  it("rC4: upgraded DB with legacy AI cache is fail-closed in eval until new run_id analysis; human retained; costs not mixed", async () => {
    const base = mkdtempSync(join(tmpdir(), "intel-eval-rc4-"))
    cleanups.push(() => rmSync(base, { recursive: true, force: true }))
    const dbPath = join(base, "shipping.sqlite3")
    const outDir = join(base, "out")
    const native = new NativeDatabase(dbPath)
    const wrap = (n: InstanceType<typeof NativeDatabase>) => createDatabase({
      name: "sqlite",
      dialect: "sqlite",
      getInstance: () => n,
      exec: (sql: string) => n.exec(sql),
      prepare: (sql: string) => {
        const statement = n.prepare(sql)
        return {
          all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
          get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
          run: async (...params: (string | number | boolean | null | undefined)[]) => {
            const result = statement.run(...params)
            return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
          },
        }
      },
      dispose: () => n.close(),
    } as never)
    const db = wrap(native)
    await initShippingTables(db, "mock")
    const intel = new IntelRepository(db)
    const analysis = new IntelAnalysisRepository(db)
    const service = new LabelService(db)
    const source = intelSourceSeeds[0]!
    const body = "Westports announces berth suspension for labeling rights tests. ".repeat(8)
    const contentHash = createHash("sha256").update(body).digest("hex")
    await intel.upsertSource(source, "2026-11-02T03:00:00.000Z")
    const saved = await intel.writeEntry({
      sourceId: source.id,
      canonicalUrl: "https://example.test/eval-rc4-upgrade",
      title: "EVAL RC4",
      contentHash,
      contentScope: "full_text",
      extractorVersion: "eval-rc4-v1",
      blocks: licensedBlocks("full_text", "EVAL RC4", body),
      fetchedAt: "2026-11-02T03:00:00.000Z",
    })
    const legacyPre = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash,
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "pre-migrate",
      modelId: "legacy-m",
      modelName: "Legacy",
      promptHash: "legacy-pre",
      receiptId: "rcpt-legacy-pre",
      createdAt: "2026-10-01T01:00:00.000Z",
      output: { decision: "PASS", content: "legacy-pre" },
    })
    const legacyEx = await analysis.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash,
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "pre-migrate",
      modelId: "legacy-m",
      modelName: "Legacy",
      promptHash: "legacy-ex",
      receiptId: "rcpt-legacy-ex",
      createdAt: "2026-10-01T02:00:00.000Z",
      output: {
        extract: {
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-10-01",
          isOfficialStatement: true,
        },
        content: "legacy-ex",
      },
    })
    native.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, purpose, status, actual_cost, cost_basis, currency, created_at, updated_at)
      VALUES (?, ?, 'fake-llm', 'chat', 'intel', 'received', ?, 'actual', 'USD', 't', 't')
    `).run("rcpt-legacy-pre", "k-legacy-pre", 1.25)
    native.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, purpose, status, actual_cost, cost_basis, currency, created_at, updated_at)
      VALUES (?, ?, 'fake-llm', 'chat', 'intel', 'received', ?, 'actual', 'USD', 't', 't')
    `).run("rcpt-legacy-ex", "k-legacy-ex", 2.5)

    const enrolled = await service.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    await service.saveHuman({
      labelItemId: enrolled.id,
      expectedContentHash: contentHash,
      kind: "human_confirm",
      operator: "human.rc4",
      decision: {
        prefilterKeep: true,
        eventType: "port_closure",
        countries: ["MY"],
        ports: ["MYPKG"],
        effectiveFrom: "2026-10-01",
        isOfficialStatement: true,
        notes: "human-eval-upgrade",
      },
      clientRequestId: "rc4-eval-human",
    })
    // Simulate migrate: NULL run_id, AI cache + receipts remain.
    native.prepare("UPDATE intel_analysis SET run_id = NULL WHERE id IN (?, ?)").run(legacyPre.id, legacyEx.id)
    native.close()

    const run1 = runEval({ SHIPPING_DB_PATH: dbPath, INTEL_EVAL_OUT: outDir })
    const report1Path = join(outDir, "intel-eval-report.json")
    if (!existsSync(report1Path)) {
      throw new Error(`eval1 failed status=${run1.status} stderr=${run1.stderr} stdout=${run1.stdout}`)
    }
    const report1 = JSON.parse(readFileSync(report1Path, "utf8")) as {
      humanLabeled: number
      paired: number
      missingPredictions: number
      cost: { byCurrency: Array<{ actualTotal: number, receiptCount: number }> }
      mixedModelPrompt?: boolean
    }
    expect(report1.humanLabeled).toBe(1)
    expect(report1.paired).toBe(0)
    expect(report1.missingPredictions).toBe(1)
    const legacyCost = (report1.cost.byCurrency || []).reduce((s, b) => s + (b.receiptCount || 0), 0)
    expect(legacyCost).toBe(0)

    // Re-open, re-enroll still legacy-only, eval again — still fail-closed.
    const native2 = new NativeDatabase(dbPath)
    const db2 = wrap(native2)
    const service2 = new LabelService(db2)
    await service2.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const detailLegacy = await service2.detail(enrolled.id)
    expect(detailLegacy.aiPrelabel).toBeNull()
    expect(detailLegacy.humanDecision?.decision.notes).toBe("human-eval-upgrade")
    native2.close()

    const outDir2 = join(base, "out2")
    const run2 = runEval({ SHIPPING_DB_PATH: dbPath, INTEL_EVAL_OUT: outDir2 })
    const report2 = JSON.parse(readFileSync(join(outDir2, "intel-eval-report.json"), "utf8")) as typeof report1
    expect(report2.paired).toBe(0)
    expect(report2.missingPredictions).toBe(1)
    expect((report2.cost.byCurrency || []).reduce((s, b) => s + (b.receiptCount || 0), 0)).toBe(0)
    void run2

    // Add new run_id analysis + enroll → eval resumes with new costs only.
    const native3 = new NativeDatabase(dbPath)
    const db3 = wrap(native3)
    const analysis3 = new IntelAnalysisRepository(db3)
    const service3 = new LabelService(db3)
    await analysis3.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash,
      step: "prefilter",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-post-v36",
      modelId: "new-m",
      modelName: "New",
      promptHash: "new-pre",
      receiptId: "rcpt-new-pre",
      createdAt: "2026-11-02T05:00:00.000Z",
      output: { decision: "PASS", content: "new-pre" },
    })
    await analysis3.insert({
      itemId: saved.itemId,
      versionId: saved.versionId,
      contentHash,
      step: "extract",
      status: "completed",
      provenance: "ai",
      basis: "fixture",
      runId: "run-post-v36",
      modelId: "new-m",
      modelName: "New",
      promptHash: "new-ex",
      receiptId: "rcpt-new-ex",
      createdAt: "2026-11-02T06:00:00.000Z",
      output: {
        extract: {
          eventType: "port_closure",
          countries: ["MY"],
          ports: ["MYPKG"],
          effectiveFrom: "2026-11-02",
          isOfficialStatement: true,
        },
        content: "new-ex",
      },
    })
    native3.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, purpose, status, actual_cost, cost_basis, currency, created_at, updated_at)
      VALUES (?, ?, 'fake-llm', 'chat', 'intel', 'received', ?, 'actual', 'USD', 't', 't')
    `).run("rcpt-new-pre", "k-new-pre", 0.1)
    native3.prepare(`
      INSERT INTO paid_receipt (id, logical_key, provider_id, capability, purpose, status, actual_cost, cost_basis, currency, created_at, updated_at)
      VALUES (?, ?, 'fake-llm', 'chat', 'intel', 'received', ?, 'actual', 'USD', 't', 't')
    `).run("rcpt-new-ex", "k-new-ex", 0.2)
    await service3.enrollFromExisting({ itemId: saved.itemId, versionId: saved.versionId })
    const detailNew = await service3.detail(enrolled.id)
    expect(detailNew.aiPrelabel?.modelId).toContain("new-m")
    expect(detailNew.humanDecision?.decision.notes).toBe("human-eval-upgrade")
    native3.close()

    const outDir3 = join(base, "out3")
    const run3 = runEval({ SHIPPING_DB_PATH: dbPath, INTEL_EVAL_OUT: outDir3 })
    if (!existsSync(join(outDir3, "intel-eval-report.json"))) {
      throw new Error(`eval3 failed status=${run3.status} stderr=${run3.stderr} stdout=${run3.stdout}`)
    }
    const report3 = JSON.parse(readFileSync(join(outDir3, "intel-eval-report.json"), "utf8")) as {
      humanLabeled: number
      paired: number
      missingPredictions: number
      cost: { byCurrency: Array<{ actualTotal: number, receiptCount: number, receiptIds?: string[] }> }
    }
    expect(report3.humanLabeled).toBe(1)
    expect(report3.paired).toBe(1)
    expect(report3.missingPredictions).toBe(0)
    const ids = (report3.cost.byCurrency || []).flatMap(b => b.receiptIds || [])
    expect(ids.sort()).toEqual(["rcpt-new-ex", "rcpt-new-pre"].sort())
    expect(ids).not.toContain("rcpt-legacy-pre")
    expect(ids).not.toContain("rcpt-legacy-ex")
    const total = (report3.cost.byCurrency || []).reduce((s, b) => s + Number(b.actualTotal || 0), 0)
    expect(total).toBeCloseTo(0.3, 5)
  })
})
