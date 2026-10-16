import { copyFile, mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { build } from "vite"

const root = resolve(import.meta.dirname, "..")
const source = resolve(root, "extensions/shipping-hot-clipper")
const outDir = resolve(root, ".tmp/clipper-package")
const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"))
const id = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16)].map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join("")
if (id !== "jihkanbaffodclncabodmbahbbgkjoad") throw new Error("clip_extension_id_mismatch")
await build({ configFile: false, root: source, build: { outDir, emptyOutDir: true, target: "chrome106", rollupOptions: { input: resolve(source, "popup.html") } } })
for (const name of ["content", "worker"]) {
  await build({ configFile: false, root: source, build: { outDir, emptyOutDir: false, target: "chrome106", lib: { entry: resolve(source, `src/${name}.ts`), name: `ShippingClip${name}`, formats: ["iife"], fileName: () => `${name}.js` } } })
}
await mkdir(resolve(outDir, "licenses"), { recursive: true })
await copyFile(resolve(source, "manifest.json"), resolve(outDir, "manifest.json"))
await copyFile(resolve(root, "third_party/obsidian-clipper/LICENSE"), resolve(outDir, "licenses/obsidian-clipper-MIT.txt"))
await copyFile(resolve(root, "node_modules/defuddle/LICENSE"), resolve(outDir, "licenses/defuddle-MIT.txt"))
console.log(JSON.stringify({ outDir, extensionId: id, origin: "http://127.0.0.1:5173", installed: false }))
