import process from "node:process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { expect, it } from "vitest"
import { observationEnvironment, parseObservationArguments, prepareObservationLaunch, validateObservationChildEnvironment } from "./r2-intel-observe-options"
import { isolateObservationChildEnvironment } from "./r2-intel-observe-environment"

const args = ["--execute", "--run-id", "offline-test", "--sources", "TH-W01,ID-W01", "--duration-ms", "60000", "--max-http-requests", "2"]
it("requires an explicit start, all limits and allowlisted sources", () => {
  expect(parseObservationArguments(["--help"])).toEqual({ help: true })
  expect(() => parseObservationArguments([])).toThrow("execute_required")
  expect(() => parseObservationArguments(args.slice(0, -2))).toThrow("limits_required")
  expect(() => parseObservationArguments([...args, "--execute"])).toThrow("duplicate_argument")
  expect(() => parseObservationArguments([...args, "--frequency", "1"])).toThrow()
  expect(() => parseObservationArguments(args.map(value => value === "TH-W01,ID-W01" ? "CN-P01" : value))).toThrow("sources_invalid")
  expect(() => parseObservationArguments(args.map(value => value === "offline-test" ? "../retained" : value))).toThrow("run_id_invalid")
  expect(parseObservationArguments(args)).toMatchObject({ help: false, config: { maxHttpRequests: 2, durationMs: 60000, sourceIds: ["TH-W01", "ID-W01"] } })
})
it("uses a system-only environment plus fixed flags; no inherited credentials, proxy or Node options", () => {
  const env = observationEnvironment({ Path: "synthetic-path", SystemRoot: "synthetic-root", TEMP: "synthetic-temp", DEEPSEEK_API_KEY: "synthetic-secret", SHIPPING_TRANSLATION_ENABLED: "true", HTTP_PROXY: "synthetic-proxy", NODE_OPTIONS: "--use-env-proxy", NODE_EXTRA_CA_CERTS: "synthetic-file", SHIPPING_DATABASE_PATH: "retained.sqlite3" }, ["TH-W01"])
  expect(env).toEqual({ Path: "synthetic-path", SystemRoot: "synthetic-root", TEMP: "synthetic-temp", TZ: "UTC", SHIPPING_OBSERVATION_CHILD: "true", SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "true", SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: "TH-W01" })
})
it("prepares a fresh isolated cwd and explicit child entry without spawning or writing persistent config", () => {
  const input = parseObservationArguments(args)
  if (input.help) throw new Error("fixture")
  const runId = `offline-launch-${randomUUID()}`
  const launch = prepareObservationLaunch({ ...input, runId }, resolve("."))
  expect(launch.executable).toBe(process.execPath)
  expect(launch.cwd).toBe(resolve(".tmp", `r2-intel-observe-${runId}`))
  expect(launch.windowsHide).toBe(true)
  expect(launch.args.some(value => basename(value) === "r2-intel-observe-worker.ts")).toBe(true)
  expect(JSON.parse(readFileSync(resolve(launch.cwd, "launch.json"), "utf8"))).toMatchObject({ config: input.config, directory: launch.cwd })
  expect(existsSync(resolve(launch.cwd, ".data"))).toBe(false)
  expect(() => prepareObservationLaunch({ ...input, runId }, resolve("."))).toThrow()
})

it("the child independently rejects inherited extra settings or mismatched enable/source flags", () => {
  const env = observationEnvironment({}, ["TH-W01"])
  expect(() => validateObservationChildEnvironment(env, ["TH-W01"])).not.toThrow()
  expect(() => validateObservationChildEnvironment({ ...env, DEEPSEEK_API_KEY: "synthetic-only" }, ["TH-W01"])).toThrow("child_environment_invalid")
  expect(() => validateObservationChildEnvironment({ ...env, HTTP_PROXY: "synthetic-only" }, ["TH-W01"])).toThrow("child_environment_invalid")
  expect(() => validateObservationChildEnvironment(env, ["ID-W01"])).toThrow("child_environment_invalid")
  expect(() => validateObservationChildEnvironment({ ...env, SHIPPING_RUNTIME_ENABLED: "false" }, ["TH-W01"])).toThrow("child_environment_invalid")
})

