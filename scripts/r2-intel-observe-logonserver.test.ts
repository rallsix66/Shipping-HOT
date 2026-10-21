import process from "node:process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { afterEach, expect, it } from "vitest"
import { observationEnvironment, parseObservationArguments, prepareObservationLaunch, validateObservationChildEnvironment } from "./r2-intel-observe-options"
import { isolateObservationChildEnvironment } from "./r2-intel-observe-environment"

/**
 * Node v24.15.0 / libuv 1.51.0 on Windows re-adds LOGONSERVER (libuv required_vars) from the
 * parent when an explicit env omits it. The contract is "validated, then removed before the
 * business phase", not "never received". Original synthetic marker only; real values never printed.
 */
const MARKER = "synthetic-logon-marker-r2obs"
const args = ["--execute", "--run-id", "offline-test", "--sources", "TH-W01,ID-W01", "--duration-ms", "60000", "--max-http-requests", "2"]
const platform = Object.getOwnPropertyDescriptor(process, "platform")!
afterEach(() => {
  Object.defineProperty(process, "platform", platform)
})
function launchEnv(prefix: string) {
  const input = parseObservationArguments(args)
  if (input.help) throw new Error("fixture")
  const launch = prepareObservationLaunch({ ...input, runId: `${prefix}-${randomUUID()}` }, resolve("."))
  return { input, launch }
}

it.skipIf(process.platform !== "win32").each(["LOGONSERVER", "LogonServer"])("accepts a lone %s on win32, then removes it; HOME/USERPROFILE are the isolated home", (key) => {
  const { input, launch } = launchEnv("logon-alone")
  const env: NodeJS.ProcessEnv = { ...launch.env, [key]: MARKER }
  expect(() => validateObservationChildEnvironment(env, input.config.sourceIds, resolve("."))).not.toThrow()
  const isolation = isolateObservationChildEnvironment(env, input.config.sourceIds, resolve("."), launch.cwd)
  expect(isolation.discardedWindowsKeys).toEqual([key])
  expect(Object.keys(env).some(name => name.toLowerCase() === "logonserver")).toBe(false)
  expect(Object.values(env)).not.toContain(MARKER)
  expect(env.HOME).toBe(resolve(launch.cwd, ".home"))
  expect(env.USERPROFILE).toBe(env.HOME)
  expect(readdirSync(isolation.home)).toEqual([])
})

it.skipIf(process.platform !== "win32")("still rejects case-duplicated LOGONSERVER keys", () => {
  const { input, launch } = launchEnv("logon-dup")
  expect(() => validateObservationChildEnvironment({ ...launch.env, LOGONSERVER: MARKER, LogonServer: MARKER }, input.config.sourceIds, resolve("."))).toThrow("observation_child_environment_invalid")
})

it("rejects LOGONSERVER outside win32", () => {
  const { input, launch } = launchEnv("logon-nonwin")
  Object.defineProperty(process, "platform", { ...platform, value: "linux" })
  expect(() => validateObservationChildEnvironment({ ...launch.env, LOGONSERVER: MARKER }, input.config.sourceIds, resolve("."))).toThrow("observation_child_environment_invalid")
})

it.skipIf(process.platform !== "win32").each([
  ["unknown key", { SHIPPING_TEST_ONLY_REJECT: "synthetic-only" }],
  ["fake credential", { DEEPSEEK_API_KEY: "synthetic-only" }],
  ["NODE_OPTIONS", { NODE_OPTIONS: "--synthetic-only" }],
  ["proxy", { HTTPS_PROXY: "synthetic-only" }],
  ["expected value mismatch", { SHIPPING_RUNTIME_ENABLED: "false" }],
])("with LOGONSERVER present, still rejects %s", (_name, extra) => {
  const { input, launch } = launchEnv("logon-reject")
  const env: NodeJS.ProcessEnv = { ...launch.env, LOGONSERVER: MARKER, ...extra }
  expect(() => isolateObservationChildEnvironment(env, input.config.sourceIds, resolve("."), launch.cwd)).toThrow("observation_child_environment_invalid")
  expect(existsSync(resolve(launch.cwd, ".home"))).toBe(false)
})

