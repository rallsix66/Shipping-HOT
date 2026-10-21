import process from "node:process"
import { readFileSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { lookup } from "node:dns/promises"
import { execFileSync } from "node:child_process"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { isolateObservationChildEnvironment } from "./r2-intel-observe-environment"
import { type WorkerStopLatch, latchWorkerStop, startAfterImportBarrier } from "./r2-intel-observe-worker-startup"

async function main() {
  const latch = latchWorkerStop(process)
  try {
    await runWorker(latch)
  } finally {
    latch.dispose()
    if (process.connected) process.disconnect()
  }
}

async function runWorker(latch: WorkerStopLatch) {
  const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)))
  if (process.env.SHIPPING_OBSERVATION_CHILD !== "true" || process.argv.length !== 4 || process.argv[2] !== "--launch") throw new Error("observation_child_entry_required")
  const directory = realpathSync(process.cwd())
  if (resolve(process.argv[3]) !== join(directory, "launch.json")) throw new Error("observation_manifest_path_invalid")
  const launch = JSON.parse(readFileSync(process.argv[3], "utf8"))
  if (Object.keys(launch).sort().join(",") !== "config,createdAt,directory,workspace" || launch.directory !== directory || launch.workspace !== root) throw new Error("observation_manifest_invalid")
  if (!process.execArgv.includes("--no-global-search-paths")) throw new Error("observation_global_search_paths_enabled")
  const environmentIsolation = isolateObservationChildEnvironment(process.env, launch.config?.sourceIds, root, directory)
  const moduleGlobalPaths = createRequire(import.meta.url)("node:module").globalPaths as string[]
  if (homedir() !== environmentIsolation.home || moduleGlobalPaths.length) throw new Error("observation_home_isolation_failed")
  // Application imports occur only after the injected profile values have been discarded; stop/disconnect are already latched.
  await startAfterImportBarrier(latch, async () => ({
    ...await import("../server/runtime/intel-observation-network"),
    ...await import("../server/services/article-fetch-security"),
    ...await import("../server/runtime/intel-observation"),
  }), async ({ validateObservationConfig, defaultTransport, startIntelObservation }, stopSignal) => {
    const config = validateObservationConfig(launch.config)
    // Read metadata from this already-validated workspace only; do not load system/user Git configuration.
    const gitEnvironment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(environmentIsolation.home, ".gitconfig") }
    const readGit = (args: string[]) => execFileSync("git", ["-c", `safe.directory=${root.replace(/\\/g, "/")}`, ...args], { cwd: root, encoding: "utf8", env: gitEnvironment }).trim()
    const codeFiles = ["scripts/r2-intel-observe.ts", "scripts/r2-intel-observe-options.ts", "scripts/r2-intel-observe-environment.ts", "scripts/r2-intel-observe-worker.ts", "scripts/r2-intel-observe-worker-startup.ts", "scripts/tsx-alias-loader.mjs", "server/runtime/intel-observation.ts", "server/runtime/intel-observation-network.ts", "server/runtime/intel-collect-job.ts", "server/runtime/intel-production.ts", "server/runtime/bootstrap.ts", "server/runtime/background-runtime.ts", "server/services/article-fetch-security.ts", "server/intel/collect.ts", "server/intel/sources.ts"]
    const codeIdentity = { head: readGit(["rev-parse", "HEAD"]), worktreeDirty: Boolean(readGit(["status", "--porcelain"])), files: Object.fromEntries(codeFiles.map(file => [file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex")])), environmentKeys: Object.keys(process.env).sort(), environmentIsolation: { ...environmentIsolation, moduleGlobalPaths, homedirMatches: true, gitConfig: "repository-only; system/global config disabled" } }
    const session = await startIntelObservation({ workspace: root, directory, config, evidenceMode: "live", codeIdentity, stopSignal, fetch: { lookup: async host => (await lookup(host, { all: true })).map(row => ({ address: row.address, family: row.family as 4 | 6 })), transport: defaultTransport } })
    const result = await session.done
    console.log(JSON.stringify({ directory, reason: result.reason, httpRequests: result.httpRequests, continuous24hAcceptance: result.continuous24hAcceptance }))
    process.exitCode = result.reason === "deadline" ? 0 : 2
  })
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "observation_worker_failed")
    process.exitCode = 1
    if (process.connected) process.disconnect()
  })
}