it("actual Node CLI resolves file/directory aliases and exits without starting on help or missing execute", () => {
  const entry = ["--import", "tsx/esm", "--experimental-loader", pathToFileURL(resolve("scripts/tsx-alias-loader.mjs")).href, resolve("scripts/r2-intel-observe.ts")]
  const options = { cwd: resolve("."), env: observationEnvironment(process.env, []), encoding: "utf8" as const, windowsHide: true }
  const help = spawnSync(process.execPath, [...entry, "--help"], options)
  expect(help.status, help.stderr).toBe(0)
  expect(help.stdout).toContain("Explicit observation only")
  const absent = spawnSync(process.execPath, entry, options)
  expect(absent.status, absent.stderr).toBe(1)
  expect(absent.stderr).toContain("observation_explicit_execute_required")
})

it("actual isolated worker rejects an extra environment key before DB/bootstrap or any source work", () => {
  const input = parseObservationArguments(args)
  if (input.help) throw new Error("fixture")
  const launch = prepareObservationLaunch({ ...input, runId: `offline-reject-${randomUUID()}` }, resolve("."))
  const child = spawnSync(launch.executable, launch.args, { cwd: launch.cwd, env: { ...launch.env, SHIPPING_TEST_ONLY_REJECT: "synthetic-only" }, encoding: "utf8", windowsHide: true, timeout: 10000 })
  expect(child.status, child.stderr).toBe(1)
  expect(child.stderr).toContain("observation_child_environment_invalid")
  expect(existsSync(resolve(launch.cwd, ".data"))).toBe(false)
  expect(existsSync(resolve(launch.cwd, "manifest.json"))).toBe(false)
  expect(existsSync(resolve(launch.cwd, ".home"))).toBe(false)
})

it.skipIf(process.platform !== "win32")("accepts only the six observed Windows keys, discards their paths and establishes an empty private home", () => {
  const input = parseObservationArguments(args)
  if (input.help) throw new Error("fixture")
  const launch = prepareObservationLaunch({ ...input, runId: `env-home-${randomUUID()}` }, resolve("."))
  const foreignHome = resolve(".tmp", `foreign-profile-${randomUUID()}`)
  mkdirSync(foreignHome)
  writeFileSync(resolve(foreignHome, ".gitconfig"), "INVALID SYNTHETIC USER CONFIG")
  const injected = { HOMEDRIVE: "C:", HOMEPATH: "\\synthetic-profile", SYSTEMDRIVE: "C:", USERDOMAIN: "synthetic-domain", USERNAME: "synthetic-user", USERPROFILE: foreignHome }
  const env: NodeJS.ProcessEnv = { ...launch.env, ...injected }
  expect(() => validateObservationChildEnvironment(env, input.config.sourceIds, resolve("."))).not.toThrow()
  const isolation = isolateObservationChildEnvironment(env, input.config.sourceIds, resolve("."), launch.cwd)
  expect(isolation.discardedWindowsKeys.sort()).toEqual(Object.keys(injected).sort())
  expect(env.HOME).toBe(resolve(launch.cwd, ".home"))
  expect(env.USERPROFILE).toBe(env.HOME)
  expect(readdirSync(isolation.home)).toEqual([])
  for (const key of Object.keys(injected).filter(key => key !== "USERPROFILE")) expect(env[key]).toBeUndefined()
  expect(readFileSync(resolve(foreignHome, ".gitconfig"), "utf8")).toBe("INVALID SYNTHETIC USER CONFIG")
})

