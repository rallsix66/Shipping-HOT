import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import { open } from "#/intel/__fixtures__/isolated-db"
import { readDatabaseMetadata } from "#/database/runtime"
import { ShippingRepository } from "#/database/shipping"

const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
// Exercise the existing CLI directly; importing its import.meta path through Vite/unimport conflicts.
// These stubs exist only in the test child; they never change host CA/DNS/network configuration.
const denyNetwork = `data:text/javascript,${encodeURIComponent(`
  import http from 'node:http'; import https from 'node:https';
  import dns from 'node:dns'; import dnsPromises from 'node:dns/promises';
  import net from 'node:net'; import { syncBuiltinESMExports } from 'node:module';
  const denied = () => { throw new Error('S7 seed network forbidden'); };
  globalThis.fetch = denied; http.request = denied; http.get = denied;
  https.request = denied; https.get = denied; dns.lookup = denied;
  dnsPromises.lookup = denied; net.connect = denied; net.createConnection = denied;
  syncBuiltinESMExports();
`)}`
async function seedS7Local(dir: string, options: { manualOnly?: boolean } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_INTEL_ENABLED: "false" }
  for (const key of Object.keys(env)) {
    if (/^(?:SHIPPING_.*(?:KEY|TOKEN|SECRET)|GFW_|VESSELAPI_|AISSTREAM_|CALENDARIFIC_|DEEPSEEK_|QWEN_|GEMINI_|OPENAI_|ANTHROPIC_|DASHSCOPE_|BAILIAN_)/.test(key)) delete env[key]
  }
  const result = spawnSync(process.execPath, ["--import", denyNetwork, "--import", "tsx/esm", "--experimental-loader", "./scripts/tsx-alias-loader.mjs", "scripts/s7-local-seed.ts", dir, ...(options.manualOnly ? ["--manual-only"] : [])], { cwd: process.cwd(), env, encoding: "utf8", windowsHide: true, timeout: 15000 })
  if (result.status !== 0) throw new Error(`${result.error?.message ?? ""}\n${result.stderr}\n${result.stdout}`)
  return JSON.parse(readFileSync(join(dir, "s7-local-manifest.json"), "utf8"))
}
function fresh() {
  mkdirSync(".tmp", { recursive: true })
  return mkdtempSync(resolve(".tmp/s7-manual-prep-"))
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it("prepares the existing S7 native schema/manifest for manual use without any app server, browser, business rows or provider activity", async () => {
  vi.stubGlobal("fetch", () => {
    throw new Error("offline seed forbids network")
  })
  const dir = fresh()
  const manifest = await seedS7Local(dir, { manualOnly: true })
  const saved = JSON.parse(readFileSync(join(dir, "s7-local-manifest.json"), "utf8"))
  expect(saved).toEqual(manifest)
  expect(saved).toMatchObject({ dataMode: "real", schemaVersion: 30, manualAcceptance: { synthetic: true, notOfficialContent: true, publishedAt: "", expected: { initialMaterials: 0, guiStatus: "NOT_RUN" } } })
  const local = open(saved.databasePath)
  try {
    expect((await readDatabaseMetadata(local.database)).schemaVersion).toBe(saved.schemaVersion)
    const harness = readFileSync("scripts/e2e-s7-integrated.mjs", "utf8")
    expect(Number(/const EXPECTED_SCHEMA_VERSION = (\d+)/.exec(harness)![1])).toBe(saved.schemaVersion)
    for (const table of ["ports", "feed_items", "intel_item", "intel_item_version", "intel_manual_action", "provider_usage", "provider_runtime", "sync_runs", "translation_cache"]) {
      expect(local.native.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 })
    }
    for (const id of ["intel:th-w01", "intel:id-w01", "intel:manual:cn-p05"]) expect((await local.repository.getSource(id))?.enabled).toBe(false)
    const settings = await new ShippingRepository(local.database, "real").getSettings()
    expect(settings?.translation).toMatchObject({ enabled: false, monthlyBudget: 0 })
    expect(saved.requestedPaths).toEqual(["/feed"])
  } finally {
    local.native.close()
  }
  expect(existsSync(join(dir, ".data/provider-secrets.json"))).toBe(false)
  const before = { db: digest(saved.databasePath), manifest: digest(join(dir, "s7-local-manifest.json")) }
  await expect(seedS7Local(dir, { manualOnly: true })).rejects.toThrow("fresh S7 directory")
  expect({ db: digest(saved.databasePath), manifest: digest(join(dir, "s7-local-manifest.json")) }).toEqual(before)
}, 20_000)

it("does not accept legacy outside-tmp override flags or create a target outside .tmp", async () => {
  vi.stubEnv("S7_SEED_ALLOW_OUTSIDE_TMP", "1")
  const target = resolve("s7-forbidden-not-created")
  expect(existsSync(target)).toBe(false)
  await expect(seedS7Local(target, { manualOnly: true })).rejects.toThrow("must be written inside")
  expect(existsSync(target)).toBe(false)
  expect(readFileSync("scripts/e2e-s7-integrated.mjs", "utf8")).not.toContain("E2E_S7_ALLOW_OUTSIDE_TMP")
}, 20_000)

it("recognizes a manual-only retained candidate as business data and never honors overwrite flags", async () => {
  const dir = fresh()
  const file = join(dir, ".data/shipping-hot-v3.sqlite3")
  mkdirSync(join(dir, ".data"))
  const local = open(file)
  local.native.exec("CREATE TABLE ports(id TEXT); CREATE TABLE feed_items(id TEXT); CREATE TABLE intel_item(id TEXT); INSERT INTO intel_item VALUES ('synthetic-preserve')")
  local.native.close()
  const before = digest(file)
  vi.stubEnv("S7_SEED_ALLOW_OVERWRITE", "1")
  await expect(seedS7Local(dir, { manualOnly: true })).rejects.toThrow("not an S7 fixture directory")
  expect(digest(file)).toBe(before)
  expect(existsSync(join(dir, "s7-local-manifest.json"))).toBe(false)
}, 20_000)

it("preserves an existing manifest in manual preparation even when its database is absent", async () => {
  const dir = fresh()
  const file = join(dir, "s7-local-manifest.json")
  writeFileSync(file, "synthetic existing marker to preserve\n")
  await expect(seedS7Local(dir, { manualOnly: true })).rejects.toThrow("fresh S7 directory")
  expect(readFileSync(file, "utf8")).toBe("synthetic existing marker to preserve\n")
  expect(existsSync(join(dir, ".data/shipping-hot-v3.sqlite3"))).toBe(false)
}, 20_000)

it("keeps the original default S7 fixture recipe and only adds the manual acceptance descriptor", async () => {
  const manifest = await seedS7Local(fresh())
  const local = open(manifest.databasePath)
  try {
    expect(local.native.prepare("SELECT COUNT(*) AS n FROM ports").get()).toEqual({ n: 3 })
    expect(local.native.prepare("SELECT COUNT(*) AS n FROM feed_items").get()).toEqual({ n: 3 })
    expect(local.native.prepare("SELECT COUNT(*) AS n FROM intel_item").get()).toEqual({ n: 0 })
    expect(manifest).toMatchObject({ expectations: { portId: "port-s7-shekou", articleFeedId: "feed-s7-article" }, manualAcceptance: { expected: { guiStatus: "NOT_RUN" } } })
  } finally {
    local.native.close()
  }
}, 20_000)
