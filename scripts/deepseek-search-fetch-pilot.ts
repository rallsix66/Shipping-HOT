/**
 * CLI entry for DeepSeek Search/Fetch pilot. Logic in deepseek-search-fetch-pilot-lib.ts.
 * Project root is derived from this script's location (…/scripts → repo root), not cwd.
 */
import process from "node:process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  KeyStdinDecodeError,
  parsePilotArgs,
  printHelp,
  resolveExecuteKey,
  runPilot,
  runPreflightKeyRequest,
  sanitizePilotText,
  summaryForStdout,
} from "./deepseek-search-fetch-pilot-lib"

const scriptDir = fileURLToPath(new URL(".", import.meta.url))
const projectRoot = resolve(scriptDir, "..")

async function main(): Promise<void> {
  const args = parsePilotArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  // Explicit-only preflight: never implicit, never chains into paid execute.
  if (args.preflightKeyRequest) {
    if (args.execute) {
      console.error("preflight_incompatible_with_execute")
      process.exitCode = 2
      return
    }
    if (!args.keyFromStdin) {
      console.error("preflight_requires_key_from_stdin")
      process.exitCode = 2
      return
    }
    let key: string | undefined
    try {
      key = await resolveExecuteKey({ keyFromStdin: true })
    } catch (error) {
      if (error instanceof KeyStdinDecodeError) {
        console.log("preflight_key_format")
        process.exitCode = 3
        return
      }
      throw error
    }
    const code = runPreflightKeyRequest(key)
    console.log(code)
    process.exitCode = code === "preflight_ok" ? 0 : 3
    return
  }
  const mode = args.execute ? "execute" : "plan"
  if (mode === "execute" && !args.keyFromStdin) {
    console.error("execute_requires_key_from_stdin")
    process.exitCode = 2
    return
  }
  let readKey: (() => Promise<string | undefined>) | undefined
  if (mode === "execute") {
    readKey = async () => resolveExecuteKey({ keyFromStdin: true })
  }
  const summary = await runPilot({
    projectRoot,
    mode,
    readKey,
  })
  console.log(JSON.stringify(summaryForStdout(summary), null, 2))
  process.exitCode = summary.exitCode
}

const moduleUrl = import.meta.url
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl) {
  void main().catch((error: unknown) => {
    if (error instanceof KeyStdinDecodeError) {
      console.error("preflight_key_format")
      process.exitCode = 3
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error(sanitizePilotText(message))
    process.exitCode = 1
  })
}