it.each(["HOME", "XDG_CONFIG_HOME", "APPDATA", "LOCALAPPDATA", "ARBITRARY_SETTING", "DEEPSEEK_API_KEY", "ACCESS_TOKEN", "PROVIDER_SECRET", "USERNAME_SECRET", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_USE_SYSTEM_CA", "NODE_USE_ENV_PROXY", "SHIPPING_DATABASE_PATH", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT", "GIT_CONFIG_NOSYSTEM", "NPM_CONFIG_USERCONFIG", "TSX_TSCONFIG_PATH"])("still rejects untrusted configuration/credentials before home creation: %s", (key) => {
  const input = parseObservationArguments(args)
  if (input.help) throw new Error("fixture")
  const launch = prepareObservationLaunch({ ...input, runId: `env-reject-${randomUUID()}` }, resolve("."))
  const env = { ...launch.env, [key]: "synthetic-untrusted" }
  expect(() => isolateObservationChildEnvironment(env, input.config.sourceIds, resolve("."), launch.cwd)).toThrow("child_environment_invalid")
  expect(existsSync(resolve(launch.cwd, ".home"))).toBe(false)
  expect(existsSync(resolve(launch.cwd, ".data"))).toBe(false)
})

it("does not inherit profile/config paths and pins tsx plus disabled global module search in the actual launch", () => {
  const input = parseObservationArguments(args)
  if (input.help) throw new Error("fixture")
  const env = observationEnvironment({ HOME: "synthetic-home", USERPROFILE: "synthetic-profile", HOMEDRIVE: "synthetic-drive", HOMEPATH: "synthetic-path", SYSTEMDRIVE: "synthetic-drive", USERDOMAIN: "synthetic-domain", USERNAME: "synthetic-user", TSX_TSCONFIG_PATH: "synthetic-config", NODE_OPTIONS: "synthetic-options", NODE_EXTRA_CA_CERTS: "synthetic-ca" }, input.config.sourceIds, resolve("."))
  expect(Object.keys(env).some(key => /home|profile|domain|username|systemdrive|node_|ca_certs/i.test(key))).toBe(false)
  expect(env.TSX_TSCONFIG_PATH).toBe(resolve("tsconfig.json"))
  const launch = prepareObservationLaunch({ ...input, runId: `env-flags-${randomUUID()}` }, resolve("."))
  expect(launch.args[0]).toBe("--no-global-search-paths")
  expect(launch.env.TSX_TSCONFIG_PATH).toBe(resolve("tsconfig.json"))
})

it("actual execute CLI reaches bootstrap, zero-budget stop, read-only reopen and released ownership with an isolated home", () => {
  const runId = `zero-positive-${randomUUID()}`
  const directory = resolve(".tmp", `r2-intel-observe-${runId}`)
  const entry = ["--no-global-search-paths", "--import", "tsx/esm", "--experimental-loader", pathToFileURL(resolve("scripts/tsx-alias-loader.mjs")).href, resolve("scripts/r2-intel-observe.ts"), "--execute", "--run-id", runId, "--sources", "TH-W01,ID-W01", "--duration-ms", "10000", "--max-http-requests", "0"]
  const child = spawnSync(process.execPath, entry, { cwd: resolve("."), env: observationEnvironment(process.env, []), encoding: "utf8", windowsHide: true, timeout: 15000 })
  expect(child.status, child.stderr).toBe(2)
  const manifest = JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8"))
  const result = JSON.parse(readFileSync(resolve(directory, "result.json"), "utf8"))
  expect(manifest.processCwd).toBe(directory)
  expect(manifest.registeredJobs).toEqual(["intel-collect"])
  expect(manifest.codeIdentity.environmentIsolation).toMatchObject({ home: resolve(directory, ".home"), tsconfigPath: resolve("tsconfig.json"), userConfigCopied: false, moduleGlobalPaths: [], homedirMatches: true })
  expect(manifest.codeIdentity.environmentKeys).toContain("HOME")
  expect(manifest.codeIdentity.environmentKeys).not.toContain("NODE_OPTIONS")
  expect(readdirSync(resolve(directory, ".home"))).toEqual([])
  expect(result).toMatchObject({ reason: "http_budget", reservations: 0, httpRequests: 0, dnsRequests: 0, ownershipReleased: true, readOnlyReopen: true })
  expect(result.counts).toMatchObject({ intel_fetch_run: 0, intel_executor: 0, intel_item: 0, provider_usage: 0, translation_cache: 0 })
  expect(existsSync(`${result.databasePath}.intel-owner.lock`)).toBe(false)
  expect(existsSync(resolve(directory, ".data/provider-secrets.json"))).toBe(false)
}, 20000)
