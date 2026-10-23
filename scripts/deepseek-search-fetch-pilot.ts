/**
 * CLI entry for DeepSeek Search/Fetch pilot. Logic lives in deepseek-search-fetch-pilot-lib.ts.
 */
import process from "node:process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  parsePilotArgs,
  printHelp,
  resolveExecuteKey,
  resolveUnderCwd,
  runPilot,
  sanitizePilotText,
  summaryForStdout,
} from "./deepseek-search-fetch-pilot-lib"

async function main(): Promise<void> {
  const args = parsePilotArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }
  const cwd = process.cwd()
  const mode = args.execute ? "execute" : "plan"
  let readKey: (() => Promise<string | undefined>) | undefined
  if (mode === "execute") {
    readKey = async () => resolveExecuteKey({
      keyFromStdin: args.keyFromStdin || !process.stdin.isTTY,
      allowSecurePrompt: !args.keyFromStdin,
    })
  }
  const summary = await runPilot({
    cwd,
    mode,
    ledgerPath: args.ledgerPath ? resolveUnderCwd(cwd, args.ledgerPath) : undefined,
    paidDbPath: args.paidDbPath ? resolveUnderCwd(cwd, args.paidDbPath) : undefined,
    pilotId: args.pilotId,
    readKey,
  })
  console.log(JSON.stringify(summaryForStdout(summary), null, 2))
  process.exitCode = summary.exitCode
}

const moduleUrl = import.meta.url
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(sanitizePilotText(message))
    process.exitCode = 1
  })
}
