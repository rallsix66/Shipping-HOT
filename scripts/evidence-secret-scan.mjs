#!/usr/bin/env node
// Evidence archive secret scanner / redactor. Prints only file, field, count — never values.
// Usage: node scripts/evidence-secret-scan.mjs [--redact] [--self-test] <dir-or-file>...
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

export const REDACTED = "[REDACTED]"
const NAME = String.raw`[\w\-]*(?:api[_\-]?key|secret|token|passw(?:or)?d|access[_\-]?key|private[_\-]?key|auth[_\-]?key|session[_\-]?id|credential)[\w\-]*`
// field: "value" | \"field\":\"value\" | 'field': 'value' | field=value  (all occurrences per line)
const FIELD_RE = new RegExp(String.raw`(\\?["']?)(${NAME})\1(\s*[:=]\s*)(\\?["'])([^"'\\\s<>]{8,})(\4)`, "gi")
const SHAPES = [
  ["google_api_key", /AIza[\w\-]{35}/g],
  ["aws_access_key_id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["jwt", /\beyJ[\w\-]{10,}\.[\w\-]{10,}\.[\w\-]{10,}/g],
  ["github_token", /\bgh[opsru]_[a-z0-9]{36,}\b/gi],
  ["slack_token", /\bxox[abprs]-[a-z0-9\-]{10,}/gi],
  ["private_key_block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
]
const NON_SECRET = /^(?:true|false|null|undefined|\[REDACTED\]|REDACTED)$/i

export function scanText(text, { redact = false } = {}) {
  const counts = new Map()
  const bump = k => counts.set(k, (counts.get(k) ?? 0) + 1)
  let out = text.replace(FIELD_RE, (m, q, name, sep, vq, value, vq2) => {
    if (NON_SECRET.test(value) || value.includes(REDACTED))
      return m
    bump(`field:${name}`)
    return redact ? `${q}${name}${q}${sep}${vq}${REDACTED}${vq2}` : m
  })
  for (const [label, re] of SHAPES) {
    out = out.replace(re, (m) => {
      bump(`shape:${label}`)
      return redact ? REDACTED : m
    })
  }
  return { counts, text: out }
}

function walk(p, acc = []) {
  if (statSync(p).isDirectory()) {
    for (const n of readdirSync(p).sort())
      walk(join(p, n), acc)
  } else {
    acc.push(p)
  }
  return acc
}

function selfTest() {
  // Synthetic positive controls (fabricated, not real keys).
  const fake = `AIza${"S".repeat(35)}`
  const sample = [
    `<script>window.__CFG__={"googleMapsApiKey":"${fake}","googleMapsBuyerApiKeyLive":"${fake}","googleMapsOrderOpsApiKeyNonLive":"${fake}"}</script>`,
    `{\\"clientSecret\\":\\"synthetic-secret-123456\\",\\"accessToken\\":\\"synthetic-token-abcdef\\"}`,
    `api_key='synthetic-value-0001' x=1 session_id="synthetic-session-0002"`,
    `"tokenizer": "false"`,
  ].join("\n")
  const r = scanText(sample, { redact: true })
  const total = [...r.counts.values()].reduce((a, b) => a + b, 0)
  const leaks = scanText(r.text).counts.size
  const ok = total === 7 && leaks === 0 && !r.text.includes(fake) && r.text.includes("googleMapsBuyerApiKeyLive")
  console.log(`self-test: hits=${total} residual_after_redact=${leaks} fields_kept=${r.text.includes("googleMapsApiKey")} result=${ok ? "PASS" : "FAIL"}`)
  return ok
}

const args = process.argv.slice(2)
const redact = args.includes("--redact")
let failed = false
if (args.includes("--self-test"))
  failed ||= !selfTest()
let totalHits = 0
for (const root of args.filter(a => !a.startsWith("--"))) {
  for (const file of walk(root)) {
    const r = scanText(readFileSync(file, "utf8"), { redact })
    for (const [k, n] of [...r.counts].sort()) {
      console.log(`${file.replace(/\\/g, "/")}\t${k}\tcount=${n}`)
      totalHits += n
    }
    if (redact && r.counts.size)
      writeFileSync(file, r.text, "utf8")
  }
}
console.log(`total_hits=${totalHits} mode=${redact ? "redact" : "scan"}`)
process.exit(failed ? 2 : totalHits > 0 && !redact ? 1 : 0)
