import { createHash } from "node:crypto"
import { type ArticleBlock, canonicalArticleBlocks } from "@shared/article"

/**
 * Server-side SHA-256 of an article version's canonical content. Uses Node's
 * built-in `node:crypto` (no new dependency, no schema change). The input is the
 * shared canonical serialization, so identical extracted content dedupes while a
 * real body/structure change produces a new version.
 */
export function computeArticleContentHash(blocks: readonly ArticleBlock[]): string {
  return createHash("sha256").update(canonicalArticleBlocks(blocks)).digest("hex")
}
