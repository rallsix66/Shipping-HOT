import process from "node:process"
import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { PRODUCTION_ALLOW_SELECT_CATALOG_IDS } from "../server/runtime/intel-allow-select"

const observationSources = new Set<string>(PRODUCTION_ALLOW_SELECT_CATALOG_IDS)

// Observed on Windows before application imports. Never inherited by the launcher or trusted as paths.
// logonserver: Node v24.15.0 / libuv 1.51.0 required_vars re-add it from the parent even when an explicit
// env omits it. Guarantee is "validated, then removed before the business phase", not "never received".
const windowsInjected = new Set(["homedrive", "homepath", "systemdrive", "userdomain", "username", "userprofile", "logonserver"])
const system = new Set(["systemroot", "windir", "comspec", "pathext", "path", "temp", "tmp"])

export function observationEnvironment(env: NodeJS.ProcessEnv, sourceIds: string[], workspace?: string): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (system.has(key.toLowerCase()) && value !== undefined) child[key] = value
  }
  return { ...child, TZ: "UTC", SHIPPING_OBSERVATION_CHILD: "true", SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "true", SHIPPING_INTEL_ENABLED: "true", SHIPPING_INTEL_SOURCE_IDS: sourceIds.join(","), ...(workspace ? { TSX_TSCONFIG_PATH: join(realpathSync(workspace), "tsconfig.json") } : {}) }
}

export function validateObservationChildEnvironment(env: NodeJS.ProcessEnv, sourceIds: string[], workspace?: string): void {
  if (!Array.isArray(sourceIds) || !sourceIds.length || new Set(sourceIds).size !== sourceIds.length || sourceIds.some(id => !observationSources.has(id))) throw new Error("observation_child_environment_invalid")
  const expected = observationEnvironment(env, sourceIds, workspace)
  const allowed = new Set([...Object.keys(expected).map(key => key.toLowerCase()), "node_channel_fd", "node_channel_serialization_mode", ...(process.platform === "win32" ? windowsInjected : [])])
  const keys = Object.keys(env).map(key => key.toLowerCase())
  if (new Set(keys).size !== keys.length || keys.some(key => !allowed.has(key)) || Object.entries(expected).some(([key, value]) => env[key] !== value)) throw new Error("observation_child_environment_invalid")
}

/** Builtins only: run before importing the application, Git or any Provider code. */
export function isolateObservationChildEnvironment(env: NodeJS.ProcessEnv, sourceIds: string[], workspace: string, directory: string) {
  validateObservationChildEnvironment(env, sourceIds, workspace)
  const root = realpathSync(workspace)
  const tmp = realpathSync(join(root, ".tmp"))
  const canonical = realpathSync(directory)
  if (tmp !== join(root, ".tmp") || dirname(canonical) !== tmp || resolve(directory) !== canonical || !/^r2-intel-observe-[a-z0-9-]{1,64}$/.test(basename(canonical))) throw new Error("observation_directory_invalid")
  if ([".data", "manifest.json", "events.jsonl", ".home"].some(name => existsSync(join(canonical, name)))) throw new Error("observation_run_exists")
  const home = join(canonical, ".home")
  mkdirSync(home, { mode: 0o700 }) // New/empty, never copied from the actual user profile.
  const discardedWindowsKeys = Object.keys(env).filter(key => windowsInjected.has(key.toLowerCase()))
  for (const key of discardedWindowsKeys) delete env[key]
  // Incoming HOME is rejected above. These are controlled child-only values, not inherited paths.
  env.HOME = home
  env.USERPROFILE = home
  return { home, discardedWindowsKeys, tsconfigPath: env.TSX_TSCONFIG_PATH, userConfigCopied: false }
}
