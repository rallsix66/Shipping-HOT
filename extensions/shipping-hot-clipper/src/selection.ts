// Adapted from obsidian-clipper@6d56d618b00bd970aa738d6a7a61edee27783e81 src/content.ts:205-214 (MIT).
import { serializeChildren } from "./dom-utils"

export function selectedHTML() {
  let selectedHtml = ""
  const selection = window.getSelection()

  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    const clonedSelection = range.cloneContents()
    const div = document.createElement("div")
    div.appendChild(clonedSelection)
    selectedHtml = serializeChildren(div)
  }
  return selectedHtml
}
