import process from "node:process"
import { mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parseArgs } from "node:util"
import { pathToFileURL } from "node:url"
import { type IntelObservationConfig, validateObservationConfig } from "../server/runtime/intel-observation-network"
import { observationEnvironment } from "./r2-intel-observe-environment"

export { observationEnvironment, validateObservationChildEnvironment } from "./r2-intel-observe-environment"

export function parseObservationArguments(args: string[]) {
  const parsed = parseArgs({ args, strict: true, allowPositionals: false, tokens: true, options: { "help": { type: "boolean" }, "execute": { type: "boolean" }, "run-id": { type: "string" }, "sources": { type: "string" }, "duration-ms": { type: "string" }, "max-http-requests": { type: "string" }, "approved-redirect": { type: "string", multiple: true } } })
  if (parsed.values.help) return { help: true as const }
  for (const token of parsed.tokens) {
    if (token.kind === "option" && token.name !== "approved-redirect" && parsed.tokens.filter(other => other.kind === "option" && other.name === token.name).length > 1) throw new Error("observation_duplicate_argument")
  }
  const values = parsed.values
  if (!values.execute) throw new Error("observation_explicit_execute_required")
  if (!/^[a-z0-9-]{1,64}$/.test(values["run-id"] ?? "")) throw new Error("observation_run_id_invalid")
  if (!/^\d+$/.test(values["duration-ms"] ?? "") || !/^\d+$/.test(values["max-http-requests"] ?? "")) throw new Error("observation_limits_required")
  const config = validateObservationConfig({ sourceIds: (values.sources ?? "").split(",").map(id => id.trim()), durationMs: Number(values["duration-ms"]), maxHttpRequests: Number(values["max-http-requests"]), approvedRedirects: (values["approved-redirect"] ?? []).map(value => JSON.parse(value)) })
  return { help: false as const, runId: values["run-id"]!, config }
}

export function prepareObservationLaunch(input: { runId: string, config: IntelObservationConfig }, workspace: string) {
  const root = realpathSync(workspace)
  mkdirSync(join(root, ".tmp"), { recursive: true })
  const tmp = realpathSync(join(root, ".tmp"))
  if (tmp !== join(root, ".tmp") || relative(root, tmp).startsWith("..") || !/^[a-z0-9-]{1,64}$/.test(input.runId)) throw new Error("observation_directory_invalid")
  const config = validateObservationConfig(input.config)
  const directory = join(tmp, `r2-intel-observe-${input.runId}`)
  mkdirSync(directory) // EEXIST is terminal: never reset or resume a prior budget/window.
  const manifest = join(directory, "launch.json")
  writeFileSync(manifest, `${JSON.stringify({ workspace: root, directory, config, createdAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx" })
  return { executable: process.execPath, args: ["--no-global-search-paths", "--import", "tsx/esm", "--experimental-loader", pathToFileURL(join(root, "scripts/tsx-alias-loader.mjs")).href, join(root, "scripts/r2-intel-observe-worker.ts"), "--launch", manifest], cwd: directory, env: observationEnvironment(process.env, config.sourceIds, root), windowsHide: true }
}
