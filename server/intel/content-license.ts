import type { IntelBlock, IntelContentScope, IntelPersistence } from "#/database/intel"

const BLOCK_CHARS = 2000
const EXCERPT_CHARS = 280

export function contentScopeFor(persistence: IntelPersistence): IntelContentScope {
  return persistence === "full" ? "full_text" : persistence === "excerpt_only" ? "excerpt" : "metadata_only"
}

/** A read may narrow stored rights to the current policy, never widen them. */
export function permittedContentScope(persistence: IntelPersistence, stored: IntelContentScope): IntelContentScope {
  const current = persistence === "full" ? 2 : persistence === "excerpt_only" ? 1 : 0
  const original = stored === "full_text" ? 2 : stored === "excerpt" ? 1 : 0
  return (["metadata_only", "excerpt", "full_text"] as const)[Math.min(current, original)]
}

/** Blocks kept for one version, limited to what the source license allows. */
export function licensedBlocks(scope: IntelContentScope, title: string, bodyText: string): IntelBlock[] {
  const blocks: IntelBlock[] = [{ blockKey: "title", order: 0, type: "title", text: title }]
  if (scope === "metadata_only" || !bodyText) return blocks
  if (scope === "excerpt") {
    const excerpt = bodyText.length <= EXCERPT_CHARS ? bodyText : `${bodyText.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`
    blocks.push({ blockKey: "excerpt", order: 1, type: "excerpt", text: excerpt })
    return blocks
  }
  for (let offset = 0, index = 0; offset < bodyText.length; offset += BLOCK_CHARS, index++) {
    blocks.push({ blockKey: `p${index}`, order: index + 1, type: "paragraph", text: bodyText.slice(offset, offset + BLOCK_CHARS) })
  }
  return blocks
}
