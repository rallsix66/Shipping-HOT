import process from "node:process"
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseObservationArguments, prepareObservationLaunch } from "./r2-intel-observe-options"

const moduleUrl = import.meta.url
const scriptWorkspace = fileURLToPath(new URL("../", moduleUrl))

async function main() {
  const input = parseObservationArguments(process.argv.slice(2))
  if (input.help) {
    console.log("Explicit observation only: --execute --run-id <new-id> --sources TH-W01,ID-W01 --duration-ms <1..86400000> --max-http-requests <0..200> [--approved-redirect '{\"from\":\"https://...\",\"to\":\"https://...\"}']\nFrequency: existing 15min job tick / adaptive15..60min. No args never starts. A real run needs separate user approval; this implementation's acceptance is offline only.")
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
