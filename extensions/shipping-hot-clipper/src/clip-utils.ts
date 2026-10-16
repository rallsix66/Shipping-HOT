// Adapted from obsidian-clipper@6d56d618b00bd970aa738d6a7a61edee27783e81 src/utils/clip-utils.ts:6-20 (MIT).
// Removed Obsidian reader DOM recovery; core synchronous parser only.
import Defuddle from "defuddle"

export function parseForClip(doc: Document) {
  return new Defuddle(doc, { url: "https://clipper.invalid/", useAsync: false, removeImages: true, includeReplies: false, fetch: async () => {
    throw new Error("clip_network_disabled")
  } }).parse()
}
