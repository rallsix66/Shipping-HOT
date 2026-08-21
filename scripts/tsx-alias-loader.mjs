import { existsSync } from "node:fs"
import { resolve as pathResolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const projectRoot = pathResolve(fileURLToPath(new URL("..", import.meta.url)))

function aliasPath(base, relativePath) {
  const candidate = pathResolve(projectRoot, base, relativePath)
  for (const suffix of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts"]) {
    if (existsSync(`${candidate}${suffix}`)) return pathToFileURL(`${candidate}${suffix}`).href
  }
  return pathToFileURL(candidate).href
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@shared/")) return nextResolve(aliasPath("shared", specifier.slice("@shared/".length)), context)
  if (specifier.startsWith("#/")) return nextResolve(aliasPath("server", specifier.slice(2)), context)
  return nextResolve(specifier, context)
}
