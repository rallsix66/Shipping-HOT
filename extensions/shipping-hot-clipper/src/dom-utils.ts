// Adapted from obsidian-clipper@6d56d618b00bd970aa738d6a7a61edee27783e81 src/utils/dom-utils.ts:30-43 (MIT).
export function serializeChildren(element: Element): string {
  return Array.from(element.childNodes).map((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).outerHTML
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      return `<!--${node.textContent ?? ""}-->`
    }
    return ""
  }).join("")
}
