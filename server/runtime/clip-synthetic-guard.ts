import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve, sep } from "node:path"
import { CLIP_SYNTHETIC_URL } from "@shared/clip-build"

export function assertClipSyntheticRun(cwd: string, env: Record<string, string | undefined>) {
  if (Object.entries(env).some(([key, value]) => value && /api.?key|secret|token|password|credential|cookie/i.test(key))) throw new Error("synthetic_credentials_forbidden")
  if (env.HOST !== "127.0.0.1" || env.NITRO_HOST !== "127.0.0.1" || env.PORT !== "5173" || env.NITRO_PORT !== "5173" || env.SHIPPING_RUNTIME_ENABLED !== "false" || env.SHIPPING_INTEL_ENABLED !== "false" || env.SHIPPING_DATA_MODE !== "real") throw new Error("synthetic_run_environment_required")
  const run = realpathSync(cwd)
  const marker = JSON.parse(readFileSync(join(run, "clip-synthetic-run.json"), "utf8"))
  const root = realpathSync(marker.repositoryRoot)
  if (!/^[a-f0-9]{40}$/.test(marker.sha) || marker.sourceUrl !== CLIP_SYNTHETIC_URL || basename(run) !== "run" || dirname(run) !== resolve(root, ".tmp", `clipper-manual-${marker.sha.slice(0, 7)}`) || !run.startsWith(join(root, ".tmp") + sep)) throw new Error("synthetic_isolated_cwd_required")
  const database = join(run, ".data/shipping-hot-v3.sqlite3")
  if (existsSync(join(run, ".data/provider-secrets.json"))) throw new Error("synthetic_credentials_forbidden")
  if (lstatSync(database).isSymbolicLink() || lstatSync(database).nlink !== 1 || realpathSync(database) !== database) throw new Error("synthetic_isolated_database_required")
}
