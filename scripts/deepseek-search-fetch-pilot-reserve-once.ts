/**
 * Child-process helper: call real reserveAttempt once (for concurrent gate tests).
 * Requires --test-isolation under project .tmp/. No secrets, no outbound.
 */
import process from "node:process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runReserveOnceCli, sanitizePilotText } from "./deepseek-search-fetch-pilot-lib"

async function main(): Promise<void> {
  process.exitCode = runReserveOnceCli(process.argv.slice(2))
}

const moduleUrl = import.meta.url
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(sanitizePilotText(message))
    process.exitCode = 1
  })
}