/**
 * Independent test parent: sets (or removes) LOGONSERVER in its own process only, then runs the same
 * two-level launcher -> worker CLI. The shared vitest process.env is never mutated.
 */
const PARENT = `
const { spawnSync } = require("node:child_process")
const spec = JSON.parse(process.argv[1])
for (const key of Object.keys(process.env)) if (key.toLowerCase() === "logonserver") delete process.env[key]
if (spec.marker) process.env.LOGONSERVER = spec.marker
const child = spawnSync(process.execPath, spec.entry, { cwd: spec.cwd, env: spec.env, encoding: "utf8", windowsHide: true, timeout: 15000 })
process.stdout.write(JSON.stringify({ status: child.status, stdout: child.stdout, stderr: child.stderr }))
`
function runCli(marker: string | null) {
  const runId = `logon-cli-${marker ? "marker" : "absent"}-${randomUUID()}`
  const directory = resolve(".tmp", `r2-intel-observe-${runId}`)
  const entry = ["--no-global-search-paths", "--import", "tsx/esm", "--experimental-loader", pathToFileURL(resolve("scripts/tsx-alias-loader.mjs")).href, resolve("scripts/r2-intel-observe.ts"), "--execute", "--run-id", runId, "--sources", "TH-W01,ID-W01", "--duration-ms", "10000", "--max-http-requests", "0"]
  const env = observationEnvironment(process.env, [])
  const parent = spawnSync(process.execPath, ["-e", PARENT, JSON.stringify({ entry, env, cwd: resolve("."), marker })], { cwd: resolve("."), env, encoding: "utf8", windowsHide: true, timeout: 20000 })
  expect(parent.status, parent.stderr).toBe(0)
  return { directory, child: JSON.parse(parent.stdout) as { status: number | null, stdout: string, stderr: string } }
}
function expectNoLeak(directory: string, texts: string[]) {
  const real = Object.entries(process.env).filter(([key, value]) => key.toLowerCase() === "logonserver" && value).map(([, value]) => value!)
  const evidence = ["manifest.json", "result.json", "events.jsonl"].filter(name => existsSync(resolve(directory, name))).map(name => readFileSync(resolve(directory, name), "utf8"))
  for (const text of [...texts, ...evidence]) {
    expect(text.includes(MARKER)).toBe(false)
    // Key NAMES may appear only in the audit list environmentIsolation.discardedWindowsKeys (no values).
    const scrubbed = text.replace(/"discardedWindowsKeys":\s*\[[^\]]*\]/g, "")
    expect(scrubbed.toLowerCase().includes("logonserver")).toBe(false)
    for (const value of real) expect(text.includes(value)).toBe(false)
  }
}

it.skipIf(process.platform !== "win32").each([["synthetic marker", MARKER], ["absent", null]] as const)("actual two-level CLI reaches exit 2 with parent LOGONSERVER %s, not visible to the business phase", (_label, marker) => {
  const { directory, child } = runCli(marker)
  expect(child.status, child.status === 2 ? "" : child.stderr.replace(MARKER, "<marker>")).toBe(2)
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"))
  expect(manifest.codeIdentity.environmentKeys.some((key: string) => key.toLowerCase() === "logonserver")).toBe(false)
  expect(manifest.codeIdentity.environmentKeys).toContain("HOME")
  const discarded: string[] = manifest.codeIdentity.environmentIsolation.discardedWindowsKeys
  expect(discarded.some(key => key.toLowerCase() === "logonserver")).toBe(marker !== null)
  const result = JSON.parse(readFileSync(resolve(directory, "result.json"), "utf8"))
  expect(result).toMatchObject({ reason: "http_budget", reservations: 0, httpRequests: 0, dnsRequests: 0, ownershipReleased: true })
  expectNoLeak(directory, [child.stdout, child.stderr])
}, 30000)
