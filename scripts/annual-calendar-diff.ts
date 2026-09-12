import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { projectDir } from "@shared/dir"
import { diffAnnualDatasets, formatAnnualDiff, parseAnnualFile, validateAnnualDataset } from "#/services/annual-calendar-diff"

// Repeatable, read-only candidate-vs-runtime validation and diff (A3-07).
// Never writes, commits or pushes.
const candidateRoot = join(projectDir, "docs", "data-candidates", "calendar")
const runtimeRoot = join(projectDir, "server", "data", "annual-calendar")

let invalid = 0
const reports: string[] = []

for (const country of readdirSync(candidateRoot).sort()) {
  const countryDir = join(candidateRoot, country)
  let years: string[]
  try {
    years = readdirSync(countryDir).sort()
  } catch {
    continue
  }
  for (const yearDir of years) {
    const candidatePath = join(countryDir, yearDir, "calendar.json")
    if (!existsSync(candidatePath)) continue
    const candidate = parseAnnualFile(candidatePath)
    const expectedYear = Number(yearDir)
    const issues = validateAnnualDataset(candidate, country, Number.isInteger(expectedYear) ? expectedYear : undefined)
    if (issues.length > 0) invalid += 1

    const runtimePath = join(runtimeRoot, `${country}-${yearDir}.json`)
    const runtime = existsSync(runtimePath) ? parseAnnualFile(runtimePath) : undefined
    const diff = diffAnnualDatasets(candidate, runtime ?? {})
    const label = `${country}-${yearDir}${runtime ? "" : " (no runtime snapshot)"}`
    reports.push(formatAnnualDiff(label, diff, issues))
  }
}

process.stdout.write(`${reports.join("\n\n")}\n`)
process.stdout.write(`\ninvalidDatasets=${invalid}\n`)
process.exitCode = invalid === 0 ? 0 : 1
