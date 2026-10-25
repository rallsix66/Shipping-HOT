import process from "node:process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parsePhM01Arguments, runPhM01Oneshot } from "./ph-m01-oneshot"

const moduleUrl = import.meta.url

async function main() {
  const input = parsePhM01Arguments(process.argv.slice(2))
  if (input.help) {
    process.stdout.write("PH-M01 one-shot. No args: plan only, no network and no database. --execute --run-id <id> calls job.run() once. Offline acceptance does not verify live SIGINT, DNS packets, or a 24h run.\n")
    return
  }
  const workspace = fileURLToPath(new URL("..", moduleUrl))
  const controller = new AbortController()
  const stop = () => controller.abort()
  if (input.mode === "execute") {
    process.on("SIGINT", stop)
    process.on("SIGTERM", stop)
  }
  try {
    const summary = await runPhM01Oneshot({ mode: input.mode, workspace, runId: input.mode === "execute" ? input.runId : undefined, signal: controller.signal })
    process.stdout.write(`${JSON.stringify(summary)}\n`)
    process.exitCode = summary.exitCode
  } finally {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "ph_m01_failed"}\n`)
    process.exitCode = 1
  })
}
