import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomBytes } from "node:crypto"
import process from "node:process"
import { expect, it } from "vitest"
import { assertClipSyntheticRun } from "./clip-synthetic-guard"

const root = process.cwd()
const sha = randomBytes(20).toString("hex")
const run = join(root, ".tmp", `clipper-manual-${sha.slice(0, 7)}`, "run")
mkdirSync(join(run, ".data"), { recursive: true })
writeFileSync(join(run, ".data/shipping-hot-v3.sqlite3"), "synthetic guard fixture, not a retained DB")
const marker = { repositoryRoot: root, sha, sourceUrl: "http://127.0.0.1:5174/synthetic-article.html" }
writeFileSync(join(run, "clip-synthetic-run.json"), JSON.stringify(marker))
const env = { HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: "5173", NITRO_PORT: "5173", SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_INTEL_ENABLED: "false", SHIPPING_DATA_MODE: "real" }
it("accepts only the marked isolated cwd with explicit safe environment", () => {
  expect(() => assertClipSyntheticRun(run, env)).not.toThrow()
  expect(() => assertClipSyntheticRun(root, env)).toThrow()
})
it.each(Object.keys(env))("rejects absent or changed %s before test server startup", (key) => {
  expect(() => assertClipSyntheticRun(run, { ...env, [key]: undefined })).toThrow()
  expect(() => assertClipSyntheticRun(run, { ...env, [key]: "wrong" })).toThrow()
})
it("rejects credential-bearing environment even with a valid test directory", () => {
  expect(() => assertClipSyntheticRun(run, { ...env, DEEPSEEK_API_KEY: "synthetic-not-a-real-key" })).toThrow("credentials_forbidden")
})
