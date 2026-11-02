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
})
