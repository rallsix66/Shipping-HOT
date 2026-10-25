import { execFileSync } from "node:child_process"
import { copyFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { build } from "vite"
import { buildClipper } from "../../scripts/build-clipper.mjs"

const root = resolve(import.meta.dirname, "../..")
if (process.cwd() !== root) throw new Error("build_from_repository_root")
await build({ configFile: resolve(root, "tools/clip-synthetic/vite.config.ts") })
await buildClipper(true)
await copyFile(resolve(root, "tools/clip-synthetic/synthetic-article.html"), resolve(root, ".tmp/clip-synthetic-build/synthetic-article.html"))
await writeFile(resolve(root, ".tmp/clip-synthetic-build/build.json"), JSON.stringify({ synthetic: true, sourceUrl: "http://127.0.0.1:5174/synthetic-article.html", sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() }, null, 2))
