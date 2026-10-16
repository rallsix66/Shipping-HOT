// Explicit local test launcher, not a browser controller or collection runtime.
import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import process from "node:process"
import { open } from "../../server/intel/__fixtures__/isolated-db"
import { initShippingTables } from "../../server/database/shipping"

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."))
const args = process.argv.slice(2)
if (args[0] === "--") args.shift()
if (args.length !== 1) throw new Error("one_synthetic_artifact_directory_required")
const artifact = realpathSync(resolve(args[0]))
const build = JSON.parse(readFileSync(join(artifact, "build.json"), "utf8"))
const sourceUrl = "http://127.0.0.1:5174/synthetic-article.html"
if (build.synthetic !== true || build.sourceUrl !== sourceUrl || !/^[a-f0-9]{40}$/.test(build.sha) || artifact !== join(root, ".tmp", `clipper-manual-${build.sha.slice(0, 7)}`)) throw new Error("invalid_synthetic_artifact")
const run = join(artifact, "run")
if (existsSync(run) && realpathSync(run) !== run) throw new Error("linked_run_directory_forbidden")
mkdirSync(run, { recursive: true })
const dataDir = join(run, ".data")
if (existsSync(dataDir) && realpathSync(dataDir) !== dataDir) throw new Error("linked_database_directory_forbidden")
mkdirSync(dataDir, { recursive: true })
const dbFile = join(run, ".data/shipping-hot-v3.sqlite3")
const markerPath = join(run, "clip-synthetic-run.json")
if (existsSync(join(run, ".data/provider-secrets.json")) || (existsSync(dbFile) && !existsSync(markerPath))) throw new Error("unexpected_database_or_secret")
if (existsSync(dbFile) && (lstatSync(dbFile).isSymbolicLink() || lstatSync(dbFile).nlink !== 1 || realpathSync(dbFile) !== dbFile)) throw new Error("linked_database_forbidden")
const db = open(dbFile)
try {
  const metadata = await initShippingTables(db.database, "real")
  if (existsSync(markerPath) && JSON.parse(readFileSync(markerPath, "utf8")).databaseId !== metadata.databaseId) throw new Error("database_identity_changed")
  writeFileSync(markerPath, JSON.stringify({ repositoryRoot: root, sha: build.sha, sourceUrl, databaseId: metadata.databaseId }, null, 2))
} finally {
  db.native.close()
}
const fixture = readFileSync(join(artifact, "synthetic-article.html"))
const source = createServer((req, res) => {
  if (req.headers.host !== "127.0.0.1:5174" || req.url !== "/synthetic-article.html") {
    res.writeHead(404)
    res.end()
    return
  }
  if (!["GET", "HEAD"].includes(req.method ?? "")) {
    res.writeHead(405)
    res.end()
    return
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Length": fixture.length, "X-Content-Type-Options": "nosniff" })
  res.end(req.method === "HEAD" ? undefined : fixture)
})
await new Promise<void>((ok, fail) => {
  source.once("error", fail)
  source.listen(5174, "127.0.0.1", ok)
})
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|programfiles(?:\(x86\))?|programdata|pathext|number_of_processors|processor_architecture|processor_identifier|os|path)$/i.test(key)))
Object.assign(env, { HOST: "127.0.0.1", NITRO_HOST: "127.0.0.1", PORT: "5173", NITRO_PORT: "5173", SHIPPING_DATA_MODE: "real", SHIPPING_RUNTIME_ENABLED: "false", SHIPPING_INTEL_ENABLED: "false", NODE_ENV: "production" })
const child = spawn(process.execPath, [join(artifact, "app-test/server/index.mjs")], { cwd: run, env, windowsHide: true, stdio: ["ignore", openSync(join(run, "server.stdout.log"), "a"), openSync(join(run, "server.stderr.log"), "a")] })
child.once("error", () => source.close())
child.once("exit", () => source.close())
function stop() {
  child.kill()
  source.close()
}
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
writeFileSync(join(run, "service.json"), JSON.stringify({ sha: build.sha, receiverPid: child.pid, sourcePid: process.pid, cwd: run, receiver: "http://127.0.0.1:5173/feed", source: sourceUrl, synthetic: true, browserOperated: false }, null, 2))
console.log(JSON.stringify({ starting: true, receiverPid: child.pid, sourcePid: process.pid, cwd: run, source: sourceUrl }))
