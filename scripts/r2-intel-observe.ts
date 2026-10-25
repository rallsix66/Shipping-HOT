import process from "node:process"
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseObservationArguments, prepareObservationLaunch, previewObservation } from "./r2-intel-observe-options"

const moduleUrl = import.meta.url
const scriptWorkspace = fileURLToPath(new URL("../", moduleUrl))

async function main() {
  const input = parseObservationArguments(process.argv.slice(2))
  if (input.help) {
    console.log("Explicit observation only: --execute --run-id <new-id> --sources <allow-select catalog ids> --duration-ms <1..86400000> --max-http-requests <0..200> [--stop-after-successful-rounds 1|2] [--approved-redirect '{\"from\":\"https://...\",\"to\":\"https://...\"}']\n--plan prints resolved entries, the approved redirect, the budget and the isolated directory, then exits with no DNS, HTTP or database. --plan together with --execute is rejected.\n--profile 24h-19 is the only mode whose shared HTTP cap may reach 2000. It requires duration-ms 86400000, the 19 allow-select catalog ids in catalog order, and exactly {\"from\":\"https://jdih.kemenkeu.go.id/\",\"to\":\"https://jdih.kemenkeu.go.id/home\"}. Any other redirect or --stop-after-successful-rounds is rejected. Ordinary runs stay capped at 200.\nFrequency: existing 15min job tick / adaptive15..60min. One runtime permits only the sources named this time. The round bound stops after that many successful source rounds, or on the first failed round; omitting it keeps the duration window. No args never starts. A real run needs separate user approval; this implementation's acceptance is offline only.")
    return
  }
  if (input.plan) {
    console.log(JSON.stringify(previewObservation(input, scriptWorkspace), null, 2))
    return
  }
  const launch = prepareObservationLaunch(input, scriptWorkspace)
  const child = spawn(launch.executable, launch.args, { cwd: launch.cwd, env: launch.env, windowsHide: true, stdio: ["inherit", "inherit", "inherit", "ipc"] })
  const stop = () => {
    if (child.connected) child.send({ type: "stop" })
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  child.once("error", () => {
    process.exitCode = 1
  })
  child.once("exit", (code) => {
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    process.exitCode = code ?? 1
  })
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === moduleUrl) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "observation_launch_failed")
    process.exitCode = 1
  })
}
