import { createHash, createPublicKey } from "node:crypto"
import { readFileSync } from "node:fs"
import { Buffer } from "node:buffer"
import { expect, it } from "vitest"
import { CLIP_EXTENSION_ID, CLIP_ORIGIN } from "../shared/clipper-bridge"

it("keeps the clipping preview free of identity, rights and time-role forms", () => {
  const popup = readFileSync("extensions/shipping-hot-clipper/popup.html", "utf8")
  expect(popup).not.toMatch(/<input[^>]*id="operator"/)
  for (const id of ["basis", "scope", "evidence", "role"]) expect(popup).not.toContain(`id="${id}"`)
  expect(popup).not.toMatch(/<(input|select)[^>]*id="date"/)
})

it("pins a public-only stable extension ID and the narrow local message surface", () => {
  const manifest = JSON.parse(readFileSync("extensions/shipping-hot-clipper/manifest.json", "utf8"))
  const publicDer = Buffer.from(manifest.key, "base64")
  expect(createPublicKey({ key: publicDer, type: "spki", format: "der" }).type).toBe("public")
  const id = [...createHash("sha256").update(publicDer).digest().subarray(0, 16)].map(b => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join("")
  expect(id).toBe(CLIP_EXTENSION_ID)
  expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"])
  expect(manifest.externally_connectable).toEqual({ ids: [], matches: [`${CLIP_ORIGIN}/feed`] })
  expect(manifest).not.toHaveProperty("host_permissions")
  expect(manifest).not.toHaveProperty("content_scripts")
  expect(manifest.content_security_policy.extension_pages).toContain("connect-src 'none'")
})
