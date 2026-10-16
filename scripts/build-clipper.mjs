import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import { fileURLToPath } from "node:url"
import process from "node:process"
import { build } from "vite"
import { clipSyntheticMark } from "./clip-synthetic-mark.ts"

const root = resolve(import.meta.dirname, "..")
const source = resolve(root, "extensions/shipping-hot-clipper")
export async function buildClipper(synthetic = false) {
  const outDir = resolve(root, synthetic ? ".tmp/clip-synthetic-build/extension" : ".tmp/clipper-package")
  const define = { __SHIPPING_CLIP_SYNTHETIC_TEST__: JSON.stringify(synthetic) }
  const manifest = JSON.parse(await readFile(resolve(source, "manifest.json"), "utf8"))
  const id = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16)].map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join("")
  if (id !== "jihkanbaffodclncabodmbahbbgkjoad") throw new Error("clip_extension_id_mismatch")
  await build({ configFile: false, envDir: false, define, plugins: synthetic ? [clipSyntheticMark()] : [], root: source, build: { outDir, emptyOutDir: true, target: "chrome106", rollupOptions: { input: resolve(source, "popup.html") } } })
  for (const name of ["content", "worker"]) {
    await build({ configFile: false, envDir: false, define, root: source, build: { outDir, emptyOutDir: false, target: "chrome106", lib: { entry: resolve(source, `src/${name}.ts`), name: `ShippingClip${name}`, formats: ["iife"], fileName: () => `${name}.js` } } })
  }
  await mkdir(resolve(outDir, "licenses"), { recursive: true })
  if (synthetic) {
    await writeFile(resolve(outDir, "manifest.json"), JSON.stringify({ ...manifest, name: "Shipping HOT 剪藏【合成测试版】", version_name: `${manifest.version}-synthetic-test`, description: "仅本地原创合成页测试；非正式HTTPS验收。" }, null, 2))
  } else {
    await copyFile(resolve(source, "manifest.json"), resolve(outDir, "manifest.json"))
  }
  await copyFile(resolve(root, "third_party/obsidian-clipper/LICENSE"), resolve(outDir, "licenses/obsidian-clipper-MIT.txt"))
  await copyFile(resolve(root, "node_modules/defuddle/LICENSE"), resolve(outDir, "licenses/defuddle-MIT.txt"))
  console.log(JSON.stringify({ outDir, synthetic, extensionId: id, origin: "http://127.0.0.1:5173", installed: false }))
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 2) throw new Error("normal_clipper_build_accepts_no_flags")
  await buildClipper(false)
}
